/**
 * POST /api/ridge-spines - Ridge Spine Extraction (DEM-Only Structure Layer)
 * 
 * Input: Parcel AOI (GeoJSON polygon), parcel_id
 * Process:
 *   1. Call Modal geoprocessor for DEM-based ridge extraction
 *   2. Compute slope, curvature, local prominence
 *   3. Identify convex high-ground lines (ridges)
 *   4. Filter by prominence (>20ft) and length (>200m)
 *   5. Classify into primary/secondary ridges
 *   6. Extract saddle nodes
 * Output: Ridge spine FeatureCollections + metadata
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateSyntheticRidgeSpines } from '@/lib/ridge-extraction';
import type { RidgeSpineResponse } from '@/types/terrain';

// Modal endpoint for DEM ridge extraction (placeholder - not yet implemented on backend)
const RIDGE_API_URL = process.env.RIDGE_API_URL || 
  'https://cwc2030--terrain-brain-v3-ridges-ridges-web.modal.run/v1/ridges';
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const API_VERSION = 'v1.0-ridge-2026-03-03';

interface RidgeRequest {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  parcel_id: string;
  bufferMeters?: number;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let body: RidgeRequest | null = null;
  
  try {
    body = await request.json().catch(() => null) as RidgeRequest | null;
    const { parcel, parcel_id, bufferMeters = 400 } = (body ?? {}) as RidgeRequest;

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

    console.log('[RidgeSpines] Processing for parcel:', parcel_id);

    // Try calling Modal backend for real DEM-based ridge extraction
    let useRealDEM = false;
    let ridgeData: RidgeSpineResponse | null = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      console.log('[RidgeSpines] Attempting Modal endpoint:', RIDGE_API_URL);
      
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

      if (modalResponse.ok) {
        const modalData = await modalResponse.json() as RidgeSpineResponse;
        const totalFeatures = 
          (modalData.ridges_primary?.features?.length || 0) +
          (modalData.ridges_secondary?.features?.length || 0);
        
        if (totalFeatures > 0) {
          ridgeData = modalData;
          useRealDEM = true;
          console.log(`[RidgeSpines] Got real DEM data from Modal: ${totalFeatures} ridge features`);
        } else {
          console.log('[RidgeSpines] Modal returned 0 ridge features, falling back to synthetic');
        }
      } else {
        const errorText = await modalResponse.text();
        console.log('[RidgeSpines] Modal returned error, falling back to synthetic:', errorText);
      }
    } catch (modalErr) {
      const errMsg = modalErr instanceof Error ? modalErr.message : String(modalErr);
      console.log('[RidgeSpines] Modal call failed, using synthetic:', errMsg);
    }

    // Fall back to synthetic generation if Modal not available
    if (!ridgeData) {
      console.log('[RidgeSpines] Generating synthetic ridge spines');
      ridgeData = generateSyntheticRidgeSpines(parcel);
    }

    const processingTime = (Date.now() - startTime) / 1000;
    
    // Update metadata with actual processing time
    ridgeData.metadata.processing_time_seconds = processingTime;
    if (!useRealDEM) {
      ridgeData.metadata.fallback_reason = 'Real DEM ridge extraction not yet available - using geometry-based synthetic generation';
    }

    console.log('[RidgeSpines] Complete:', {
      mode: useRealDEM ? 'real_dem' : 'synthetic',
      primary: ridgeData.ridges_primary.features.length,
      secondary: ridgeData.ridges_secondary.features.length,
      saddles: ridgeData.saddle_nodes.features.length,
      processingTime: processingTime.toFixed(2) + 's',
    });

    return NextResponse.json({
      ...ridgeData,
      version: API_VERSION,
      request_id: `ridge_${Date.now().toString(36)}`,
      mode: useRealDEM ? 'real_dem' : 'synthetic',
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[RidgeSpines] Error:', errMsg);
    
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
