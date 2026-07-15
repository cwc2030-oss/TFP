/**
 * Build Stamp
 * ----------
 * Small, human-readable identifier rendered always-visible in a corner of the
 * /intel page so anyone (team or customer) can instantly confirm which build
 * they are looking at — no debug flag required.
 *
 * BUILD_DATE: bump this to the ship date whenever you cut a new build.
 * The version is anchored to the terrain engine version so the stamp always
 * reflects the shipped analysis engine.
 */
// NOTE: The corner stamp's DISPLAY version is intentionally decoupled from
// TERRAIN_ENGINE_VERSION. TERRAIN_ENGINE_VERSION is a terrain-cache key — bumping
// it invalidates all cached compute and forces expensive recompute. This release
// is a ship-only reliability fix (no change to terrain output), so the cache key
// stays at v6.1 while the visible stamp advances to v6.2 for at-a-glance deploy
// confirmation.
export const BUILD_VERSION = 'v6.2-flowing-form';

// Ship date for the current build (update on each deploy).
export const BUILD_DATE = 'Jul 15';

// Build revision WITHIN the current terrain engine version. Bump this for
// ship-only fixes that DON'T change cached terrain output (so the terrain
// cache is preserved across deploys). Bump TERRAIN_ENGINE_VERSION instead
// only when the analysis output itself changes.
// r2 — scope-move stability: abort pile-up, fast scope compute, retry-on-fail.
// r3 — remove ridge-influence spine-count guard: influence now reflects real
//      measured relief (prominence/relief), independent of primary-spine count.
// r1 (v5.2) — relief gate now max(primary,secondary) prominence @ 32 ft floor
//      (restores flow on moderate ground) + scope ridge call back to 2 attempts
//      × ~27s (kills the "tap to retry" banner under cold Modal).
export const BUILD_REV = 'r1';

// e.g. "build v6.2-flowing-form r1 · Jul 15"
export const BUILD_STAMP = `build ${BUILD_VERSION} ${BUILD_REV} · ${BUILD_DATE}`;
