// One-off smoke test for gonefishin-service against live Blockscout + Postgres.
// Usage: npx tsx scripts/smoke-gonefishin.ts <wallet>
// (run from api-server/ so dotenv picks up .env)

async function main() {
  const { getGoneFishinData } = await import('../src/services/gonefishin-service');
  const { pool } = await import('../src/db');
  const wallet = process.argv[2] || '0x9628149b8268f15adc99911e64a79cdea7fb71ab';
  const started = Date.now();
  try {
    const data = await getGoneFishinData(wallet.toLowerCase());
    console.log(`[smoke] ${wallet} in ${Date.now() - started}ms`);
    console.log(JSON.stringify(data, null, 2));

    const t2 = Date.now();
    await getGoneFishinData(wallet.toLowerCase());
    console.log(`[smoke] second call (cache hit): ${Date.now() - t2}ms`);
  } finally {
    // Force exit: the proxy pool's keep-alive sockets keep the event loop
    // alive after pool.end(), which would hang the smoke run.
    setTimeout(() => process.exit(0), 500).unref();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
