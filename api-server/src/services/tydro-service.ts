import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolTxHashes, getTxData, getTxLogs, partitionTxHashes } from './blockscout-service';
import { priceService } from './price-service';
import { safeWeiToEth, mapWithConcurrency } from './metrics-utils';

// Tydro contract addresses (lowercase)
const TYDRO_CONTRACTS = [
    '0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2',
    '0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba',
];

// Method IDs for categorization
const SUPPLY_METHODS = ['0x474cf53d', '0x617ba037'];
const WITHDRAW_METHODS = ['0x80500d20', '0x69328dec'];
const BORROW_METHODS = ['0xe74f7b85', '0xa415bcad'];
const REPAY_METHODS = ['0xbcc3c255', '0x573ade81'];

// Known tokens for price calculation
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; usdPegged?: boolean; ethPegged?: boolean; btcPegged?: boolean }> = {
    '0xe343167631d89b6ffc58b88d6b7fb0228795491d': { symbol: 'USDG', decimals: 18, usdPegged: true },
    '0x0200c29006150606b650577bbe7b6248f58470c1': { symbol: 'USDT', decimals: 6, usdPegged: true },
    '0x2d270e6886d130d724215a266106e6832161eaed': { symbol: 'USDC', decimals: 6, usdPegged: true },
    '0xfc421ad3c883bf9e7c4f42de845c4e4405799e73': { symbol: 'GHO', decimals: 18, usdPegged: true },
    '0xeb466342c4d449bc9f53a865d5cb90586f405215': { symbol: 'axlUSDC', decimals: 6, usdPegged: true },
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18, ethPegged: true },
    '0x2416092f143378750bb29b79ed961ab195cceea5': { symbol: 'ezETH', decimals: 18, ethPegged: true },
    '0xa3d68b74bf0528fdd07263c60d6488749044914b': { symbol: 'weETH', decimals: 18, ethPegged: true },
    '0x9f0a74a92287e323eb95c1cd9ecdbeb0e397cae4': { symbol: 'wrsETH', decimals: 18, ethPegged: true },
    '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98': { symbol: 'kBTC', decimals: 8, btcPegged: true },
};

// BTC price cache
let btcPriceCache: { price: number; timestamp: number } | null = null;
const BTC_PRICE_CACHE_TTL = 5 * 60 * 1000;

async function getBtcPrice(): Promise<number> {
    if (btcPriceCache && Date.now() - btcPriceCache.timestamp < BTC_PRICE_CACHE_TTL) {
        return btcPriceCache.price;
    }
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { signal: AbortSignal.timeout(3000) });
        if (response.ok) {
            const data = await response.json() as { bitcoin?: { usd?: number } };
            const price = data.bitcoin?.usd || 95000;
            btcPriceCache = { price, timestamp: Date.now() };
            return price;
        }
    } catch (error) {
        console.error('Failed to fetch BTC price:', error);
    }
    return btcPriceCache?.price || 95000;
}

export interface TydroResponse {
    currentSupplyUsd: number;
    currentSupplyEth: number;
    totalDepositedUsd: number;
    totalDepositedEth: number;
    totalWithdrawnUsd: number;
    totalWithdrawnEth: number;
    depositCount: number;
    withdrawCount: number;
    currentBorrowUsd: number;
    currentBorrowEth: number;
    totalBorrowedUsd: number;
    totalBorrowedEth: number;
    totalRepaidUsd: number;
    totalRepaidEth: number;
    borrowCount: number;
    repayCount: number;
    partial?: boolean;
}

// Tydro history is append-only: a 5-min long cache + in-flight dedup stops
// the frontend-direct + score-self-fetch pair from each running the full
// multi-hundred-tx pricing pass (the 7.6s stream tail).
const TYDRO_LONG_CACHE_TTL = 5 * 60 * 1000;

async function getTokenPriceUsd(tokenAddress: string, ethPrice: number): Promise<number> {
    const addr = tokenAddress.toLowerCase();
    const token = KNOWN_TOKENS[addr];
    if (token?.usdPegged) return 1;
    if (token?.ethPegged) return ethPrice;
    if (token?.btcPegged) return await getBtcPrice();
    return ethPrice;
}

export async function getTydroData(walletAddress: string): Promise<TydroResponse> {
    const tydrLcKey = 'long:wallet:tydro:' + walletAddress;
    const tydrLc = getLongCache<TydroResponse>(tydrLcKey, TYDRO_LONG_CACHE_TTL);
    if (tydrLc && !tydrLc.partial) {
        return tydrLc;
    }
    return withInflight<TydroResponse>(tydrLcKey, async () => {
        const ethPrice = await priceService.getCurrentPrice();
        const allMethods = [...SUPPLY_METHODS, ...WITHDRAW_METHODS, ...BORROW_METHODS, ...REPAY_METHODS];

        // Tx hashes across both Tydro contracts (selectors enforced server-side).
        // Amounts come from transfer legs: first non-receipt-token leg OUT
        // of the wallet (supply/repay) or INTO it (withdraw/borrow).
        // Counterparty is deliberately NOT constrained to the gateway/pool:
        // gateway-multicall flows route tokens through intermediate contracts
        // (proven: USDT0 wallet->0x99cbf1... on a supply tx). Direction +
        // receipt-exclusion identifies the action amount; each tx carries a
        // single tracked action by method-filter construction.
        // Native-ETH flows (depositETH/repayETH) use tx value exactly as before.
        const RECEIPT_TOKEN = /^(aInk|variableDebt|stableDebt)/i;

        const [gwHashes, poolHashes] = await Promise.all([
            getProtocolTxHashes(walletAddress, TYDRO_CONTRACTS[0], allMethods),
            getProtocolTxHashes(walletAddress, TYDRO_CONTRACTS[1], allMethods),
        ]);
        const allHashes = [...new Set([...gwHashes.hashes, ...poolHashes.hashes])];

        if (allHashes.length === 0) {
            const emptyResponse: TydroResponse = {
                currentSupplyUsd: 0,
                currentSupplyEth: 0,
                totalDepositedUsd: 0,
                totalDepositedEth: 0,
                totalWithdrawnUsd: 0,
                totalWithdrawnEth: 0,
                depositCount: 0,
                withdrawCount: 0,
                currentBorrowUsd: 0,
                currentBorrowEth: 0,
                totalBorrowedUsd: 0,
                totalBorrowedEth: 0,
                totalRepaidUsd: 0,
                totalRepaidEth: 0,
                borrowCount: 0,
                repayCount: 0,
            };
            setLongCache(tydrLcKey, emptyResponse);
            return emptyResponse;
        }

        const { cached: cachedHashes, uncached: uncachedHashes } = await partitionTxHashes(allHashes);
        const priced = [...cachedHashes, ...uncachedHashes.slice(0, 500)];
        // Partial = pricing cap OR discovery truncation on either contract
        // (an incomplete discovery set understates counts/volume until the
        // background completion loop resumes below its floor).
        const discoveryPartial = !gwHashes.complete || !poolHashes.complete;
        const partial = discoveryPartial || cachedHashes.length + Math.min(uncachedHashes.length, 500) < allHashes.length;
        const txData = await getTxData(priced);
        // Oldest-first for the running-balance clamps below.
        priced.sort((a, b) => String(txData.get(a)?.meta.timestamp || '').localeCompare(String(txData.get(b)?.meta.timestamp || '')));

        const supplyBalances: Map<string, number> = new Map();
        const borrowBalances: Map<string, number> = new Map();

        let totalDepositedUsd = 0, totalDepositedEth = 0;
        let totalWithdrawnUsd = 0, totalWithdrawnEth = 0;
        let totalBorrowedUsd = 0, totalBorrowedEth = 0;
        let totalRepaidUsd = 0, totalRepaidEth = 0;
        let depositCount = 0, withdrawCount = 0, borrowCount = 0, repayCount = 0;

        const priceReserve = async (reserve: string): Promise<number> => getTokenPriceUsd(reserve, ethPrice);
        // Withdraw event topic for the logs fallback below (native-ETH
        // receipts arrive via internal transfers, invisible in token legs).
        const WITHDRAW_EVENT_TOPIC = '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7';
        const firstLeg = (
            legs: Array<{ tokenAddress: string; symbol: string; amount: number; fromAddress: string; toAddress: string }>,
            fromWallet: boolean
        ) => legs.find((l) =>
            !RECEIPT_TOKEN.test(l.symbol || '') &&
            (fromWallet ? l.fromAddress === walletAddress : l.toAddress === walletAddress)
        );

        // Pass 1 (sync): classify + resolve legs, collecting the distinct
        // reserves needing a price and the withdraw txs needing log lookup.
        // Previously each tx awaited priceReserve (CoinGecko for kBTC, up to
        // 3s) and getTxLogs serially - N txs x seconds = the 7.6s tail.
        type TydroParsed = { action: 'supply' | 'withdraw' | 'borrow' | 'repay'; amountUsd: number; amountEth: number; reserve: string };
        const parsed = new Map<string, TydroParsed>();
        const legAmountByTx = new Map<string, number>();
        const reservesNeeded = new Set<string>();
        const withdrawsNeedingLogs: string[] = [];
        for (const h of priced) {
            const data = txData.get(h);
            if (!data) continue;
            const selector = (data.meta.selector || '').toLowerCase();
            let action: 'supply' | 'withdraw' | 'borrow' | 'repay' | null = null;
            if (SUPPLY_METHODS.includes(selector)) action = 'supply';
            else if (WITHDRAW_METHODS.includes(selector)) action = 'withdraw';
            else if (BORROW_METHODS.includes(selector)) action = 'borrow';
            else if (REPAY_METHODS.includes(selector)) action = 'repay';
            if (!action) continue;

            if (selector === '0x474cf53d') {
                // ETH deposit (depositETH): tx value directly, as before.
                // Counted even when $0 (matches old behavior: reserve was
                // always set for depositETH).
                const amountEthV = safeWeiToEth(data.meta.value);
                parsed.set(h, { action, amountUsd: amountEthV * ethPrice, amountEth: amountEthV, reserve: '0x4200000000000000000000000000000000000006' });
                continue;
            }
            if (selector === '0xbcc3c255') {
                // ETH repay (repayETH): tx value directly, as before.
                const amountEthV = safeWeiToEth(data.meta.value);
                if (amountEthV > 0) {
                    parsed.set(h, { action, amountUsd: amountEthV * ethPrice, amountEth: amountEthV, reserve: '0x4200000000000000000000000000000000000006' });
                }
                continue;
            }
            const wantFromWallet = action === 'supply' || action === 'repay';
            const leg = firstLeg(data.legs, wantFromWallet);
            if (leg) {
                reservesNeeded.add(leg.tokenAddress.toLowerCase());
                parsed.set(h, { action, amountUsd: 0, amountEth: 0, reserve: leg.tokenAddress });
                // Stash leg amount on the entry via closure map below.
                legAmountByTx.set(h, leg.amount);
            } else if (action === 'withdraw') {
                withdrawsNeedingLogs.push(h);
                parsed.set(h, { action, amountUsd: 0, amountEth: 0, reserve: '' });
            }
            // Txs with neither leg nor withdraw fallback carry no resolvable
            // amount (matches old behavior: unparseable txs were skipped).
        }

        // Batch: all reserve prices (concurrency-capped) + all withdraw logs
        // (single call, internally concurrent) in parallel.
        const pricedReserves = [...reservesNeeded];
        const [reservePrices, withdrawLogsMap] = await Promise.all([
            (async () => {
                const entries = await mapWithConcurrency(pricedReserves, 10, (r) => priceReserve(r).catch(() => ethPrice));
                return new Map(pricedReserves.map((r, i) => [r, entries[i]]));
            })(),
            withdrawsNeedingLogs.length > 0 ? getTxLogs(withdrawsNeedingLogs) : Promise.resolve(new Map()),
        ]);
        for (const [h, amt] of legAmountByTx) {
            const entry = parsed.get(h);
            if (!entry || entry.reserve === '') continue;
            const key = entry.reserve.toLowerCase();
            const tokenPrice = reservePrices.get(key) ?? ethPrice;
            const token = KNOWN_TOKENS[key];
            entry.amountUsd = amt * tokenPrice;
            entry.amountEth = token?.ethPegged ? amt : 0;
        }
        // Withdraw fallback: native-ETH receipts travel via internal
        // transfers (no token leg). The Withdraw event carries the
        // reserve + amount regardless of routing.
        for (const h of withdrawsNeedingLogs) {
            const entry = parsed.get(h);
            if (!entry || entry.reserve !== '') continue;
            for (const log of withdrawLogsMap.get(h) || []) {
                if ((log.topics?.[0] || '').toLowerCase() !== WITHDRAW_EVENT_TOPIC) continue;
                const topic1 = log.topics?.[1] || '';
                if (!topic1 || topic1.length < 42) continue;
                const reserveAddr = ('0x' + topic1.slice(-40)).toLowerCase();
                const rawData = log.data || '';
                const dataHex = rawData.startsWith('0x') ? rawData.slice(2) : rawData;
                // Withdraw(reserve,user,to,amount): 3 indexed params, so
                // data is a single uint256 amount (32 bytes). Take the
                // last word to stay compatible with wider layouts.
                if (dataHex.length < 64) continue;
                let amount = 0;
                try {
                    amount = Number(BigInt('0x' + dataHex.slice(-64)));
                } catch {
                    continue;
                }
                const token = KNOWN_TOKENS[reserveAddr];
                const decimals = token?.decimals || 18;
                const tokenPrice = reservePrices.get(reserveAddr) ?? await priceReserve(reserveAddr).catch(() => ethPrice);
                const amt = amount / Math.pow(10, decimals);
                entry.reserve = reserveAddr;
                entry.amountUsd = amt * tokenPrice;
                entry.amountEth = token?.ethPegged ? amt : 0;
                break;
            }
        }

        // Pass 2 (sync): aggregate oldest-first (priced already sorted).
        for (const h of priced) {
            const entry = parsed.get(h);
            // Count only txs with a resolved amount (matches old behavior,
            // where unparseable txs returned null and were skipped).
            if (!entry || entry.reserve === '') continue;
            const { action, amountUsd, amountEth, reserve } = entry;

            switch (action) {
                case 'supply':
                    depositCount++;
                    totalDepositedUsd += amountUsd;
                    totalDepositedEth += amountEth;
                    const currentSupplyBalance = supplyBalances.get(reserve) || 0;
                    supplyBalances.set(reserve, Math.round((currentSupplyBalance + amountUsd) * 100) / 100);
                    break;
                case 'withdraw':
                    withdrawCount++;
                    totalWithdrawnUsd += amountUsd;
                    totalWithdrawnEth += amountEth;
                    const currentSupplyBalanceWithdraw = supplyBalances.get(reserve) || 0;
                    supplyBalances.set(reserve, Math.max(0, Math.round((currentSupplyBalanceWithdraw - amountUsd) * 100) / 100));
                    break;
                case 'borrow':
                    borrowCount++;
                    totalBorrowedUsd += amountUsd;
                    totalBorrowedEth += amountEth;
                    const currentBorrowBalance = borrowBalances.get(reserve) || 0;
                    borrowBalances.set(reserve, Math.round((currentBorrowBalance + amountUsd) * 100) / 100);
                    break;
                case 'repay':
                    repayCount++;
                    totalRepaidUsd += amountUsd;
                    totalRepaidEth += amountEth;
                    const currentBorrowBalanceRepay = borrowBalances.get(reserve) || 0;
                    borrowBalances.set(reserve, Math.max(0, Math.round((currentBorrowBalanceRepay - amountUsd) * 100) / 100));
                    break;
            }
        }

        let currentSupplyUsd = Math.max(0, totalDepositedUsd - totalWithdrawnUsd);
        let currentSupplyEth = Math.max(0, totalDepositedEth - totalWithdrawnEth);
        let currentBorrowUsd = Math.max(0, totalBorrowedUsd - totalRepaidUsd);
        let currentBorrowEth = Math.max(0, totalBorrowedEth - totalRepaidEth);

        currentSupplyUsd = Math.round(currentSupplyUsd * 100) / 100;
        currentSupplyEth = Math.round(currentSupplyEth * 10000) / 10000;
        currentBorrowUsd = Math.round(currentBorrowUsd * 100) / 100;
        currentBorrowEth = Math.round(currentBorrowEth * 10000) / 10000;

        const response: TydroResponse = {
            currentSupplyUsd: Math.round(currentSupplyUsd * 100) / 100,
            currentSupplyEth: Math.round(currentSupplyEth * 10000) / 10000,
            totalDepositedUsd: Math.round(totalDepositedUsd * 100) / 100,
            totalDepositedEth: Math.round(totalDepositedEth * 10000) / 10000,
            totalWithdrawnUsd: Math.round(totalWithdrawnUsd * 100) / 100,
            totalWithdrawnEth: Math.round(totalWithdrawnEth * 10000) / 10000,
            depositCount,
            withdrawCount,
            currentBorrowUsd: Math.round(currentBorrowUsd * 100) / 100,
            currentBorrowEth: Math.round(currentBorrowEth * 10000) / 10000,
            totalBorrowedUsd: Math.round(totalBorrowedUsd * 100) / 100,
            totalBorrowedEth: Math.round(totalBorrowedEth * 10000) / 10000,
            totalRepaidUsd: Math.round(totalRepaidUsd * 100) / 100,
            totalRepaidEth: Math.round(totalRepaidEth * 10000) / 10000,
            borrowCount,
            repayCount,
            partial,
        };

        if (!partial) {
            setLongCache(tydrLcKey, response);
        }

        return response;
    });
}
