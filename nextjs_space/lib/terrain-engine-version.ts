/**
 * Terrain Engine Version
 * ----------------------
 * This string is baked into every TerrainAnalysisCache entry. The terrain-cache
 * read path only returns entries whose stored engineVersion matches the CURRENT
 * value below. When you ship a terrain-engine fix (ridge/saddle/flow logic),
 * bump this string. Stale cache entries then stop matching -> they are treated
 * as misses -> fresh compute -> re-cache under the new version.
 *
 * This is what lets us keep BOTH benefits at once:
 *   - Engine fixes propagate instantly (version bump busts the cache)
 *   - Expensive static terrain compute is still cached between bumps
 *
 * Current engine: v5.0-scope (canonical scope-aware flow contract:
 *   flow_lines[] + scope{} + engine_version emitted on flow responses)
 */
export const TERRAIN_ENGINE_VERSION = 'v5.0-scope';