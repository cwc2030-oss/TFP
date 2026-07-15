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
 * Current engine: v6.1-flowing-form. Phase 5 ("Wake Up the Land") Step 1 adds
 *   FLOWING FORM on top of the honest v6.0 geometry: saddle crossings are curved
 *   into a TANGENTIAL ridge merge (they run parallel to the ridge as they pass
 *   through the real saddle, then peel into each flank) so ridge → saddle → ridge
 *   reads as one continuous flowing path with no 90° T-bone. This is a VISUAL
 *   reshape only — it runs in the post-convergence polish stage, is anchored on
 *   the same three real crossing points (flankA, saddle, flankB), and interpolates
 *   strictly between them (Chaikin convex-envelope principle), so no line leaves
 *   the real ridges/saddles. Convergence scoring and the honest v5.2 relief gate
 *   are untouched (still computed on the raw traced geometry; flat ground still
 *   yields no flow). Step 2 (corridor continuity beyond the ring) is a
 *   rendering-only change and does not affect cached output. Bumped from
 *   v6.0-tier1-flow so already-cached parcels miss and lazily recompute the
 *   curved (tangential) crossing geometry.
 *
 * Prior engine: v6.0-tier1-flow. Tier 1 "glorious flow" (Phases 1-4) ships
 *   the honest, natural-looking deer-flow network: real ridge-traced flow lines
 *   (Phase 1-2), network-derived convergence scoring (Phase 3), and visual
 *   polish — modest downslope flank offset + Chaikin smoothing + curved saddle
 *   crossings (Phase 4). The honest v5.2 relief gate is preserved unchanged
 *   underneath: flat ground still yields no flow. Bumped from v5.2-relief-gate
 *   so already-cached parcels miss and lazily recompute under the polished
 *   Tier 1 engine (raw traced geometry drives convergence; polish is visual
 *   only and never moves flow off the real terrain).
 *
 * Prior engine: v5.2-relief-gate. v5.2 fixes the v5.1 prominence gate, which
 *   only looked at PRIMARY ridge prominence and required 50 ft — erasing flow
 *   on real moderate/rolling hunting ground that carries its relief in
 *   SECONDARY ridges (calibration 2026-07: 5 of 8 known-good moderate parcels
 *   got no flow). v5.2 gates on max(primary, secondary) prominence with a
 *   32 ft floor (calibrated clean gap: flat-ag ≤~30 ft, moderate ≥~33 ft) and
 *   falls back to secondary ridge geometry for pattern classification when no
 *   primary ridge is present. Bumped so already-cached parcels (including the
 *   stale empty-flow entries produced by v5.1 on moderate ground) miss and
 *   recompute lazily under the corrected gate.
 */
export const TERRAIN_ENGINE_VERSION = 'v6.1-flowing-form';