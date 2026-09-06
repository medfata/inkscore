// Fleet status dashboard: renders backfill progress as text bars.
// Progress = wallets with COMPLETE metric snapshots (the truth that matters
// for instant UI loads), queried from the shared Postgres. Lane position +
// throttle + 429 counters come from the local lane log files.
// Usage: node scripts/fleet-status.mjs
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const LOG_DIR = 'D:/my_projects/inkscore/backfill';
const LANES = [
  { name: 'A', range: [1, 1015], log: `${LOG_DIR}/client-a.log`, api: `${LOG_DIR}/lane1-api.log` },
  { name: 'B', range: [1016, 2030], log: `${LOG_DIR}/client-b.log`, api: `${LOG_DIR}/lane2-api.log` },
  { name: 'C', range: [2031, 3045], log: `${LOG_DIR}/client-c.log`, api: `${LOG_DIR}/lane3-api.log` },
  { name: 'D', range: [3046, 4060], log: `${LOG_DIR}/client-d.log`, api: `${LOG_DIR}/lane4-api.log` },
  { name: 'VPS', range: [4061, 4439], log: null, api: null },
];
const W = 34; // bar width

const bar = (done, total) => {
  const filled = total > 0 ? Math.round((done / total) * W) : 0;
  return '█'.repeat(filled) + '░'.repeat(W - filled);
};
const pad = (s, n) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

const c = new pg.Client({ connectionString: env.match(/DATABASE_URL=(.*)/)[1].trim() });
await c.connect();

// Leaderboard ranks (1-based position by score) mapped to wallets per range.
const ranks = await c.query(`
  WITH lb AS (SELECT lower(entry->>'wallet_address') AS wallet,
                     row_number() OVER (ORDER BY (entry->>'score')::numeric DESC) AS rank
              FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry WHERE id = 1)
  SELECT count(*)::int AS total FROM lb`);
const total = ranks.rows[0].total;

const perRange = [];
for (const lane of LANES) {
  const [start, end] = lane.range;
  const r = await c.query(
    `WITH lb AS (SELECT lower(entry->>'wallet_address') AS wallet,
                        row_number() OVER (ORDER BY (entry->>'score')::numeric DESC) AS rank
                 FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry WHERE id = 1)
     SELECT count(*)::int AS wallets,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wallet_metrics_snapshots s WHERE s.wallet = lb.wallet AND s.partial = false))::int AS complete,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wallet_metrics_snapshots s WHERE s.wallet = lb.wallet))::int AS visited
     FROM lb WHERE rank BETWEEN $1 AND $2`, [start, end]);
  perRange.push({ ...lane, wallets: r.rows[0].wallets, complete: r.rows[0].complete, visited: r.rows[0].visited });
}
const grand = perRange.reduce((a, r) => ({ wallets: a.wallets + r.wallets, complete: a.complete + r.complete, visited: a.visited + r.visited }), { wallets: 0, complete: 0, visited: 0 });

// Log-derived lane telemetry.
const lastLine = (file, re) => {
  try {
    if (!file || !existsSync(file)) return null;
    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => re.test(l));
    return lines.length ? lines[lines.length - 1] : null;
  } catch { return null; }
};

const lines = [];
lines.push('╔══════════════════════════════════════════════════════════════════╗');
lines.push('║  INKSCORE BACKFILL FLEET — live status                           ║');
lines.push('╠══════════════════════════════════════════════════════════════════╣');
for (const r of perRange) {
  const rankLine = lastLine(r.log, /\[\d+\/\d+\] rank/);
  const pos = rankLine ? (rankLine.match(/\[(\d+)\/(\d+)\] rank (\d+)/) || [])[3] : null;
  const usage = lastLine(r.api, /Blockscout usage/);
  const rpm = usage ? (usage.match(/last 60s: (\d+) reqs/) || [])[1] : null;
  const n429 = r.api && existsSync(r.api)
    ? readFileSync(r.api, 'utf8').split('\n').filter((l) => /status 429|429 for/.test(l)).length
    : 0;
  const pct = r.wallets ? Math.round((r.complete / r.wallets) * 100) : 0;
  const vpct = r.wallets ? Math.round((r.visited / r.wallets) * 100) : 0;
  const posTxt = pos ? `sweep@${pos}/${r.range[1]}` : '—';
  const thrTxt = rpm ? `${rpm} rpm` : '—';
  // Bar = VISITED (sweep traversal truth); done = fully-complete wallets.
  lines.push(`║  Lane ${pad(r.name, 4)} ${bar(r.visited, r.wallets)} ${pad(vpct + '%', 5)} visited ${pad(r.visited + '/' + r.wallets, 12)} done ${pad(String(r.complete), 5)} ${pad(posTxt, 13)} ${pad(thrTxt, 9)} 429:${n429}`);
}
lines.push('╠══════════════════════════════════════════════════════════════════╣');
const vpctAll = Math.round((grand.visited / grand.wallets) * 100);
lines.push(`║  VISITED (sweep traversal)  ${bar(grand.visited, grand.wallets)} ${vpctAll}%`);
lines.push(`║  ${grand.visited} / ${grand.wallets} wallets visited · ${grand.complete} fully complete (instant UI)`);
lines.push('╚══════════════════════════════════════════════════════════════════╝');
console.log(lines.join('\n'));
await c.end();
