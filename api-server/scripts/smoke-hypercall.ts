// One-off smoke test for hypercall-service against live Blockscout + Postgres.
// Usage: npx tsx scripts/smoke-hypercall.ts <wallet>
// (run from api-server/ so dotenv picks up .env)

async function main() {
  const { getHypercallData } = await import('../src/services/hypercall-service');
  const { pool } = await import('../src/db');
  const wallet = (process.argv[2] || '0x0c6657303fb609bc39174d5b198e4a7a1280d885').toLowerCase();
  const started = Date.now();
  try {
    const data = await getHypercallData(wallet);
    console.log(`[smoke] ${wallet} in ${Date.now() - started}ms`);
    console.log(JSON.stringify(data, null, 2));

    const t2 = Date.now();
    await getHypercallData(wallet);
    console.log(`[smoke] second call (cache hit): ${Date.now() - t2}ms`);
  } finally {
    setTimeout(() => process.exit(0), 500).unref();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
