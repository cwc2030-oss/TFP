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
import { TERRAIN_ENGINE_VERSION } from './terrain-engine-version';

// Ship date for the current build (update on each deploy).
export const BUILD_DATE = 'Jul 14';

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

// e.g. "build v5.0-scope r2 · Jul 13"
export const BUILD_STAMP = `build ${TERRAIN_ENGINE_VERSION} ${BUILD_REV} · ${BUILD_DATE}`;
