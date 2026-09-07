// Direct-egress pace probe for Blockscout: ramps request rate, counts 429s,
// to find the per-IP ceiling. Usage: node scripts/probe-direct-pace.mjs
const BASE = 'https://explorer.inkonchain.com/api/v2';
const WALLET = '0x8655df35818f348ea4e371a613e73677d816f589';
const url = `${BASE}/addresses/${WALLET}/transactions`;

async function burst(n, spacingMs, label) {
  let ok = 0, r429 = 0, other = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) ok++;
      else if (res.status === 429) r429++;
      else other++;
    } catch { other++; }
    await new Promise((r) => setTimeout(r, spacingMs));
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`${label}: ok=${ok} 429=${r429} other=${other} (${n} req in ${secs}s)`);
  return { ok, r429 };
}

await burst(10, 1000, '10 req @ 1/s (60/min)   ');
await burst(20, 500, '20 req @ 2/s (120/min)  ');
await burst(30, 333, '30 req @ 3/s (180/min)  ');
await burst(40, 200, '40 req @ 5/s (300/min)  ');
