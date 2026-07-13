/**
 * Piece 6a — Terrain Brain free-read meter helpers.
 *
 * A "read" = the first full Terrain Brain flow analysis of a distinct
 * parcel/scope in a season. Free accounts get READS_PER_SEASON reads; after
 * that the flow locks (baseline map stays free). Revisiting an already-read
 * parcel never consumes a new read (enforced by the ParcelRead unique key).
 *
 * The Season Pass unlock is a PLACEHOLDER in 6a (User.readsUnlocked). Real
 * Stripe billing arrives in 6b. Pro / Pro Max / admin are always treated as
 * unlocked here so paying subscribers are never metered.
 */

/** Free Terrain Brain reads allowed per season for a signed-in free account. */
export const READS_PER_SEASON = 3;

/**
 * Current hunting-season bucket as a stable string, e.g. "2026".
 *
 * Whitetail seasons straddle the new year (early archery in the fall through
 * late season in Jan/Feb), so we bucket by the year the fall season OPENS:
 * July–December -> that calendar year; January–June -> the previous year.
 * Deterministic and timezone-tolerant enough for a read counter.
 */
export function getCurrentSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0 = Jan
  // Jan(0)–Jun(5) still belongs to the season that opened the previous fall.
  const seasonYear = month <= 5 ? year - 1 : year;
  return String(seasonYear);
}

/**
 * Whether a user is "unlocked" (unlimited reads + save). True for the
 * placeholder Season Pass flag OR any paying/admin tier.
 */
export function isReadsUnlocked(user: {
  readsUnlocked?: boolean | null;
  subscriptionStatus?: string | null;
  role?: string | null;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.readsUnlocked) return true;
  const sub = (user.subscriptionStatus || '').toLowerCase();
  if (sub === 'pro' || sub === 'promax') return true;
  if ((user.role || '').toLowerCase() === 'admin') return true;
  return false;
}
