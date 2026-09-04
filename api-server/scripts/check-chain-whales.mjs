// One-off: find the highest-tx EOAs (user wallets) on Ink and check whether
// the new page caps would truncate any walk for them.
//
// Usage: node scripts/check-chain-whales.mjs   (no DB needed)

const BASE = 'https://explorer.inkonchain.com/api/v2';
const CAPS = {
  protocolPages: 100,  // MAX_COUNT_PAGES
  nativePages: 100,    // MAX_NATIVE_PAGES
  inflowPages: 60,     // BRIDGE_INFLOW_TRANSFER_PAGES
};
const ITEMS_PER_PAGE = 50;
const PAGES_TO_SCAN = 6; // 6 × 50 = 300 ranked addresses — plenty to find EOAs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const eoaByTx = [];
let url = `${BASE}/addresses?sort=transactions_count&order=desc`;

for (let p = 0; p < PAGES_TO_SCAN && url; p++) {
  const res = await fetch(url);
  const data = await res.json();
  for (const item of data?.items || []) {
    if (item.is_contract) continue;
    eoaByTx.push({
      hash: item.hash,
      txs: parseInt(item.transactions_count || '0', 10),
      transfers: null,
    });
  }
  const np = data?.next_page_params;
  url = np
    ? `${BASE}/addresses?${Object.entries(np).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`
    : null;
  await sleep(400);
}

// Dedup + sort desc
const seen = new Set();
const eoas = [];
for (const e of eoaByTx) {
  if (seen.has(e.hash)) continue;
  seen.add(e.hash);
  eoas.push(e);
}
eoas.sort((a, b) => b.txs - a.txs);
const top = eoas.slice(0, 10);

console.log(`Top ${top.length} highest-tx EOAs on Ink vs new caps (50 items/page)\n`);
console.log(
  'rank  wallet'.padEnd(48),
  'total txs'.padStart(10),
  'worst-case pages'.padStart(17),
  'verdict'
);

for (let i = 0; i < top.length; i++) {
  const e = top[i];
  // Worst-case pages assume ALL txs are outgoing + ALL transfers inbound.
  const txPages = Math.ceil(e.txs / ITEMS_PER_PAGE);
  let xferPages = '?';
  try {
    const c = await (await fetch(`${BASE}/addresses/${e.hash}/counters`)).json();
    const xfers = parseInt(c.token_transfers_count || '0', 10);
    xferPages = Math.ceil(xfers / ITEMS_PER_PAGE);
    e.transfers = xfers;
  } catch { /* keep '?' */ }

  const volumeOk = txPages <= CAPS.nativePages;
  const protocolsOk = txPages <= CAPS.protocolPages;
  const bridgeOk = xferPages === '?' ? true : xferPages <= CAPS.inflowPages;
  const ok = volumeOk && protocolsOk && bridgeOk;

  const verdict = ok
    ? 'COVERED — full history in one scan'
    : `AT RISK: ${!volumeOk ? `volume ${txPages}p>100 ` : ''}${!protocolsOk ? 'protocol walks may truncate ' : ''}${bridgeOk ? '' : `bridge ${xferPages}p>60`}`;

  console.log(
    String(i + 1).padStart(5),
    (e.hash.slice(0, 10) + '…' + e.hash.slice(-4)).padEnd(18),
    String(e.txs).padStart(10),
    `${txPages}p`.padStart(7),
    `xfer:${xferPages}p`.padStart(9),
    ' ',
    verdict
  );
  await sleep(400);
}
