// Sprint 2 gate: prove that a score served FROM a metrics snapshot is
// EXACTLY the score a live computation of the same inputs produces.
//
// Usage (server must be running on :4000, freshly started so the
// responseCache is cold):
//   node scripts/check-snapshot-parity.mjs live     out/live.json
//   node scripts/check-snapshot-parity.mjs snapshot out/from-snapshot.json
//   node scripts/check-snapshot-parity.mjs compare  out/live.json out/from-snapshot.json
//
// Protocol:
//   1. `live` on a COLD server: ?refresh=true -> live gather + compute,
//      which persists the snapshot of those exact inputs.
//   2. RESTART the server (clears the in-memory responseCache; the snapshot
//      persists in Postgres).
//   3. `snapshot` on the cold server: plain GET -> responseCache miss ->
//      snapshot path -> computeScoreFromInputs(stored inputs).
//   4. `compare`: total_points, rank and EVERY breakdown entry must match.
//      last_updated always differs (timestamp). Any other difference is a
//      FAILURE — either the JSONB round-trip or the split is unfaithful
//      (unless the wallet transacted between runs; the diff output shows
//      exactly what moved so that can be judged, e.g. +1 count increments).

const WALLET = process.argv[4] || '0x8655df35818f348ea4e371a613e73677d816f589';
const BASE = process.env.API_BASE_URL_TEST || 'http://127.0.0.1:4000';
const mode = process.argv[2];

function flat(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
    else out[key] = v;
  }
  return out;
}

async function fetchScore(query) {
  const res = await fetch(`${BASE}/api/wallet/${WALLET}/score${query}`);
  if (!res.ok) throw new Error(`score HTTP ${res.status}`);
  return res.json();
}

if (mode === 'live' || mode === 'snapshot') {
  const out = process.argv[3];
  const score = await fetchScore(mode === 'live' ? '?refresh=true' : '');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(score, null, 2));
  console.log(`[${mode}] total_points=${score.total_points} partial=${!!score.partial} -> ${out}`);
  console.log(`[${mode}] breakdown entries: ${Object.keys(flat(score.breakdown)).length}`);
} else if (mode === 'compare') {
  const { readFileSync } = await import('node:fs');
  const a = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  const fa = flat({ total_points: a.total_points, rank: a.rank?.name, breakdown: a.breakdown });
  const fb = flat({ total_points: b.total_points, rank: b.rank?.name, breakdown: b.breakdown });
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  let diffs = 0;
  for (const k of [...keys].sort()) {
    if (String(fa[k]) !== String(fb[k])) {
      diffs++;
      console.log(`  ✗ ${k}: ${fa[k]} != ${fb[k]}`);
    }
  }
  if (diffs === 0) {
    console.log('SNAPSHOT PARITY OK ✅ — snapshot-served score is identical to the live score');
  } else {
    console.log(`SNAPSHOT PARITY: ${diffs} differences — inspect above (live-activity increments must be judged manually)`);
    process.exit(1);
  }
} else {
  console.error('usage: check-snapshot-parity.mjs live|snapshot|compare ...');
  process.exit(1);
}
