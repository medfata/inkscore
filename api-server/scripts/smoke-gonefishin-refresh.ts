// Smoke test for the incremental refresh path of getTokenTransfersInto.
// Forces the discovery TTL to appear expired between calls, then asserts the
// refresh pass stops at the known boundary (+0 new rows, complete).

async function main() {
  const { getTokenTransfersInto } = await import('../src/services/blockscout-service');
  const { pool } = await import('../src/db');
  const wallet = (process.argv[2] || '0x9628149b8268f15adc99911e64a79cdea7fb71ab').toLowerCase();
  const from = '0x476973c8124faf5db6a8fc35265da81e1d9b4e3e';

  try {
    const t1 = Date.now();
    const r1 = await getTokenTransfersInto(wallet, from);
    console.log(`[refresh-test] build/serve: ${Date.now() - t1}ms, rows=${r1.transfers.length}, complete=${r1.complete}`);

    // Age the cursor past the 10min discovery TTL to force a refresh pass.
    const { query } = await import('../src/db');
    await query(`UPDATE bs_token_inflow_cursors SET updated_at = now() - interval '11 minutes' WHERE wallet_address = $1 AND from_address = $2`, [wallet, from]);

    const t2 = Date.now();
    const r2 = await getTokenTransfersInto(wallet, from);
    console.log(`[refresh-test] refresh pass: ${Date.now() - t2}ms, rows=${r2.transfers.length}, complete=${r2.complete}`);
    console.log(`[refresh-test] rows stable: ${r1.transfers.length === r2.transfers.length ? 'YES (boundary hit, no re-scan)' : 'NO — CHECK'}`);
  } finally {
    setTimeout(() => process.exit(0), 500).unref();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[refresh-test] FAILED:', err);
  process.exit(1);
});
