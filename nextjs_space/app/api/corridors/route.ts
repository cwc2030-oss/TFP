/**
 * POST /api/corridors - Travel Corridor V1 Analysis
 * 
 * Input: Parcel AOI (GeoJSON polygon), parcel_id
 * Process:
 *   1. Call Modal geoprocessor for DEM-based corridor computation
 *   2. Uses slope preference + concavity weighting
 *   3. Returns movement probability as image overlay
 * Output: Image URL + bbox metadata
 */

import { NextRequest, NextResponse } from 'next/server';
import { uploadToS3, getCorridorPath, fileExists, getFileUrl } from '@/lib/s3';
import { getBucketConfig } from '@/lib/aws-config';

const CORRIDOR_API_URL = process.env.CORRIDOR_API_URL || 
  'https://cwc2030--terrain-brain-v3-corridors-corridors-web.modal.run/v1/corridors';
const REQUEST_TIMEOUT_MS = 120000; // 120 seconds for corridor computation (includes DEM fetch)
const API_VERSION = 'v3.1-diag-2026-02-24';

interface CorridorRequest {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  parcel_id: string;
  state?: string;
  county?: string;
}

interface CorridorResponse {
  success: boolean;
  corridor_url?: string;
  corridor_png_base64?: string;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  metadata: {
    processing_time_seconds: number;
    dem_source: string;
    resolution_m: number;
    weights: {
      slope_preference: string;
      concavity_weight: number;
    };
    stage_log?: object;
    fallback_reason?: string | null;
  };
  error?: string;
  error_code?: string;
  error_message?: string;   // User-friendly error message
  last_stage?: string;      // Stage where processing failed
  request_id?: string;      // Unique request identifier
  version?: string;         // Service version
}

// User-friendly error messages for error codes from Modal
const ERROR_MESSAGES: Record<string, string> = {
  DEM_FETCH_TIMEOUT: 'Terrain data request timed out. Please try again in a moment.',
  DEM_FETCH_RATE_LIMIT: 'Terrain data service is busy. Please try again in a few minutes.',
  DEM_FETCH_ERROR: 'Unable to fetch terrain data. Please try again.',
  DEM_OPEN_FAIL: 'Terrain data was corrupted. Retrying should fix this.',
  CACHE_CORRUPT: 'Cached terrain data was invalid. Retrying should fix this.',
  AOI_TOO_LARGE: 'Selected area is too large. Please zoom in on a smaller parcel.',
  GEOMETRY_INVALID: 'Parcel boundary data is invalid. Please select a different parcel.',
  API_KEY_MISSING: 'Terrain service is not configured. Contact support.',
  COMPUTE_FAIL: 'Corridor analysis failed. Please try again.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json() as CorridorRequest;
    const { parcel, parcel_id, state = 'mo', county = 'johnson' } = body;

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

    // Check if corridor already computed (cache)
    const corridorPath = getCorridorPath(state, county, parcel_id);
    const exists = await fileExists(corridorPath);
    
    if (exists) {
      console.log('[Corridors] Cache hit:', corridorPath);
      const url = await getFileUrl(corridorPath, false);
      
      // Return cached result with approximate bbox from parcel
      const coords = parcel.geometry.type === 'Polygon'
        ? parcel.geometry.coordinates[0]
        : parcel.geometry.coordinates[0][0];
      const lngs = coords.map((c: number[]) => c[0]);
      const lats = coords.map((c: number[]) => c[1]);
      
      return NextResponse.json({
        success: true,
        corridor_url: url,
        bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
        metadata: {
          processing_time_seconds: 0,
          dem_source: 'USGS_3DEP (cached)',
          resolution_m: 10,
          weights: { slope_preference: 'moderate', concavity_weight: 0.4 },
        },
        cached: true,
        mode: 'cached',
        version: API_VERSION,
        request_id: `cache_${Date.now().toString(36)}`,
        error_code: null,
        error_message: null,
        last_stage: null,
      });
    }

    // Call Modal geoprocessor for corridor computation
    console.log('[Corridors] Computing for parcel:', parcel_id);
    console.log('[Corridors] Using Modal endpoint:', CORRIDOR_API_URL);
    
    try {
      const modalResponse = await fetch(CORRIDOR_API_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-OpenTopo-Key': process.env.OPENTOPOGRAPHY_API_KEY || '',
        },
        body: JSON.stringify({
          parcel,
          parcel_id,
          state,
          county,
          options: {
            dem_source: 'USGS3DEP1m',
            slope_preference: 'moderate', // 5-15 degrees preferred
            concavity_weight: 0.4,        // Higher = more weight to draws/swales
            output_format: 'geojson',     // GeoJSON for V1
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!modalResponse.ok) {
        const errorText = await modalResponse.text();
        const statusCode = modalResponse.status;
        console.error('[Corridors] Modal HTTP error:', statusCode, errorText);
        
        // Map HTTP status to error code
        let errorCode = 'DEM_FETCH_ERROR';
        if (statusCode === 429) errorCode = 'DEM_FETCH_RATE_LIMIT';
        else if (statusCode === 504 || statusCode === 408) errorCode = 'DEM_FETCH_TIMEOUT';
        
        // Fallback to synthetic only if Modal is truly down
        console.log('[Corridors] Falling back to synthetic due to HTTP', statusCode);
        return generateSyntheticCorridor(parcel, parcel_id, startTime, errorCode, undefined, 'http_error');
      }

      const result = await modalResponse.json();
      
      // Check if Modal returned success
      if (!result.success) {
        const errorCode = result.error_code || 'UNKNOWN_ERROR';
        const userMessage = ERROR_MESSAGES[errorCode] || result.error || 'Analysis failed';
        
        console.error('[Corridors] Modal returned error:', {
          error_code: errorCode,
          error: result.error,
          stage_log: result.metadata?.stage_log,
        });
        
        // For certain errors, we should NOT fall back to synthetic (user needs to take action)
        const noFallbackErrors = ['AOI_TOO_LARGE', 'GEOMETRY_INVALID', 'API_KEY_MISSING'];
        if (noFallbackErrors.includes(errorCode)) {
          return NextResponse.json({
            success: false,
            error: userMessage,
            error_code: errorCode,
            metadata: result.metadata,
          }, {
            status: errorCode === 'AOI_TOO_LARGE' ? 413 : 400,
            headers: {
              'X-Error-Code': errorCode,
            },
          });
        }
        
        // For transient errors, fall back to synthetic but include the error info
        console.log('[Corridors] Falling back to synthetic due to:', errorCode);
        return generateSyntheticCorridor(
          parcel, 
          parcel_id, 
          startTime, 
          errorCode, 
          result.request_id,
          result.last_stage
        );
      }
      
      // Update processing time to include network latency
      if (result.metadata) {
        result.metadata.processing_time_seconds = (Date.now() - startTime) / 1000;
      }

      console.log('[Corridors] Real DEM corridors computed:', {
        mode: result.mode,
        corridors: result.corridors?.features?.length || 0,
        dem_source: result.metadata?.dem_source,
        processing_time: result.metadata?.processing_time_seconds,
      });

      // Ensure diagnostic fields are present in response
      const enrichedResult = {
        ...result,
        version: result.version || API_VERSION,
        request_id: result.request_id || `modal_${Date.now().toString(36)}`,
        error_code: result.error_code || null,
        error_message: result.error_message || null,
        last_stage: result.last_stage || 'complete',
      };

      return NextResponse.json(enrichedResult, {
        headers: {
          'X-Processing-Time-Ms': String(Date.now() - startTime),
          'X-Corridor-Mode': result.mode || 'real',
          'X-API-Version': API_VERSION,
        },
      });
    } catch (fetchError) {
      const isTimeout = fetchError instanceof Error && fetchError.name === 'TimeoutError';
      const errorCode = isTimeout ? 'DEM_FETCH_TIMEOUT' : 'DEM_FETCH_ERROR';
      console.error('[Corridors] Fetch error:', errorCode, fetchError);
      
      // Fallback to synthetic on network errors
      return generateSyntheticCorridor(parcel, parcel_id, startTime, errorCode, undefined, 'fetch_error');
    }

  } catch (error) {
    console.error('[Corridors] Error:', error);

    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json(
        { success: false, error: 'Corridor computation timed out (90s)' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Corridor analysis failed' },
      { status: 500 }
    );
  }
}

/**
 * Generate synthetic corridor data for V1 demo
 * Uses parcel geometry to create a plausible movement probability surface
 */
function generateSyntheticCorridor(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  parcel_id: string,
  startTime: number,
  fallbackReason?: string,
  originalRequestId?: string,
  originalLastStage?: string
): NextResponse {
  const coords = parcel.geometry.type === 'Polygon'
    ? parcel.geometry.coordinates[0]
    : parcel.geometry.coordinates[0][0];
  
  const lngs = coords.map((c: number[]) => c[0]);
  const lats = coords.map((c: number[]) => c[1]);
  const bbox: [number, number, number, number] = [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];

  // Generate corridor lines as GeoJSON (simpler than raster for V1)
  const centerLng = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const corridorFeatures = generateCorridorLines(bbox, centerLng, centerLat);

  const reasonText = fallbackReason 
    ? `SYNTHETIC (fallback: ${fallbackReason})`
    : 'SYNTHETIC (Modal unavailable)';
  
  // Generate local request_id if none from Modal
  const requestId = originalRequestId || `local_${Date.now().toString(36)}`;

  return NextResponse.json({
    success: true,
    mode: 'synthetic',
    corridors: {
      type: 'FeatureCollection',
      features: corridorFeatures,
    },
    bbox,
    metadata: {
      processing_time_seconds: (Date.now() - startTime) / 1000,
      dem_source: reasonText,
      resolution_m: 0,
      weights: { slope_preference: 'moderate', concavity_weight: 0.4 },
      fallback_reason: fallbackReason || null,
    },
    // Diagnostic fields for UI
    request_id: requestId,
    version: `${API_VERSION}-synthetic`,
    error_code: fallbackReason || null,
    error_message: fallbackReason ? ERROR_MESSAGES[fallbackReason] || 'Falling back to synthetic data' : null,
    last_stage: originalLastStage || null,
  }, {
    headers: {
      'X-Corridor-Mode': 'synthetic',
      'X-Fallback-Reason': fallbackReason || 'modal_unavailable',
      'X-Request-Id': requestId,
      'X-API-Version': API_VERSION,
    },
  });
}

/**
 * Generate synthetic corridor lines within bbox
 */
function generateCorridorLines(
  bbox: [number, number, number, number],
  centerLng: number,
  centerLat: number
): GeoJSON.Feature[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const features: GeoJSON.Feature[] = [];

  // Create 3-5 corridor lines crossing the parcel
  const numCorridors = Math.floor(Math.random() * 3) + 3;
  
  for (let i = 0; i < numCorridors; i++) {
    const probability = 60 + Math.random() * 40; // 60-100
    
    // Random angle for corridor direction
    const angle = Math.random() * Math.PI;
    const halfWidth = (maxLng - minLng) / 2;
    const halfHeight = (maxLat - minLat) / 2;
    
    // Generate corridor line with some curvature
    const startLng = centerLng + halfWidth * 0.8 * Math.cos(angle);
    const startLat = centerLat + halfHeight * 0.8 * Math.sin(angle);
    const endLng = centerLng - halfWidth * 0.8 * Math.cos(angle);
    const endLat = centerLat - halfHeight * 0.8 * Math.sin(angle);
    
    // Add midpoint with offset for curvature
    const midLng = centerLng + (Math.random() - 0.5) * halfWidth * 0.3;
    const midLat = centerLat + (Math.random() - 0.5) * halfHeight * 0.3;

    features.push({
      type: 'Feature',
      properties: {
        corridor_id: `corr_${i + 1}`,
        probability: Math.round(probability),
        type: probability > 80 ? 'primary' : 'secondary',
        width_m: 20 + Math.random() * 30,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [startLng, startLat],
          [midLng, midLat],
          [endLng, endLat],
        ],
      },
    });
  }

  return features;
}

export async function GET() {
  return NextResponse.json({
    status: 'available',
    version: 'v1',
    description: 'Travel Corridor Analysis API',
    endpoints: {
      POST: {
        input: {
          parcel: 'GeoJSON Feature (Polygon)',
          parcel_id: 'string',
          state: 'string (default: mo)',
          county: 'string (default: johnson)',
        },
        output: {
          corridor_url: 'URL to corridor raster/image',
          corridors: 'GeoJSON FeatureCollection (fallback)',
          bbox: '[minLng, minLat, maxLng, maxLat]',
          metadata: 'Processing details',
        },
      },
    },
  });
}
