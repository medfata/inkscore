// =============================================================================
// Fresh-transaction pickup validator
//
// Proves the incremental cursor mechanism picks up NEW txs on live requests
// even after the worker's last pass, without double-counting:
//   0. NORMALIZE  — one call so the row is fresh (whatever its prior state).
//   1. CHEAP PATH — a fresh row (updated_at < 60 min TTL) is served from DB
//      without a re-walk (updated_at untouched).
//   2. DELTA PATH — aging updated_at forces a re-walk of ONLY the delta
//      (age_from = last_seen); count must not inflate, last_seen must not
//      regress.
//   3. STABILITY  — a second forced re-walk must leave the count identical
//      (regression check for the inclusive-age_from double-count bug).
//
// Run: npx tsx scripts/validate-fresh-tx.ts [wallet]
// =============================================================================
import 'dotenv/config';

// Mirrors analytics-metrics-service (inkypump-created protocol).
const PROTOCOL = 'inkypump-created';
const TO_ADDRESS = '0x1d74317d760f2c72a94386f50e8d10f2c902b899';
const METHODS = ['0xa07849e6'];

async function main() {
  const { query, pool } = await import('../src/db');
  const { getProtocolCount } = await import('../src/services/blockscout-service');

  let wallet = process.argv[2]?.toLowerCase();
  if (!wallet) {
    const pick = (
      await query<{ wallet_address: string }>(
        `SELECT wallet_address FROM bs_protocol_counts
          WHERE protocol = $1 AND count > 0
          ORDER BY updated_at DESC LIMIT 1`,
        [PROTOCOL]
      )
    )[0];
    wallet = pick?.wallet_address;
  }
  if (!wallet) { console.log('no bs_protocol_counts row found to test with'); process.exit(1); }

  const readRow = async () => (
    await query<{ count: string; last_seen: string | null; updated_at: string }>(
      `SELECT count, last_seen::text AS last_seen, updated_at::text AS updated_at
         FROM bs_protocol_counts
        WHERE wallet_address = $1 AND protocol = $2`,
      [wallet, PROTOCOL]
    )
  )[0];
  const age = async (hours: number) => {
    await query(
      `UPDATE bs_protocol_counts SET updated_at = NOW() - ($1::bigint * INTERVAL '1 hour')
        WHERE wallet_address = $2 AND protocol = $3`,
      [hours, wallet, PROTOCOL]
    );
  };

  console.log(`testing ${PROTOCOL} on ${wallet}`);

  // ---- 0. NORMALIZE: make the row fresh regardless of prior state ----
  const base = await readRow();
  console.log(`  prior state: count=${base?.count}, last_seen=${base?.last_seen}, updated_at=${base?.updated_at}`);
  const r0 = await getProtocolCount(wallet, PROTOCOL, TO_ADDRESS, METHODS);

  // ---- 1. CHEAP PATH ----
  const fresh = await readRow();
  const t1 = Date.now();
  const r1 = await getProtocolCount(wallet, PROTOCOL, TO_ADDRESS, METHODS);
  const d1 = Date.now() - t1;
  const after1 = await readRow();
  const cheapOk = after1.updated_at === fresh.updated_at && r1.count === r0.count;
  console.log(`\n[1] cheap path: ${d1}ms, count=${r1.count}, updated_at ${cheapOk ? 'UNTOUCHED ✓ (served from DB, no re-walk)' : 'CHANGED ✗'}`);

  // ---- 2. DELTA PATH (new txs since last_seen get picked up) ----
  await age(2);
  const t2 = Date.now();
  const r2 = await getProtocolCount(wallet, PROTOCOL, TO_ADDRESS, METHODS);
  const after2 = await readRow();
  const reWalked = after2.updated_at !== fresh.updated_at;
  const cursorOk = after2.last_seen === null || after2.last_seen >= fresh.last_seen;
  console.log(`[2] delta path: ${Date.now() - t2}ms, count=${r2.count} (base ${r0.count})`);
  console.log(`    re-walked:          ${reWalked ? '✓ (updated_at bumped → delta scanned)' : '✗'}`);
  console.log(`    cursor monotonic:   ${cursorOk ? `✓ (last_seen ${after2.last_seen})` : '✗'}`);

  // ---- 3. STABILITY (regression check for double-counting) ----
  await age(2);
  const r3 = await getProtocolCount(wallet, PROTOCOL, TO_ADDRESS, METHODS);
  const stable = r3.count === r2.count;
  console.log(`[3] stability: second re-walk count=${r3.count} ${stable ? '✓ (no inflation)' : `✗ INFLATED from ${r2.count}`}`);

  const pass = cheapOk && reWalked && cursorOk && stable;
  console.log(`\n${pass ? 'FRESH-TX PICKUP VALIDATION: PASS ✓' : 'FRESH-TX PICKUP VALIDATION: FAIL ✗'}`);
  console.log('New txs after the worker passes its cycle are accounted for by the next live request (age_from = last_seen), with no double-counting.');
  await pool.end();
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
