// ProxyScrape Account API client (https://api.proxyscrape.com).
//
// Read-only control plane: list subaccounts, download datacenter proxy lists
// (credentials format matches our pool file: user:pass@host:port), read
// plan overview (quota + expiry) and usage buckets.
//
// Auth: 64-char API key in the `api-token` header. Keys are NEVER logged here
// (only their masked fingerprint) and callers must never forward full
// credentials to API responses or logs.

const API_BASE = 'https://api.proxyscrape.com';
const FETCH_TIMEOUT_MS = 20_000;

export interface PsSubaccount {
  id: string;
  type: string; // e.g. 'datacenter_shared'
  label: string;
}

export interface PsOverview {
  proxyAmount: number;
  bandwidthLimit: number; // bytes
  bandwidthUsed: number; // bytes
  expiresAtMs: number | null;
  isTrial: boolean;
  credentialsEnabled: boolean;
  proxyUsername: string;
}

function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

async function apiGet(apiKey: string, path: string): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: { 'api-token': apiKey, Accept: 'application/json, text/plain' },
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** List subaccounts for the key's account. Needs `subaccount:read`. */
export async function listSubaccounts(apiKey: string): Promise<PsSubaccount[]> {
  const { status, body } = await apiGet(apiKey, '/v4/account/subaccounts');
  if (status === 401 || status === 403) {
    throw new Error(`ProxyScrape rejected the key (HTTP ${status}) — check it has subaccount:read permission`);
  }
  if (status !== 200) throw new Error(`ProxyScrape subaccounts failed (HTTP ${status})`);
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('ProxyScrape returned non-JSON for subaccounts');
  }
  const list = parsed?.data?.subaccounts;
  if (!Array.isArray(list)) throw new Error('ProxyScrape subaccounts: unexpected shape');
  return list.map((s: any) => ({
    id: String(s?.AccountID || ''),
    type: String(s?.AccountType || ''),
    label: String(s?.label || s?.AccountID || ''),
  })).filter((s: PsSubaccount) => s.id.length > 0);
}

function datacenterPath(subaccountId: string, accountType: string, leaf: string): string {
  const seg = accountType === 'datacenter_dedicated' ? 'datacenter_dedicated' : 'datacenter_shared';
  return `/v4/account/${encodeURIComponent(subaccountId)}/${seg}/${leaf}`;
}

/**
 * Download the proxy list in credentials format (user:pass@host:port, one per
 * line). Uses type=displayproxies (no download-timestamp side effect) and
 * status=online (only currently reachable proxies).
 * Throws with err.code === 'SUBSCRIPTION_EXPIRED' on HTTP 401.
 */
export async function fetchProxyList(
  apiKey: string,
  subaccountId: string,
  accountType: string
): Promise<string[]> {
  const path =
    `${datacenterPath(subaccountId, accountType, 'proxy-list')}` +
    '?type=displayproxies&protocol=http&format=credentials&credential_format=2&status=online&limit=5000';
  const { status, body } = await apiGet(apiKey, path);
  if (status === 401) {
    const err = new Error('ProxyScrape subscription expired') as Error & { code?: string };
    err.code = 'SUBSCRIPTION_EXPIRED';
    throw err;
  }
  if (status === 403) {
    throw new Error('Credential download not enabled for this ProxyScrape account (HTTP 403)');
  }
  if (status === 404) throw new Error('ProxyScrape subaccount not found (HTTP 404)');
  if (status !== 200) throw new Error(`ProxyScrape proxy-list failed (HTTP ${status})`);
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('http') ? l : `http://${l}`));
}

export interface PsQuota {
  proxyAmount: number;
  bandwidthLimit: number;
  bandwidthUsed: number;
  expiresAtMs: number | null;
  isTrial: boolean;
}

/** Plan overview: quota + expiry. Throws SUBSCRIPTION_EXPIRED on HTTP 401. */
export async function fetchQuota(
  apiKey: string,
  subaccountId: string,
  accountType: string
): Promise<PsQuota> {
  const { status, body } = await apiGet(apiKey, datacenterPath(subaccountId, accountType, 'overview'));
  if (status === 401) {
    const err = new Error('ProxyScrape subscription expired') as Error & { code?: string };
    err.code = 'SUBSCRIPTION_EXPIRED';
    throw err;
  }
  if (status !== 200) throw new Error(`ProxyScrape overview failed (HTTP ${status})`);
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('ProxyScrape overview: non-JSON response');
  }
  const d = parsed?.data || {};
  const seg = d?.services?.datacenter_shared || d?.services?.datacenter_dedicated || {};
  const expSec = typeof seg?.expiration_time === 'number' ? seg.expiration_time : null;
  return {
    proxyAmount: Number(seg?.proxy_amount || 0),
    bandwidthLimit: Number(d?.bandwidth || 0),
    bandwidthUsed: Number(d?.bandwidth_used || 0),
    expiresAtMs: expSec !== null ? expSec * 1000 : null,
    isTrial: d?.is_trial === true,
  };
}

/** Raw usage buckets (bytes per bucket) for a sparkline; shape is unlabeled. */
export async function fetchUsageBuckets(
  apiKey: string,
  subaccountId: string,
  accountType: string
): Promise<number[]> {
  const { status, body } = await apiGet(apiKey, datacenterPath(subaccountId, accountType, 'usage'));
  if (status !== 200) throw new Error(`ProxyScrape usage failed (HTTP ${status})`);
  try {
    const parsed = JSON.parse(body);
    const arr = Array.isArray(parsed) ? parsed : parsed?.data;
    if (!Array.isArray(arr)) return [];
    return arr.map((v: unknown) => Number(v) || 0);
  } catch {
    return [];
  }
}

export { maskKey };
