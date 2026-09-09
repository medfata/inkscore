import { queryOne } from '@/lib/db';

export interface SignupBonusSetting {
  points: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

const SIGNUP_BONUS_KEY = 'signup_bonus_points';

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
