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
// it invalidates all cached compute and forces expensive recompute.
//
// v6.3 — Convergence-driver honesty reconciliation. The Convergence structural
// driver now derives from the real measured saddle pinch nodes (via
// computeStructuralDrivers) whenever the flow-derived convergence_zones are
// empty/sparse, taking the MAX of the two real signals. This runs FRESH on every
// render from the already-cached ridge/saddle data (saddle_nodes), so it surfaces
// on existing cached parcels WITHOUT invalidating the terrain cache. Option B
// (near-boundary convergence-zone tolerance in terrain-flow) is a no-op for
// single parcels (already clipped to the 800m hunt-context buffer) and only
// widens the territory-mode tight-clip path slightly. Net: no terrain-output
// change that warrants an expensive full recompute, so the cache key stays at
// v6.1 while the visible stamp advances to v6.3 for at-a-glance deploy confirmation.
export const BUILD_VERSION = 'v6.3-flowing-form';

// Ship date for the current build (update on each deploy).
export const BUILD_DATE = 'Jul 17';

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
// r1 (v6.3) — Convergence driver reconciled to real pinch points: saddle-pinch
//      fallback (Option A) + near-boundary convergence tolerance (Option B) so
//      the number, the narrative, and the map agree. Honest 0 only when there
//      are genuinely no convergence zones AND no saddles.
// r2 (v6.3) — reliability hardening: generateTerrainStory / computeStructuralDrivers
//      can no longer throw (guarded convergence_zones / metadata / opportunity_zones /
//      flow_primary/secondary / bbox reads); a throw now logs full message+stack and
//      degrades to an honest empty story instead of blanking the intel view. The late
//      ridge-data re-generation effect is wrapped so a throw can't crash unhandled.
// r3 (v6.3) — shared-backbone verdict + network-side per-line prominence floor:
//      flow AND story consult ONE assessBackbone determination (stamped in
//      metadata.backbone), and the network-count side now counts only lines that
//      each clear NETWORK_LINE_MIN_FT (40ft) rather than a raw traced-line count,
//      so flat-ag artifact spurs go honest-empty instead of drawing a lattice.
// r4 (v6.3) — read-only ScopeProbe/RidgeTrace calibration instrumentation: the
//      server-side ScopeProbe log line and terrain_debug now expose maxProm,
//      strongLineCount (prominence-qualified >=40ft), the per-line prominence
//      list, and the backbone verdict on every move, so per-line prominences are
//      visible from server logs without the browser console. Purely additive —
//      no gate/threshold/terrain-output change, terrain cache untouched.
// r5 (v6.3) — read-only length + coherence + flank-relief calibration instrumentation:
//      terrain_debug and the ScopeProbe log now also expose per-line lengthMeters,
//      coherence (avgRidgeScore), and flank-relief (median bilateral DEM drop sampled
//      perpendicular to each spine at +/-125m over up to 9 stations, from ridge
//      service v1.3.0). Investigates whether length/coherence/flank can separate
//      genuine single spines from flat-ag artifacts where prominence alone could not.
//      Purely additive diagnostics — no gate/threshold/terrain-output change, cache untouched.
// r6 (v6.3) — single-parcel geom-fallback on the parcel cache: point-in-polygon
//      (ray-casting) read fallback (getCachedParcelByPoint) added to /api/parcels
//      and /api/parcels/lookup so a repeat click ANYWHERE inside an already-cached
//      parcel hits [CACHE HIT · geom] even when the click point rounds to a different
//      lat/lng key than the stored centroid. Fixes the read=click/write=centroid key
//      mismatch that pinned the single-parcel hit rate near 7%. Purely a parcel-cache
//      READ path — no terrain/flow change, r5 flank instrumentation and terrain cache
//      fully preserved. Neighbor/adjacent re-key parked as a separate follow-up.
export const BUILD_REV = 'r6';

// e.g. "build v6.3-flowing-form r1 · Jul 15"
export const BUILD_STAMP = `build ${BUILD_VERSION} ${BUILD_REV} · ${BUILD_DATE}`;
