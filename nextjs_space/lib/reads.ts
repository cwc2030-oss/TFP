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

/* ──────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH for season boundaries (Piece 6c).
 *
 * A whitetail "season" opens on July 1 (UTC) of its fall year and runs until
 * the following July 1. Everything that depends on when a season starts/ends —
 * the current-season bucket (which drives free-read refresh at rollover),
 * Season Pass expiry, and the read counter — derives from these two constants
 * and getSeasonStart(). They are defined in exactly one place so reads, pass
 * expiry, and refresh can never drift apart.
 * ────────────────────────────────────────────────────────────────────────── */

/** Month a season opens, 0-based (6 = July). */
export const SEASON_OPEN_MONTH = 6;
/** Day of SEASON_OPEN_MONTH a season opens (UTC). */
export const SEASON_OPEN_DAY = 1;

/** The exact UTC instant the season that opens in `openYear` begins. */
export function getSeasonStart(openYear: number): Date {
  return new Date(Date.UTC(openYear, SEASON_OPEN_MONTH, SEASON_OPEN_DAY, 0, 0, 0));
}

/**
 * Current hunting-season bucket as a stable string, e.g. "2026".
 *
 * Whitetail seasons straddle the new year (early archery in the fall through
 * late season in Jan/Feb), so we bucket by the year the fall season OPENS. We
 * derive the boundary from getSeasonStart(): if `now` is before this calendar
 * year's season start, we still belong to the season that opened last fall.
 * Deterministic and timezone-tolerant enough for a read counter, and it shares
 * the exact same boundary definition as getSeasonExpiry().
 */
export function getCurrentSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const seasonYear = now < getSeasonStart(year) ? year - 1 : year;
  return String(seasonYear);
}

/**
 * The moment a Season Pass bought for `season` lapses — i.e. when the NEXT
 * season opens. Derived from getSeasonStart() so it always agrees with
 * getCurrentSeason(): a pass for season "2026" is valid until July 1 (UTC)
 * 2027, the instant getCurrentSeason() starts returning "2027". 6c uses this
 * to revert a lapsed pass to free.
 */
export function getSeasonExpiry(season: string): Date {
  const year = parseInt(season, 10);
  const openYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
  return getSeasonStart(openYear + 1);
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
