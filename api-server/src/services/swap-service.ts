// Swap volume computation (per-DEX: InkySwap, Curve, DyorSwap, Velodrome).
//
// Extracted VERBATIM from routes/backup_wallet.ts (Sprint 1 — "move, don't
// rewrite"). The route is now a thin shell: responseCache get/set + this call.
// The in-flight dedup and the 5-min long cache live here (same cache key as
// before) so the score can call the service directly (no loopback HTTP) and
// still share the dashboard's in-flight computation.

import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolTxHashes, getTxData, partitionTxHashes } from './blockscout-service';
import { getTokenInfo } from './token-info-service';
import { priceService } from './price-service';
import { safeWeiToEth, mapWithConcurrency } from './metrics-utils';
import { pool } from '../db';

export interface SwapVolumeResponse {
    totalEth: number;
    totalUsd: number;
    txCount: number;
    partial?: boolean;
    byPlatform: Array<{
        platform: string;
        contractAddress: string;
        ethValue: number;
        usdValue: number;
        txCount: number;
    }>;
}

// Known swap contract addresses and their platform names
const SWAP_CONTRACTS: Record<string, string> = {
    '0x551134e92e537ceaa217c2ef63210af3ce96a065': 'InkySwap',
    '0xd7e72f3615aa65b92a4dbdc211e296a35512988b': 'Curve',
    '0x9b17690de96fcfa80a3acaefe11d936629cd7a77': 'DyorSwap',
    '0x01d40099fcd87c018969b0e8d4ab1633fb34763c': 'Velodrome',
};

// Common swap method IDs
const SWAP_METHOD_IDS = [
    '0x7ff36ab5', '0x18cbafe5', '0x38ed1739', '0xfb3bdb41',
    '0x4a25d94a', '0x8803dbee', '0xb6f9de95', '0x791ac947',
    '0x5c11d795', '0x3593564c', '0xaad348a2',
];

// Swap history is append-only (same rationale as Tydro long cache).
const SWAP_LONG_CACHE_TTL = 5 * 60 * 1000;

export async function getSwapVolume(walletAddress: string): Promise<SwapVolumeResponse> {
    // Same key as the pre-extraction route so existing long-cache entries stay
    // valid across the deploy.
    const cacheKey = `wallet:swap:${walletAddress}`;
    const swapLcKey = `long:${cacheKey}`;

    // Swap history is append-only: share in-flight work and cache longer.
    const swapLc = getLongCache<SwapVolumeResponse>(swapLcKey, SWAP_LONG_CACHE_TTL);
    if (swapLc && !swapLc.partial) {
        return swapLc;
    }

    return withInflight<SwapVolumeResponse>(swapLcKey, async () => {
        const ALLOWED_DEX_CONTRACTS = Object.keys(SWAP_CONTRACTS).map(addr => addr.toLowerCase());

        // Swap tx hashes per DEX via Blockscout (method selectors enforced
        // server-side). USD per tx = max transfer leg (same semantics as the
        // old log parser): DeFi Llama price first (parity), Blockscout
        // exchange_rate fallback, native ETH value last.
        const ethPriceSwap = await priceService.getCurrentPrice().catch(() => 3500);
        const platformAggregates = new Map<string, { ethValue: number; usdValue: number; txCount: number }>();
        let swapPartial = false;

        await Promise.all(ALLOWED_DEX_CONTRACTS.map(async (contractAddr) => {
            const platformName = SWAP_CONTRACTS[contractAddr] || 'Unknown DEX';
            const { hashes, complete } = await getProtocolTxHashes(walletAddress, contractAddr, SWAP_METHOD_IDS);
            // Discovery truncation (page cap not yet walked): the returned set
            // is a subset of history. Never silent — partial drives the
            // background completion loop (bundle job resumes below the floor).
            if (!complete) swapPartial = true;
            const { cached, uncached } = await partitionTxHashes(hashes);
            const priced = [...cached, ...uncached.slice(0, 1000)];
            if (cached.length + Math.min(uncached.length, 1000) < hashes.length) {
                swapPartial = true;
            }
            const txData = await getTxData(priced);

            // Batch missing-token price lookups (was: sequential await per
            // leg, up to 3s DeFi Llama timeout each).
            const missingTokens = [...new Set(
                priced.flatMap((h) => txData.get(h)?.legs || [])
                    .filter((leg) => !(leg.exchangeRate > 0))
                    .map((leg) => leg.tokenAddress.toLowerCase())
            )];
            const legPrices = new Map<string, number>();
            if (missingTokens.length > 0) {
                const fetched = await mapWithConcurrency(missingTokens, 10, (t) =>
                    getTokenInfo(t).then((info) => (info.price > 0.00002 ? info.price : 0)).catch(() => 0)
                );
                missingTokens.forEach((t, i) => legPrices.set(t, fetched[i]));
            }

            let usdSum = 0;
            for (const h of priced) {
                const legs = txData.get(h)?.legs || [];
                let txUsd = 0;
                for (const leg of legs) {
                    // Blockscout exchange_rate first (instant, no extra call);
                    // DeFi Llama fallback when unlisted (same source as before).
                    const price = leg.exchangeRate || legPrices.get(leg.tokenAddress.toLowerCase()) || 0;
                    const v = leg.amount * price;
                    if (v > txUsd) txUsd = v;
                }
                if (txUsd === 0) {
                    const meta = txData.get(h)?.meta;
                    txUsd = safeWeiToEth(meta?.value) * ethPriceSwap;
                }
                usdSum += txUsd;
            }

            platformAggregates.set(contractAddr, { ethValue: 0, usdValue: usdSum, txCount: hashes.length });
        }));

        let totalEth = 0;
        let totalUsd = 0;
        let totalTxCount = 0;
        const byPlatform: SwapVolumeResponse['byPlatform'] = [];

        for (const [contractAddr, aggregate] of platformAggregates) {
            if (aggregate.txCount === 0) continue; // omit empty platforms
            totalEth += aggregate.ethValue;
            totalUsd += aggregate.usdValue;
            totalTxCount += aggregate.txCount;

            let platformName = SWAP_CONTRACTS[contractAddr];

            if (!platformName) {
                try {
                    const contractResult = await pool.query(
                        `SELECT name FROM contracts WHERE LOWER(address) = LOWER($1)`,
                        [contractAddr]
                    );
                    platformName = contractResult.rows[0]?.name || 'Unknown DEX';
                } catch {
                    platformName = 'Unknown DEX';
                }
            }

            byPlatform.push({
                platform: platformName,
                contractAddress: contractAddr,
                ethValue: aggregate.ethValue,
                usdValue: aggregate.usdValue,
                txCount: aggregate.txCount,
            });
        }

        byPlatform.sort((a, b) => b.usdValue - a.usdValue);

        const response: SwapVolumeResponse = {
            totalEth,
            totalUsd,
            txCount: totalTxCount,
            partial: swapPartial,
            byPlatform,
        };

        if (!swapPartial) {
            setLongCache(swapLcKey, response);
        }

        return response;
    });
}
