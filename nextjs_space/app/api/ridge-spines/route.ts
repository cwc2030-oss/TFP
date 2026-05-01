/**
 * POST /api/ridge-spines - Ridge Spine Extraction (DEM-Only Structure Layer)
 * 
 * Priority: Real DEM-derived features from Modal Terrain Brain.
 * Synthetic fallback only when Modal fails — always tagged as fallback.
 * 
 * Returns terrain_debug block on every response for pipeline transparency.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateSyntheticRidgeSpines } from '@/lib/ridge-extraction';
import type { RidgeSpineResponse } from '@/types/terrain';

const RIDGE_API_URL = process.env.RIDGE_API_URL || 
  'https://cwc2030--terrain-brain-v3-ridges-ridges-web.modal.run/v1/ridges';
const REQUEST_TIMEOUT_MS = 45000; // 45s — allows Modal cold-start + USGS 3DEP fallback
const API_VERSION = 'v1.1-ridge-2026-05-01';

interface RidgeRequest {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  parcel_id: string;
  bufferMeters?: number;
}

/** Compute bbox dimensions in meters from a GeoJSON geometry */
function computeBboxMetrics(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const coords = geom.type === 'MultiPolygon'
    ? geom.coordinates.flatMap(p => p[0])
    : geom.coordinates[0];
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const centerLat = (minLat + maxLat) / 2;
  const widthM = (maxLng - minLng) * 111000 * Math.cos(centerLat * Math.PI / 180);
  const heightM = (maxLat - minLat) * 111000;
  const acreage = (widthM * heightM * 0.8) / 4046.86; // ~80% fill
  return { minLng, minLat, maxLng, maxLat, widthM, heightM, acreage };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let body: RidgeRequest | null = null;
  
  // Debug block — always returned
  const terrainDebug: Record<string, any> = {
    terrain_source: 'unknown',
    fallback_used: false,
    fallback_reason: null,
    modal_http_status: null,
    modal_error: null,
    modal_version: null,
    modal_stage_log: null,
    acreage: 0,
    bbox_width_m: 0,
    bbox_height_m: 0,
    dem_resolution_m: null,
    dem_source: null,
    dem_shape: null,
    raw_ridge_candidates: null,
    raw_saddle_candidates: null,
    post_filter_ridges_primary: 0,
    post_filter_ridges_secondary: 0,
    post_filter_saddles: 0,
    pipeline_steps: {} as Record<string, any>,
  };
  
  try {
    body = await request.json().catch(() => null) as RidgeRequest | null;
    const { parcel, parcel_id, bufferMeters = 400 } = (body ?? {}) as RidgeRequest;

    if (!parcel || !parcel.geometry) {
      return NextResponse.json({ success: false, error: 'Valid parcel GeoJSON required' }, { status: 400 });
    }
    if (!parcel_id) {
      return NextResponse.json({ success: false, error: 'parcel_id required' }, { status: 400 });
    }

    // Compute bbox metrics for debug
    const bm = computeBboxMetrics(parcel.geometry);
    terrainDebug.acreage = Math.round(bm.acreage);
    terrainDebug.bbox_width_m = Math.round(bm.widthM);
    terrainDebug.bbox_height_m = Math.round(bm.heightM);

    console.log('[RidgeSpines] Processing:', parcel_id, `~${Math.round(bm.acreage)}ac, ${Math.round(bm.widthM)}x${Math.round(bm.heightM)}m`);

    // ─── Step 1: Call Modal backend for real DEM-based ridges ───
    let useRealDEM = false;
    let ridgeData: RidgeSpineResponse | null = null;
    let modalRawData: any = null;

    terrainDebug.pipeline_steps.modal_call = 'attempted';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      
      const modalResponse = await fetch(RIDGE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenTopo-Key': process.env.OPENTOPOGRAPHY_API_KEY || '',
        },
        body: JSON.stringify({
          parcel,
          parcel_id,
          bufferMeters,
          options: {
            dem_source: 'SRTMGL1',
            min_prominence_ft: 8,
            min_length_m: 60,
            output_format: 'geojson',
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      terrainDebug.modal_http_status = modalResponse.status;

      if (modalResponse.ok) {
        modalRawData = await modalResponse.json();
        terrainDebug.modal_version = modalRawData.version || null;
        terrainDebug.modal_stage_log = modalRawData.metadata?.stage_log || null;
        terrainDebug.dem_source = modalRawData.metadata?.dem_source || null;
        terrainDebug.dem_resolution_m = modalRawData.metadata?.resolution_m || null;
        terrainDebug.dem_shape = modalRawData.metadata?.dem_shape || null;
        
        const primaryCount = modalRawData.ridges_primary?.features?.length || 0;
        const secondaryCount = modalRawData.ridges_secondary?.features?.length || 0;
        const saddleCount = modalRawData.saddle_nodes?.features?.length || 0;
        
        terrainDebug.post_filter_ridges_primary = primaryCount;
        terrainDebug.post_filter_ridges_secondary = secondaryCount;
        terrainDebug.post_filter_saddles = saddleCount;
        terrainDebug.pipeline_steps.modal_call = 'success';
        
        // Extract pipeline counts from stage_log if available
        if (modalRawData.metadata?.stage_log?.stages) {
          for (const stage of modalRawData.metadata.stage_log.stages) {
            if (stage.detail) {
              terrainDebug.pipeline_steps[stage.stage] = stage.detail;
            }
          }
        }
        
        if (primaryCount + secondaryCount > 0) {
          ridgeData = modalRawData as RidgeSpineResponse;
          useRealDEM = true;
          terrainDebug.terrain_source = 'modal_dem_real';
          console.log(`[RidgeSpines] REAL DEM: ${primaryCount}P + ${secondaryCount}S ridges, ${saddleCount} saddles`);
        } else {
          terrainDebug.terrain_source = 'synthetic_fallback';
          terrainDebug.fallback_used = true;
          terrainDebug.fallback_reason = `Modal returned 0 features (${modalRawData.metadata?.dem_source || 'unknown'} DEM loaded but no ridges passed filters)`;
          terrainDebug.pipeline_steps.modal_call = 'success_but_empty';
          console.log('[RidgeSpines] Modal returned 0 features → falling back to synthetic');
        }
      } else {
        const errorText = await modalResponse.text();
        terrainDebug.modal_error = errorText.slice(0, 500);
        terrainDebug.pipeline_steps.modal_call = `http_${modalResponse.status}`;
        terrainDebug.fallback_reason = `Modal HTTP ${modalResponse.status}: ${errorText.slice(0, 200)}`;
        console.log('[RidgeSpines] Modal error:', modalResponse.status, errorText.slice(0, 200));
      }
    } catch (modalErr) {
      const errMsg = modalErr instanceof Error ? modalErr.message : String(modalErr);
      terrainDebug.modal_error = errMsg;
      terrainDebug.pipeline_steps.modal_call = errMsg.includes('abort') ? 'timeout' : 'network_error';
      terrainDebug.fallback_reason = `Modal unreachable: ${errMsg.slice(0, 200)}`;
      console.log('[RidgeSpines] Modal call failed:', errMsg);
    }

    // ─── Step 2: Synthetic fallback (tagged as such) ───
    if (!ridgeData) {
      terrainDebug.terrain_source = 'synthetic_fallback';
      terrainDebug.fallback_used = true;
      if (!terrainDebug.fallback_reason) {
        terrainDebug.fallback_reason = 'Modal returned no usable data';
      }
      
      console.log('[RidgeSpines] Generating SYNTHETIC fallback (reason:', terrainDebug.fallback_reason, ')');
      ridgeData = generateSyntheticRidgeSpines(parcel);
      terrainDebug.pipeline_steps.synthetic_generation = 'used';
      terrainDebug.post_filter_ridges_primary = ridgeData.ridges_primary.features.length;
      terrainDebug.post_filter_ridges_secondary = ridgeData.ridges_secondary.features.length;
      terrainDebug.post_filter_saddles = ridgeData.saddle_nodes.features.length;
    }

    const processingTime = (Date.now() - startTime) / 1000;
    ridgeData.metadata.processing_time_seconds = processingTime;
    
    if (!useRealDEM) {
      ridgeData.metadata.fallback_reason = terrainDebug.fallback_reason;
    }

    console.log('[RidgeSpines] Complete:', {
      terrain_source: terrainDebug.terrain_source,
      primary: terrainDebug.post_filter_ridges_primary,
      secondary: terrainDebug.post_filter_ridges_secondary,
      saddles: terrainDebug.post_filter_saddles,
      acreage: terrainDebug.acreage,
      time: processingTime.toFixed(2) + 's',
    });

    return NextResponse.json({
      ...ridgeData,
      version: API_VERSION,
      request_id: `ridge_${Date.now().toString(36)}`,
      mode: useRealDEM ? 'real_dem' : 'synthetic',
      terrain_debug: terrainDebug,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[RidgeSpines] Error:', errMsg);
    
    return NextResponse.json({
      success: false,
      error: errMsg,
      version: API_VERSION,
      terrain_debug: { ...terrainDebug, fatal_error: errMsg },
    }, { status: 500 });
  }
}
