// One-off smoke test for sentry-service against live Blockscout + Postgres.
// Usage: npx tsx scripts/smoke-sentry.ts <wallet>
// (run from api-server/ so dotenv picks up .env)

async function main() {
  const { getSentryData } = await import('../src/services/sentry-service');
  const { pool } = await import('../src/db');
  const wallet = (process.argv[2] || '0x67ae9550f52afdb6ae4a94be45847130ad3b609e').toLowerCase();
  const started = Date.now();
  try {
    const data = await getSentryData(wallet);
    console.log(`[smoke] ${wallet} in ${Date.now() - started}ms`);
    console.log(JSON.stringify(data, null, 2));

    const t2 = Date.now();
    await getSentryData(wallet);
    console.log(`[smoke] second call (cache hit): ${Date.now() - t2}ms`);
  } finally {
    // Force exit: keep-alive sockets would otherwise hang the run.
    setTimeout(() => process.exit(0), 500).unref();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
