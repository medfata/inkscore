// Ground-truth check for the native-outflow cursor: pages the plain
// address-transactions endpoint to exhaustion (no cap) and reports the
// exact totals the cursored walk must converge to.
// Usage: node scripts/verify-native-outflow.mjs 0xWallet
const WALLET = (process.argv[2] || '0x8655df35818f348ea4e371a613e73677d816f589').toLowerCase();
const BASE = 'https://explorer.inkonchain.com/api/v2';

const toQs = (np) => Object.entries(np || {})
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === null || v === undefined ? '' : String(v))}`)
  .join('&');

let url = `${BASE}/addresses/${WALLET}/transactions?filter=from`;
let pages = 0;
let count = 0; // ok txs with a value field (previous capped-walk semantics)
let countPos = 0; // value > 0 only
const uniq = new Set();
let wei = 0n;
let dupItems = 0;
while (url && pages < 500) {
  pages++;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.error(`HTTP ${res.status} on page ${pages}`); process.exit(1); }
  const data = await res.json();
  for (const item of data?.items || []) {
    if (item?.status === 'ok' && item?.value) {
      count++;
      const h = String(item.hash || '').toLowerCase();
      if (h) {
        if (uniq.has(h)) dupItems++; else uniq.add(h);
      }
      try {
        const v = BigInt(String(item.value));
        wei += v;
        if (v > 0n) countPos++;
      } catch {}
    }
  }
  const np = data?.next_page_params;
  if (!np) break;
  url = `${BASE}/addresses/${WALLET}/transactions?filter=from&${toQs(np)}`;
  await new Promise((r) => setTimeout(r, 350));
}
console.log(`FULL HISTORY: pages=${pages} ok_value_txs=${count} (uniq_hashes=${uniq.size}, dup_items=${dupItems}, value_gt0=${countPos}) total_wei=${wei.toString()} eth=${Number(wei) / 1e18}`);
