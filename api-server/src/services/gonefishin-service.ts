import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolTxHashes, getTxData, getTokenTransfersInto } from './blockscout-service';
import { priceService } from './price-service';
import { safeWeiToEth } from './metrics-utils';

// Gone Fishin (gonefishin.ink) — on-chain fishing game on Ink.
//
// Mechanics (verified on-chain): a player spends ETH to buy rounds or packs
// (single buy selector 0xe376f53a, value = ETH spent); a keeper settles
// rounds and pushes prize tokens (tokenized stock wrappers like wNVDAx /
// wAAPLx) straight into the player's wallet inside settle txs the player
// never signs.
//
// Tracking scope (user activity only — keeper txs are infrastructure):
// - buys:   txs FROM the wallet TO the game contract with the buy selector
// - prizes: ERC-20 transfers FROM the game contract INTO the wallet
//
// History is append-only: per-tx data lives in the permanent bs_tx_legs
// cache, prize inflows accumulate in bs_token_inflows behind a cursor, and
// getProtocolTxHashes refreshes incrementally via last_seen — so the first
// visit scans the (tiny) game history once and every later visit only pays
// for new activity. No backfill worker is wired for this metric by design.

// Game contract (ERC1967 proxy, verified on explorer.inkonchain.com).
const GONE_FISHIN_CONTRACT = '0x476973c8124faf5db6a8fc35265da81e1d9b4e3e';
// The single selector covers both single-round and pack purchases.
const BUY_SELECTOR = '0xe376f53a';

// Append-only counts (same rationale as the Tydro/NFT2Me long cache).
const GONE_FISHIN_LONG_CACHE_TTL = 5 * 60 * 1000;

export interface GoneFishinPrize {
  symbol: string;
  address: string;
  amount: number; // human-readable token units
  count: number; // number of prize payouts
  usdValue: number; // 0 when no liquid DexScreener pair exists
}

export interface GoneFishinResponse {
  gamesBought: number; // buy txs to the game contract (rounds + packs)
  totalSpentEth: number;
  totalSpentUsd: number;
  firstPlayAt: string | null;
  lastPlayAt: string | null;
  prizesWonCount: number; // total prize payouts received
  prizesWonUsd: number;
  prizesWon: GoneFishinPrize[];
}

function emptyResponse(): GoneFishinResponse {
  return {
    gamesBought: 0,
    totalSpentEth: 0,
    totalSpentUsd: 0,
    firstPlayAt: null,
    lastPlayAt: null,
    prizesWonCount: 0,
    prizesWonUsd: 0,
    prizesWon: [],
  };
}

// ---- prize token USD pricing ------------------------------------------------
// DexScreener with the same highest-liquidity-pair rule as
// wallet-stats-service: thin pools quote stale/oscillating prices, so the
// price comes from the deepest ink-chain pair per token. Tokens without a
// liquid pair price at $0 (raw amount still shown).
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';
interface PrizePriceEntry {
  priceUsd: number;
  timestamp: number;
}
const prizePriceCache = new Map<string, PrizePriceEntry>();
const PRIZE_PRICE_TTL = 5 * 60 * 1000;

async function getPrizeTokenPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const missing: string[] = [];
  const now = Date.now();
  for (const addr of tokenAddresses) {
    const hit = prizePriceCache.get(addr);
    if (hit && now - hit.timestamp < PRIZE_PRICE_TTL) prices.set(addr, hit.priceUsd);
    else missing.push(addr);
  }
  if (missing.length === 0) return prices;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${DEXSCREENER_API}/${missing.join(',')}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = (await response.json()) as {
        pairs?: Array<{
          chainId?: string;
          baseToken?: { address?: string };
          priceUsd?: string;
          liquidity?: { usd?: number };
        }>;
      };
      // Best pair per token = highest liquidity (never the highest price).
      const liquidityByToken = new Map<string, number>();
      for (const pair of data.pairs || []) {
        if (pair.chainId !== 'ink') continue;
        const tokenAddress = pair.baseToken?.address?.toLowerCase();
        const priceUsd = parseFloat(pair.priceUsd || '0');
        const liquidityUsd = pair.liquidity?.usd || 0;
        if (!tokenAddress || priceUsd <= 0) continue;
        const best = liquidityByToken.get(tokenAddress);
        if (best === undefined || liquidityUsd > best) {
          liquidityByToken.set(tokenAddress, liquidityUsd);
          prices.set(tokenAddress, priceUsd);
        }
      }
    }
  } catch {
    // Priced at $0 below — never fail the metric over a price lookup.
  }

  // Cache BOTH hits and misses: a token with no pair would otherwise be
  // re-fetched on every load. Misses cache at $0 for the same TTL.
  for (const addr of missing) {
    prizePriceCache.set(addr, { priceUsd: prices.get(addr) || 0, timestamp: now });
  }
  return prices;
}

export async function getGoneFishinData(walletAddress: string): Promise<GoneFishinResponse> {
  const lcKey = 'long:wallet:gonefishin:' + walletAddress;
  const cached = getLongCache<GoneFishinResponse>(lcKey, GONE_FISHIN_LONG_CACHE_TTL);
  if (cached) return cached;

  return withInflight<GoneFishinResponse>(lcKey, async () => {
    const wallet = walletAddress.toLowerCase();

    // --- buys: wallet -> game contract with the buy selector -----------------
    const buys = await getProtocolTxHashes(wallet, GONE_FISHIN_CONTRACT, [BUY_SELECTOR]).catch(
      (err: unknown) => {
        console.warn('[GoneFishin] buy discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }
    );

    let gamesBought = 0;
    let totalSpentEth = 0;
    let firstPlayAt: string | null = null;
    let lastPlayAt: string | null = null;
    if (buys.hashes.length > 0) {
      const txData = await getTxData(buys.hashes);
      for (const h of buys.hashes) {
        const d = txData.get(h);
        if (!d || d.meta.ok === false) continue; // failed buys are not plays
        gamesBought++;
        totalSpentEth += safeWeiToEth(d.meta.value);
        const ts = d.meta.timestamp;
        if (ts && (!firstPlayAt || ts < firstPlayAt)) firstPlayAt = ts;
        if (ts && (!lastPlayAt || ts > lastPlayAt)) lastPlayAt = ts;
      }
    }

    // --- prizes: game contract -> wallet token inflows -----------------------
    const inflow = await getTokenTransfersInto(wallet, GONE_FISHIN_CONTRACT).catch(
      (err: unknown) => {
        console.warn('[GoneFishin] prize inflow scan failed:', err instanceof Error ? err.message : err);
        return { transfers: [], complete: false };
      }
    );

    const byToken = new Map<string, { symbol: string; amount: number; count: number }>();
    for (const t of inflow.transfers) {
      const entry = byToken.get(t.tokenAddress) || { symbol: t.symbol, amount: 0, count: 0 };
      entry.amount += t.amount;
      entry.count += 1;
      if (!entry.symbol && t.symbol) entry.symbol = t.symbol;
      byToken.set(t.tokenAddress, entry);
    }

    const ethPrice = await priceService.getCurrentPrice();
    const tokenAddresses = [...byToken.keys()];
    const priceMap = tokenAddresses.length
      ? await getPrizeTokenPrices(tokenAddresses)
      : new Map<string, number>();

    const prizesWon: GoneFishinPrize[] = tokenAddresses.map((addr) => {
      const entry = byToken.get(addr)!;
      return {
        symbol: entry.symbol || 'UNKNOWN',
        address: addr,
        amount: entry.amount,
        count: entry.count,
        usdValue: Math.round(entry.amount * (priceMap.get(addr) || 0) * 100) / 100,
      };
    });
    // Highest-value first so the card shows what matters above the fold.
    prizesWon.sort((a, b) => b.usdValue - a.usdValue || b.amount - a.amount);

    const response: GoneFishinResponse = {
      gamesBought,
      totalSpentEth: Math.round(totalSpentEth * 1e6) / 1e6,
      totalSpentUsd: Math.round(totalSpentEth * ethPrice * 100) / 100,
      firstPlayAt,
      lastPlayAt,
      prizesWonCount: prizesWon.reduce((sum, p) => sum + p.count, 0),
      prizesWonUsd: Math.round(prizesWon.reduce((sum, p) => sum + p.usdValue, 0) * 100) / 100,
      prizesWon,
    };

    setLongCache(lcKey, response);
    return response;
  });
}
