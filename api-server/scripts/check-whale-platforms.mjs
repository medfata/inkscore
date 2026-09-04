// One-off: for the chain's highest-tx EOAs, sample their tx history and
// measure per-platform filtered walk sizes (what our metrics actually walk)
// vs the caps. Early-stops at cap+1 pages — we only need to know whether a
// walk exceeds the cap, not its exact depth.
//
// Usage: node scripts/check-whale-platforms.mjs

const BASE = 'https://explorer.inkonchain.com/api/v2';
const ITEMS_PER_PAGE = 50;
const PROOF_PAGES = 101; // protocol/volume cap(100) + 1 — proves truncation
const PROOF_PAGES_INFLOW = 61; // bridge inflow cap(60) + 1
const RANK_PAGES = 6;
const WHALES_TO_PROBE = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qs = (np) =>
  np ? '?' + Object.entries(np).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';

// 1) Ranked addresses → top EOAs
const seen = new Set();
const eoas = [];
let url = `${BASE}/addresses?sort=transactions_count&order=desc`;
for (let p = 0; p < RANK_PAGES && url; p++) {
  const data = await (await fetch(url)).json();
  for (const item of data?.items || []) {
    if (item.is_contract || seen.has(item.hash)) continue;
    seen.add(item.hash);
    eoas.push({ hash: item.hash, txs: parseInt(item.transactions_count || '0', 10) });
  }
  url = data?.next_page_params ? `${BASE}/addresses${qs(data.next_page_params)}` : null;
  await sleep(400);
}
eoas.sort((a, b) => b.txs - a.txs);
const whales = eoas.slice(0, WHALES_TO_PROBE);

for (const whale of whales) {
  const w = whale.hash;
  console.log(`\n=== ${w} (${whale.txs.toLocaleString()} txs)`);

  // 2) Sample recent outgoing txs: which contracts dominate?
  let freq = new Map();
  try {
    const sample = await (await fetch(`${BASE}/addresses/${w}/transactions?filter=from`)).json();
    for (const it of sample?.items || []) {
      const to = (it.to?.hash || '').toLowerCase();
      const method = it.method || 'fallback';
      const key = `${to.slice(0, 12)}… (${method})`;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    console.log('   recent targets:', [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}×${n}`).join('  '));
  } catch (e) { console.log('   sample failed:', e.message); }
  await sleep(500);

  // 3) Inbound token transfers (bridge inflow walk): count pages to cap+1
  try {
    let u = `${BASE}/addresses/${w}/token-transfers?filter=to`;
    let pages = 0;
    while (u && pages < PROOF_PAGES_INFLOW) { pages++; const d = await (await fetch(u)).json(); u = d?.next_page_params ? `${BASE}/addresses/${w}/token-transfers?filter=to${qs(d.next_page_params)}` : null; await sleep(250); }
    console.log(`   bridge inflow (token-transfers to wallet): ${pages < PROOF_PAGES_INFLOW ? `complete in ${pages} pages → COVERED (cap 60)` : `still going at ${pages} pages → TRUNCATES (cap 60)`}`);
  } catch (e) { console.log('   inflow probe failed:', e.message); }
  await sleep(500);

  // 4) Outgoing txs (volume walk): count pages to cap+1
  try {
    let u = `${BASE}/addresses/${w}/transactions?filter=from`;
    let pages = 0;
    while (u && pages < PROOF_PAGES) { pages++; const d = await (await fetch(u)).json(); u = d?.next_page_params ? `${BASE}/addresses/${w}/transactions?filter=from${qs(d.next_page_params)}` : null; await sleep(250); }
    console.log(`   circulated volume (outgoing txs): ${pages < PROOF_PAGES ? `complete in ${pages} pages → COVERED (cap 100)` : `still going at ${pages} pages → TRUNCATES (cap 100)`}`);
  } catch (e) { console.log('   volume probe failed:', e.message); }
  await sleep(500);
}
