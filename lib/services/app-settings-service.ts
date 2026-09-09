import { queryOne } from '@/lib/db';

export interface SignupBonusSetting {
  points: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

const SIGNUP_BONUS_KEY = 'signup_bonus_points';

export interface WalletBonusEntry {
  address: string;
  points: number;
}

export interface WalletBonusSetting {
  wallets: WalletBonusEntry[];
  updatedBy: string | null;
  updatedAt: string | null;
}

const WALLET_BONUS_KEY = 'wallet_bonus_points';

/** Per-wallet caps: same sanity ceiling as the global bonus, plus a list cap. */
export const MAX_WALLET_BONUS_POINTS = 1_000_000;
export const MAX_WALLET_BONUS_ENTRIES = 500;

const WALLET_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isValidWalletAddress(address: unknown): address is string {
  return typeof address === 'string' && WALLET_ADDRESS_RE.test(address.trim());
}

export function normalizeWalletAddress(address: string): string {
  return address.trim().toLowerCase();
}

function parseBonusValue(raw: { points?: number } | null | undefined): number {
  if (!raw) return 0;
  const points = Number(raw.points);
  return Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
}

/**
 * Read the admin-controlled signup bonus (points added to every wallet's
 * score on top of activity points). Missing row or malformed value = 0.
 * Throws if the app_settings table is missing (migration 029 not applied) —
 * callers decide whether that is fatal (admin API) or not (scoring engine).
 */
export async function getSignupBonus(): Promise<SignupBonusSetting> {
  const row = await queryOne<{
    value: { points?: number } | null;
    updated_by: string | null;
    updated_at: string | Date | null;
  }>(
    `SELECT value, updated_by, updated_at FROM app_settings WHERE key = $1`,
    [SIGNUP_BONUS_KEY]
  );

  if (!row) return { points: 0, updatedBy: null, updatedAt: null };

  return {
    points: parseBonusValue(row.value),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Update the signup bonus. Records which admin wallet made the change so
 * /admin/points can show "last updated by ...".
 */
export async function setSignupBonus(points: number, updatedBy: string): Promise<SignupBonusSetting> {
  const row = await queryOne<{
    value: { points: number };
    updated_by: string | null;
    updated_at: string | Date;
  }>(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING value, updated_by, updated_at`,
    [SIGNUP_BONUS_KEY, JSON.stringify({ points }), updatedBy]
  );

  return {
    points: parseBonusValue(row?.value),
    updatedBy: row?.updated_by ?? updatedBy,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Normalize + validate a raw wallet-bonus list. Shared by the admin API
 * (rejects invalid input) and defensive readers (skip invalid entries).
 * Dedupe is last-entry-wins on the lowercased address.
 */
export function normalizeWalletBonuses(
  raw: unknown
): { wallets: WalletBonusEntry[]; errors: string[] } {
  const errors: string[] = [];
  const list = Array.isArray((raw as { wallets?: unknown } | null)?.wallets)
    ? (raw as { wallets: unknown[] }).wallets
    : null;

  if (!list) return { wallets: [], errors };

  const byAddress = new Map<string, number>();
  list.forEach((entry, index) => {
    const label = `wallets[${index}]`;
    const address = (entry as WalletBonusEntry | null)?.address;
    const pointsRaw = (entry as WalletBonusEntry | null)?.points;

    if (!isValidWalletAddress(address)) {
      errors.push(`${label}: address must be 0x + 40 hex characters`);
      return;
    }
    const points = Number(pointsRaw);
    if (!Number.isFinite(points) || !Number.isInteger(points) || points < 1) {
      errors.push(`${label}: points must be a whole number of 1 or more`);
      return;
    }
    if (points > MAX_WALLET_BONUS_POINTS) {
      errors.push(
        `${label}: points cannot exceed ${MAX_WALLET_BONUS_POINTS.toLocaleString()}`
      );
      return;
    }
    byAddress.set(normalizeWalletAddress(address), points);
  });

  const wallets = [...byAddress.entries()].map(([address, points]) => ({
    address,
    points,
  }));
  return { wallets, errors };
}

/**
 * Read the per-wallet bonus list (stacked on top of the global signup bonus).
 * Missing row or malformed value = empty list.
 */
export async function getWalletBonuses(): Promise<WalletBonusSetting> {
  const row = await queryOne<{
    value: { wallets?: unknown } | null;
    updated_by: string | null;
    updated_at: string | Date | null;
  }>(
    `SELECT value, updated_by, updated_at FROM app_settings WHERE key = $1`,
    [WALLET_BONUS_KEY]
  );

  if (!row) return { wallets: [], updatedBy: null, updatedAt: null };

  return {
    wallets: normalizeWalletBonuses(row.value).wallets,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Replace the per-wallet bonus list. Callers must validate first via
 * normalizeWalletBonuses; entries are stored lowercased + sorted for stable reads.
 */
export async function setWalletBonuses(
  wallets: WalletBonusEntry[],
  updatedBy: string
): Promise<WalletBonusSetting> {
  const sorted = [...wallets].sort((a, b) => a.address.localeCompare(b.address));
  const row = await queryOne<{
    value: { wallets: WalletBonusEntry[] };
    updated_by: string | null;
    updated_at: string | Date;
  }>(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING value, updated_by, updated_at`,
    [WALLET_BONUS_KEY, JSON.stringify({ wallets: sorted }), updatedBy]
  );

  return {
    wallets: normalizeWalletBonuses(row?.value).wallets,
    updatedBy: row?.updated_by ?? updatedBy,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}
