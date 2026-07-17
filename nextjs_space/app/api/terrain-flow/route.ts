/**
 * POST /api/terrain-flow - Terrain Flow Analysis V2 (Terrain-Driven)
 * 
 * Computes terrain-guided movement likelihood surfaces and extracts
 * flow lines, convergence zones, and opportunity areas.
 * 
 * This is terrain intelligence, not wildlife AI.
 * 
 * V2 CHANGES:
 * - Uses buffered analysis extent (1km default, up to 2km)
 * - Fetches corridor data from Modal backend for DEM-derived terrain structure
 * - Computes weighted likelihood surface from terrain components
 * - Extracts terrain-following flow lines (NOT parcel-aligned)
 * - Terrain-based convergence detection (NOT endpoint clustering)
 * - Supports debug layers for component surface visualization
 * - Supports before/after comparison mode
 * 
 * Input: Parcel AOI (GeoJSON polygon), parcel_id, bufferMeters
 * Process:
 *   1. Expand parcel bounds by buffer for landscape context
 *   2. Fetch corridor data from Modal backend (with buffered extent)
 *   3. Compute component rasters (slope, bench, saddle, spine, convergence)
 *   4. Build weighted likelihood surface
 *   5. Extract terrain-following flow lines
 *   6. Identify convergence and opportunity zones
 * Output: Flow FeatureCollections + metadata
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  generateTerrainDrivenFlow, 
  generateLegacySyntheticFlow,
  FLOW_WEIGHTS, 
  FLOW_THRESHOLDS 
} from '@/lib/terrain-flow';
import {
  ANALYSIS_BUFFER_M,
  ANALYSIS_BUFFER_MAX_M,
  createBufferedParcel,
  getBbox,
  expandBbox,
} from '@/lib/terrain-analysis';
import type { TerrainFlowResponse } from '@/types/terrain-flow';
import { buildFlowScope, toFlowLines } from '@/lib/flow-contract';
import { TERRAIN_ENGINE_VERSION } from '@/lib/terrain-engine-version';
import { syntheticFlowEnabled, MAX_ANALYSIS_ACRES, acresToRadiusMeters } from '@/lib/flow-flags';
import { clipFlowToAcreLimit } from '@/lib/flow-cap';
import { buildHuntZoneCircle } from '@/lib/huntzone-scope';
import * as turf from '@turf/turf';

/**
 * Compute the canonical flow scope for a parcel analysis (Piece 0 plumbing).
 * center = parcel centroid, radius_m = analysis buffer, acres from parcel area,
 * mode = 'parcel'. Fully defensive: never throws.
 */
function computeParcelScope(
  parcel: any,
  radiusM: number,
) {
  let center = { lat: 0, lng: 0 };
  let acres = 0;
  try {
    const c = turf.centerOfMass(parcel as any);
    const coords = c?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      center = { lat: Number(coords[1]) || 0, lng: Number(coords[0]) || 0 };
    }
  } catch {
    /* leave center at origin on failure */
  }
  try {
    const areaM2 = turf.area(parcel as any);
    if (Number.isFinite(areaM2)) acres = areaM2 / 4046.8564224;
  } catch {
    /* leave acres at 0 on failure */
  }
  return buildFlowScope({ center, radius_m: radiusM, acres, mode: 'parcel' });
}

// Modal endpoint for DEM-based corridor computation
const CORRIDOR_API_URL = process.env.CORRIDOR_API_URL || 
  'https://cwc2030--terrain-brain-v3-corridors-corridors-web.modal.run/v1/corridors';

// Ridge endpoint (if available)
const RIDGE_API_URL = process.env.RIDGE_API_URL || 
  'https://cwc2030--terrain-brain-v3-ridges-ridges-web.modal.run/v1/ridges';

// MAIN-PATH BUDGET (v6.1 blank-fix): corridor + ridge now run IN PARALLEL (see
// Promise.all below), each with 2 attempts at 27s. Parallel worst case is 2×27s
// = 54s (not the old 4×45s = 180s sequential blowup that overran the client's
// abort and produced silent empty flow). The client cap is the OUTER bound at
// 75s (REQUEST_TIMEOUT_MS in lib/terrain-flow.ts) — comfortably above this 54s
// server budget + flow-gen compute, so the client never aborts mid-retry.
const CORRIDOR_TIMEOUT_MS = 27000; // 27s per attempt × 2 attempts ≈ 54s (parallel with ridge)
const RIDGE_TIMEOUT_MS = 27000;    // 27s per attempt × 2 attempts ≈ 54s (parallel with corridor)
// Scope compute skips corridor, so ridge is the only upstream call. Run TWO
// attempts at ~27s each (54s worst case, safely under the 60s client cap):
// a single cold/slow Modal timeout auto-recovers on the retry instead of
// surfacing a hard 502 + "couldn't load — tap to retry" banner. The retry loop
// has no inter-attempt backoff, so 2×27s stays under the cap.
const RIDGE_TIMEOUT_SCOPE_MS = 27000; // 27s per attempt × 2 attempts ≈ 54s
const API_VERSION = 'v2.1-terrain-driven-2026-05-01';

/**
 * Fetch with timeout + one automatic retry on abort/timeout.
 * Returns the Response on success or null on double failure.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeout: number },
  label: string,
  maxAttempts: number = 2,
  parentSignal?: AbortSignal,
): Promise<Response | null> {
  const { timeout, ...fetchInit } = init;
  // If the client already gave up on this request (superseded by a newer scope
  // move), don't even start the upstream call — free the Modal backend now.
  if (parentSignal?.aborted) {
    console.warn(`[TerrainFlow] ${label} skipped — client already aborted (superseded)`);
    return null;
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    // Bridge the client abort into THIS upstream fetch so a superseded request
    // actually cancels the Modal compute (not just abandons it client-side).
    const onParentAbort = () => controller.abort();
    if (parentSignal) parentSignal.addEventListener('abort', onParentAbort);
    try {
      const res = await fetch(url, { ...fetchInit, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = errMsg.includes('abort');
      // Client aborted (superseded) — stop immediately, never retry, free backend.
      if (parentSignal?.aborted) {
        console.warn(`[TerrainFlow] ${label} attempt ${attempt} aborted — superseded by newer scope move (client cancelled)`);
        return null;
      }
      if (attempt < maxAttempts && isTimeout) {
        console.warn(`[TerrainFlow] ${label} attempt ${attempt} timed out after ${init.timeout}ms — retrying`);
        continue;
      }
      console.warn(`[TerrainFlow] ${label} attempt ${attempt} failed: ${errMsg}`);
      return null;
    } finally {
      if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
  return null;
}

interface TerrainFlowRequest {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  parcel_id: string;
  bufferMeters?: number;
  options?: {
    weights?: Partial<typeof FLOW_WEIGHTS>;
    thresholds?: Partial<typeof FLOW_THRESHOLDS>;
    includeDebugLayers?: boolean;
    mode?: 'terrain_driven' | 'synthetic'; // For comparison
    // Hunt Zone scope move: skip the (always-empty) corridor call and use a
    // single ridge attempt so the compute settles well under the client cap.
    scopeCompute?: boolean;
  };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let body: TerrainFlowRequest | null = null;
  
  try {
    body = await request.json().catch(() => null) as TerrainFlowRequest | null;
    const { 
      parcel, 
      parcel_id, 
      bufferMeters = ANALYSIS_BUFFER_M,
      options = {} 
    } = (body ?? {}) as TerrainFlowRequest;

    // Validate input
    if (!parcel || !parcel.geometry) {
      return NextResponse.json(
        { success: false, error: 'Valid parcel GeoJSON required' },
        { status: 400 }
      );
    }

    if (!parcel_id) {
      return NextResponse.json(
        { success: false, error: 'parcel_id required' },
        { status: 400 }
      );
    }

    // Clamp buffer to allowed range
    const effectiveBuffer = Math.min(
      Math.max(bufferMeters, 200), 
      ANALYSIS_BUFFER_MAX_M
    );

    // ─── Neighborhood-AOI normalization (verdict window ≡ flow window) ──
    // The DEM/Modal compute window used to scale with parcel size (parcel
    // bbox + buffer), so the same hilly location returned DIFFERENT ridge
    // geometry — and thus a different verdict — at different parcel sizes
    // (the 89-ac non-monotonic flip). We floor the COMPUTE geometry to the
    // A-300 hunt-zone circle centered on the parcel centroid whenever the
    // parcel is smaller than the 300-ac analysis scope. All sub-300-ac
    // parcels at a given location now share the SAME compute AOI → the same
    // ridges → a stable verdict. Larger parcels keep their own footprint.
    // Guard with NEIGHBORHOOD_AOI=0 to fall back to the legacy per-parcel AOI.
    let effParcel = parcel;
    if (process.env.NEIGHBORHOOD_AOI !== '0' && options.mode !== 'synthetic') {
      try {
        const areaAcres = turf.area(parcel as any) / 4046.8564224;
        if (Number.isFinite(areaAcres) && areaAcres < MAX_ANALYSIS_ACRES) {
          const c = turf.centerOfMass(parcel as any);
          const coords = c?.geometry?.coordinates;
          if (Array.isArray(coords) && coords.length >= 2) {
            const center = { lat: Number(coords[1]), lng: Number(coords[0]) };
            if (Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
              const radiusM = acresToRadiusMeters(MAX_ANALYSIS_ACRES);
              effParcel = buildHuntZoneCircle(center, radiusM) as any;
              console.log(
                `[TerrainFlow] Neighborhood-AOI normalize: parcel ${areaAcres.toFixed(1)}ac -> A-${MAX_ANALYSIS_ACRES} circle r=${radiusM.toFixed(0)}m @ ${center.lat.toFixed(4)},${center.lng.toFixed(4)}`,
              );
            }
          }
        }
      } catch (e) {
        console.warn('[TerrainFlow] Neighborhood-AOI normalize failed, using raw parcel:', e);
      }
    }

    // Terrain debug block — always returned
    const terrainDebug: Record<string, any> = {
      terrain_source: 'unknown',
      fallback_used: false,
      fallback_reason: null,
      corridor_modal_status: null,
      corridor_modal_error: null,
      ridge_modal_status: null,
      ridge_modal_error: null,
      corridor_count: 0,
      ridge_count_primary: 0,
      ridge_count_secondary: 0,
      flow_count_primary: 0,
      flow_count_secondary: 0,
      convergence_count: 0,
      opportunity_count: 0,
      pipeline_steps: {} as Record<string, any>,
    };

    console.log('[TerrainFlow] Processing for parcel:', parcel_id);
    console.log('[TerrainFlow] Buffer:', effectiveBuffer, 'm');
    console.log('[TerrainFlow] Mode:', options.mode || 'terrain_driven');

    // Merge user options with defaults
    const weights = { ...FLOW_WEIGHTS, ...options.weights };
    const thresholds = { ...FLOW_THRESHOLDS, ...options.thresholds };

    // Hunt Zone scope move: the corridor endpoint returns empty for the tight
    // 300-ac circle every time, so skip it entirely. The ridge call runs 2
    // attempts at ~27s each (54s worst case, under the 60s client cap) so a
    // single cold/slow Modal ridge auto-recovers instead of surfacing a hard
    // 502 + retry banner.
    const scopeCompute = options.scopeCompute === true;
    const flowReqId = `flowreq_${Date.now().toString(36)}`;
    if (scopeCompute) {
      console.log(`[TerrainFlow][scope ${flowReqId}] START scope compute for ${parcel_id} (corridor skipped, ridge 2 attempts x ~27s)`);
    }

    // If requesting legacy synthetic mode for comparison
    if (options.mode === 'synthetic') {
      // Piece 1: synthetic flow is disabled by default. generateLegacySyntheticFlow
      // already returns an empty response when the flag is OFF; here we also
      // refuse to emit any flow_lines from the synthetic branch unless the flag
      // is explicitly ON — the synthetic branch produces zero lines by default.
      const synthEnabled = syntheticFlowEnabled();
      console.log('[TerrainFlow] Synthetic comparison mode requested (flag %s)', synthEnabled ? 'ON' : 'OFF');
      const syntheticData = generateLegacySyntheticFlow(parcel);
      const processingTime = (Date.now() - startTime) / 1000;
      syntheticData.metadata.processing_time_seconds = processingTime;
      
      return NextResponse.json({
        ...syntheticData,
        // Piece 1: no synthetic lines emitted when the flag is OFF (default).
        flow_lines: synthEnabled ? toFlowLines(syntheticData) : [],
        scope: computeParcelScope(parcel, effectiveBuffer),
        engine_version: TERRAIN_ENGINE_VERSION,
        empty_state: synthEnabled ? null : {
          type: 'synthetic_disabled',
          message: 'Synthetic comparison flow is disabled. Enable the synthetic flow flag to view it.',
        },
        version: API_VERSION,
        request_id: `flow_synthetic_${Date.now().toString(36)}`,
        terrain_debug: { ...terrainDebug, terrain_source: 'synthetic_comparison', fallback_used: true, fallback_reason: synthEnabled ? 'User requested synthetic comparison mode' : 'Synthetic flow disabled (flag off)' },
      });
    }

    // Create buffered parcel for landscape context (uses the neighborhood-
    // normalized AOI so the DEM window is stable across parcel sizes).
    const bufferedParcel = createBufferedParcel(effParcel, effectiveBuffer);
    
    // Try calling Modal backend for DEM-based corridor data
    let corridorData: any = null;
    let ridgeData: any = null;
    let usedRealDEM = false;

    // Kick off corridor + ridge IN PARALLEL (v6.1 blank-fix). Both promises are
    // started here and awaited together via Promise.all below, so worst case is
    // 54s (2×27s), not the old 108s+ sequential path that overran the client
    // abort and produced a silent empty render.
    const corridorPromise = scopeCompute
      ? Promise.resolve<Response | null>(null)
      : fetchWithRetry(
      CORRIDOR_API_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenTopo-Key': process.env.OPENTOPOGRAPHY_API_KEY || '',
        },
        body: JSON.stringify({
          parcel: bufferedParcel,
          parcel_id: parcel_id + '_buffered',
          state: 'mo',
          county: 'unknown',
          options: {
            dem_source: 'USGS3DEP1m',
            slope_preference: 'moderate',
            concavity_weight: 0.4,
            output_format: 'geojson',
          },
        }),
        timeout: CORRIDOR_TIMEOUT_MS,
      },
      'Corridor',
      2,
      request.signal,
    );

    // Ridge promise — started NOW (before awaiting corridor) so the two Modal
    // calls overlap on the wire. Both are awaited together via Promise.all.
    terrainDebug.pipeline_steps.ridge_call = 'attempted';
    const ridgePromise = fetchWithRetry(
      RIDGE_API_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenTopo-Key': process.env.OPENTOPOGRAPHY_API_KEY || '',
        },
        body: JSON.stringify({
          parcel: bufferedParcel,
          parcel_id: parcel_id + '_buffered',
          bufferMeters: effectiveBuffer,
          options: {
            dem_source: 'USGS3DEP1m',
            min_prominence_ft: 8,
            min_length_m: 60,
          },
        }),
        timeout: scopeCompute ? RIDGE_TIMEOUT_SCOPE_MS : RIDGE_TIMEOUT_MS,
      },
      'Ridge',
      // Two attempts for both scope and full path at ~27s each. Running corridor
      // and ridge in parallel keeps worst case at 54s — under the 75s client cap.
      2,
      request.signal,
    );

    // Await BOTH in parallel — the core of the budget fix.
    const [corridorResponse, ridgeResponse] = await Promise.all([corridorPromise, ridgePromise]);

    if (scopeCompute) {
      terrainDebug.pipeline_steps.corridor_call = 'skipped_scope_compute';
      console.log('[TerrainFlow] Scope compute — skipping corridor call (empty for 300-ac circle)');
    } else {
      terrainDebug.pipeline_steps.corridor_call = 'attempted';
      console.log('[TerrainFlow] Fetching corridor data from Modal');
    }

    if (corridorResponse?.ok) {
      terrainDebug.corridor_modal_status = corridorResponse.status;
      try {
        corridorData = await corridorResponse.json();
        const corridorCount = corridorData.corridors?.features?.length || corridorData.features?.length || 0;
        terrainDebug.corridor_count = corridorCount;
        
        if (corridorCount > 0) {
          usedRealDEM = true;
          terrainDebug.pipeline_steps.corridor_call = 'success';
          console.log('[TerrainFlow] Got corridor data from Modal:', corridorCount);
        } else {
          terrainDebug.pipeline_steps.corridor_call = 'success_but_empty';
          terrainDebug.corridor_modal_error = 'Corridor data empty or unsuccessful';
          console.log('[TerrainFlow] Corridor data empty or unsuccessful');
          corridorData = null;
        }
      } catch (parseErr) {
        terrainDebug.pipeline_steps.corridor_call = 'parse_error';
        terrainDebug.corridor_modal_error = String(parseErr);
        console.log('[TerrainFlow] Corridor response parse failed:', parseErr);
      }
    } else if (corridorResponse) {
      terrainDebug.corridor_modal_status = corridorResponse.status;
      const errorText = await corridorResponse.text().catch(() => 'unreadable');
      terrainDebug.corridor_modal_error = errorText.slice(0, 300);
      terrainDebug.pipeline_steps.corridor_call = `http_${corridorResponse.status}`;
      console.log('[TerrainFlow] Corridor API error:', corridorResponse.status);
    } else if (!scopeCompute) {
      terrainDebug.pipeline_steps.corridor_call = 'unreachable';
      terrainDebug.corridor_modal_error = 'No response (timeout or network error)';
    }
    // (scopeCompute leaves corridor_call = 'skipped_scope_compute')

    // Ridge response already awaited above (in parallel with corridor).
    console.log('[TerrainFlow] Ridge data fetched (parallel with corridor)');

    if (ridgeResponse?.ok) {
      terrainDebug.ridge_modal_status = ridgeResponse.status;
      try {
        ridgeData = await ridgeResponse.json();
        const rp = ridgeData.ridges_primary?.features?.length || 0;
        const rs = ridgeData.ridges_secondary?.features?.length || 0;
        terrainDebug.ridge_count_primary = rp;
        terrainDebug.ridge_count_secondary = rs;
        if (rp + rs > 0) {
          terrainDebug.pipeline_steps.ridge_call = 'success';
          usedRealDEM = true;
          const rSaddles = ridgeData.saddle_nodes?.features?.length || 0;
          terrainDebug.ridge_saddle_count = rSaddles;
          console.log('[TerrainFlow] Got ridge data:', rp, 'P +', rs, 'S +', rSaddles, 'saddles');
        } else {
          terrainDebug.pipeline_steps.ridge_call = 'success_but_empty';
          terrainDebug.ridge_modal_error = ridgeData.metadata?.error || 'No ridge features found';
          console.log('[TerrainFlow] Ridge modal returned 0 features, dem_source:', ridgeData.metadata?.dem_source || 'unknown');
          ridgeData = null;
        }
      } catch (parseErr) {
        terrainDebug.pipeline_steps.ridge_call = 'parse_error';
        terrainDebug.ridge_modal_error = String(parseErr);
        console.warn('[TerrainFlow] Ridge response parse failed:', parseErr);
      }
    } else if (ridgeResponse) {
      terrainDebug.ridge_modal_status = ridgeResponse.status;
      terrainDebug.pipeline_steps.ridge_call = `http_${ridgeResponse.status}`;
      terrainDebug.ridge_modal_error = 'Non-200 response';
    } else {
      terrainDebug.pipeline_steps.ridge_call = 'unreachable';
      terrainDebug.ridge_modal_error = 'No response (timeout or network error)';
    }

    // Scope compute with NO usable ridge data: distinguish a transient upstream
    // failure (timeout / unreachable / non-200 / parse error) from a genuine
    // "flat terrain" empty. Corridor is skipped on scope computes, so ridge is
    // the only data source — a transient ridge failure means we have NO answer
    // for this scope. Surface it as an explicit failure (502) so the client shows
    // the retry banner, rather than a 200 with empty flow that would read as a
    // false "no flow detected here." A real ridge response with 0 features
    // ('success_but_empty') is a legitimate empty result and falls through.
    if (scopeCompute && !usedRealDEM) {
      const rc = terrainDebug.pipeline_steps.ridge_call;
      const transientFailure =
        rc === 'unreachable' || rc === 'parse_error' ||
        (typeof rc === 'string' && rc.startsWith('http_'));
      if (transientFailure) {
        const processingTime = (Date.now() - startTime) / 1000;
        console.warn(`[TerrainFlow][scope ${flowReqId}] FAILED (${rc}) in ${processingTime.toFixed(2)}s (client_aborted=${request.signal.aborted}) — returning failure for retry (${parcel_id})`);
        // Per-scope-move diagnostic: one greppable line carrying ridge-service
        // HTTP status + feature counts + timing so a rapid-roam burst can be read
        // full→empty and throttle (429/503/timeout) vs render-decay separated.
        console.log(`[ScopeProbe] req=${flowReqId} outcome=FAIL ridge_call=${rc} ridge_http=${terrainDebug.ridge_modal_status ?? 'null'} rp=${terrainDebug.ridge_count_primary} rs=${terrainDebug.ridge_count_secondary} saddles=${terrainDebug.ridge_saddle_count ?? 0} flow_p=0 flow_s=0 dur=${(processingTime * 1000).toFixed(0)}ms client_aborted=${request.signal.aborted} err=${terrainDebug.ridge_modal_error ?? ''} parcel=${parcel_id}`);
        return NextResponse.json(
          {
            success: false,
            error: `ridge_${rc}`,
            scopeCompute: true,
            version: API_VERSION,
            terrain_debug: terrainDebug,
          },
          { status: 502 },
        );
      }
    }

    // MAIN PATH (v6.1 blank-fix) — distinguish a CHOKED compute from a genuinely
    // FLAT parcel, exactly as the scope path does above. Without this, a
    // transient Modal failure (timeout / unreachable / non-200 / parse error) on
    // the initial render falls through to generateTerrainDrivenFlow(null,null),
    // yields 0 lines, and returns a 200 'no_backbone' empty — which the client
    // renders as an honest "flat" parcel. That is the precise dishonesty we must
    // prevent: a hunter reading "empty = no deer" when the truth is "it choked."
    // If we have NO real DEM data AND either endpoint failed transiently, surface
    // an explicit failure (502) so the client shows the retry banner + auto-retry
    // instead of a false-flat. Both endpoints returning real 200s with zero
    // features ('success_but_empty') is a legitimate flat result and falls
    // through to the honest no_backbone empty below.
    if (!scopeCompute && !usedRealDEM) {
      const isTransient = (rc: any) =>
        rc === 'unreachable' || rc === 'parse_error' ||
        (typeof rc === 'string' && rc.startsWith('http_'));
      const corridorRc = terrainDebug.pipeline_steps.corridor_call;
      const ridgeRc = terrainDebug.pipeline_steps.ridge_call;
      if (isTransient(corridorRc) || isTransient(ridgeRc)) {
        const processingTime = (Date.now() - startTime) / 1000;
        console.warn(`[TerrainFlow][main ${flowReqId}] FAILED (corridor=${corridorRc} ridge=${ridgeRc}) in ${processingTime.toFixed(2)}s — returning failure for retry (${parcel_id})`);
        console.log(`[FlowDiag] path=main outcome=failure corridor=${corridorRc} ridge=${ridgeRc} time=${processingTime.toFixed(1)}s parcel=${parcel_id}`);
        return NextResponse.json(
          {
            success: false,
            error: `compute_transient_failure (corridor=${corridorRc}, ridge=${ridgeRc})`,
            version: API_VERSION,
            terrain_debug: terrainDebug,
          },
          { status: 502 },
        );
      }
    }

    // Generate terrain-driven flow
    console.log('[TerrainFlow] Generating terrain-driven flow');
    const flowData = generateTerrainDrivenFlow(
      effParcel,
      corridorData,
      ridgeData,
      options.includeDebugLayers || false
    );

    const processingTime = (Date.now() - startTime) / 1000;
    
    // Update metadata
    flowData.metadata.processing_time_seconds = processingTime;
    flowData.metadata.buffer_m = effectiveBuffer;
    
    // Determine flow mode
    const flowMode = usedRealDEM ? 'real_dem' : 'synthetic';
    terrainDebug.terrain_source = usedRealDEM ? 'modal_dem_real' : 'synthetic_fallback';
    terrainDebug.fallback_used = !usedRealDEM;
    if (!usedRealDEM) {
      const reasons: string[] = [];
      if (terrainDebug.corridor_modal_error) reasons.push(`Corridor: ${terrainDebug.corridor_modal_error}`);
      if (terrainDebug.ridge_modal_error) reasons.push(`Ridge: ${terrainDebug.ridge_modal_error}`);
      terrainDebug.fallback_reason = reasons.join('; ') || 'Both Modal endpoints returned no features';
    }

    terrainDebug.flow_count_primary = flowData.flow_primary.features.length;
    terrainDebug.flow_count_secondary = flowData.flow_secondary.features.length;
    terrainDebug.convergence_count = flowData.convergence_zones.features.length;
    terrainDebug.opportunity_count = flowData.opportunity_zones.features.length;

    // READ-ONLY DIAGNOSTIC (v6.4.2): surface the shared backbone verdict's gate
    // inputs so an emptied move's REAL spine prominences are visible from server
    // logs / batch scans without Clark's browser console. This is exactly the
    // data the NETWORK_LINE_MIN_FT recalibration needs: max prominence, the
    // per-line prominence list, the >=40ft qualified count, and the verdict.
    const bb = flowData.metadata?.backbone;
    if (bb) {
      terrainDebug.max_prominence_ft = Math.round(bb.maxProminenceFt ?? 0);
      terrainDebug.strong_line_count = bb.networkLines ?? 0;
      terrainDebug.line_prominences_ft = bb.linePromsFt ?? [];
      // READ-ONLY CALIBRATION (v6.4.3): per-line LENGTH (m, full spine in the
      // buffered window) + COHERENCE (avgRidgeScore) aligned index-for-index
      // with line_prominences_ft. Investigating whether length/continuity can
      // separate genuine single spines from flat-ag artifacts where prominence
      // could not. NOTE: length can include spine portions outside the parcel.
      terrainDebug.line_lengths_m = bb.lineLensM ?? [];
      terrainDebug.line_coherence = bb.lineCoherence ?? [];
      terrainDebug.line_flank_ft = bb.lineFlankFt ?? [];
      terrainDebug.backbone_has_real = bb.hasRealBackbone;
      terrainDebug.backbone_reason = bb.reason;
    }

    if (usedRealDEM) {
      flowData.metadata.mode = 'terrain_driven';
      flowData.metadata.dem_source = corridorData?.metadata?.dem_source || 'USGS_3DEP_1m';
    }

    console.log('[TerrainFlow] Complete:', {
      terrain_source: terrainDebug.terrain_source,
      flowMode,
      primary: terrainDebug.flow_count_primary,
      secondary: terrainDebug.flow_count_secondary,
      convergence: terrainDebug.convergence_count,
      time: processingTime.toFixed(2) + 's',
    });
    if (scopeCompute) {
      console.log(`[TerrainFlow][scope ${flowReqId}] DONE in ${processingTime.toFixed(2)}s (client_aborted=${request.signal.aborted}) for ${parcel_id}`);
    }

    // ─── Piece 1: 300-acre real-data cap ───────────────────────────────
    // Cap any single analysis at MAX_ANALYSIS_ACRES of real terrain data.
    // Beyond that, no whole-territory flow — the client shows a clean
    // "spin up a Hunt Zone here" empty-state for the rest.
    const scope = computeParcelScope(parcel, effectiveBuffer);
    let outFlow: TerrainFlowResponse = flowData;
    let emptyState: any = null;

    if (scope.acres > MAX_ANALYSIS_ACRES) {
      const clipped = clipFlowToAcreLimit(
        {
          flow_primary: flowData.flow_primary,
          flow_secondary: flowData.flow_secondary,
          convergence_zones: flowData.convergence_zones,
          opportunity_zones: flowData.opportunity_zones,
        },
        scope.center,
        MAX_ANALYSIS_ACRES,
      );
      outFlow = {
        ...flowData,
        flow_primary: clipped.flow_primary as any,
        flow_secondary: clipped.flow_secondary as any,
        convergence_zones: clipped.convergence_zones as any,
        opportunity_zones: clipped.opportunity_zones as any,
      };
      emptyState = {
        type: 'acre_cap',
        max_acres: MAX_ANALYSIS_ACRES,
        total_acres: Math.round(scope.acres),
        message: `Analysis capped at ${MAX_ANALYSIS_ACRES} acres of real terrain. Spin up a Hunt Zone here to analyze the rest.`,
      };
      // Honesty: reflect the clipped counts in terrain_debug.
      terrainDebug.flow_count_primary = outFlow.flow_primary.features.length;
      terrainDebug.flow_count_secondary = outFlow.flow_secondary.features.length;
      terrainDebug.convergence_count = outFlow.convergence_zones.features.length;
      terrainDebug.opportunity_count = outFlow.opportunity_zones.features.length;
      console.log('[TerrainFlow] Acre cap applied: %d ac > %d ac cap — kept %d, dropped %d flow features',
        Math.round(scope.acres), MAX_ANALYSIS_ACRES, clipped.kept, clipped.dropped);
    } else {
      // Within the cap: if there is no real backbone flow at all, surface an
      // honest no-backbone empty-state (never synthetic lines).
      const totalLines =
        outFlow.flow_primary.features.length + outFlow.flow_secondary.features.length;
      if (totalLines === 0) {
        emptyState = {
          type: 'no_backbone',
          message: 'No real terrain backbone available for this parcel yet.',
        };
      }
    }

    // [FlowDiag] main-path classification — lets us grep the blank rate and watch
    // it fall as Modal warms under the v6.1 cold-cache wave. Distinguishes a
    // real render from an honest-flat empty (server 200 + no_backbone) so a flat
    // parcel is never miscounted as a failure. Genuine failures never reach here
    // (full path returns synthetic-or-fail via client; scope path 502s above).
    {
      const totalLines = outFlow.flow_primary.features.length + outFlow.flow_secondary.features.length;
      const diagOutcome = totalLines > 0 ? 'real' : (emptyState?.type === 'no_backbone' ? 'flat_empty' : (emptyState?.type || 'empty'));
      console.log(`[FlowDiag] path=${scopeCompute ? 'scope' : 'main'} outcome=${diagOutcome} flowMode=${flowMode} usedRealDEM=${usedRealDEM} primary=${outFlow.flow_primary.features.length} secondary=${outFlow.flow_secondary.features.length} conv=${outFlow.convergence_zones.features.length} time=${((Date.now() - startTime) / 1000).toFixed(1)}s parcel=${parcel_id}`);
      // Per-scope-move diagnostic (success path): same greppable schema as the
      // FAIL line above so a rapid-roam burst reads full→empty in one grep.
      if (scopeCompute) {
        console.log(`[ScopeProbe] req=${flowReqId} outcome=${totalLines > 0 ? 'OK' : 'EMPTY'} ridge_call=${terrainDebug.pipeline_steps?.ridge_call ?? 'unknown'} ridge_http=${terrainDebug.ridge_modal_status ?? 'null'} rp=${terrainDebug.ridge_count_primary} rs=${terrainDebug.ridge_count_secondary} saddles=${terrainDebug.ridge_saddle_count ?? 0} maxProm=${terrainDebug.max_prominence_ft ?? 'n/a'} strongLines=${terrainDebug.strong_line_count ?? 'n/a'} proms=[${(terrainDebug.line_prominences_ft ?? []).join(',')}] lensM=[${(terrainDebug.line_lengths_m ?? []).join(',')}] coh=[${(terrainDebug.line_coherence ?? []).join(',')}] flankFt=[${(terrainDebug.line_flank_ft ?? []).join(',')}] backbone=${terrainDebug.backbone_has_real === undefined ? 'n/a' : (terrainDebug.backbone_has_real ? 'real' : 'none')} flow_p=${outFlow.flow_primary.features.length} flow_s=${outFlow.flow_secondary.features.length} dur=${(Date.now() - startTime)}ms client_aborted=${request.signal.aborted} flowMode=${flowMode} parcel=${parcel_id}`);
      }
    }

    return NextResponse.json({
      ...outFlow,
      // Canonical flow contract (v5.0-scope) — additive
      flow_lines: toFlowLines(outFlow),
      scope,
      engine_version: TERRAIN_ENGINE_VERSION,
      empty_state: emptyState,
      flowMode,
      version: API_VERSION,
      request_id: `flow_terrain_${Date.now().toString(36)}`,
      terrain_debug: terrainDebug,
    }, {
      headers: {
        'X-Processing-Time-Ms': String(Date.now() - startTime),
        'X-Flow-Mode': outFlow.metadata.mode,
        'X-API-Version': API_VERSION,
      },
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[TerrainFlow] Error:', errMsg);
    
    return NextResponse.json(
      {
        success: false,
        error: errMsg,
        version: API_VERSION,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'available',
    version: API_VERSION,
    description: 'Terrain Flow Analysis API V2 - Terrain-Driven',
    features: [
      'Buffered analysis extent (1-2km)',
      'DEM-derived component rasters',
      'Weighted likelihood surface',
      'Terrain-following flow extraction',
      'Terrain-based convergence detection',
      'Debug layers for tuning',
      'Comparison mode (synthetic vs terrain-driven)',
    ],
    endpoints: {
      POST: {
        input: {
          parcel: 'GeoJSON Feature (Polygon)',
          parcel_id: 'string',
          bufferMeters: 'number (default: 1000, max: 2000)',
          options: {
            includeDebugLayers: 'boolean',
            mode: '"terrain_driven" | "synthetic"',
          },
        },
        output: {
          flow_primary: 'FeatureCollection<LineString>',
          flow_secondary: 'FeatureCollection<LineString>',
          convergence_zones: 'FeatureCollection<Point>',
          opportunity_zones: 'FeatureCollection<Point>',
          debug_layers: 'optional component surfaces',
          metadata: 'Processing details',
        },
      },
    },
  });
}
