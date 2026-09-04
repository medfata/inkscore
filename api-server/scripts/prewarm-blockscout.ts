// Pre-warm Blockscout caches ahead of cutover (or after a cold restart).
//
// Warms bs_* tables + response caches for a wallet list so day-one traffic
// is served warm. Safe to re-run: every endpoint is idempotent and the
// service layer throttles itself (~150 req/min shared budget).
//
// Usage:
//   npx ts-node scripts/prewarm-blockscout.ts 0xabc... 0xdef...
//   npx ts-node scripts/prewarm-blockscout.ts --file wallets.txt
// Env: API_BASE (default http://localhost:4000), DELAY_MS between wallets.

import * as fs from 'fs';

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const DELAY_MS = parseInt(process.env.DELAY_MS || '2000', 10);

const CHAIN_ENDPOINTS = [
  (w: string) => `/api/wallet/${w}/stats`,
  (w: string) => `/api/wallet/${w}/swap`,
  (w: string) => `/api/wallet/${w}/bridge`,
  (w: string) => `/api/wallet/${w}/volume`,
  (w: string) => `/api/wallet/${w}/tydro`,
  (w: string) => `/api/wallet/${w}/nft2me`,
  (w: string) => `/api/analytics/${w}/zns`,
  (w: string) => `/api/analytics/${w}/shellies_joined_raffles`,
  (w: string) => `/api/analytics/${w}/shellies_pay_to_play`,
  (w: string) => `/api/analytics/${w}/shellies_staking`,
  (w: string) => `/api/analytics/${w}/inkypump_created_tokens`,
  (w: string) => `/api/analytics/${w}/inkypump_buy_volume`,
  (w: string) => `/api/analytics/${w}/inkypump_sell_volume`,
  (w: string) => `/api/nado/${w}`,
];

async function hit(url: string): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    // Drain the body so the connection can be reused.
    await res.arrayBuffer().catch(() => undefined);
    return { ok: res.ok, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let wallets: string[] = [];
  const fileIdx = args.indexOf('--file');
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    wallets = fs
      .readFileSync(args[fileIdx + 1], 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^0x[a-fA-F0-9]{40}$/.test(l));
  } else {
    wallets = args.filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
  }
  if (wallets.length === 0) {
    console.error('Usage: ts-node scripts/prewarm-blockscout.ts <wallet...> | --file wallets.txt');
    process.exit(1);
  }

  console.log(`Pre-warming ${wallets.length} wallets against ${API_BASE} (${CHAIN_ENDPOINTS.length} endpoints each)`);
  const t0 = Date.now();
  let okCount = 0;
  let failCount = 0;
  for (const w of wallets) {
    const wStart = Date.now();
    const results = await Promise.all(
      CHAIN_ENDPOINTS.map((fn) => hit(`${API_BASE}${fn(w)}`))
    );
    const ok = results.filter((r) => r.ok).length;
    const slow = Math.max(...results.map((r) => r.ms));
    okCount += ok;
    failCount += results.length - ok;
    console.log(`${w.slice(0, 12)}... ${ok}/${results.length} ok, slowest ${slow}ms, wallet total ${Date.now() - wStart}ms`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${okCount} ok, ${failCount} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
