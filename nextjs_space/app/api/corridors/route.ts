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
  };
  error?: string;
}

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
        console.error('[Corridors] Modal error:', modalResponse.status, errorText);
        
        // Fallback to synthetic only if Modal is truly down
        console.log('[Corridors] Falling back to synthetic corridors');
        return generateSyntheticCorridor(parcel, parcel_id, startTime);
      }

      const result = await modalResponse.json();
      
      // Check if Modal returned success
      if (!result.success) {
        console.error('[Corridors] Modal returned error:', result.error);
        return generateSyntheticCorridor(parcel, parcel_id, startTime);
      }
      
      // Update processing time to include network latency
      if (result.metadata) {
        result.metadata.processing_time_seconds = (Date.now() - startTime) / 1000;
      }

      console.log('[Corridors] Real DEM corridors computed:', {
        mode: result.mode,
        corridors: result.corridors?.features?.length || 0,
        dem_source: result.metadata?.dem_source,
      });

      return NextResponse.json(result, {
        headers: {
          'X-Processing-Time-Ms': String(Date.now() - startTime),
          'X-Corridor-Mode': result.mode || 'real',
        },
      });
    } catch (fetchError) {
      console.error('[Corridors] Fetch error:', fetchError);
      
      // Fallback to synthetic on network errors
      return generateSyntheticCorridor(parcel, parcel_id, startTime);
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
  startTime: number
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
      dem_source: 'SYNTHETIC (Modal unavailable)',
      resolution_m: 0,
      weights: { slope_preference: 'moderate', concavity_weight: 0.4 },
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
