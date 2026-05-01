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

// Modal endpoint for DEM-based corridor computation
const CORRIDOR_API_URL = process.env.CORRIDOR_API_URL || 
  'https://cwc2030--terrain-brain-v3-corridors-corridors-web.modal.run/v1/corridors';

// Ridge endpoint (if available)
const RIDGE_API_URL = process.env.RIDGE_API_URL || 
  'https://cwc2030--terrain-brain-v3-ridges-ridges-web.modal.run/v1/ridges';

const CORRIDOR_TIMEOUT_MS = 45000; // 45s — allows Modal cold-start
const RIDGE_TIMEOUT_MS = 30000;    // 30s — allows Modal cold-start
const API_VERSION = 'v2.0-terrain-driven-2026-03-11';

/**
 * Fetch with timeout + one automatic retry on abort/timeout.
 * Returns the Response on success or null on double failure.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeout: number },
  label: string,
): Promise<Response | null> {
  const { timeout, ...fetchInit } = init;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(url, { ...fetchInit, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = errMsg.includes('abort');
      if (attempt === 1 && isTimeout) {
        console.warn(`[TerrainFlow] ${label} attempt 1 timed out after ${init.timeout}ms — retrying`);
        continue;
      }
      console.warn(`[TerrainFlow] ${label} attempt ${attempt} failed: ${errMsg}`);
      return null;
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

    console.log('[TerrainFlow] Processing for parcel:', parcel_id);
    console.log('[TerrainFlow] Buffer:', effectiveBuffer, 'm');
    console.log('[TerrainFlow] Mode:', options.mode || 'terrain_driven');

    // Merge user options with defaults
    const weights = { ...FLOW_WEIGHTS, ...options.weights };
    const thresholds = { ...FLOW_THRESHOLDS, ...options.thresholds };

    // If requesting legacy synthetic mode for comparison
    if (options.mode === 'synthetic') {
      console.log('[TerrainFlow] Generating LEGACY synthetic flow for comparison');
      const syntheticData = generateLegacySyntheticFlow(parcel);
      const processingTime = (Date.now() - startTime) / 1000;
      syntheticData.metadata.processing_time_seconds = processingTime;
      
      return NextResponse.json({
        ...syntheticData,
        version: API_VERSION,
        request_id: `flow_synthetic_${Date.now().toString(36)}`,
      });
    }

    // Create buffered parcel for landscape context
    const bufferedParcel = createBufferedParcel(parcel, effectiveBuffer);
    
    // Try calling Modal backend for DEM-based corridor data
    let corridorData: any = null;
    let ridgeData: any = null;
    let usedRealDEM = false;

    console.log('[TerrainFlow] Fetching corridor data from Modal with buffer (timeout %dms, 1 retry)', CORRIDOR_TIMEOUT_MS);

    const corridorResponse = await fetchWithRetry(
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
    );

    if (corridorResponse?.ok) {
      try {
        corridorData = await corridorResponse.json();
        if (corridorData.success &&
            (corridorData.corridors?.features?.length > 0 || corridorData.features?.length > 0)) {
          usedRealDEM = true;
          console.log('[TerrainFlow] Got corridor data from Modal:', {
            corridors: corridorData.corridors?.features?.length || corridorData.features?.length || 0,
            dem_source: corridorData.metadata?.dem_source,
          });
        } else {
          console.log('[TerrainFlow] Corridor data empty or unsuccessful');
          corridorData = null;
        }
      } catch (parseErr) {
        console.log('[TerrainFlow] Corridor response parse failed:', parseErr);
      }
    } else if (corridorResponse) {
      const errorText = await corridorResponse.text().catch(() => 'unreadable');
      console.log('[TerrainFlow] Corridor API error:', corridorResponse.status, errorText);
    }

    // Fetch ridge data (optional — timeout %dms, 1 retry)
    console.log('[TerrainFlow] Fetching ridge data from Modal (timeout %dms, 1 retry)', RIDGE_TIMEOUT_MS);

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
            dem_source: 'SRTMGL1',
            min_prominence_ft: 8,
            min_length_m: 60,
          },
        }),
        timeout: RIDGE_TIMEOUT_MS,
      },
      'Ridge',
    );

    if (ridgeResponse?.ok) {
      try {
        ridgeData = await ridgeResponse.json();
        if (ridgeData.success) {
          console.log('[TerrainFlow] Got ridge data:', {
            primary: ridgeData.ridges_primary?.features?.length || 0,
            secondary: ridgeData.ridges_secondary?.features?.length || 0,
            saddles: ridgeData.saddle_nodes?.features?.length || 0,
          });
        } else {
          ridgeData = null;
        }
      } catch (parseErr) {
        console.warn('[TerrainFlow] Ridge response parse failed:', parseErr);
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
    
    // Determine flow mode — 'real_dem' when Modal succeeded, 'synthetic' on fallback
    const flowMode = usedRealDEM ? 'real_dem' : 'synthetic';

    if (usedRealDEM) {
      flowData.metadata.mode = 'terrain_driven';
      flowData.metadata.dem_source = corridorData?.metadata?.dem_source || 'USGS_3DEP_1m';
    }

    console.log('[TerrainFlow] Complete:', {
      flowMode,
      mode: flowData.metadata.mode,
      primary: flowData.flow_primary.features.length,
      secondary: flowData.flow_secondary.features.length,
      convergence: flowData.convergence_zones.features.length,
      opportunity: flowData.opportunity_zones.features.length,
      processingTime: processingTime.toFixed(2) + 's',
      usedRealDEM,
    });

    return NextResponse.json({
      ...flowData,
      flowMode,
      version: API_VERSION,
      request_id: `flow_terrain_${Date.now().toString(36)}`,
    }, {
      headers: {
        'X-Processing-Time-Ms': String(Date.now() - startTime),
        'X-Flow-Mode': flowData.metadata.mode,
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
