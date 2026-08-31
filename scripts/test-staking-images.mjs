/**
 * Standalone verification for the staking NFT image pipeline.
 *
 * Usage:
 *   node scripts/test-staking-images.mjs            # tests tokens 113,357
 *   node scripts/test-staking-images.mjs 615 357    # custom token ids
 *
 * Tests, per token:
 *   1. OpenSea API v2 (primary path — requires OPENSEA_API_KEY in .env)
 *   2. Chain tokenURI → IPFS gateway fallback (keyless)
 *
 * Exits non-zero if BOTH paths fail for every requested token.
 */

import 'dotenv/config';

const ZENITH = '0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78';
const RPC = 'https://rpc-gel.inkonchain.com';
const GATEWAYS = ['https://w3s.link/ipfs/', 'https://nftstorage.link/ipfs/'];

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['113', '357'];
const apiKey = process.env.OPENSEA_API_KEY ?? '';

const toG = (uri, g) => {
  if (uri.startsWith('ipfs://')) return g + uri.slice(7);
  const m = uri.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/);
  return m ? g + m[1] : uri;
};

async function fetchOk(url, timeout = 8000) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout) });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

async function openSeaPath(id) {
  if (!apiKey) return { ok: false, detail: 'OPENSEA_API_KEY not set in .env' };
  try {
    const url = `https://api.opensea.io/api/v2/chain/ink/contract/${ZENITH.toLowerCase()}/nfts/${id}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = await res.json();
    const img = data.nft?.image_url || data.nft?.image_original_url || null;
    return img ? { ok: true, detail: img.slice(0, 80) + '…' } : { ok: false, detail: 'no image_url in response' };
  } catch (e) {
    return { ok: false, detail: e.message.slice(0, 80) };
  }
}

async function chainPath(id) {
  try {
    const data = '0xc87b56dd' + BigInt(id).toString(16).padStart(64, '0');
    const rpc = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ZENITH, data }, 'latest'] }),
    });
    const hex = (await rpc.json()).result;
    const len = parseInt(hex.slice(66, 130), 16);
    const tokenUri = Buffer.from(hex.slice(130, 130 + len * 2), 'hex').toString();

    let metadata = null;
    for (const g of GATEWAYS) {
      const r = await fetchOk(toG(tokenUri, g));
      if (r) {
        metadata = await r.json();
        break;
      }
    }
    if (!metadata?.image) return { ok: false, detail: 'metadata unreachable on all gateways' };

    for (const g of GATEWAYS) {
      const url = toG(metadata.image, g);
      if (await fetchOk(url)) return { ok: true, detail: url.slice(0, 80) + '…' };
    }
    return { ok: false, detail: 'image 404/504 on all gateways' };
  } catch (e) {
    return { ok: false, detail: e.message.slice(0, 80) };
  }
}

console.log(`OPENSEA_API_KEY: ${apiKey ? `set (${apiKey.slice(0, 6)}…${apiKey.slice(-4)})` : 'NOT SET'}`);
let anyPass = false;

for (const id of ids) {
  const os = await openSeaPath(id);
  const chain = await chainPath(id);
  const pass = os.ok || chain.ok;
  anyPass ||= pass;
  console.log(`\nToken #${id} — ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  OpenSea (primary): ${os.ok ? '✅' : '❌'} ${os.detail}`);
  console.log(`  Chain  (fallback): ${chain.ok ? '✅' : '❌'} ${chain.detail}`);
}

process.exit(anyPass ? 0 : 1);
