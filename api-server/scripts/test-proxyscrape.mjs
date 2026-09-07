// Acceptance test: ProxyScrape datacenter proxies vs explorer.inkonchain.com
// Phase 1: preflight each sampled proxy (alive? latency?)
// Phase 2: burst at rising rates round-robining working proxies, count 429/403/ok
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { readFileSync } from 'node:fs';

const PROXIES = readFileSync(new URL('./proxyscrape-list.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => (l.startsWith('http') ? l : `http://${l}`));
const TARGET = 'https://explorer.inkonchain.com/api/v2/addresses/0x8655df35818f348ea4e371a613e73677d816f589/transactions';

async function via(proxyUrl) {
  const agent = new ProxyAgent(proxyUrl);
  const t0 = Date.now();
  try {
    const res = await undiciFetch(TARGET, { dispatcher: agent, signal: AbortSignal.timeout(15000) });
    return { status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: e?.cause?.code || e?.message };
  }
}

// Phase 1: preflight a sample of 15
console.log(`=== PHASE 1: preflight ${Math.min(15, PROXIES.length)} of ${PROXIES.length} proxies ===`);
const working = [];
for (const p of PROXIES.slice(0, 15)) {
  const r = await via(p);
  console.log(`  ${p.slice(p.indexOf('@') + 1)}: status=${r.status} ${r.ms}ms ${r.err || ''}`);
  if (r.status === 200) working.push(p);
}
console.log(`preflight: ${working.length}/15 working\n`);

if (working.length === 0) { console.log('VERDICT: FAIL - no working proxies'); process.exit(1); }

// Phase 2: burst through working proxies
console.log(`=== PHASE 2: burst test through ${working.length} working proxies ===`);
let i = 0;
const next = () => working[i++ % working.length];
const count = { ok: 0, s429: 0, s403: 0, other: 0 };
const t0 = Date.now();
const N = 100;
for (let k = 0; k < N; k++) {
  const r = await via(next());
  if (r.status === 200) count.ok++;
  else if (r.status === 429) count.s429++;
  else if (r.status === 403) count.s403++;
  else count.other++;
  await new Promise((res) => setTimeout(res, 150)); // ~6-7 req/s aggregate
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);
const rate = (N / (secs / 60)).toFixed(0);
console.log(`burst: ok=${count.ok} 429=${count.s429} 403=${count.s403} other=${count.other} | ${N} req in ${secs}s (~${rate}/min)`);
console.log(count.s429 + count.s403 === 0 ? 'VERDICT: PASS - datacenter proxies work against Blockscout' : 'VERDICT: check 429/403 counts above');
