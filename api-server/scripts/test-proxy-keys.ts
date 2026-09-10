// Integration test: proxy key store + ProxyScrape client + pool rebuild.
// SAFE: ProxyScrape calls are read-only (subaccounts/overview/displayproxies).
// DB rows use label TEST-KEY and are deleted at the end. Tables created if
// missing (forward-compatible with prod).
// Run: $env:BLOCKSCOUT_PROXY='hybrid'; node -r ts-node/register/transpile-only scripts/test-proxy-keys.ts
// Requires: $env:PROXYSCRAPE_TEST_KEY set to a valid ProxyScrape API key.

import { strict as assert } from 'node:assert';

async function main(): Promise<void> {
  const apiKey = process.env.PROXYSCRAPE_TEST_KEY || '';
  assert.ok(apiKey, 'PROXYSCRAPE_TEST_KEY must be set');

  const store = await import('../src/services/proxy-keys-store');
  const client = await import('../src/services/proxyscrape-client');
  const agent = await import('../src/services/proxy-agent');

  // 1. pure helpers (no DB)
  assert.equal(store.maskApiKey('5OUP6eESCari2mC0'), '5OUP…2mC0');
  assert.equal(store.proxyIdentity('http://user:pass@216.26.234.255:3129'), '216.26.234.255:3129');
  assert.equal(agent.maskProxyUrl('http://az5jyye0xur8:SECRET@216.26.234.255:3129'), 'http://az5jyye0xur8:•••@216.26.234.255:3129');
  const enc = store.encryptSecret('hello');
  assert.equal(store.decryptSecret(enc), 'hello');
  assert.ok(!enc.includes('hello'), 'ciphertext must not contain plaintext');
  console.log('1. helpers OK');

  // 2. tables
  await store.ensureTables();
  console.log('2. tables OK');

  // 3. live ProxyScrape reads
  const subs = await client.listSubaccounts(apiKey);
  assert.ok(subs.length >= 1, 'expected >=1 subaccount');
  const sub = subs.find((s) => s.type.startsWith('datacenter')) || subs[0];
  console.log(`3. subaccounts OK (${subs.length}, using ${sub.type} ${sub.id})`);
  const quota = await client.fetchQuota(apiKey, sub.id, sub.type);
  assert.ok(quota.bandwidthLimit > 0, 'expected bandwidth limit');
  console.log(`   quota: used=${quota.bandwidthUsed} limit=${quota.bandwidthLimit} proxies=${quota.proxyAmount} trial=${quota.isTrial}`);
  const urls = await client.fetchProxyList(apiKey, sub.id, sub.type);
  assert.ok(urls.length >= 1, 'expected >=1 proxy');
  console.log(`   list: ${urls.length} proxies`);

  // 4. store key + sync (cleanup first in case a previous run crashed)
  const pre = await store.listKeysWithSecrets();
  for (const k of pre.filter((x) => x.label === 'TEST-KEY')) {
    await store.deleteKey(k.id);
  }
  const id = await store.addKey('TEST-KEY', apiKey, sub.id, sub.type);
  const keys = await store.listKeys();
  const me = keys.find((k) => k.id === id);
  assert.ok(me, 'key listed');
  assert.ok(/^.{4}….{4}$/.test(me!.api_key_masked), `masked fingerprint, got: ${me!.api_key_masked}`);
  assert.ok(!(me as unknown as Record<string, unknown>).api_key_enc, 'ciphertext must not leak in listKeys');
  console.log(`4. addKey OK (masked=${me!.api_key_masked})`);

  const sync = await store.syncPoolIps(sub.id, urls);
  assert.equal(sync.total, urls.length);
  console.log(`5. syncPoolIps OK (${sync.total})`);

  // 6. pool rebuild from DB
  const r = await agent.rebuildPool('test');
  assert.equal(r.size, urls.length, `pool size ${r.size} !== ${urls.length}`);
  const status = agent.getProxyPoolStatus();
  assert.equal(status.healthy, urls.length);
  assert.ok(status.entries.every((e) => e.urlMasked.includes(':•••@')), 'all entry URLs masked');
  assert.ok(status.entries.every((e) => e.subaccountId === sub.id), 'entries tagged with subaccount');
  console.log(`6. rebuildPool OK (${r.size} IPs, ${status.source})`);

  // 7. quota re-check must NOT deprecate a healthy key
  await agent.recheckKeyQuota(sub.id, 'test');
  const after = await store.listKeys();
  assert.equal(after.find((k) => k.id === id)!.status, 'active', 'healthy key stays active');
  console.log('7. recheckKeyQuota OK (stays active)');

  // 8. admin disable one IP → rebuild drops it
  const victim = status.entries[0];
  await store.setIpAdminDisabled(victim.subaccountId, victim.proxyKey, true);
  const r2 = await agent.rebuildPool('test');
  assert.equal(r2.size, urls.length - 1, 'disabled IP excluded');
  console.log('8. admin disable OK');

  // 9. cleanup
  await store.deleteKey(id);
  const gone = await store.listKeys();
  assert.ok(!gone.some((k) => k.id === id), 'key deleted');
  const rest = await store.getAllPoolIps();
  assert.ok(!rest.some((x) => x.subaccount_id === sub.id), 'cached IPs deleted');
  console.log('9. cleanup OK');

  console.log('ALL PROXY-KEY TESTS PASSED');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
);
