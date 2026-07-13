/**
 * Piece 6a — Terrain Brain free-read meter helpers.
 *
 * A "read" = the first full Terrain Brain flow analysis of a distinct
 * parcel/scope in a season. Free accounts get READS_PER_SEASON reads; after
 * that the flow locks (baseline map stays free). Revisiting an already-read
 * parcel never consumes a new read (enforced by the ParcelRead unique key).
 *
 * The Season Pass is a real $19 one-time seasonal purchase (Piece 6b): the
 * Stripe webhook stamps User.seasonPassSeason + seasonPassExpiry, and a pass
 * grants unlimited reads + save while it is the current season and unexpired.
 * Pro / Pro Max / admin are always treated as unlocked here so paying
 * subscribers are never metered. User.readsUnlocked remains a legacy/admin
 * override kept from 6a.
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
 * The moment a Season Pass bought for `season` lapses. Whitetail seasons run
 * roughly July of the opening year through the following June, so a pass is
 * valid until July 1 (UTC) of the year AFTER the season opens. 6c can use this
 * to drive renewal prompts.
 */
export function getSeasonExpiry(season: string): Date {
  const year = parseInt(season, 10);
  const openYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
  return new Date(Date.UTC(openYear + 1, 6, 1, 0, 0, 0)); // July 1 of openYear+1
}

/**
 * Whether a user is "unlocked" (unlimited reads + save). True for any
 * paying/admin tier, the legacy readsUnlocked override, OR an active Season
 * Pass (bought for the current season and not yet expired).
 */
export function isReadsUnlocked(user: {
  readsUnlocked?: boolean | null;
  subscriptionStatus?: string | null;
  role?: string | null;
  seasonPassSeason?: string | null;
  seasonPassExpiry?: Date | string | null;
} | null | undefined, now: Date = new Date()): boolean {
  if (!user) return false;
  const sub = (user.subscriptionStatus || '').toLowerCase();
  if (sub === 'pro' || sub === 'promax') return true;
  if ((user.role || '').toLowerCase() === 'admin') return true;
  if (user.readsUnlocked) return true; // legacy/admin override from 6a
  // Season Pass — valid only for the CURRENT season and while unexpired.
  if (user.seasonPassSeason && user.seasonPassSeason === getCurrentSeason(now)) {
    if (!user.seasonPassExpiry || new Date(user.seasonPassExpiry) > now) return true;
  }
  return false;
}
