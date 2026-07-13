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
export const BUILD_DATE = 'Jul 13';

// e.g. "build v5.0-scope · Jul 13"
export const BUILD_STAMP = `build ${TERRAIN_ENGINE_VERSION} · ${BUILD_DATE}`;
