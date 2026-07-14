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
import { syntheticFlowEnabled, MAX_ANALYSIS_ACRES } from '@/lib/flow-flags';
import { clipFlowToAcreLimit } from '@/lib/flow-cap';
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

const CORRIDOR_TIMEOUT_MS = 45000; // 45s — allows Modal cold-start
const RIDGE_TIMEOUT_MS = 45000;    // 45s — allows Modal cold-start + USGS 3DEP fallback
// Scope compute skips corridor, so ridge is the only upstream call. Give it a bit
// more room (still safely under the 60s client cap) so a Modal cold-start ridge
// can finish instead of spuriously timing out at 45s and forcing a retry.
const RIDGE_TIMEOUT_SCOPE_MS = 50000; // 50s
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
    // 300-ac circle every time, so skip it entirely; and use a single ridge
    // attempt (no double-retry) so a typical scope compute settles well under
    // the client cap instead of stacking two 45s corridor + two 45s ridge waits.
    const scopeCompute = options.scopeCompute === true;
    const flowReqId = `flowreq_${Date.now().toString(36)}`;
    if (scopeCompute) {
      console.log(`[TerrainFlow][scope ${flowReqId}] START scope compute for ${parcel_id} (corridor skipped, ridge single-attempt)`);
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

    // Create buffered parcel for landscape context
    const bufferedParcel = createBufferedParcel(parcel, effectiveBuffer);
    
    // Try calling Modal backend for DEM-based corridor data
    let corridorData: any = null;
    let ridgeData: any = null;
    let usedRealDEM = false;

    const corridorResponse = scopeCompute
      ? null
      : await fetchWithRetry(
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

    // Fetch ridge data
    terrainDebug.pipeline_steps.ridge_call = 'attempted';
    console.log('[TerrainFlow] Fetching ridge data from Modal');

    const ridgeResponse = await fetchWithRetry(
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
      // Scope move: single attempt (no double-retry) to stay under the client cap.
      scopeCompute ? 1 : 2,
      request.signal,
    );

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

    // Generate terrain-driven flow
    console.log('[TerrainFlow] Generating terrain-driven flow');
    const flowData = generateTerrainDrivenFlow(
      parcel,
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
