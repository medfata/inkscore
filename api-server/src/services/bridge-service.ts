// Bridge volume computation (Relay / Ink Official / Native Bridge USDT0 / Bungee).
//
// Extracted VERBATIM from routes/backup_wallet.ts (Sprint 1 — "move, don't
// rewrite"). The route is now a thin shell: responseCache get/set + this call.
// The in-flight dedup and the 5-min long cache live here so the score can call
// the service directly (no loopback HTTP) and still share the dashboard's
// in-flight computation.

import { getLongCache } from '../cache';
import {
  getBridgeInflows,
  getProtocolTxHashes,
  getTxData,
  getTxLogs,
  partitionTxHashes,
} from './blockscout-service';
import { getTokenInfo } from './token-info-service';
import { pool } from '../db';

// Relay wallet handles both "Relay" and "Ink Official" based on method selectors (Bridge IN)
const RELAY_WALLET = '0xf70da97812cb96acdf810712aa562db8dfa3dbef';

// Relay deposit contract for Bridge OUT (depositNative) - shared by Relay and Ink Official
const RELAY_DEPOSIT_CONTRACT = '0x4cd00e387622c35bddb9b4c962c136462338bc31';

// Method selectors for Ink Official bridge IN
const INK_OFFICIAL_METHODS = ['0x0c6d9703', '0x5819bf3d'];

// OFT Adapter contract address for Native Bridge (USDT0) - Bridge OUT
const OFT_ADAPTER_ADDRESS = '0x1cb6de532588fca4a21b7209de7c456af8434a65';

// LayerZero Executor contract for Native Bridge (USDT0) - Bridge IN
const LZ_EXECUTOR_ADDRESS = '0xfebcf17b11376c724ab5a5229803c6e838b6eae5';

// Bungee contracts
const BUNGEE_SOCKET_GATEWAY = '0x3a23f943181408eac424116af7b7790c94cb97a5';
const BUNGEE_FULFILLMENT_CONTRACT = '0x26d8da52e56de71194950689ccf74cd309761324';
const BUNGEE_REQUEST_CONTRACT = '0xe18dfefce7a5d18d39ce6fc925f102286fa96fdc';

// Event signatures
const OFT_SENT_SIGNATURE = '0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a';
const OFT_RECEIVED_SIGNATURE = '0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c';
const SOCKET_BRIDGE_SIGNATURE = '0x74594da9e31ee4068e17809037db37db496702bf7d8d63afe6f97949277d1609';
const SOCKET_SWAP_TOKENS_SIGNATURE = '0xb346a959ba6c0f1c7ba5426b10fd84fe4064e392a0dfcf6609e9640a0dd260d3';

const USDT0_DECIMALS = 6;

// All bridge platforms configuration
const ALL_BRIDGE_PLATFORMS: Record<string, { logo: string; url: string }> = {
    'Native Bridge (USDT0)': {
        logo: 'https://pbs.twimg.com/profile_images/1879546764971188224/SQISVYwX_400x400.jpg',
        url: 'https://usdt0.to',
    },
    'Ink Official': {
        logo: 'https://inkonchain.com/favicon.ico',
        url: 'https://inkonchain.com/bridge',
    },
    'Relay': {
        logo: 'https://relay.link/favicon.ico',
        url: 'https://relay.link',
    },
    'Bungee': {
        logo: 'https://www.bungee.exchange/favicon.ico',
        url: 'https://www.bungee.exchange',
    },
};

export interface BridgeVolumeResponse {
    totalEth: number;
    totalUsd: number;
    txCount: number;
    bridgedInUsd: number;
    bridgedInCount: number;
    bridgedOutUsd: number;
    bridgedOutCount: number;
    partial?: boolean;
    byPlatform: Array<{
        platform: string;
        ethValue: number;
        usdValue: number;
        txCount: number;
        logo: string;
        url: string;
        bridgedInUsd?: number;
        bridgedInCount?: number;
        bridgedOutUsd?: number;
        bridgedOutCount?: number;
    }>;
}

function parseOftSentAmount(data: string): bigint {
    try {
        const cleanData = data.startsWith('0x') ? data.slice(2) : data;
        const amountHex = cleanData.slice(64, 128);
        return amountHex ? BigInt('0x' + amountHex) : BigInt(0);
    } catch {
        return BigInt(0);
    }
}

function parseOftReceivedAmount(data: string): bigint {
    try {
        const cleanData = data.startsWith('0x') ? data.slice(2) : data;
        const amountHex = cleanData.slice(64, 128);
        return amountHex ? BigInt('0x' + amountHex) : BigInt(0);
    } catch {
        return BigInt(0);
    }
}

function extractAddressFromTopic(topic: string): string {
    const cleanTopic = topic.startsWith('0x') ? topic.slice(2) : topic;
    return '0x' + cleanTopic.slice(-40).toLowerCase();
}

// Parse SocketBridge event: (uint256 amount, address token, uint256 toChainId, bytes32 bridgeName, address sender, address receiver, bytes32 metadata)
// Returns null on malformed data so one bad log cannot fail the whole route.
function parseSocketBridgeEvent(data: string): { amount: bigint; token: string } | null {
    try {
        const cleanData = data.startsWith('0x') ? data.slice(2) : data;
        // SocketBridge: amount is first 32 bytes, token is second 32 bytes
        const amountHex = cleanData.slice(0, 64);
        const amount = BigInt('0x' + amountHex);
        const tokenHex = cleanData.slice(64, 128);
        const token = '0x' + tokenHex.slice(-40).toLowerCase();
        return { amount, token };
    } catch {
        return null;
    }
}

// Parse SocketSwapTokens event: (address fromToken, address toToken, uint256 buyAmount, uint256 sellAmount, bytes32 routeName, address receiver, bytes32 metadata)
function parseSocketSwapTokensEvent(data: string): { fromToken: string; toToken: string; buyAmount: bigint; sellAmount: bigint } {
    const cleanData = data.startsWith('0x') ? data.slice(2) : data;
    const fromToken = '0x' + cleanData.slice(24, 64).toLowerCase();
    const toToken = '0x' + cleanData.slice(88, 128).toLowerCase();
    const buyAmount = BigInt('0x' + cleanData.slice(128, 192));
    const sellAmount = BigInt('0x' + cleanData.slice(192, 256));
    return { fromToken, toToken, buyAmount, sellAmount };
}

// Safe wei -> ETH: one malformed `value` must not throw and wipe a whole
// flow's volume (previously `Number(BigInt(v))` threw inside the loop and
// the catch skipped ALL bridge-OUT txs).
function safeWeiToEth(value: string | null | undefined): number {
    if (!value || value === '0') return 0;
    try {
        return Number(BigInt(value)) / 1e18;
    } catch {
        return 0;
    }
}

// Bounded parallel map (concurrency cap so we don't spike DeFi Llama /
// Blockscout). Preserves input order.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (next < items.length) {
            const idx = next++;
            results[idx] = await fn(items[idx]);
        }
    });
    await Promise.all(workers);
    return results;
}

// In-flight dedup: concurrent requests for the same wallet (frontend +
// score self-fetch routinely arrive together — the double "discovery
// completed" lines in logs) share one computation instead of doubling
// Blockscout load and tripping the 150 req/min throttle.
const bridgeInflight = new Map<string, Promise<BridgeVolumeResponse>>();

// Long cache for COMPLETE bridge results. The shared responseCache TTL is
// only 30s, so every score poll recomputed 3 full Blockscout history walks.
// Bridge history is append-only; 5 min is safe and cuts cold computes ~10x.
// Partial (truncated) results are NOT long-cached — they must be recomputed
// so USD converges to complete over successive loads.
const bridgeLongCache = new Map<string, { data: BridgeVolumeResponse; timestamp: number }>();
const BRIDGE_LONG_CACHE_TTL = 5 * 60 * 1000;

export async function getBridgeVolume(walletAddress: string): Promise<BridgeVolumeResponse> {
    const requestStart = Date.now();

    const longCached = bridgeLongCache.get(walletAddress);
    if (longCached && Date.now() - longCached.timestamp < BRIDGE_LONG_CACHE_TTL && longCached.data.partial !== true) {
        return longCached.data;
    }
    const inflight = bridgeInflight.get(walletAddress);
    if (inflight) {
        try {
            return await inflight;
        } catch {
            // Fall through and compute fresh if the shared run failed.
        }
    }

    const compute = (async (): Promise<BridgeVolumeResponse> => {

        const platformData: Record<string, {
            ethValue: number;
            usdValue: number;
            txCount: number;
            bridgedInUsd?: number;
            bridgedInCount?: number;
            bridgedOutUsd?: number;
            bridgedOutCount?: number;
        }> = {
            'Native Bridge (USDT0)': { ethValue: 0, usdValue: 0, txCount: 0 },
            'Ink Official': { ethValue: 0, usdValue: 0, txCount: 0 },
            'Relay': { ethValue: 0, usdValue: 0, txCount: 0 },
            'Bungee': { ethValue: 0, usdValue: 0, txCount: 0 },
        };

        let totalEth = 0;
        let totalTxCount = 0;
        let bridgedInUsd = 0;
        let bridgedInCount = 0;
        let bridgedOutUsd = 0;
        let bridgedOutCount = 0;

        // Get ETH price
        let ethPrice = 3500;
        try {
            const priceResult = await pool.query(
                `SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 1`
            );
            ethPrice = priceResult.rows[0]?.price_usd || 3500;
        } catch {
            // Use fallback price
        }

        // Bridge discovery via Blockscout (replaces dead Routescan/enrichment
        // reads). Each flow resolves tx hashes, then amounts from native
        // value + transfer legs. Log-topic parsing (OFT/SocketBridge) ports
        // verbatim — Blockscout log topics/data are identical semantics.
        // NOTE: ETH legs use the CURRENT price (old code used per-tx
        // historical eth_price_usd, unrecoverable from Blockscout).
        const WETH_LOW = '0x4200000000000000000000000000000000000006';
        const dbStart = Date.now();
        const [
            relayOutHashes,
            oftHashes,
            bungeeOutHashes,
            gatewayHashes,
        ] = await Promise.all([
            getProtocolTxHashes(walletAddress, RELAY_DEPOSIT_CONTRACT, null, null, 10, 'out'),
            getProtocolTxHashes(walletAddress, OFT_ADAPTER_ADDRESS, null, null, 10, 'out'),
            getProtocolTxHashes(walletAddress, BUNGEE_REQUEST_CONTRACT, null, null, 10, 'out'),
            getProtocolTxHashes(walletAddress, BUNGEE_SOCKET_GATEWAY, null, null, 10, 'out'),
        ]);
        console.log(`[Bridge ${walletAddress}] discovery completed in ${Date.now() - dbStart}ms`);

        // Cap priced txs per flow (permanent legs cache => converges over loads).
        const priceCap = async (hashes: string[]) => {
            const { cached: ch, uncached: uh } = await partitionTxHashes(hashes);
            const priced = [...ch, ...uh.slice(0, 1000)];
            return { priced, partial: ch.length + Math.min(uh.length, 1000) < hashes.length };
        };
        let bridgePartial = false;

        // Bridge IN via wallet-centric inflows. Contract-centric from/to
        // queries structurally miss solver/relayer-originated fills (top-level
        // from=solver, wallet only internal/in topics) — the wallet's own
        // inbound transfers catch them regardless of origin.
        try {
            const { inflows, complete: inflowsComplete } = await getBridgeInflows(walletAddress, {
                relayWallet: RELAY_WALLET,
                oftAdapter: OFT_ADAPTER_ADDRESS,
                lzExecutor: LZ_EXECUTOR_ADDRESS,
                bungeeFulfill: BUNGEE_FULFILLMENT_CONTRACT,
            });
            bridgePartial = bridgePartial || !inflowsComplete;

            // OFT topic validation set for usdt0 classification (cached logs).
            const usdt0Hashes = inflows.filter((i) => i.bucket === 'usdt0').map((i) => i.txHash).slice(0, 200);
            const usdt0Logs = await getTxLogs(usdt0Hashes);
            const hasOftReceived = (h: string): boolean | null => {
                const logs = usdt0Logs.get(h);
                if (!logs || logs.length === 0) return null; // unknown: fail open
                return logs.some(
                    (l) =>
                        (l.address || '').toLowerCase() === OFT_ADAPTER_ADDRESS.toLowerCase() &&
                        (l.topics?.[0] || '').toLowerCase() === OFT_RECEIVED_SIGNATURE.toLowerCase() &&
                        l.topics?.[2] && extractAddressFromTopic(l.topics[2]) === walletAddress
                );
            };

            const priceInflowToken = async (tokenAddress: string, fallbackXR: number): Promise<number> => {
                if (fallbackXR > 0) return fallbackXR;
                try {
                    const info = await getTokenInfo(tokenAddress);
                    return info.price > 0.00002 ? info.price : 0;
                } catch {
                    return 0;
                }
            };

            // Batch-fetch missing token prices IN PARALLEL (was: sequential
            // `await` per inflow, up to 3s DeFi Llama timeout each — N
            // inflows x 3s easily exceeded the score's fetch budget and
            // produced the bridge TimeoutError). Exchange-rate legs skip
            // the network entirely.
            const tokensNeedingPrice = [...new Set(
                inflows.filter((i) => !i.isNative && !(i.exchangeRate > 0)).map((i) => i.tokenAddress.toLowerCase())
            )];
            const inflowPrices = new Map<string, number>();
            if (tokensNeedingPrice.length > 0) {
                const fetched = await mapWithConcurrency(tokensNeedingPrice, 10, (t) => priceInflowToken(t, 0));
                tokensNeedingPrice.forEach((t, idx) => inflowPrices.set(t, fetched[idx]));
            }

            for (const inf of inflows) {
                let usdValue = 0;
                let ethValue = 0;
                if (inf.isNative) {
                    ethValue = inf.amount;
                    usdValue = ethValue * ethPrice;
                } else if (inf.exchangeRate > 0) {
                    usdValue = inf.amount * inf.exchangeRate;
                    if (inf.tokenAddress === WETH_LOW) ethValue = inf.amount;
                } else {
                    const price = inflowPrices.get(inf.tokenAddress.toLowerCase()) ?? 0;
                    if (price <= 0) continue;
                    usdValue = inf.amount * price;
                    if (inf.tokenAddress === WETH_LOW) ethValue = inf.amount;
                }
                if (usdValue === 0) continue;

                if (inf.bucket === 'usdt0') {
                    const topicOk = hasOftReceived(inf.txHash);
                    if (topicOk === false) continue;
                    platformData['Native Bridge (USDT0)'].usdValue += usdValue;
                    platformData['Native Bridge (USDT0)'].txCount += 1;
                    platformData['Native Bridge (USDT0)'].bridgedInUsd =
                        (platformData['Native Bridge (USDT0)'].bridgedInUsd || 0) + usdValue;
                    platformData['Native Bridge (USDT0)'].bridgedInCount =
                        (platformData['Native Bridge (USDT0)'].bridgedInCount || 0) + 1;
                    totalTxCount += 1;
                    bridgedInUsd += usdValue;
                    bridgedInCount += 1;
                } else if (inf.bucket === 'bungee') {
                    // Skip huge values (same sanity cap as before)
                    if (usdValue > 1_000_000) continue;
                    platformData['Bungee'].ethValue += ethValue;
                    platformData['Bungee'].usdValue += usdValue;
                    platformData['Bungee'].txCount += 1;
                    platformData['Bungee'].bridgedInUsd = (platformData['Bungee'].bridgedInUsd || 0) + usdValue;
                    platformData['Bungee'].bridgedInCount = (platformData['Bungee'].bridgedInCount || 0) + 1;
                    totalEth += ethValue;
                    totalTxCount += 1;
                    bridgedInUsd += usdValue;
                    bridgedInCount += 1;
                } else {
                    const selector = (inf.selector || '').toLowerCase();
                    const platform = INK_OFFICIAL_METHODS.includes(selector) ? 'Ink Official' : 'Relay';
                    platformData[platform].ethValue += ethValue;
                    platformData[platform].usdValue += usdValue;
                    platformData[platform].txCount += 1;
                    platformData[platform].bridgedInUsd = (platformData[platform].bridgedInUsd || 0) + usdValue;
                    platformData[platform].bridgedInCount = (platformData[platform].bridgedInCount || 0) + 1;
                    totalEth += ethValue;
                    totalTxCount += 1;
                    bridgedInUsd += usdValue;
                    bridgedInCount += 1;
                }
            }
        } catch (dbError: unknown) {
            console.error('Error processing bridge IN flows:', dbError instanceof Error ? dbError.message : dbError);
        }


        // 1b. Process Relay/Ink Official bridge OUT transactions (depositNative)
        try {
            let sharedBridgeOutEth = 0;
            let sharedBridgeOutUsd = 0;
            let sharedBridgeOutCount = 0;

            const { priced, partial } = await priceCap(relayOutHashes.hashes);
            bridgePartial = bridgePartial || partial || !relayOutHashes.complete;
            const txData = await getTxData(priced);
            for (const h of priced) {
                const meta = txData.get(h)?.meta;
                // Count every tx (even $0), matching old behavior.
                // safeWeiToEth: a malformed value must not throw and wipe
                // the whole OUT flow (previously one bad row skipped ALL).
                const ethValue = safeWeiToEth(meta?.value);
                const usdValue = ethValue * ethPrice;

                sharedBridgeOutEth += ethValue;
                sharedBridgeOutUsd += usdValue;
                sharedBridgeOutCount += 1;
            }

            if (sharedBridgeOutCount > 0) {
                platformData['Ink Official'].ethValue += sharedBridgeOutEth;
                platformData['Ink Official'].usdValue += sharedBridgeOutUsd;
                platformData['Ink Official'].txCount += sharedBridgeOutCount;
                platformData['Ink Official'].bridgedOutUsd = (platformData['Ink Official'].bridgedOutUsd || 0) + sharedBridgeOutUsd;
                platformData['Ink Official'].bridgedOutCount = (platformData['Ink Official'].bridgedOutCount || 0) + sharedBridgeOutCount;

                platformData['Relay'].bridgedOutUsd = (platformData['Relay'].bridgedOutUsd || 0) + sharedBridgeOutUsd;
                platformData['Relay'].bridgedOutCount = (platformData['Relay'].bridgedOutCount || 0) + sharedBridgeOutCount;

                totalEth += sharedBridgeOutEth;
                totalTxCount += sharedBridgeOutCount;
                bridgedOutUsd += sharedBridgeOutUsd;
                bridgedOutCount += sharedBridgeOutCount;
            }
        } catch (dbError: unknown) {
            console.error('Error querying Relay/Ink Official OUT:', dbError instanceof Error ? dbError.message : dbError);
        }

        // 2a. Native Bridge (USDT0) IN is covered by the wallet-centric
        // inflows above (usdt0 bucket, OFT topic-validated).

        // 2b. Process Native Bridge (USDT0) OUT transactions
        try {
            const { priced, partial } = await priceCap(oftHashes.hashes.slice(0, 200));
            bridgePartial = bridgePartial || partial;
            const logsMap = await getTxLogs(priced);
            for (const h of priced) {
                const logs = logsMap.get(h) || [];
                for (const log of logs) {
                    const logAddress = (log.address || '').toLowerCase();
                    const topic0 = log.topics?.[0]?.toLowerCase();
                    const topic2 = log.topics?.[2];

                    if (logAddress !== OFT_ADAPTER_ADDRESS.toLowerCase()) continue;
                    if (topic0 !== OFT_SENT_SIGNATURE.toLowerCase()) continue;
                    if (!topic2) continue;

                    const eventWallet = extractAddressFromTopic(topic2);
                    if (eventWallet !== walletAddress) continue;

                    const amountRaw = parseOftSentAmount(log.data);
                    const amountUsd = Number(amountRaw) / Math.pow(10, USDT0_DECIMALS);

                    platformData['Native Bridge (USDT0)'].usdValue += amountUsd;
                    platformData['Native Bridge (USDT0)'].txCount += 1;
                    platformData['Native Bridge (USDT0)'].bridgedOutUsd = (platformData['Native Bridge (USDT0)'].bridgedOutUsd || 0) + amountUsd;
                    platformData['Native Bridge (USDT0)'].bridgedOutCount = (platformData['Native Bridge (USDT0)'].bridgedOutCount || 0) + 1;

                    totalTxCount += 1;
                    bridgedOutUsd += amountUsd;
                    bridgedOutCount += 1;
                }
            }
        } catch (dbError: unknown) {
            console.error('Error querying Native Bridge OUT:', dbError instanceof Error ? dbError.message : dbError);
        }


        // 3. Process Bungee bridge transactions
        try {
            // 3a. Bungee Bridge IN is covered by the wallet-centric inflows
            // above (bungee bucket).

            // 3b. Bungee Bridge OUT (CreateRequest)
            const { priced: outPriced, partial: outPartial } = await priceCap(bungeeOutHashes.hashes);
            bridgePartial = bridgePartial || outPartial || !bungeeOutHashes.complete;
            const outTxData = await getTxData(outPriced);
            for (const h of outPriced) {
                const meta = outTxData.get(h)?.meta;
                // Count every tx (even $0), matching old behavior.
                const ethValue = safeWeiToEth(meta?.value);
                const usdValue = ethValue * ethPrice;

                platformData['Bungee'].ethValue += ethValue;
                platformData['Bungee'].usdValue += usdValue;
                platformData['Bungee'].txCount += 1;
                platformData['Bungee'].bridgedOutUsd = (platformData['Bungee'].bridgedOutUsd || 0) + usdValue;
                platformData['Bungee'].bridgedOutCount = (platformData['Bungee'].bridgedOutCount || 0) + 1;

                totalEth += ethValue;
                totalTxCount += 1;
                bridgedOutUsd += usdValue;
                bridgedOutCount += 1;
            }

            // 3c. Legacy Socket Gateway transactions - MUST check for SocketBridge event to distinguish from swaps
            const { priced: gwPriced, partial: gwPartial } = await priceCap(gatewayHashes.hashes.slice(0, 200));
            bridgePartial = bridgePartial || gwPartial;
            const gwTxData = await getTxData(gwPriced);
            const gwLogsMap = await getTxLogs(gwPriced);
            // First pass: classify + collect distinct SocketBridge tokens so
            // DeFi Llama lookups run IN PARALLEL (was: sequential await per
            // tx, each up to 3s — the main cold-load stall after inflows).
            const gwCandidates: Array<{ h: string; amount: bigint; token: string; metaValue?: string | null }> = [];
            for (const h of gwPriced) {
                const meta = gwTxData.get(h)?.meta;
                // Check for failed transactions (replaces operations status check)
                if (meta && meta.ok === false) {
                    continue;
                }
                const logs = gwLogsMap.get(h) || [];

                // CRITICAL: Classify transaction as bridge or swap based on event signatures
                let hasSocketBridge = false;
                let hasSocketSwapTokens = false;
                let socketBridgeData: { amount: bigint; token: string } | null = null;

                for (const log of logs) {
                    const topic0 = log.topics?.[0]?.toLowerCase();

                    if (topic0 === SOCKET_BRIDGE_SIGNATURE.toLowerCase()) {
                        hasSocketBridge = true;
                        // Parse the SocketBridge event to get accurate amount and token
                        if (log.data) {
                            socketBridgeData = parseSocketBridgeEvent(log.data);
                        }
                    }
                    if (topic0 === SOCKET_SWAP_TOKENS_SIGNATURE.toLowerCase()) {
                        hasSocketSwapTokens = true;
                    }
                }

                // Skip if this is a swap (SocketSwapTokens without SocketBridge)
                if (hasSocketSwapTokens && !hasSocketBridge) {
                    continue;
                }

                // Skip if no bridge event found
                if (!hasSocketBridge) {
                    continue;
                }

                if (socketBridgeData) {
                    gwCandidates.push({ h, amount: socketBridgeData.amount, token: socketBridgeData.token, metaValue: meta?.value ?? null });
                } else {
                    // No event data: fallback to native tx value (no price call).
                    const txEthValue = safeWeiToEth(meta?.value);
                    // Guard: ignore dust/absurd values (matches old <1e21 wei cap).
                    if (txEthValue > 0 && txEthValue < 1000) {
                        const txUsdValue = txEthValue * ethPrice;
                        if (txUsdValue > 0 && txUsdValue < 1_000_000) {
                            platformData['Bungee'].ethValue += txEthValue;
                            platformData['Bungee'].usdValue += txUsdValue;
                            platformData['Bungee'].txCount += 1;
                            // Gateway transactions are bridge OUT (user initiating bridge from Ink)
                            platformData['Bungee'].bridgedOutUsd = (platformData['Bungee'].bridgedOutUsd || 0) + txUsdValue;
                            platformData['Bungee'].bridgedOutCount = (platformData['Bungee'].bridgedOutCount || 0) + 1;

                            totalEth += txEthValue;
                            totalTxCount += 1;
                            bridgedOutUsd += txUsdValue;
                            bridgedOutCount += 1;
                        }
                    }
                }
            }
            const gwTokens = [...new Set(gwCandidates.map((c) => c.token.toLowerCase()))];
            const gwTokenInfos = new Map<string, { decimals: number; price: number }>();
            if (gwTokens.length > 0) {
                const fetchedGw = await mapWithConcurrency(gwTokens, 10, (t) =>
                    getTokenInfo(t).catch(() => ({ decimals: 18, symbol: 'UNKNOWN', price: 0.00001, timestamp: 0, confidence: 0 }))
                );
                gwTokens.forEach((t, idx) => gwTokenInfos.set(t, fetchedGw[idx]));
            }
            for (const c of gwCandidates) {
                // This is a confirmed bridge transaction - calculate USD value
                let txUsdValue = 0;
                let txEthValue = 0;

                const tokenLower = c.token.toLowerCase();

                // Native ETH address used in Bungee events
                const NATIVE_ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
                const WETH = '0x4200000000000000000000000000000000000006';

                const tokenInfo = gwTokenInfos.get(tokenLower) ?? { decimals: 18, price: 0.00001 };

                const tokenAmount = Number(c.amount) / Math.pow(10, tokenInfo.decimals);
                txUsdValue = tokenAmount * tokenInfo.price;

                if (tokenLower === NATIVE_ETH || tokenLower === WETH) {
                    txEthValue = tokenAmount;
                }

                // Sanity check and add to totals
                if (txUsdValue > 0 && txUsdValue < 1_000_000) {
                    platformData['Bungee'].ethValue += txEthValue;
                    platformData['Bungee'].usdValue += txUsdValue;
                    platformData['Bungee'].txCount += 1;
                    // Gateway transactions are bridge OUT (user initiating bridge from Ink)
                    platformData['Bungee'].bridgedOutUsd = (platformData['Bungee'].bridgedOutUsd || 0) + txUsdValue;
                    platformData['Bungee'].bridgedOutCount = (platformData['Bungee'].bridgedOutCount || 0) + 1;

                    totalEth += txEthValue;
                    totalTxCount += 1;
                    bridgedOutUsd += txUsdValue;
                    bridgedOutCount += 1;
                }
            }
        } catch (dbError: unknown) {
            console.error('Error querying Bungee:', dbError instanceof Error ? dbError.message : dbError);
        }

        // Build byPlatform array
        const byPlatform = Object.entries(ALL_BRIDGE_PLATFORMS).map(([platform, config]) => ({
            platform,
            ethValue: platformData[platform].ethValue,
            usdValue: platformData[platform].usdValue,
            txCount: platformData[platform].txCount,
            logo: config.logo,
            url: config.url,
            ...(platformData[platform].bridgedInUsd !== undefined && {
                bridgedInUsd: platformData[platform].bridgedInUsd,
                bridgedInCount: platformData[platform].bridgedInCount,
            }),
            ...(platformData[platform].bridgedOutUsd !== undefined && {
                bridgedOutUsd: platformData[platform].bridgedOutUsd,
                bridgedOutCount: platformData[platform].bridgedOutCount,
            }),
        }));

        byPlatform.sort((a, b) => b.usdValue - a.usdValue);

        const totalUsd = Object.values(platformData).reduce((sum, p) => sum + p.usdValue, 0);

        const response: BridgeVolumeResponse = {
            totalEth,
            totalUsd,
            txCount: totalTxCount,
            bridgedInUsd,
            bridgedInCount,
            bridgedOutUsd,
            bridgedOutCount,
            partial: bridgePartial,
            byPlatform,
        };

        if (!bridgePartial) {
            bridgeLongCache.set(walletAddress, { data: response, timestamp: Date.now() });
        }

        console.log(`[Bridge ${walletAddress}] TOTAL REQUEST TIME: ${Date.now() - requestStart}ms${bridgePartial ? ' (partial)' : ''}`);

        return response;
    })();

    bridgeInflight.set(walletAddress, compute);
    try {
        return await compute;
    } finally {
        if (bridgeInflight.get(walletAddress) === compute) {
            bridgeInflight.delete(walletAddress);
        }
    }
}
