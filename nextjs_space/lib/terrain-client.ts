/**
 * Shared terrain analysis client
 * Used by both /core and /intel pages
 */

import type { TerrainAnalysisResponse, SeasonProfile, WindDirection } from '@/types/terrain';

export interface TerrainRequestParams {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  seasonProfile: SeasonProfile;
  prevailingWinds: WindDirection[];
  bufferMeters?: number;
}

export interface TerrainFetchResult {
  success: boolean;
  data?: TerrainAnalysisResponse;
  error?: string;
  status?: number;
  durationMs: number;
}

export interface FetchProgressCallback {
  (step: string, progress: number): void;
}

// Default timeout: 45 seconds - fail fast for better UX
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Fetch terrain analysis from /api/terrain-analysis
 * Shared by /core and /intel pages
 */
export async function fetchTerrainAnalysis(
  params: TerrainRequestParams,
  onProgress?: FetchProgressCallback,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<TerrainFetchResult> {
  const startTime = Date.now();
  const apiUrl = '/api/terrain-analysis';
  
  const requestBody = {
    parcel: params.parcel,
    seasonProfile: params.seasonProfile,
    prevailingWinds: params.prevailingWinds,
    bufferMeters: params.bufferMeters ?? 800,
  };

  console.error('[TerrainClient] === FETCH START ===' );
  console.error('[TerrainClient] URL:', apiUrl);
  console.error('[TerrainClient] Timeout:', timeoutMs, 'ms');
  console.error('[TerrainClient] Season:', params.seasonProfile, 'Wind:', params.prevailingWinds);
  console.error('[TerrainClient] Parcel type:', params.parcel.geometry.type);
  
  onProgress?.('Connecting to terrain server...', 15);

  // Progress ticker for shorter timeout (45s total)
  let progressTick = 15;
  const progressMessages = [
    { at: 2000, msg: 'Initializing terrain engine...', prog: 20 },
    { at: 5000, msg: 'Processing elevation data...', prog: 30 },
    { at: 10000, msg: 'Computing deer corridors...', prog: 45 },
    { at: 18000, msg: 'Analyzing terrain features...', prog: 55 },
    { at: 28000, msg: 'Finalizing analysis...', prog: 65 },
    { at: 38000, msg: 'Almost complete...', prog: 70 },
  ];
  
  console.error('[TerrainClient] Starting progress ticker (timeout: ' + timeoutMs + 'ms)');
  const progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const nextMsg = progressMessages.find(p => p.at <= elapsed && p.prog > progressTick);
    if (nextMsg) {
      progressTick = nextMsg.prog;
      console.error(`[TerrainClient] Progress: ${nextMsg.msg} (${nextMsg.prog}%) at ${elapsed}ms`);
      onProgress?.(nextMsg.msg, nextMsg.prog);
    }
  }, 1000); // Check every second

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.error('[TerrainClient] Request timed out after', timeoutMs, 'ms');
    }, timeoutMs);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearInterval(progressInterval);
    clearTimeout(timeoutId);
    const fetchDuration = Date.now() - startTime;
    
    console.error('[TerrainClient] Response received in', fetchDuration, 'ms');
    console.error('[TerrainClient] Status:', response.status, response.statusText);
    
    onProgress?.(`Processing response...`, 70);

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorBody = await response.text();
        console.error('[TerrainClient] Error body:', errorBody.slice(0, 500));
        // Try to parse as JSON for structured error
        try {
          const parsed = JSON.parse(errorBody);
          errorMsg = parsed.message || parsed.error || errorMsg;
        } catch {
          errorMsg = errorBody.slice(0, 200) || errorMsg;
        }
      } catch {
        // Ignore read errors
      }
      
      return {
        success: false,
        error: errorMsg,
        status: response.status,
        durationMs: fetchDuration,
      };
    }

    onProgress?.('Parsing response...', 70);
    
    const data = await response.json() as TerrainAnalysisResponse;
    const totalDuration = Date.now() - startTime;
    
    console.error('[TerrainClient] === FETCH COMPLETE ===' );
    console.error('[TerrainClient] Total duration:', totalDuration, 'ms');
    console.error('[TerrainClient] Mode:', data.mode);
    console.error('[TerrainClient] Layers:', {
      bedding: data.layers?.beddingPolygons?.features?.length || 0,
      funnels: data.layers?.funnels?.features?.length || 0,
      stands: data.layers?.standPoints?.features?.length || 0,
    });

    onProgress?.('Analysis complete', 100);
    
    return {
      success: true,
      data,
      status: response.status,
      durationMs: totalDuration,
    };

  } catch (err) {
    clearInterval(progressInterval);
    const duration = Date.now() - startTime;
    
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[TerrainClient] Request aborted (timeout)');
      onProgress?.('Request timed out - server may be cold-starting', 0);
      return {
        success: false,
        error: `Request timed out after ${Math.round(timeoutMs / 1000)}s. The terrain server may be cold-starting. Please try again in 30 seconds.`,
        durationMs: duration,
      };
    }
    
    console.error('[TerrainClient] Fetch error:', err);
    onProgress?.('Connection error', 0);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
      durationMs: duration,
    };
  }
}

/**
 * Fetch parcel boundary from Regrid API
 */
export async function fetchParcelGeometry(
  lat: number,
  lng: number
): Promise<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null> {
  console.error('[TerrainClient] Fetching parcel boundary for:', lat, lng);
  
  // 15-second timeout for parcel fetch to prevent indefinite hang
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    console.error('[TerrainClient] Parcel fetch timed out after 15s');
  }, 15_000);

  try {
    const response = await fetch(`/api/parcels?lat=${lat}&lng=${lng}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('[TerrainClient] Parcel fetch failed:', response.status);
      return null;
    }

    const result = await response.json();
    const data = result.parcels?.[0];
    
    if (!data || !data.coordinates || !data.geometryType) {
      console.error('[TerrainClient] No parcel data in response');
      return null;
    }

    console.error('[TerrainClient] Got parcel:', data.parcelId, data.acreage, 'acres');
    
    return {
      type: 'Feature',
      properties: {
        parcelId: data.parcelId,
        owner: data.owner,
        acreage: data.acreage,
        address: data.siteAddress,
      },
      geometry: {
        type: data.geometryType as 'Polygon' | 'MultiPolygon',
        coordinates: data.coordinates,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[TerrainClient] Parcel fetch aborted (timeout)');
    } else {
      console.error('[TerrainClient] Parcel fetch error:', err);
    }
    return null;
  }
}

/**
 * Generate synthetic square parcel from center point and acreage
 */
export function generateSyntheticParcel(
  lat: number,
  lng: number,
  acreage: number
): GeoJSON.Feature<GeoJSON.Polygon> {
  const sqMeters = acreage * 4046.86;
  const side = Math.sqrt(sqMeters);
  const halfSide = side / 2;

  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos(lat * Math.PI / 180);

  const latOffset = halfSide / metersPerDegLat;
  const lngOffset = halfSide / metersPerDegLng;

  return {
    type: 'Feature',
    properties: { acreage, synthetic: true },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - lngOffset, lat - latOffset],
        [lng + lngOffset, lat - latOffset],
        [lng + lngOffset, lat + latOffset],
        [lng - lngOffset, lat + latOffset],
        [lng - lngOffset, lat - latOffset],
      ]],
    },
  };
}
