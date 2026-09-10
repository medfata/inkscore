// Admin proxy-key management (api-server side).
//
// Auth: shared secret in the `x-admin-secret` header (ADMIN_API_SECRET env).
// The Next.js `web` service holds the same secret and only forwards after its
// own wallet-signature admin check. timingSafeEqual on sha256 digests.
//
// Nothing here ever returns full API keys or proxy credentials — masked only.

import { Router, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  addKey,
  deleteKey,
  ensureTables,
  getAllPoolIps,
  listKeys,
  listKeysWithSecrets,
  setIpAdminDisabled,
  syncPoolIps,
  updateKeyQuota,
} from '../services/proxy-keys-store';
import { decryptSecret } from '../services/proxy-keys-store';
import {
  fetchProxyList,
  fetchQuota,
  fetchUsageBuckets,
  listSubaccounts,
} from '../services/proxyscrape-client';
import { getProxyPoolStatus, maskProxyUrl, rebuildPool, recheckKeyQuota } from '../services/proxy-agent';

const router = Router();

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.ADMIN_API_SECRET || '';
  const got = req.header('x-admin-secret') || '';
  if (!expected) {
    res.status(503).json({ error: 'proxy admin disabled: ADMIN_API_SECRET not configured' });
    return false;
  }
  const a = createHash('sha256').update(expected, 'utf8').digest();
  const b = createHash('sha256').update(got, 'utf8').digest();
  if (!timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

router.use((req, res, next) => {
  if (checkSecret(req, res)) next();
});

// GET /api/admin/proxies/status — pool + keys + all cached IPs (all masked)
router.get('/status', async (_req, res) => {
  try {
    await ensureTables();
    const pool = getProxyPoolStatus();
    const keys = await listKeys();
    const ips = await getAllPoolIps();
    res.json({
      pool,
      keys,
      ips: ips.map((r) => ({
        subaccountId: r.subaccount_id,
        proxyKey: r.proxy_key,
        urlMasked: maskProxyUrl(r.proxy_url),
        online: r.online,
        adminDisabled: r.admin_disabled,
        autoDisabled: r.auto_disabled,
        disableReason: r.disable_reason,
        consecFails: r.consec_fails,
        requests: Number(r.requests) || 0,
        ok: Number(r.ok_count) || 0,
        rateLimited: Number(r.rate_limited) || 0,
        netErrors: Number(r.net_errors) || 0,
        lastError: r.last_error,
        lastUsedAt: r.last_used_at,
      })),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/admin/proxies/keys { apiKey, label } — validate live, discover
// subaccounts, store key(s), sync lists, rebuild pool.
router.post('/keys', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    const label = String(req.body?.label || '').trim().slice(0, 80);
    if (!apiKey) {
      res.status(400).json({ error: 'apiKey is required' });
      return;
    }
    await ensureTables();
    const subs = await listSubaccounts(apiKey);
    const dcSubs = subs.filter(
      (s) => s.type === 'datacenter_shared' || s.type === 'datacenter_dedicated'
    );
    if (dcSubs.length === 0) {
      res.status(400).json({ error: 'key is valid but has no datacenter subaccounts' });
      return;
    }
    const added = [];
    for (const sub of dcSubs) {
      const quota = await fetchQuota(apiKey, sub.id, sub.type);
      const urls = await fetchProxyList(apiKey, sub.id, sub.type);
      const id = await addKey(label || sub.label, apiKey, sub.id, sub.type);
      await syncPoolIps(sub.id, urls);
      await updateKeyQuota(id, quota, urls.length);
      added.push({
        id,
        label: label || sub.label,
        subaccountId: sub.id,
        accountType: sub.type,
        proxies: urls.length,
        bandwidthUsed: quota.bandwidthUsed,
        bandwidthLimit: quota.bandwidthLimit,
        expiresAtMs: quota.expiresAtMs,
      });
    }
    await rebuildPool('admin key added');
    res.json({ added });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /api/admin/proxies/keys/:id — remove key + its cached IPs, rebuild.
router.delete('/keys/:id', async (req, res) => {
  try {
    await ensureTables();
    await deleteKey(String(req.params.id));
    await rebuildPool('admin key deleted');
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/admin/proxies/keys/:id/sync — re-fetch list + quota now. Expired
// or exhausted keys deprecate here (same as the scheduled poll).
router.post('/keys/:id/sync', async (req, res) => {
  try {
    await ensureTables();
    const keys = await listKeysWithSecrets();
    const key = keys.find((k) => k.id === String(req.params.id));
    if (!key) {
      res.status(404).json({ error: 'key not found' });
      return;
    }
    if (key.status !== 'active') {
      res.status(400).json({ error: `key is ${key.status}: ${key.deprecated_reason}` });
      return;
    }
    let apiKey: string;
    try {
      apiKey = decryptSecret(key.api_key_enc);
    } catch {
      res.status(500).json({ error: 'stored key undecryptable (secret rotated?)' });
      return;
    }
    const urls = await fetchProxyList(apiKey, key.subaccount_id, key.account_type);
    await syncPoolIps(key.subaccount_id, urls);
    const quota = await fetchQuota(apiKey, key.subaccount_id, key.account_type);
    await updateKeyQuota(key.id, quota, urls.length);
    await recheckKeyQuota(key.subaccount_id, 'manual sync');
    await rebuildPool('admin key sync');
    res.json({
      proxies: urls.length,
      bandwidthUsed: quota.bandwidthUsed,
      bandwidthLimit: quota.bandwidthLimit,
      expiresAtMs: quota.expiresAtMs,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'SUBSCRIPTION_EXPIRED') {
      try {
        await recheckKeyQuota(
          (await listKeysWithSecrets()).find((k) => k.id === String(req.params.id))?.subaccount_id || '',
          'manual sync'
        );
        await rebuildPool('admin key sync');
      } catch {
        // ignore
      }
      res.status(400).json({ error: 'subscription expired — key deprecated' });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// PATCH /api/admin/proxies/ips { subaccountId, proxyKey, disabled }
router.patch('/ips', async (req, res) => {
  try {
    const subaccountId = String(req.body?.subaccountId || '');
    const proxyKey = String(req.body?.proxyKey || '');
    const disabled = req.body?.disabled === true;
    if (!subaccountId || !proxyKey) {
      res.status(400).json({ error: 'subaccountId and proxyKey are required' });
      return;
    }
    await ensureTables();
    await setIpAdminDisabled(subaccountId, proxyKey, disabled);
    await rebuildPool('admin ip toggle');
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/admin/proxies/reload — re-read pool (covers hand-edits).
router.post('/reload', async (_req, res) => {
  const r = await rebuildPool('admin reload');
  res.json(r);
});

// GET /api/admin/proxies/usage/:id — live quota + usage buckets for charts.
router.get('/usage/:id', async (req, res) => {
  try {
    await ensureTables();
    const keys = await listKeysWithSecrets();
    const key = keys.find((k) => k.id === String(req.params.id));
    if (!key) {
      res.status(404).json({ error: 'key not found' });
      return;
    }
    let apiKey: string;
    try {
      apiKey = decryptSecret(key.api_key_enc);
    } catch {
      res.status(500).json({ error: 'stored key undecryptable (secret rotated?)' });
      return;
    }
    const [quota, buckets] = await Promise.all([
      fetchQuota(apiKey, key.subaccount_id, key.account_type),
      fetchUsageBuckets(apiKey, key.subaccount_id, key.account_type).catch(() => [] as number[]),
    ]);
    await updateKeyQuota(key.id, quota, quota.proxyAmount);
    res.json({
      bandwidthUsed: quota.bandwidthUsed,
      bandwidthLimit: quota.bandwidthLimit,
      expiresAtMs: quota.expiresAtMs,
      isTrial: quota.isTrial,
      proxyAmount: quota.proxyAmount,
      buckets,
    });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
