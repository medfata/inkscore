import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, defineChain, http } from 'viem';
import {
  INK_RPC_URL,
  IPFS_GATEWAYS,
  ZENITH_NFT_ADDRESS,
  ZENITH_TOKENURI_ABI,
  ipfsToGateway,
} from '@/lib/staking-contract';

/**
 * Resolves NFT image URLs for the staking page.
 *
 * Keyless pipeline (no API key required):
 *   1. Read tokenURI(tokenId) straight from the Zenith contract on-chain —
 *      always fresh (post-reveal), unlike Blockscout's cached metadata.
 *   2. Fetch the metadata JSON via an IPFS gateway (with fallbacks).
 *   3. Point metadata.image at the first gateway that actually serves the
 *      bytes (gateways return transient 504s per content, so we probe).
 *
 * Optional enhancer: when OPENSEA_API_KEY is configured, OpenSea's CDN
 * (i2c.seadn.io) is tried first — it also covers the handful of tokens
 * whose on-chain metadata predates the reveal.
 *
 * The API key (if any) stays server-side; the client never sees it.
 * All failures resolve to null — the frontend falls back to the
 * explorer-served URL, then to a placeholder.
 */

const inkChain = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [INK_RPC_URL] } },
});

const publicClient = createPublicClient({ chain: inkChain, transport: http(INK_RPC_URL) });

const OPENSEA_NFT_URL = (tokenId: string) =>
  `https://api.opensea.io/api/v2/chain/ink/contract/${ZENITH_NFT_ADDRESS.toLowerCase()}/nfts/${tokenId}`;

const MAX_IDS = 60;
const FETCH_TIMEOUT = 8_000;
/** Gateways flap (200 one minute, 504 the next) — retry each before moving on. */
const ATTEMPTS_PER_GATEWAY = 2;
const RETRY_BACKOFF_MS = 400;
/** Positive results are immutable; negatives retry after a short window. */
const NEGATIVE_CACHE_TTL_MS = 60_000;

/**
 * Bump when resolution logic changes so stale in-memory entries (including
 * old permanent nulls from previous logic versions) self-heal without a
 * server restart.
 */
const CACHE_VERSION = 2;

/** Per-instance warm cache — resolved URLs are effectively immutable. */
const resolvedCache = new Map<string, string | null>();
const negativeCache = new Map<string, number>();

function isNegativelyCached(tokenId: string): boolean {
  const until = negativeCache.get(`${CACHE_VERSION}:${tokenId}`);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  negativeCache.delete(`${CACHE_VERSION}:${tokenId}`);
  return false;
}

async function fetchOk(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

async function fetchWithRetry(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < ATTEMPTS_PER_GATEWAY; attempt++) {
    const res = await fetchOk(url);
    if (res) return res;
    if (attempt < ATTEMPTS_PER_GATEWAY - 1) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetchWithRetry(url);
  if (!res) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchIpfsJson(uri: string): Promise<{ image?: string } | null> {
  for (const gateway of IPFS_GATEWAYS) {
    const json = await fetchJson<{ image?: string }>(ipfsToGateway(uri, gateway));
    if (json) return json;
  }
  return null;
}

/** First gateway that actually serves the image bytes (transient 504s are common). */
async function resolveIpfsImage(uri: string): Promise<string | null> {
  if (!/^ipfs:\/\//.test(uri) && !uri.includes('/ipfs/')) return uri;
  for (const gateway of IPFS_GATEWAYS) {
    const url = ipfsToGateway(uri, gateway);
    if (await fetchWithRetry(url)) return url;
  }
  return null;
}

async function fetchFromOpenSea(tokenId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(OPENSEA_NFT_URL(tokenId), {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      nft?: { image_url?: string | null; image_original_url?: string | null };
    };
    return data.nft?.image_url || data.nft?.image_original_url || null;
  } catch {
    return null;
  }
}

async function resolveImage(tokenId: string): Promise<string | null> {
  const cacheKey = `${CACHE_VERSION}:${tokenId}`;
  const cached = resolvedCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (isNegativelyCached(tokenId)) return null;

  let result: string | null = null;
  let reason = 'unknown';

  // 1. Primary: OpenSea CDN (deterministic, covers stale pre-reveal metadata).
  const apiKey = process.env.OPENSEA_API_KEY ?? '';
  if (apiKey) {
    result = await fetchFromOpenSea(tokenId, apiKey);
    if (!result) reason = 'opensea: no image / request failed';
  } else {
    reason = 'no OPENSEA_API_KEY configured';
  }

  // 2. Fallback: fresh metadata straight from the chain, then gateways.
  if (!result) {
    try {
      const tokenUri = await publicClient.readContract({
        address: ZENITH_NFT_ADDRESS,
        abi: ZENITH_TOKENURI_ABI,
        functionName: 'tokenURI',
        args: [BigInt(tokenId)],
      });
      const metadata = await fetchIpfsJson(tokenUri);
      if (metadata?.image) {
        result = await resolveIpfsImage(metadata.image);
        if (!result) reason = 'gateways: image 404/504 on all gateways';
      } else {
        reason = 'gateways: metadata JSON unreachable';
      }
    } catch (err) {
      result = null;
      reason = `chain read failed: ${(err as Error).message.slice(0, 80)}`;
    }
  }

  if (result) {
    resolvedCache.set(cacheKey, result);
  } else {
    negativeCache.set(cacheKey, Date.now() + NEGATIVE_CACHE_TTL_MS);
    console.warn(`[staking-images] token ${tokenId} unresolved (${reason})`);
  }
  return result;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{1,12}$/.test(s))
    .slice(0, MAX_IDS);

  if (!ids.length) {
    return NextResponse.json({ images: {} });
  }

  const images: Record<string, string | null> = {};
  await Promise.all(
    ids.map(async (id) => {
      images[id] = await resolveImage(id);
    })
  );

  const res = NextResponse.json({ images });
  res.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res;
}
