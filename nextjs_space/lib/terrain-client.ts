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
  /**
   * v6.3 leak-fix: optional external abort signal. When the hunter roams to a
   * new parcel the caller aborts this signal so an abandoned analysis (and its
   * 10s-delay cold-start retry loop) is torn down instead of piling up on the
   * shared backend — the pileup was what surfaced "warming up" after ~5 visits.
   */
  signal?: AbortSignal;
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

  console.log('[TerrainClient] === FETCH START ===' );
  console.log('[TerrainClient] URL:', apiUrl);
  console.log('[TerrainClient] Timeout:', timeoutMs, 'ms');
  console.log('[TerrainClient] Season:', params.seasonProfile, 'Wind:', params.prevailingWinds);
  console.log('[TerrainClient] Parcel type:', params.parcel.geometry.type);
  
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
  
  console.log('[TerrainClient] Starting progress ticker (timeout: ' + timeoutMs + 'ms)');
  const progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const nextMsg = progressMessages.find(p => p.at <= elapsed && p.prog > progressTick);
    if (nextMsg) {
      progressTick = nextMsg.prog;
      console.log(`[TerrainClient] Progress: ${nextMsg.msg} (${nextMsg.prog}%) at ${elapsed}ms`);
      onProgress?.(nextMsg.msg, nextMsg.prog);
    }
  }, 1000); // Check every second

  // ── Retry-aware fetch with 502/HTML cold-start handling ──
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 10_000;

  // v6.3 leak-fix: if the caller already moved on before we even started, bail.
  if (params.signal?.aborted) {
    clearInterval(progressInterval);
    return { success: false, error: 'aborted', durationMs: Date.now() - startTime };
  }

  // v6.3 leak-fix: an abortable sleep so the 10s retry delay is cut short the
  // moment the caller aborts (roam) instead of blocking a dead request.
  const abortableDelay = (ms: number) => new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    params.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // v6.3 leak-fix: stop retrying the instant the caller aborts (roam).
    if (params.signal?.aborted) {
      clearInterval(progressInterval);
      return { success: false, error: 'aborted', durationMs: Date.now() - startTime };
    }
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.log('[TerrainClient] Request timed out after', timeoutMs, 'ms (attempt', attempt + ')');
      }, timeoutMs);

      // v6.3 leak-fix: bridge external roam-abort into this attempt's controller.
      if (params.signal) {
        if (params.signal.aborted) {
          controller.abort();
        } else {
          params.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const fetchDuration = Date.now() - startTime;

      console.log('[TerrainClient] Response received in', fetchDuration, 'ms (attempt', attempt + ')');
      console.log('[TerrainClient] Status:', response.status, response.statusText);

      // ── 502 / HTML cold-start detection ──
      // Modal returns an HTML error page instead of JSON during cold starts.
      // Detect this and retry automatically instead of surfacing garbage to the user.
      const contentType = response.headers.get('content-type') || '';
      const is502 = response.status === 502;
      const isHtmlError = !response.ok && contentType.includes('text/html');

      if (is502 || isHtmlError) {
        let errorBody = '';
        try { errorBody = await response.text(); } catch { /* ignore */ }
        console.log(`[TerrainClient] Cold-start error (attempt ${attempt}/${MAX_RETRIES}):`, response.status, errorBody.slice(0, 300));

        if (attempt < MAX_RETRIES) {
          onProgress?.('Terrain servers warming up — retrying automatically...', Math.min(progressTick, 30));
          console.log(`[TerrainClient] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue; // retry
        }

        // Final attempt exhausted
        clearInterval(progressInterval);
        return {
          success: false,
          error: 'Terrain server is warming up. Please wait 30 seconds and try again.',
          status: response.status,
          durationMs: fetchDuration,
          coldStart: true,
        } as TerrainFetchResult & { coldStart?: boolean };
      }

      onProgress?.(`Processing response...`, 70);

      if (!response.ok) {
        clearInterval(progressInterval);
        let errorMsg = `HTTP ${response.status}`;
        try {
          const errorBody = await response.text();
          console.log('[TerrainClient] Error body:', errorBody.slice(0, 500));
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

      clearInterval(progressInterval);
      onProgress?.('Parsing response...', 70);

      const data = await response.json() as TerrainAnalysisResponse;
      const totalDuration = Date.now() - startTime;

      console.log('[TerrainClient] === FETCH COMPLETE ===' );
      console.log('[TerrainClient] Total duration:', totalDuration, 'ms');
      console.log('[TerrainClient] Mode:', data.meta?.mode);
      console.log('[TerrainClient] Huntability:', data.huntabilityScore);
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
      const duration = Date.now() - startTime;

      if (err instanceof Error && err.name === 'AbortError') {
        // v6.3 leak-fix: distinguish a roam-abort from a timeout — a roam-abort
        // must NOT retry (the hunter is gone); return immediately.
        if (params.signal?.aborted) {
          clearInterval(progressInterval);
          console.log('[TerrainClient] Request aborted (caller roamed) attempt', attempt);
          return { success: false, error: 'aborted', durationMs: duration };
        }
        console.log('[TerrainClient] Request aborted (timeout) attempt', attempt);
        // Timeouts on earlier attempts get retried too
        if (attempt < MAX_RETRIES) {
          onProgress?.('Terrain servers warming up — retrying automatically...', Math.min(progressTick, 30));
          console.log(`[TerrainClient] Retrying after timeout in ${RETRY_DELAY_MS / 1000}s...`);
          await abortableDelay(RETRY_DELAY_MS);
          continue;
        }
        clearInterval(progressInterval);
        onProgress?.('Request timed out - server may be cold-starting', 0);
        return {
          success: false,
          error: `Request timed out after ${Math.round(timeoutMs / 1000)}s. The terrain server may be cold-starting. Please try again in 30 seconds.`,
          durationMs: duration,
        };
      }

      // v6.3 leak-fix: bail on roam-abort before any retry.
      if (params.signal?.aborted) {
        clearInterval(progressInterval);
        return { success: false, error: 'aborted', durationMs: duration };
      }
      // Network errors on earlier attempts get retried
      if (attempt < MAX_RETRIES) {
        console.log(`[TerrainClient] Network error (attempt ${attempt}), retrying in ${RETRY_DELAY_MS / 1000}s:`, err);
        onProgress?.('Terrain servers warming up — retrying automatically...', Math.min(progressTick, 30));
        await abortableDelay(RETRY_DELAY_MS);
        continue;
      }

      clearInterval(progressInterval);
      console.log('[TerrainClient] Fetch error (final attempt):', err);
      onProgress?.('Connection error', 0);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network error',
        durationMs: duration,
      };
    }
  }

  // Should never reach here, but safety net
  clearInterval(progressInterval);
  return {
    success: false,
    error: 'Analysis failed after retries',
    durationMs: Date.now() - startTime,
  };
}

/**
 * Client-side session cache for parcel geometry.
 * Key = rounded "lat,lng" (6 decimals). Survives within a single browser session,
 * preventing duplicate Regrid lookups when the same parcel is viewed multiple times
 * (e.g., Intel re-analyze, back-nav, page re-render).
 */
const parcelSessionCache = new Map<string, GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>();
function sessionCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/**
 * Fetch parcel boundary — uses the lightweight /api/parcels/lookup endpoint
 * (backed by the same 30-day DB cache) instead of the heavier /api/parcels.
 * Also checks a client-side session map to avoid hitting the server at all
 * for parcels already loaded this browser session.
 */
export async function fetchParcelGeometry(
  lat: number,
  lng: number
): Promise<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null> {
  // ── Session cache check ──
  const cKey = sessionCacheKey(lat, lng);
  const cached = parcelSessionCache.get(cKey);
  if (cached) {
    console.log('[TerrainClient] SESSION-CACHE HIT for:', lat, lng);
    return cached;
  }

  console.log('[TerrainClient] Fetching parcel boundary for:', lat, lng);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    console.log('[TerrainClient] Parcel fetch timed out after 15s');
  }, 15_000);

  try {
    // Use /api/parcels/lookup — lighter endpoint, same DB-backed cache
    const response = await fetch(`/api/parcels/lookup?lat=${lat}&lng=${lng}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log('[TerrainClient] Parcel fetch failed:', response.status);
      return null;
    }

    const result = await response.json();
    
    if (!result.found || !result.parcel) {
      console.log('[TerrainClient] No parcel data in response');
      return null;
    }

    const data = result.parcel;
    console.log('[TerrainClient] Got parcel:', data.parcelId, data.acreage, 'acres');
    
    const feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
      type: 'Feature',
      properties: {
        parcelId: data.parcelId,
        owner: data.owner,
        acreage: data.acreage,
        address: data.address,
      },
      geometry: {
        type: data.geometryType as 'Polygon' | 'MultiPolygon',
        coordinates: data.coordinates,
      },
    };

    // Store in session cache
    parcelSessionCache.set(cKey, feature);

    return feature;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      console.log('[TerrainClient] Parcel fetch aborted (timeout)');
    } else {
      console.log('[TerrainClient] Parcel fetch error:', err);
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
