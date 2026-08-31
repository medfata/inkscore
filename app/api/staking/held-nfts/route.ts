import { NextRequest, NextResponse } from 'next/server';
import { INK_RPC_URL, ZENITH_NFT_ADDRESS } from '@/lib/staking-contract';

/**
 * Held-Zenith discovery straight from the chain — replaces the explorer
 * holder-index + transfer-history pipeline that took 7-30s for large
 * wallets (Blockscout was ~6.7s per page, serial pagination for history).
 *
 * The collection is a fixed 888 supply; ids 1..888 (burned ids revert on
 * ownerOf and simply cannot be owned). One batched ownerOf pass resolves
 * every owner. The result is cached module-level and shared across ALL
 * visitors, so the ~3s scan runs at most every SCAN_TTL_MS regardless of
 * traffic; per-wallet lookups against a warm cache are instant.
 *
 * Response is CDN-cacheable per wallet (s-maxage + stale-while-revalidate).
 */

const OWNER_OF_SELECTOR = '0x6352211e'; // ownerOf(uint256)
const MAX_TOKEN_ID = 888;
const BATCH_SIZE = 100;
const RPC_TIMEOUT = 10_000;
const SCAN_TTL_MS = 20_000;

let ownerCache: Map<string, string> | null = null;
let ownerCacheAt = 0;
let scanInFlight: Promise<Map<string, string>> | null = null;

async function rpcBatchOwnerOf(ids: number[]): Promise<Array<string | null>> {
  const body = ids.map((id, i) => ({
    jsonrpc: '2.0',
    id: i,
    method: 'eth_call',
    params: [
      { to: ZENITH_NFT_ADDRESS, data: OWNER_OF_SELECTOR + BigInt(id).toString(16).padStart(64, '0') },
      'latest',
    ],
  }));
  const res = await fetch(INK_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RPC_TIMEOUT),
  });
  if (!res.ok) throw new Error(`RPC responded ${res.status}`);
  const results = (await res.json()) as Array<{ id: number; result?: string }>;
  const out: Array<string | null> = new Array(ids.length).fill(null);
  for (const entry of results) {
    // entry.id is the batch index; a reverted ownerOf (burned / nonexistent
    // token) stays null — it cannot be owned.
    const idx = entry.id;
    if (idx < 0 || idx >= ids.length) continue;
    const result = entry.result;
    if (typeof result === 'string' && result.length >= 40) {
      out[idx] = `0x${result.slice(-40).toLowerCase()}`;
    }
  }
  return out;
}

async function scanAllOwners(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let start = 1; start <= MAX_TOKEN_ID; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, MAX_TOKEN_ID);
    const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const owners = await rpcBatchOwnerOf(ids);
    for (let i = 0; i < ids.length; i++) {
      const owner = owners[i];
      if (owner) map.set(String(ids[i]), owner);
    }
  }
  return map;
}

/** Fresh-enough owner map, shared across requests; concurrent scans dedupe. */
async function getOwners(): Promise<Map<string, string>> {
  if (ownerCache && Date.now() - ownerCacheAt < SCAN_TTL_MS) return ownerCache;
  if (!scanInFlight) {
    scanInFlight = scanAllOwners()
      .then((map) => {
        ownerCache = map;
        ownerCacheAt = Date.now();
        return map;
      })
      .finally(() => {
        scanInFlight = null;
      });
  }
  return scanInFlight;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const walletParam = request.nextUrl.searchParams.get('wallet') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletParam)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 });
  }
  const wallet = walletParam.toLowerCase();

  let owners: Map<string, string>;
  try {
    owners = await getOwners();
  } catch (err) {
    console.error('[held-nfts] owner scan failed:', (err as Error).message);
    return NextResponse.json({ error: 'Ownership scan failed' }, { status: 502 });
  }

  const ids: string[] = [];
  for (const [id, owner] of owners) {
    if (owner === wallet) ids.push(id);
  }
  ids.sort((a, b) => Number(a) - Number(b));

  const res = NextResponse.json({ ids, scannedAt: ownerCacheAt || null });
  res.headers.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  return res;
}
