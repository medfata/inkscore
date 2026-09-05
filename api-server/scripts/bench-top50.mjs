// Benchmark: run the top-50 leaderboard wallets against the local api-server,
// timing a NO-CACHE full dashboard load for each (?refresh=true — bypasses the
// responseCache AND the snapshot; metrics recompute live, then re-cache).
//
//   node scripts/bench-top50.mjs
//
// Writes one JSON line per wallet to baselines/bench-top50/results.jsonl as it
// goes, then prints a summary.
import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

const BASE = process.env.API_BASE_URL_TEST || 'http://127.0.0.1:4000';
const OUT_DIR = path.join(__dirname, '..', 'baselines', 'bench-top50');
const OUT_FILE = path.join(OUT_DIR, 'results.jsonl');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, '');

const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT entry->>'wallet_address' AS wallet, (entry->>'score')::numeric AS score
       FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
      WHERE id = 1
      ORDER BY (entry->>'score')::numeric DESC
      LIMIT 50`
  );
  await c.end();
  const wallets = r.rows.map((x) => (x.wallet || '').toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w));
  console.log(`benchmarking ${wallets.length} wallets (no-cache, sequential)\n`);
  console.log('rank | wallet                              | time   | partial | missing');
  console.log('-----+-------------------------------------+--------+---------+--------');

  const times = [];
  let complete = 0;
  let failed = 0;
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const t0 = Date.now();
    let rec = { rank: i + 1, wallet: w, ms: null, partial: null, missing: [], error: null };
    try {
      const res = await fetch(`${BASE}/api/dashboard/bundle/${w}?refresh=true`, {
        signal: AbortSignal.timeout(150000),
      });
      if (!res.ok) {
        rec.error = `HTTP ${res.status}`;
      } else {
        const b = await res.json();
        const missing = Object.entries(b.metrics || {}).filter(([, v]) => v == null).map(([k]) => k);
        rec.ms = Date.now() - t0;
        rec.partial = !!b.partial;
        rec.missing = missing;
        if (!b.partial) complete++;
        times.push(rec.ms);
      }
    } catch (e) {
      rec.ms = Date.now() - t0;
      rec.error = e.name === 'TimeoutError' ? 'timeout >150s' : String(e.message || e);
    }
    failed += rec.error ? 1 : 0;
    const miss = rec.missing.length > 0 ? rec.missing.join(',') : (rec.error ? rec.error : '-');
    console.log(
      `${String(i + 1).padStart(4)} | ${w} | ${fmt(rec.ms).padStart(6)} | ${String(rec.partial).padStart(7)} | ${miss}`
    );
    fs.appendFileSync(OUT_FILE, JSON.stringify(rec) + '\n');
  }

  console.log('\n=== SUMMARY (no-cache full dashboard load, 50 wallets) ===');
  if (times.length) {
    console.log(`complete: ${complete}/${wallets.length}   failed: ${failed}`);
    console.log(`min ${fmt(Math.min(...times))} | p25 ${fmt(pct(times, 25))} | median ${fmt(pct(times, 50))} | p75 ${fmt(pct(times, 75))} | max ${fmt(Math.max(...times))}`);
    console.log(`mean ${(times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1)}s | total ${(times.reduce((a, b) => a + b, 0) / 1000 / 60).toFixed(1)} min`);
  }
})();
