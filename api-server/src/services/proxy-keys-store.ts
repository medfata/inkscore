// Proxy key + pool-IP store.
//
// - API keys are AES-256-GCM encrypted at rest (secret from PROXY_KEYS_SECRET,
//   else ADMIN_API_SECRET). Without either, a per-boot random key is used and
//   a loud warning is logged (stored keys won't survive a restart — fail-safe,
//   never fail-open into a hardcoded secret).
// - Pool IPs are cached per subaccount (same trust posture as today's
//   plaintext list file on the box disk).
// - Full secrets are only ever decrypted server-side; listKeys() returns a
//   masked fingerprint for admin display.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { query, queryOne } from '../db';

let tablesReady: Promise<void> | null = null;

export function ensureTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS proxy_api_keys (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        api_key_enc TEXT NOT NULL,
        subaccount_id TEXT NOT NULL,
        account_type TEXT NOT NULL DEFAULT 'datacenter_shared',
        status TEXT NOT NULL DEFAULT 'active',
        deprecated_reason TEXT NOT NULL DEFAULT '',
        quota_limit BIGINT NOT NULL DEFAULT 0,
        quota_used BIGINT NOT NULL DEFAULT 0,
        quota_checked_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        proxy_count INTEGER NOT NULL DEFAULT 0,
        last_sync_at TIMESTAMPTZ,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE UNIQUE INDEX IF NOT EXISTS proxy_api_keys_subaccount_uidx
        ON proxy_api_keys (subaccount_id)`);
      await query(`CREATE TABLE IF NOT EXISTS proxy_pool_ips (
        subaccount_id TEXT NOT NULL,
        proxy_key TEXT NOT NULL,
        proxy_url TEXT NOT NULL,
        online BOOLEAN NOT NULL DEFAULT TRUE,
        admin_disabled BOOLEAN NOT NULL DEFAULT FALSE,
        auto_disabled BOOLEAN NOT NULL DEFAULT FALSE,
        disable_reason TEXT NOT NULL DEFAULT '',
        consec_fails INTEGER NOT NULL DEFAULT 0,
        requests BIGINT NOT NULL DEFAULT 0,
        ok_count BIGINT NOT NULL DEFAULT 0,
        rate_limited BIGINT NOT NULL DEFAULT 0,
        net_errors BIGINT NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        last_used_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (subaccount_id, proxy_key)
      )`);
      await query(`CREATE INDEX IF NOT EXISTS proxy_pool_ips_subaccount_idx
        ON proxy_pool_ips (subaccount_id)`);
    })().catch((err) => {
      tablesReady = null;
      throw err;
    });
  }
  return tablesReady;
}

// ---- encryption ------------------------------------------------------------

let encKey: Buffer | null = null;
let encWarned = false;

function getEncKey(): Buffer {
  if (!encKey) {
    const secret = process.env.PROXY_KEYS_SECRET || process.env.ADMIN_API_SECRET || '';
    if (secret) {
      encKey = createHash('sha256').update(secret, 'utf8').digest();
    } else {
      encKey = randomBytes(32);
      if (!encWarned) {
        encWarned = true;
        console.warn('[ProxyKeys] PROXY_KEYS_SECRET/ADMIN_API_SECRET unset — API keys encrypted with a per-boot key and will NOT survive restarts. Set PROXY_KEYS_SECRET in production.');
      }
    }
  }
  return encKey;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getEncKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

// ---- key CRUD ---------------------------------------------------------------

export interface ProxyKeyRow {
  id: string;
  label: string;
  api_key_masked: string;
  subaccount_id: string;
  account_type: string;
  status: string;
  deprecated_reason: string;
  quota_limit: string;
  quota_used: string;
  quota_checked_at: string | null;
  expires_at: string | null;
  proxy_count: number;
  last_sync_at: string | null;
  last_error: string;
  created_at: string;
}

const KEY_SELECT = `id, label, subaccount_id, account_type, status, deprecated_reason,
  quota_limit, quota_used, quota_checked_at, expires_at, proxy_count,
  last_sync_at, last_error, created_at`;

export async function addKey(label: string, apiKey: string, subaccountId: string, accountType: string): Promise<string> {
  await ensureTables();
  const id = randomUUID();
  await query(
    `INSERT INTO proxy_api_keys (id, label, api_key_enc, subaccount_id, account_type, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', now())
     ON CONFLICT (subaccount_id) DO UPDATE SET
       label = $2, api_key_enc = $3, account_type = $5,
       status = 'active', deprecated_reason = '', last_error = '', updated_at = now()`,
    [id, label, encryptSecret(apiKey), subaccountId, accountType]
  );
  const row = await queryOne<{ id: string }>(
    'SELECT id FROM proxy_api_keys WHERE subaccount_id = $1', [subaccountId]
  );
  return row ? row.id : id;
}

export async function listKeys(): Promise<ProxyKeyRow[]> {
  await ensureTables();
  const rows = await query<ProxyKeyRow & { api_key_enc: string }>(
    `SELECT ${KEY_SELECT}, api_key_enc FROM proxy_api_keys ORDER BY created_at ASC`
  );
  // Decrypt server-side ONLY to derive the masked fingerprint; the full
  // secret never leaves this function.
  return rows.map((r) => {
    let masked = '****';
    try {
      masked = maskApiKey(decryptSecret(r.api_key_enc));
    } catch {
      masked = '**** (undecryptable)';
    }
    const { api_key_enc: _drop, ...rest } = r;
    void _drop;
    return { ...rest, api_key_masked: masked };
  });
}

/** Rows WITH ciphertext for server-side use (secret handling). */
export async function listKeysWithSecrets(): Promise<Array<ProxyKeyRow & { api_key_enc: string }>> {
  await ensureTables();
  return query<ProxyKeyRow & { api_key_enc: string }>(
    `SELECT ${KEY_SELECT}, api_key_enc FROM proxy_api_keys ORDER BY created_at ASC`
  );
}

export async function getKeySecret(id: string): Promise<string | null> {
  await ensureTables();
  const row = await queryOne<{ api_key_enc: string }>(
    'SELECT api_key_enc FROM proxy_api_keys WHERE id = $1', [id]
  );
  if (!row) return null;
  try {
    return decryptSecret(row.api_key_enc);
  } catch {
    return null;
  }
}

export async function deleteKey(id: string): Promise<{ subaccountId: string | null }> {
  await ensureTables();
  const row = await queryOne<{ subaccount_id: string }>(
    'SELECT subaccount_id FROM proxy_api_keys WHERE id = $1', [id]
  );
  await query('DELETE FROM proxy_pool_ips WHERE subaccount_id = (SELECT subaccount_id FROM proxy_api_keys WHERE id = $1)', [id]);
  await query('DELETE FROM proxy_api_keys WHERE id = $1', [id]);
  return { subaccountId: row ? row.subaccount_id : null };
}

export async function setKeyDeprecated(id: string, reason: string): Promise<void> {
  await ensureTables();
  await query(
    `UPDATE proxy_api_keys SET status = 'deprecated', deprecated_reason = $2, updated_at = now() WHERE id = $1`,
    [id, reason]
  );
}

export async function setKeyActive(id: string): Promise<void> {
  await ensureTables();
  await query(
    `UPDATE proxy_api_keys SET status = 'active', deprecated_reason = '', last_error = '', updated_at = now() WHERE id = $1`,
    [id]
  );
}

export async function updateKeyQuota(
  id: string,
  quota: { proxyAmount: number; bandwidthLimit: number; bandwidthUsed: number; expiresAtMs: number | null },
  proxyCount: number,
  lastError = ''
): Promise<void> {
  await ensureTables();
  await query(
    `UPDATE proxy_api_keys SET quota_limit = $2, quota_used = $3, quota_checked_at = now(),
      expires_at = $4, proxy_count = $5, last_sync_at = now(), last_error = $6, updated_at = now()
     WHERE id = $1`,
    [
      id,
      String(Math.floor(quota.bandwidthLimit)),
      String(Math.floor(quota.bandwidthUsed)),
      quota.expiresAtMs !== null ? new Date(quota.expiresAtMs).toISOString() : null,
      proxyCount,
      lastError,
    ]
  );
}

export async function setKeyError(id: string, lastError: string): Promise<void> {
  await ensureTables();
  await query('UPDATE proxy_api_keys SET last_error = $2, updated_at = now() WHERE id = $1', [id, lastError]);
}

// ---- pool IP cache -----------------------------------------------------------

export interface PoolIpRow {
  subaccount_id: string;
  proxy_key: string;
  proxy_url: string;
  online: boolean;
  admin_disabled: boolean;
  auto_disabled: boolean;
  disable_reason: string;
  consec_fails: number;
  requests: string;
  ok_count: string;
  rate_limited: string;
  net_errors: string;
  last_error: string;
  last_used_at: string | null;
}

/** host:port identity used for union-dedupe across keys. */
export function proxyIdentity(proxyUrl: string): string {
  const m = proxyUrl.match(/@([^@\/]+)$/);
  const hostport = (m ? m[1] : proxyUrl.replace(/^https?:\/\//, '')).toLowerCase();
  return hostport;
}

/**
 * Sync a subaccount's cached IPs to a freshly downloaded list: upsert present
 * (online=true), mark absent as provider-offline (online=false, kept for
 * history). Returns counts.
 */
export async function syncPoolIps(subaccountId: string, urls: string[]): Promise<{ total: number; online: number }> {
  await ensureTables();
  const seen = new Set<string>();
  for (const url of urls) {
    const key = proxyIdentity(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await query(
      `INSERT INTO proxy_pool_ips (subaccount_id, proxy_key, proxy_url, online, updated_at)
       VALUES ($1, $2, $3, TRUE, now())
       ON CONFLICT (subaccount_id, proxy_key) DO UPDATE SET
         proxy_url = $3, online = TRUE, updated_at = now()`,
      [subaccountId, key, url]
    );
  }
  await query(
    `UPDATE proxy_pool_ips SET online = FALSE, updated_at = now()
     WHERE subaccount_id = $1 AND NOT (proxy_key = ANY($2))`,
    [subaccountId, [...seen]]
  );
  return { total: seen.size, online: seen.size };
}

export async function getActivePoolIps(): Promise<PoolIpRow[]> {
  await ensureTables();
  return query<PoolIpRow>(
    `SELECT i.subaccount_id, i.proxy_key, i.proxy_url, i.online, i.admin_disabled,
       i.auto_disabled, i.disable_reason, i.consec_fails, i.requests, i.ok_count,
       i.rate_limited, i.net_errors, i.last_error, i.last_used_at
     FROM proxy_pool_ips i
     JOIN proxy_api_keys k ON k.subaccount_id = i.subaccount_id
     WHERE k.status = 'active' AND i.online AND NOT i.admin_disabled AND NOT i.auto_disabled
     ORDER BY i.subaccount_id, i.proxy_key`
  );
}

export async function getAllPoolIps(): Promise<PoolIpRow[]> {
  await ensureTables();
  return query<PoolIpRow>(
    `SELECT subaccount_id, proxy_key, proxy_url, online, admin_disabled, auto_disabled,
       disable_reason, consec_fails, requests, ok_count, rate_limited, net_errors,
       last_error, last_used_at
     FROM proxy_pool_ips ORDER BY subaccount_id, proxy_key`
  );
}

export async function setIpAdminDisabled(subaccountId: string, proxyKey: string, disabled: boolean): Promise<void> {
  await ensureTables();
  await query(
    `UPDATE proxy_pool_ips SET admin_disabled = $3, auto_disabled = CASE WHEN $3 THEN FALSE ELSE auto_disabled END,
       disable_reason = CASE WHEN $3 THEN 'disabled by admin' ELSE '' END, updated_at = now()
     WHERE subaccount_id = $1 AND proxy_key = $2`,
    [subaccountId, proxyKey, disabled]
  );
}

export async function recordIpAutoDisabled(subaccountId: string, proxyKey: string, reason: string): Promise<void> {
  await ensureTables();
  await query(
    `UPDATE proxy_pool_ips SET auto_disabled = TRUE, disable_reason = $3, updated_at = now()
     WHERE subaccount_id = $1 AND proxy_key = $2`,
    [subaccountId, proxyKey, reason]
  );
}

export async function recordIpAutoRecovered(subaccountId: string, proxyKey: string): Promise<void> {
  await ensureTables();
  await query(
    `UPDATE proxy_pool_ips SET auto_disabled = FALSE, consec_fails = 0, disable_reason = '', last_error = '', updated_at = now()
     WHERE subaccount_id = $1 AND proxy_key = $2`,
    [subaccountId, proxyKey]
  );
}

export async function bumpIpStats(
  subaccountId: string,
  proxyKey: string,
  field: 'requests' | 'ok_count' | 'rate_limited' | 'net_errors',
  consecFails: number | null,
  lastError: string | null
): Promise<void> {
  await ensureTables();
  const col = field === 'requests' ? 'requests' : field === 'ok_count' ? 'ok_count' : field === 'rate_limited' ? 'rate_limited' : 'net_errors';
  const sets = [`${col} = ${col} + 1`, 'last_used_at = now()'];
  const params: unknown[] = [subaccountId, proxyKey];
  if (consecFails !== null) {
    params.push(consecFails);
    sets.push(`consec_fails = $${params.length}`);
  }
  if (lastError !== null) {
    params.push(lastError);
    sets.push(`last_error = $${params.length}`);
  }
  sets.push('updated_at = now()');
  await query(
    `UPDATE proxy_pool_ips SET ${sets.join(', ')} WHERE subaccount_id = $1 AND proxy_key = $2`,
    params
  );
}

/** Bulk stats flush (called ~1/min by the agent, never on the request path). */
export async function addIpStats(
  subaccountId: string,
  proxyKey: string,
  deltas: { requests: number; ok: number; rateLimited: number; netErrors: number },
  consecFails: number,
  lastError: string | null
): Promise<void> {
  await ensureTables();
  const params: unknown[] = [subaccountId, proxyKey, deltas.requests, deltas.ok, deltas.rateLimited, deltas.netErrors, consecFails];
  let sql = `UPDATE proxy_pool_ips SET requests = requests + $3, ok_count = ok_count + $4,
    rate_limited = rate_limited + $5, net_errors = net_errors + $6, consec_fails = $7,
    last_used_at = now(), updated_at = now() WHERE subaccount_id = $1 AND proxy_key = $2`;
  if (lastError !== null) {
    params.push(lastError);
    sql = `UPDATE proxy_pool_ips SET requests = requests + $3, ok_count = ok_count + $4,
    rate_limited = rate_limited + $5, net_errors = net_errors + $6, consec_fails = $7,
    last_error = $8, last_used_at = now(), updated_at = now() WHERE subaccount_id = $1 AND proxy_key = $2`;
  }
  await query(sql, params);
}
