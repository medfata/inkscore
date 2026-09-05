// Deep-diff one dashboard field against its endpoint (canonical, timestamps ignored),
// printing exact leaf paths that differ. Usage:
//   node scripts/diag-field-diff.mjs <wallet> <port> <field>
const BASE_NEXT = `http://127.0.0.1:${process.argv[3] || 3100}`;
const BASE_API = process.env.API_BASE_URL_TEST || 'http://127.0.0.1:4000';
const WALLET = process.argv[2];
const FIELD = process.argv[4];

const URLS = {
  score: `${BASE_API}/api/wallet/${WALLET}/score`,
  stats: `${BASE_API}/api/wallet/${WALLET}/stats`,
  analytics: `${BASE_API}/api/analytics/${WALLET}`,
  nado: `${BASE_API}/api/nado/${WALLET}`,
};

function flat(v, prefix, out, stripKey) {
  if (stripKey.test(prefix)) return;
  if (Array.isArray(v)) { v.forEach((x, i) => flat(x, `${prefix}[${i}]`, out, stripKey)); return; }
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) flat(val, `${prefix}.${k}`, out, stripKey);
    return;
  }
  out[prefix] = v;
}

const dash = await (await fetch(`${BASE_NEXT}/api/${WALLET}/dashboard?refresh=true`)).json();
const ep = await (await fetch(URLS[FIELD], { signal: AbortSignal.timeout(45000) })).json();

const strip = /(last_updated|captured_at|from_snapshot)/;
const a = {}, b = {};
flat(dash[FIELD] ?? null, FIELD, a, strip);
flat(ep ?? null, FIELD, b, strip);
const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
let n = 0;
for (const k of [...keys].sort()) {
  if (String(a[k]) !== String(b[k])) {
    n++;
    console.log(`${k}: dashboard=${JSON.stringify(a[k])} endpoint=${JSON.stringify(b[k])}`);
  }
}
console.log(n === 0 ? `NO VALUE DIFFERENCES in ${FIELD} ✅` : `${n} differing leaves in ${FIELD}`);
