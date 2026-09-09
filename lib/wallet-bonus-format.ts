/**
 * Client-safe helpers for the per-wallet bonus editor on /admin/points.
 * Dependency-free so it can be imported by client components (the
 * server-side validation in lib/services/app-settings-service.ts re-checks
 * everything on save — never trust the client).
 */

export const WALLET_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Same ceiling as the server (@see MAX_WALLET_BONUS_POINTS). */
export const MAX_WALLET_BONUS_POINTS = 1_000_000;

export interface ParsedBonus {
  address: string;
  points: string;
}

/**
 * Parse pasted text into { address, points } entries. Accepts one entry per
 * line; within a line the address and points may be separated by a comma,
 * slash, or any whitespace ("0xabc…, 500" / "0xabc… 500" / "0xabc…/500").
 * An address alone yields an entry with empty points. Lines without a valid
 * address are skipped.
 */
export function parsePastedBonuses(text: string): ParsedBonus[] {
  const entries: ParsedBonus[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line
      .split(/[\s,;/|]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) continue;
    const address = tokens.find((t) => WALLET_ADDRESS_RE.test(t));
    if (!address) continue;
    const points = tokens.find((t) => t !== address && /^\d+$/.test(t)) ?? '';
    entries.push({ address, points });
  }
  return entries;
}
