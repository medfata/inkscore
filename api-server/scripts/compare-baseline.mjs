// Diff two baseline captures (see capture-baseline.mjs).
// Accuracy-tolerant comparison: USD values are re-priced at fetch time, so
// floats compare with a small relative tolerance; counts must match exactly.
// Volatile fields (timestamps) are ignored.
//
// Usage: node scripts/compare-baseline.mjs --a baselines/pre-sprint1 --b baselines/after-swap-extraction

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const A = getArg('a');
const B = getArg('b');
if (!A || !B) { console.error('Usage: --a <dirA> --b <dirB>'); process.exit(2); }

const VOLATILE_KEYS = new Set(['last_updated', 'updated_at', 'timestamp', 'captured_at']);
const FLOAT_TOL_REL = 0.005; // 0.5% — covers ETH-price repricing between runs
const FLOAT_TOL_ABS = 0.02;

function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (VOLATILE_KEYS.has(k)) continue;
      if (typeof val === 'number' && !Number.isInteger(val)) {
        out[k] = Math.round(val * 10000) / 10000; // 4 decimals for floats
      } else {
        out[k] = normalize(val);
      }
    }
    // deterministic array order for platform-like lists
    for (const [k, val] of Object.entries(out)) {
      if (Array.isArray(val) && val.length > 1 && val.every((x) => x && typeof x === 'object')) {
        const key = val[0].platform ? 'platform' : val[0].slug ? 'slug' : val[0].contractAddress ? 'contractAddress' : null;
        if (key) out[k] = [...val].sort((p, q) => String(p[key]).localeCompare(String(q[key])));
      }
    }
    return out;
  }
  return v;
}

function isNum(x) { return typeof x === 'number' && !Number.isInteger(x); }
// Many endpoints format USD as strings ("453.75") — those must get the same
// repricing tolerance as numbers, not exact string equality.
function numStr(x) {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) && !Number.isInteger(n) ? n : null;
}

function diff(a, b, path, report, usdScale = 1) {
  // Floats in these payloads are price-derived (USD values, token values) and
  // repriced at fetch time. When captures ran at different ETH prices, a float
  // passes if it matches EITHER the plain tolerance OR the price-scaled
  // expectation (5% band — blended values mix $1-pegged stables with
  // ETH-pegged legs, so the blended ratio isn't exactly the price ratio).
  // Integer counts compare EXACTLY — no tolerance.
  const scale = usdScale;
  const na = numStr(a), nb = numStr(b);
  if (na !== null && nb !== null) {
    const plainOk = Math.abs(nb - na) <= Math.max(FLOAT_TOL_ABS, Math.abs(na) * FLOAT_TOL_REL);
    const scaledOk = scale !== 1 && Math.abs(nb - na * scale) <= Math.max(FLOAT_TOL_ABS, Math.abs(na * scale) * 0.05);
    if (!plainOk && !scaledOk) {
      report.push(`${path}: "${a}" != "${b}" (beyond tolerance)`);
    }
    return;
  }
  if (isNum(a) && isNum(b)) {
    const plainOk = Math.abs(b - a) <= Math.max(FLOAT_TOL_ABS, Math.abs(a) * FLOAT_TOL_REL);
    const scaledOk = scale !== 1 && Math.abs(b - a * scale) <= Math.max(FLOAT_TOL_ABS, Math.abs(a * scale) * 0.05);
    if (!plainOk && !scaledOk) {
      report.push(`${path}: ${a} != ${b} (beyond tolerance)`);
    }
    return;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (a !== b) report.push(`${path}: ${a} != ${b} (count mismatch)`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) report.push(`${path}: array length ${a} vs ${b}`);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) diff(a[i], b[i], `${path}[${i}]`, report, usdScale);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) report.push(`${path}.${k}: missing in A`);
      else if (!(k in b)) report.push(`${path}.${k}: missing in B`);
      else diff(a[k], b[k], `${path}.${k}`, report, usdScale);
    }
    return;
  }
  if (a !== b) report.push(`${path}: ${JSON.stringify(a)?.slice(0, 60)} != ${JSON.stringify(b)?.slice(0, 60)}`);
}

let totalFiles = 0, totalDiffs = 0;
// USD normalization: values are priced at fetch time, so when the two
// captures ran at different ETH spot prices, USD diffs must be judged
// against the price ratio, not a fixed tolerance.
function readPrice(dir, wallet) {
  try {
    const m = JSON.parse(readFileSync(join(dir, wallet, '_meta.json'), 'utf8'));
    return typeof m.ethPrice === 'number' && m.ethPrice > 0 ? m.ethPrice : null;
  } catch { return null; }
}

for (const wallet of readdirSync(A)) {
  const dirA = join(A, wallet);
  if (!statSync(dirA).isDirectory()) continue;
  const dirB = join(B, wallet);
  if (!existsSync(dirB)) { console.log(`wallet ${wallet}: MISSING in B`); totalDiffs++; continue; }
  const pa = readPrice(A, wallet), pb = readPrice(B, wallet);
  // Only normalize within sane bounds; 1 = no normalization needed.
  let usdScale = 1;
  if (pa && pb && pa !== pb) {
    const ratio = pb / pa;
    if (ratio > 0.2 && ratio < 5) usdScale = ratio;
  }
  if (usdScale !== 1) console.log(`(${wallet}: normalizing USD by price ratio ${usdScale.toFixed(4)} — A@$${pa} B@$${pb})`);
  for (const f of readdirSync(dirA)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    totalFiles++;
    const a = normalize(JSON.parse(readFileSync(join(dirA, f), 'utf8')));
    const bf = join(dirB, f);
    if (!existsSync(bf)) { console.log(`✗ ${wallet}/${f}: missing in B`); totalDiffs++; continue; }
    const b = normalize(JSON.parse(readFileSync(bf, 'utf8')));
    const report = [];
    diff(a, b, f.replace('.json', ''), report, usdScale);
    if (report.length === 0) {
      console.log(`✓ ${wallet}/${f}`);
    } else {
      totalDiffs += report.length;
      console.log(`✗ ${wallet}/${f}:`);
      report.slice(0, 12).forEach((r) => console.log(`    ${r}`));
      if (report.length > 12) console.log(`    … +${report.length - 12} more`);
    }
  }
}
console.log(`\n${totalFiles} files compared — ${totalDiffs === 0 ? 'PARITY OK ✅ (behavior identical within tolerance)' : `${totalDiffs} DIFFERENCES ❌ — do not ship the extraction until resolved`}`);
process.exit(totalDiffs === 0 ? 0 : 1);
