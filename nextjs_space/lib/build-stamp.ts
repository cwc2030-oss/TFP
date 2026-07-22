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
export const BUILD_DATE = 'Jul 22';

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
// r7 (v6.3) — gate-real / pull-fake terrain honesty pass: ONE shared 3-state
//      backbone verdict (metadata.backbone.state = confirmed | marginal | flat,
//      marginal floor FLOW_MARGINAL_SPINE_MIN_FT = 54 ft) now drives EVERY intel
//      surface. v1 non-discriminative fabrications pulled from render + copy:
//      bedding polygons, v1 funnel lines/polys, and the v1 huntability score +
//      funnel count (which were byte-identical flat -> confirmed). Ridge/saddle
//      render layers gated on state (confirmed -> full spines + saddles; marginal
//      -> single spine, no saddles; flat -> hidden). Intelligence readout, Parcel
//      Character, confidence badge, key-metrics row and the Pro Hunt Report score/
//      grade/stats all key off the shared verdict so nothing can contradict, and
//      a gentle parcel can never print a premium score/grade. Copy numbers replaced
//      with real ridge-spine + saddle-crossing counts. UI/render-only — terrain
//      cache untouched (TERRAIN_ENGINE_VERSION unchanged).
// r8 (v6.3) — neighborhood-window fix: verdict window ≡ flow window ≡ compute
//      window. The relevance filter AND the Modal DEM compute AOI both used to
//      scale with parcel size, so the same location returned different ridges
//      (and a different verdict) at different sizes — the non-monotonic 89-ac
//      flip, and tiny real parcels reading flat despite rolling ground. Now the
//      relevance window (lib/terrain-flow-v3.ts neighborhoodRelevanceBbox) and
//      the compute AOI (app/api/terrain-flow/route.ts) are both floored to the
//      A-300 hunt-zone circle (~622m) at the parcel centroid for any parcel
//      under 300 ac, so every sub-300-ac parcel at a location shares ONE stable
//      AOI -> one verdict. Audit: non-monotonic flips gone, flat-ag guards stay
//      flat, natural marginals appear. Env NEIGHBORHOOD_AOI=0 reverts. Terrain
//      cache untouched (TERRAIN_ENGINE_VERSION unchanged).
// r9 — A-300 maker's-mark wordmark added to the hunt-zone scope ring.
// r10 — LAUNCH: marketplace gate opened (TFP_MARKETPLACE_OPEN=true). The
//      coming-soon wall comes down and the marketplace/listings + hunter
//      inquiry surfaces go live to the founding 120 + public. Pre-flight
//      confirmed green before flip: r9 live on all 11 hosts (stamp reads r9),
//      $19 Season Pass Stripe checkout live ($19.00 one_time livemode price),
//      and the free-read meter (3/season) -> paywall -> Season Pass handoff
//      verified end-to-end (free user walls on the 4th read, Unlock creates a
//      real checkout.stripe.com session). Env/gate-only flip — terrain cache
//      and terrain output untouched (TERRAIN_ENGINE_VERSION unchanged).
// r11 (v6.3) — PHASE 1 report/badge honesty kill-switch: the v1
//      non-discriminating fabrications were still live on the downloadable/
//      shareable artifacts + public listing surfaces even after r7 honed the
//      /intel view. A flat-vs-confirmed generated-report test proved the
//      scorecard was byte-identical (a flat parcel printed the same CERTIFIED
//      HUNTABLE / 78 / PRIME / Grade B as a confirmed one). Phase 1 HIDES the
//      fabrications now to stop live fabrication, ahead of the Phase 2 gate-real
//      rebuild: report + share link (lib/report/build-html.ts) drop the CERTIFIED
//      HUNTABLE badge, huntability score-hero + seasonal letter grades, bedding/
//      funnel/stand-count stat boxes, per-stand score badges, the certificate
//      grade + score/intercept boxes, and the OG share title/desc score; public
//      /find-a-lease cards + listing detail + teaser + social OG image drop the
//      Terrain Certified badge, letter grade, and corr/fun/int/bedding/season
//      stat boxes. UI/render-only — terrain cache untouched.
// r12 (v6.3) — PHASE 2 gate-real / pull-fake rebuild. Report (lib/report/
//      build-html.ts) now consumes a real `backbone` verdict (state +
//      ridge-spine / saddle-crossing / convergence counts) carried in the
//      client payload from intelMetrics — the SAME source as the map render
//      gate + in-page preview, so the artifact can never contradict them.
//      "CERTIFIED HUNTABLE" quality claim is retired -> honest "TERRAIN
//      ANALYZED" analysis-run marker (report + listing cards + listing detail).
//      New Terrain Backbone block prints the real counts; flat parcels show 0s
//      + a "no confirmed backbone" note. Re-ran the flat-vs-confirmed report
//      test: the two HTMLs now DIFFER (ridge spines 0 vs 4, FLAT vs CONFIRMED
//      state label), no CERTIFIED HUNTABLE / HUNTABILITY SCORE anywhere.
//      Listing card/detail fab numbers stay hidden (no per-listing backbone
//      field yet); grade filter/sort/slug still rank on the v1 score — flagged
//      as a follow-up. UI/render-only — terrain cache untouched.
//  r13: Closed the last tendril — listing RANKING now runs on the REAL backbone
//      verdict, not the v1 score. Added per-listing backbone fields
//      (backboneState/backboneRank/ridgeSpineCount/saddleCrossings/
//      convergenceZoneCount/backboneComputedAt), backfilled all published
//      listings via the honest engine, switched browse sort/filter to
//      backboneRank (nulls last = unranked), publish path now computes+stores
//      the verdict, and the URL slug + detail badge + meta description carry the
//      real state (dropped the v1 letter grade). Terrain cache untouched.
// r14: flow↔verdict unification. (1) One window — single-parcel flow display
//      clips to the SAME A-300 neighborhood ring the backbone verdict is
//      computed on (was the tiny deed → Jackson "flow empty / verdict
//      Confirmed"). (2) One shared state — the Hunt Zone scope-move path now
//      regenerates the verdict/story from the SAME response it draws flow from
//      (was flow-only → Jefferson frozen-flat story). (3) failure ≠ flat across
//      panels — "too flat" only shows when compute succeeded AND the verdict is
//      genuinely flat; never on a failed compute, never when the verdict reads
//      Confirmed/Marginal. No detection bar changed; terrain cache untouched.
// r15: client-side flow-leak fix ("goes quiet after ~5 parcels"). Profiled a
//      roam: the four suspected counters (Mapbox layers 193, sources 57, map
//      listeners 120, DOM markers 0) + JS heap were ALL flat — no leak there.
//      Real cause: parcel-keyed fetches were never cancelled on roam. The main
//      flow effect only flipped a `cancelled` flag (discarded the RESULT but
//      left the XHR + its auto-retry running); fetchRidgeSpines/CDL had no
//      external abort; fetchTerrainAnalysis kept a 10s-delay cold-start retry
//      loop alive. Abandoned-parcel requests piled up on the shared backend →
//      contention/cold-start → "warming up"/flow-quiet (a reload fixed it by
//      tearing down the piled XHRs). Fix: real AbortController per parcel on the
//      flow/ridge/CDL effects (abort() on cleanup + signal passed through), and
//      external-signal support + retry-loop bail in fetchRidgeSpines /
//      fetchTerrainAnalysis. Verified a 22-parcel no-reload roam: peak concurrent
//      terrain requests = 1, 148 stale requests aborted, layers/sources/heap
//      flat, flow delivered crisply post-roam. No detection bar changed; terrain
//      cache untouched (TERRAIN_ENGINE_VERSION unchanged).
// r16: consolidated FLAT empty state. The three scattered "nothing here"
//      fragments that used to fire together for a genuinely-flat verdict — the
//      Deer Flow panel's "Not detected on this parcel / too flat or uniform,"
//      the Terrain Story headline "Gentle, low-relief terrain," and the four 0%
//      structural-driver bars — are replaced by ONE dignified statement
//      (components/terrain/flat-terrain-notice.tsx): "No terrain-driven
//      movement — dispersed, not funneled — hunt food/cover/sign." It states
//      what the tool sees (no terrain funneling) and stays in its lane: never
//      "unhuntable," never a verdict on the land's hunting value, because the
//      tool reads terrain, not food/cover/deer. Gated on a single genuineFlat
//      signal (compute succeeded + shared verdict flat + reliefMeasured false);
//      confirmed & marginal states are untouched. UI/render-only — no detection
//      bar changed, terrain cache untouched (TERRAIN_ENGINE_VERSION unchanged).
// r17: gate-real on the last two v1 surfaces that missed the honesty sweep —
//      the TERRITORY SHARE PAGE (app/territory/[shareId]) and the social
//      SCORECARD. Both still ran the retired v1 fabrications: a color-graded
//      terrainScore/100, a "Funnels" count, "Intercept Sites" (=stand count),
//      "Bedding Acres," a letter grade badge, and "My land scored X/100" share
//      copy — none of which read differently across flat/marginal/confirmed.
//      All pulled. Both surfaces now show the SAME 3-state backbone verdict the
//      map + Hunt Report use (confirmed / marginal / flat) with the real
//      ridge-spine, saddle-crossing and convergence counts (zeroed on unearned
//      states). Persisted: SavedProperty gained backboneState/backboneRank/
//      ridgeSpineCount/saddleCrossings/convergenceZoneCount/backboneComputedAt,
//      written on Save + Share (one backboneSnapshot built from intelMetrics),
//      copied on Claim, returned by the share API; all 12 live shared rows were
//      backfilled through the same terrain-flow path (10 confirmed, 2 flat —
//      incl. a "Sample Property" that used to fake a 90/100). Verified flat vs
//      confirmed read differently end-to-end via the share API. Also relabeled
//      the onX button "Open Territory in onX Hunt" -> "View location in onX" and
//      demoted it from the bright-orange PRIMARY to a quiet secondary link
//      below Claim (it leaves TFP carrying none of our terrain read). Render +
//      persistence only; no detection bar changed, terrain cache untouched
//      (TERRAIN_ENGINE_VERSION unchanged).
// r18: BRICK 1 of the vetted-introduction marketplace — Hunter Trust Profile
//      + Owner Browse-and-Choose. GATED behind TFP_HUNTER_PROFILES_OPEN
//      (closed by default; separate switch from the already-open marketplace
//      gate). New models HunterProfile + HunterShortlist (+ Footprint /
//      CredentialLevel enums), all additive (safe db push, no data loss).
//      CENTRAL GUARDRAIL — no overclaiming: CredentialLevel has NO 'VERIFIED'
//      member, so nothing can render "verified"/"screened"/"background-checked";
//      creds render "Self-attested" or "Not provided" only (the doc-on-file
//      uploader is NOT built in Brick 1, so DOCUMENT_ON_FILE is unreachable &
//      never surfaced). Firearm item is ALWAYS "Self-attested — no third-party
//      background check". Reputation is a shell — "New — unproven", no numeric
//      score. Affirmative-claim hard gate: a profile appears in browse ONLY
//      when visible && firearmAttestation. Owner browse restricted to
//      landowners (own >=1 Listing, or admin). Reference PII hidden (count
//      only). Deferred (not built): review engine, insurance integration,
//      payments/escrow, matching algorithm, trophy room. No terrain/detection
//      change; terrain cache untouched (TERRAIN_ENGINE_VERSION unchanged).
// r19 (ENGINE BUMP v6.1 -> v6.4-cache-integrity): stale-cache-poison fix.
//      Root cause of the Nussbaum's-parcel flip (flat vs confirmed on a slight
//      ring move): the single-parcel terrain cache WRITE path was missing the
//      synthetic/empty-flow guard the scope path already had, so a transiently
//      degraded whole-parcel compute (real-DEM flagged but empty/marginal) got
//      persisted under the CURRENT engine version with a 7-day TTL and served
//      forever as a valid hit. Confirmed via DB + forced-fresh recompute:
//      cached flow_p=0 / marginal vs fresh flow_p=7 / confirmed (maxProm 91 ft),
//      identical 3/3 runs (NOT a compute race). Two-part fix: (1) integrity
//      guard on the single-parcel write (never persist synthetic or zero-flow),
//      (2) TERRAIN_ENGINE_VERSION bumped v6.1-flowing-form -> v6.4-cache-integrity
//      to invalidate every poisoned v6.1 entry so all cells lazily recompute
//      fresh. UNLIKE prior r-series entries, this one DOES bump the terrain
//      engine key on purpose (one-time poison flush) -> expect a one-time
//      recompute wave across cached parcels after deploy.
// r20 (single-parcel instant-"tap to retry" fix, output-neutral, NO engine bump):
//      Clark isolated the slowness/instant-retry to the Pick Parcel (single-
//      parcel) path while the scope path worked. Root cause is NOT the r19
//      write-guard (git diff proves the only r19 change to intel/page.tsx is a
//      fire-and-forget cache-WRITE guard that can't throw or set the retry
//      banner) and NOT the engine bump (single-parcel main path never reads the
//      terrain cache). Real mechanism: fetchWithRetry only retried on TIMEOUTS,
//      so a COLD Modal container that fast-errors on the first hit returned null
//      after ONE attempt -> main path usedRealDEM=false -> instant 502 -> the
//      hunter saw an immediate "tap to retry" that healed on the client auto-
//      retry once warm. Fix: retry on ANY non-abort upstream error (with a brief
//      cold-start backoff) so a single cold hit self-heals inside the same
//      request. Applies to both corridor + ridge; terrain OUTPUT unchanged, so
//      the terrain engine key is deliberately NOT bumped (cache preserved).
// r21 (Intel panel redesign + honesty fix, UI-only, NO engine bump):
//      Clark's redesign — two hero panels front-and-center: Terrain Story (all
//      four Bench/Saddle/Ridge/Convergence % bars, now expanded/non-compact) and
//      the Terrain Flow info panel. Cut the clutter: the admin "Travel Corridor"
//      DEBUG block, the standalone Saddles toggle block, the "Corridors &
//      Alignment" section (Primary Corridors + Draws), and the redundant
//      movement-summary run-count rows (Green/Blue/Black/Pinch) + intensity key.
//      Re-Align Terrain button relabeled "Re-Load" and rewired to trigger a
//      GENUINE fresh terrain read (bumps mainRetryNonce) + recenter — the
//      everyday read-again action, distinct from the failure-only "Retry" state.
//      HONESTY FIX: the "see the flow lines on the map / drag the scope over the
//      ridge" nudge is now gated on flow lines ACTUALLY drawn (flowTierCounts
//      .total > 0), never on structure-exists or verdict alone; in the zero-
//      features branch it is unreachable. Marginal-with-no-flow now shows ONLY
//      "Single spine detected — unconfirmed. Scout on foot before committing."
//      with zero flow-line reference. UI-only — terrain engine key NOT bumped.
// r22 ("The Loose Window" — presentation-layer rebuild of /intel, NO engine bump):
//      Clark's redesign — collapse the multi-panel intel view into ONE minimal
//      floating translucent card (LooseWindow) whose centerpiece is the four
//      MEASURED structural drivers (Bench/Saddle/Ridge/Convergence, all
//      estimated:false). Card carries: (A) a situated message that NAMES the
//      leading driver in teal + a plain "so what", swapping with real terrain;
//      flat/no-backbone gets the food-and-cover line, never "unhuntable", and
//      never a flow-line promise (still gated on flowTierCounts.total > 0);
//      (B) four big numbers with % (teal hero / ivory / muted-low color logic,
//      flat = low+muted, never blank); (C) tap-to-teach one-liners (one tap deep,
//      taps swallowed so the map never drags). Gated behind LOOSE_WINDOW=true:
//      left rail (Hunt Goal/Conditions/Intelligence/Refine) + right rail
//      (Terrain Flow + Terrain Story) hidden via opacity/pointer-events (all
//      state/effects still wired). Standalone Pick-Parcel entry hidden (map-
//      click read retires; address/My Parcels/Re-Load still read terrain);
//      Territory KEPT (Pro revenue path). Clean Map + Re-center hidden. New quiet
//      top-right conditions strip: moon (auto, illum %) + season phase (calendar-
//      derived, honest — no parked value) display-only; wind TAPPABLE, starts
//      UNSET (no fabricated "NW" on a Verified screen). ONE amber Re-Load =
//      genuine fresh read + recenter. UI-only — terrain engine key NOT bumped.
// r23 ("Roam-and-Read" — the A-300 reads what it's over, NO engine bump):
//      The terrain read follows the ring instead of being pinned to the loaded
//      parcel. The A-300 ring locks to the map's viewport center; when the user
//      roams the map and it SETTLES (debounced ~450ms), the ground under the
//      ring center is read and EVERYTHING recomputes for that center (four
//      numbers + situated message + flow lines) via the existing Piece-4 scope
//      pipeline — abort-in-flight/cancel prior read, cache-first (snapped grid),
//      story regen from the SAME response, failure ≠ flat. A quarter-inch nudge
//      trips a fresh read (roaming is the primary interaction now). Fired only
//      on USER moves (movestart originalEvent discriminator) — programmatic
//      flyTo/fitBounds never trip a read. URL lat/lng updates to the ring center
//      (shareable). Numbers now ROLL IN (odometer, eased decelerate ~520ms,
//      landing exactly on the true measured value — never randomized) with a
//      soft one-beat teal pulse on the leading driver as the read lands.
//      Re-Load button REMOVED (roaming replaces it; genuine failures show an
//      inline "Re-read terrain" retry INSIDE the Loose Window, wired to the
//      scope retry). Faint yellow dashed parcel border HIDDEN while roaming.
//      Honesty invariants preserved. Gated behind ROAM_AND_READ=true. UI/wiring
//      only — terrain engine key NOT bumped.
//
// r24 — RESTORE A-300 RING DRAG (r23 regression fix). r23 wired drag to the map
//      for roam-and-read and in doing so disabled the ring's own grab handler —
//      the ring could no longer be dragged, only the map panned under a
//      center-locked ring. r24 restores the grab so BOTH gestures coexist (as
//      before r23): grab the RING → the ring moves and, on release, commits its
//      snapped center (URL updated) tripping the same Piece-4 read; grab EMPTY
//      MAP → the map pans and the roam auto-trip reads on settle. No conflict —
//      the ring drag disables dragPan, so the map never moves during it and the
//      roam move/moveend handlers don't fire (no double-commit). The read always
//      follows the RING's footprint, not screen-center. All r23 wins intact
//      (roll-in, teal lock, no Re-Load button, no dashed border, inline retry,
//      cancel-in-flight). Interaction/handler restore only — no engine bump, no
//      cache flush.
//
// r25 — DECOUPLE SCROLL-WHEEL FROM THE A-300 RING. Bug: scroll/pinch was walking
//      the ring diagonally instead of zooming the map. Cause = the roam auto-trip
//      effect re-pinned the ring to the viewport center on EVERY user 'move'
//      (incl. wheel-zoom, which recenters toward the cursor) and fired a wasted
//      read on settle. Fix: track gesture-start zoom and split PAN from ZOOM —
//      onMove re-centers the ring ONLY on a pure pan; a zoom/pinch leaves the ring
//      glued to its committed geographic center (turf.circle in lat/lng, so mapbox
//      reprojects + scales it in place → no drift). onMoveEnd skips the read
//      entirely on any zoom (same dirt under the ring → no compute, no phantom
//      roll-in) and re-glues the ring to its committed center. The ring-drag
//      handler already listened to mouse down/move/up only (never wheel), so wheel
//      reaches the map's native scroll-zoom. All r23/r24 wins intact. Input-handler
//      + ring-anchor only — no engine bump, no cache flush.
//
// r26 — ZOOM KILL-SHOT: retire the scroll wheel + break the zoom->read feedback
//      loop + restore return-to-parcel. r25 anchored the ring to ground coords but
//      the ring still oscillated on repeated wheel-zoom over an OFF-CENTER ring:
//      zoom fires a generic 'move' the roam handler couldn't distinguish from a
//      pan, so it re-pinned the ring + read, which nudged the camera -> another
//      move -> re-pin -> read (the obsessive back-and-forth). Fix (3 parts):
//      (1) roam-and-read is now PAN-ONLY — it binds to DRAG events (dragstart/
//      drag/dragend), which fire only for a real pointer pan, never for a zoom or
//      a programmatic camera move, so a zoom can neither re-pin nor read (loop
//      cannot form). (2) scroll-wheel zoom disabled entirely; zoom is via an
//      always-visible +/- control that eases with around:ringCenter (ring is the
//      pivot, stays fixed on screen, only scales) plus native pinch. (3) the ring
//      holds its ground anchor through any zoom (geographic turf.circle -> mapbox
//      reprojects + scales it). Also: a loaded parcel is a returnable anchor again
//      (return-to-parcel chip flies the ring back + re-reads) and its outline
//      shows as a landmark when loaded (hidden in pure free-roam). All r23/r24/r25
//      wins intact. Interaction/gesture layer only — no engine bump, no cache flush.
//
// r27 — SEPARATE NAV FROM READ (map = look, ring = read): panning the map now
//      only NAVIGATES — it fires NO read and does NOT re-pin the ring. Before,
//      a map-pan settle (r24/r26) treated the pan as "roam here": it dropped the
//      loaded parcel and scored whatever new ground was under the viewport center,
//      so nudging the map just to LOOK AROUND cost the user their parcel. Fix:
//      the roam effect no longer binds the map's drag events at all, so a pan (and
//      a zoom) can neither re-pin the ring nor trip a read. The loaded parcel, its
//      gold outline, its numbers, and its message all persist through a pan; the
//      A-300 ring is a geographic turf.circle so it stays glued to its ground and
//      simply scrolls off-screen if you pan far (return-to-parcel chip, or dragging
//      the ring back, brings it home). Net trigger rule: reads fire ONLY on
//      ring-drag settle (Piece 3) + return-to-parcel. Zoom still fires no read.
//      Tap-to-place-the-ring intentionally left out (no new gesture this pass).
//      All r23–r26 wins intact. Interaction plumbing only — no engine bump, no
//      cache flush.
//
// r28 — HONESTY + FORM FIXES (weekly-test fix directive): presentation, data, and
//      test-tooling only — NO terrain engine change, NO cache flush. (1) Scrubbed
//      the killed "Intercept Placements" / ranked-stand / wind-strategy language
//      from every marketing + report surface (/demo, /flow-score, listing teaser,
//      shared territory, interactive-map layer, the /intel report-preview modal,
//      and the paid report HTML) and regrounded it in the honest A-300 deliverable
//      (flow lines traced from real ridges + the four measured drivers + situated
//      message). (2) Removed 9 test/debug marketplace listings and added an
//      admin moderation gate (TFP_LISTINGS_AUTO_APPROVE=false → new publishes go
//      to PENDING_REVIEW; /admin/listings review queue). (3) Wired real validation
//      feedback on /signup (empty/incomplete submit) and the homepage hero "View
//      in 3D" (empty address). (4) Closed two test holes: a forced compute-failure
//      hook (?forceFail=1, env-gated by TFP_ALLOW_TEST_FAILURE) so TC-A10 can
//      assert failure≠flat, and window.__tfpHuntZone ring test hooks + a Playwright
//      e2e drag spec for TC-A3. Interaction/engine behavior unchanged.
//
// r29 — RESTORE SCROLL-WHEEL ZOOM: bring back smooth, continuous wheel zoom (and
//      trackpad pinch), zooming toward the cursor — the way it worked before r26
//      retired it. Single-line flip in app/intel/page.tsx: scrollZoom.disable() →
//      scrollZoom.enable() at map create. Safe now because the two r26 drift
//      root-causes are both already gone: zoom fires NO read (reads are pan-only +
//      ring-drag-only since r26/r27) and the ring is anchored to its ground
//      coordinates (a geographic turf.circle mapbox reprojects/scales every camera
//      move — nothing re-pins it to viewport center on zoom), so the wheel cannot
//      reintroduce the walk/oscillation loop. The +/- buttons stay too (both zoom
//      paths live). TC-A6 rewritten (e2e/terrain-scroll-zoom.spec.ts): wheel over
//      an off-center ring → map zooms, ring holds its ground, NO read fires.
//      View/interaction only — no engine change, no cache flush.
//
// r30 — FREE-TIER METER + "CLAIM YOUR PARCEL" LANDOWNER PATH: put the whole
//      free-tier scouting funnel together. (1) Anonymous first read is now free &
//      instant — no signup wall in front of the wow (lib/reads.ts ANON_FREE_READS,
//      cookie-tracked best-effort; /api/reads/consume + /api/reads/status anon
//      branches). Reads 2–3 still prompt lightweight email signup; the 4th distinct
//      location shows the honest $39/season wall ($19 copy → $39 everywhere; the
//      buy is reachable BEFORE the wall via the meter chip + floating CTA). Roam/
//      zoom/re-read within one parcel still burns nothing. (2) NEW landowner path:
//      "Claim this parcel as mine" (Parcel Identity card) → soft-matches the
//      claimant against the Regrid owner-of-record (lib/claims.ts, conservative
//      2-token match; LLC/trust/mismatch → PENDING, never silently granted).
//      MATCHED = your ground: reads there are always free & don't burn the meter
//      (consume-route ownership exemption) + listable flag set. Honest: soft-verified
//      only, no "Verified Owner" badge beyond what we checked. New ParcelClaim model
//      (additive) + OwnerMatchStatus enum. $39 rides the existing Season Pass Stripe
//      plumbing via STRIPE_SEASON_PASS_PRICE_ID (mode:'payment', per-season). App +
//      data-model only — no terrain engine change, no cache flush.
//
// r31 — SEASON PASS PRICE = $39 (config only): pointed STRIPE_SEASON_PASS_PRICE_ID
//      at Clark's real $39 one-time "Season Pass" Stripe price (verified via API:
//      unit_amount 3900 usd, one-time, active) so the checkout charge now matches
//      the $39 wall copy shipped in r30. Was still pointing at the legacy $19 price.
//      Env/config change only — no code, engine, or data change.
//
// r32 — PRICING PAGE REBUILT to the locked spine (/pricing): killed the old
//      $19 Parcel Unlock tier and every standalone "$19" reference; new 3-tier
//      spine = FREE (3 reads/season, anon first read) / SEASON PASS $39 hero
//      (unlimited reads, flat per-season, no auto-renew) / PRO-OUTFITTER $99
//      (+ optional Pro Max $199). "Get the Season Pass" wired to /api/reads/unlock
//      (the SAME $39 STRIPE_SEASON_PASS_PRICE_ID the in-app wall uses) — one
//      number everywhere. Billing toggle now scoped to Pro/Outfitter only; copy
//      says Season Pass is flat $39. Added landowner "Claim it free" callout band
//      (no price/take-rate). Honesty scrub: removed "intercept points" (->pinch
//      points/crossings), "hunt-scoring engine", branded "ScoreCard"/"Hunt Report"
//      bullets, and the "most comprehensive...available" superlative; every bullet
//      now describes what the tool actually does. Marketing/checkout wiring only —
//      no terrain engine change, no cache flush.
// r33 — REMOVE SIT PINS + STAND JOURNAL (legacy Pro-only hunt-logging), app-only:
//      the personal sit-pin markers + stand-journal features were never part of
//      the honest loose-window product, weren't confirmed working, and their
//      pricing bullets were already dropped in r32 — so they're cleaned out.
//      Deleted the four API routes (app/api/sit-pins, app/api/sit-pins/[id],
//      app/api/stand-journal, app/api/stand-journal/[id]) and surgically removed
//      from /intel: the green sit-pin Mapbox source+layers (tfp-user-sit-pins /
//      tfp-sit-pin image, glow/icon/label + hover/click/context-menu handlers),
//      the Esc-closes-context-menu keydown branch, the pin/journal state, the
//      save/delete-pin + journal load/submit/delete handlers + isProRef, and the
//      three UI blocks (context menu, pin naming modal, Stand Journal modal);
//      dropped the .tfp-sit-pin-popup CSS. LOAD-BEARING report engine LEFT INTACT
//      (app/api/parcel-hunt-file, lib/report/build-html.ts, report/share,
//      report/[reportId], HuntingReport model) — listing creation + the paid
//      Hunt Report still work. The Supabase spatial tables (public.user_sit_pins
//      + stand-journal) are left dormant (no data touched, no Prisma migration).
//      App/UI only — no terrain engine change, no cache flush.
//
// r34 — CONSOLE/DEBUG NOISE FIX (Claude patch consoleanddebugfixes.patch).
//      (1) Downgraded 6 [STAND-STABILITY] diagnostic traces from console.error
//      to console.log — they were informational stand-reconciliation lines that
//      surfaced as red 'errors' (~94 on a single load), burying real errors and
//      the [ScopeProbe] deer-flow diagnostics. (2) Gated the heavy
//      buildStandSelectionDebug payload (JSON.stringify + console.table of a
//      large object) behind ?debug=true — it ran on EVERY stand recompute (i.e.
//      every A-300 ring roam) as real main-thread work + console spam for normal
//      users. No behavioral change; console now reflects real severity.
export const BUILD_REV = 'r34';

// e.g. "build v6.3-flowing-form r11 · Jul 17"
export const BUILD_STAMP = `build ${BUILD_VERSION} ${BUILD_REV} · ${BUILD_DATE}`;
