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

// Default timeout: 120 seconds for Modal cold starts
const DEFAULT_TIMEOUT_MS = 120_000;

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

  console.log('[TerrainClient] === FETCH START ===' );
  console.log('[TerrainClient] URL:', apiUrl);
  console.log('[TerrainClient] Timeout:', timeoutMs, 'ms');
  console.log('[TerrainClient] Season:', params.seasonProfile, 'Wind:', params.prevailingWinds);
  console.log('[TerrainClient] Parcel type:', params.parcel.geometry.type);
  
  onProgress?.('Connecting to terrain server...', 15);

  // Progress ticker for long-running requests (Modal cold starts)
  let progressTick = 15;
  const progressMessages = [
    { at: 5000, msg: 'Initializing terrain engine...', prog: 20 },
    { at: 15000, msg: 'Processing elevation data...', prog: 30 },
    { at: 30000, msg: 'Computing deer corridors...', prog: 40 },
    { at: 45000, msg: 'Analyzing terrain features...', prog: 50 },
    { at: 60000, msg: 'Still processing (server warming up)...', prog: 55 },
    { at: 75000, msg: 'Almost there...', prog: 60 },
    { at: 90000, msg: 'Finalizing analysis...', prog: 65 },
    { at: 105000, msg: 'Server is responding slowly...', prog: 68 },
  ];
  
  const progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const nextMsg = progressMessages.find(p => p.at <= elapsed && p.prog > progressTick);
    if (nextMsg) {
      progressTick = nextMsg.prog;
      onProgress?.(nextMsg.msg, nextMsg.prog);
      console.log(`[TerrainClient] Progress: ${nextMsg.msg} (${elapsed}ms)`);
    }
  }, 2000);

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
    
    console.log('[TerrainClient] Response received in', fetchDuration, 'ms');
    console.log('[TerrainClient] Status:', response.status, response.statusText);
    
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
    
    console.log('[TerrainClient] === FETCH COMPLETE ===' );
    console.log('[TerrainClient] Total duration:', totalDuration, 'ms');
    console.log('[TerrainClient] Mode:', data.mode);
    console.log('[TerrainClient] Layers:', {
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
  console.log('[TerrainClient] Fetching parcel boundary for:', lat, lng);
  
  try {
    const response = await fetch(`/api/parcels?lat=${lat}&lng=${lng}`);
    if (!response.ok) {
      console.warn('[TerrainClient] Parcel fetch failed:', response.status);
      return null;
    }

    const result = await response.json();
    const data = result.parcels?.[0];
    
    if (!data || !data.coordinates || !data.geometryType) {
      console.warn('[TerrainClient] No parcel data in response');
      return null;
    }

    console.log('[TerrainClient] Got parcel:', data.parcelId, data.acreage, 'acres');
    
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
    console.error('[TerrainClient] Parcel fetch error:', err);
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
