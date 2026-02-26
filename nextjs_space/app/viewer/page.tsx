/**
 * /viewer - Leaflet-based 2D map viewer with terrain overlays
 * No WebGL, no Deck.gl, no 3D - pure Leaflet with MapTiler hybrid basemap
 */
'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { AlertTriangle, Layers, X, Target, ChevronRight, Activity, CheckCircle2, MapPin, Crosshair, Route, Scan, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchTerrainAnalysis, fetchParcelGeometry, generateSyntheticParcel } from '@/lib/terrain-client';
import type { TerrainAnalysisResponse, TerrainLayers } from '@/types/terrain';
import type { ActiveParcelInfo } from '@/components/viewer/leaflet-map';

// Compute state types
type ComputeState = 'idle' | 'processing' | 'computed' | 'error' | 'fallback';

interface ComputeStatusItem {
  state: ComputeState;
  timestamp?: string;
  request_id?: string;
  error_code?: string | null;
  error_message?: string | null;
  last_stage?: string | null;
  mode?: string;  // 'real', 'synthetic', 'cached'
}

// Client-side timeout for corridor requests (45 seconds)
const CORRIDOR_CLIENT_TIMEOUT_MS = 45000;

interface ComputeStatus {
  terrain: ComputeStatusItem;
  corridors: ComputeStatusItem;
}

interface CorridorData {
  corridors?: GeoJSON.FeatureCollection;
  corridor_url?: string;
  bbox: [number, number, number, number];
  mode?: string;
  metadata?: {
    processing_time_seconds?: number;
    dem_source?: string;
    resolution_m?: number;
    weights?: {
      slope_preference?: string;
      concavity_weight?: number;
    };
    corridors_found?: number;
    timestamp?: string;
    fallback_reason?: string | null;
  };
  // Diagnostic fields
  request_id?: string;
  version?: string;
  error_code?: string | null;
  error_message?: string | null;
  last_stage?: string | null;
}

// Dynamic import for Leaflet components (avoid SSR issues)
const LeafletMap = dynamic(() => import('@/components/viewer/leaflet-map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent mx-auto mb-4" />
        <p className="text-slate-300">Loading map...</p>
      </div>
    </div>
  ),
});

// Spatial corridor data type (from Supabase)
interface SpatialCorridorData {
  parcelId: string;
  corridors: GeoJSON.FeatureCollection;
  count: number;
}

function ViewerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession() || {};
  const isAuthenticated = sessionStatus === 'authenticated';
  
  // URL params
  const lat = parseFloat(searchParams.get('lat') || '38.5');
  const lng = parseFloat(searchParams.get('lng') || '-92.5');
  const address = searchParams.get('address') || 'Unknown Location';
  const spatialParcelId = searchParams.get('spatialParcelId') || null; // UUID from Supabase
  
  // State
  const [parcel, setParcel] = useState<GeoJSON.Feature | null>(null);
  const [layers, setLayers] = useState<TerrainLayers | null>(null);
  const [provenance, setProvenance] = useState<TerrainAnalysisResponse['provenance'] | null>(null);
  const [corridorData, setCorridorData] = useState<CorridorData | null>(null);
  const [corridorLoading, setCorridorLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  
  // Spatial corridors (from Supabase)
  const [spatialCorridors, setSpatialCorridors] = useState<SpatialCorridorData | null>(null);
  const [spatialCorridorsLoading, setSpatialCorridorsLoading] = useState(false);
  const [spatialCorridorsAuthRequired, setSpatialCorridorsAuthRequired] = useState(false);
  
  // Effective center (from URL or spatial parcel centroid)
  const [effectiveCenter, setEffectiveCenter] = useState<[number, number]>([lat, lng]);
  
  // Layer visibility
  const [layerVisibility, setLayerVisibility] = useState({
    parcel: true,
    bedding: true,
    funnels: true,
    saddles: true,
    stands: true,
    corridors: false, // Off by default, user toggles on
    spatialCorridors: true, // Supabase corridors ON by default when available
  });
  const [showLegend, setShowLegend] = useState(true);
  const [showSystemPanel, setShowSystemPanel] = useState(true);
  
  // Active parcel (selected for analysis)
  const [activeParcel, setActiveParcel] = useState<ActiveParcelInfo | null>(null);
  
  // Compute status tracking
  const [computeStatus, setComputeStatus] = useState<ComputeStatus>({
    terrain: { state: 'idle' },
    corridors: { state: 'idle' },
  });
  
  // Debug log for on-screen display (no devtools needed)
  const [debugLog, setDebugLog] = useState<string[]>([]);
  
  // Loading progress state for tracking
  const [loadingProgress, setLoadingProgress] = useState<{ step: string; percent: number }>({ step: 'idle', percent: 0 });

  // Fetch parcel and terrain data (Regrid flow for non-spatial parcels)
  const loadData = useCallback(async () => {
    console.log('[Viewer:loadData] ▶️ START (0%)');
    setLoadingProgress({ step: 'init', percent: 0 });
    setIsLoading(true);
    setError(null);
    setOverlayError(null);
    
    // Set terrain compute state to processing
    setComputeStatus(prev => ({
      ...prev,
      terrain: { state: 'processing' }
    }));

    try {
      // Step 1: Get parcel geometry (10%)
      console.log('[Viewer:loadData] 📍 Fetching parcel geometry... (10%)');
      setLoadingProgress({ step: 'fetching_parcel', percent: 10 });
      
      let parcelFeature = await fetchParcelGeometry(lat, lng);
      
      console.log('[Viewer:loadData] 📍 Parcel geometry received (25%)');
      setLoadingProgress({ step: 'parcel_received', percent: 25 });
      
      if (!parcelFeature) {
        // Use synthetic parcel as fallback
        parcelFeature = generateSyntheticParcel(lat, lng, 80);
        console.log('[Viewer:loadData] ⚠️ Using synthetic parcel (30%)');
        setLoadingProgress({ step: 'synthetic_parcel', percent: 30 });
      }
      
      setParcel(parcelFeature);
      console.log('[Viewer:loadData] ✅ Parcel set in state (35%)');
      setLoadingProgress({ step: 'parcel_set', percent: 35 });

      // Step 2: Fetch terrain analysis (36% - this is where it might hang)
      console.log('[Viewer:loadData] 🏔️ Fetching terrain analysis... (36%)');
      setLoadingProgress({ step: 'fetching_terrain', percent: 36 });
      
      const result = await fetchTerrainAnalysis(
        {
          parcel: parcelFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
          seasonProfile: 'rut',
          prevailingWinds: ['NW', 'N'],
          bufferMeters: 800,
        },
        undefined, // No progress callback
        120000
      );
      
      console.log('[Viewer:loadData] 🏔️ Terrain analysis response received (80%)');
      setLoadingProgress({ step: 'terrain_received', percent: 80 });

      if (result.success && result.data) {
        setLayers(result.data.layers);
        setProvenance(result.data.provenance);
        setComputeStatus(prev => ({
          ...prev,
          terrain: { state: 'computed', timestamp: new Date().toISOString() }
        }));
        console.log('[Viewer:loadData] ✅ Terrain data loaded (100%):', {
          bedding: result.data.layers.beddingPolygons?.features?.length || 0,
          funnels: result.data.layers.funnels?.features?.length || 0,
          stands: result.data.layers.standPoints?.features?.length || 0,
        });
        setLoadingProgress({ step: 'complete', percent: 100 });
      } else {
        // Non-fatal: viewer still loads, just show banner
        setOverlayError(result.error || 'Could not load terrain overlays');
        setComputeStatus(prev => ({
          ...prev,
          terrain: { state: 'error' }
        }));
        console.warn('[Viewer:loadData] ⚠️ Overlay fetch failed (100% with error):', result.error);
        setLoadingProgress({ step: 'error_terrain', percent: 100 });
      }
    } catch (err) {
      console.error('[Viewer:loadData] ❌ Load error:', err);
      setOverlayError(err instanceof Error ? err.message : 'Failed to load overlays');
      setComputeStatus(prev => ({
        ...prev,
        terrain: { state: 'error' }
      }));
      setLoadingProgress({ step: 'error_exception', percent: 100 });
    } finally {
      console.log('[Viewer:loadData] 🏁 FINALLY - clearing isLoading');
      setIsLoading(false);
    }
  }, [lat, lng]);

  // Load Regrid data only when NOT loading from spatial parcel
  useEffect(() => {
    console.log('[Viewer:useEffect:loadData] Triggered - spatialParcelId:', spatialParcelId);
    if (!spatialParcelId) {
      console.log('[Viewer:useEffect:loadData] ▶️ No spatialParcelId, calling loadData()');
      loadData();
    } else {
      console.log('[Viewer:useEffect:loadData] ⏭️ spatialParcelId present, skipping loadData()');
    }
  }, [loadData, spatialParcelId]);

  // Load spatial parcel from Supabase (parcel only, no auth required)
  const loadSpatialParcel = useCallback(async () => {
    if (!spatialParcelId) {
      console.log('[Viewer:loadSpatialParcel] ⏭️ No spatialParcelId, skipping');
      return;
    }
    
    console.log('[Viewer:loadSpatialParcel] ▶️ START (0%) - parcelId:', spatialParcelId);
    setLoadingProgress({ step: 'spatial_init', percent: 0 });
    setIsLoading(true);
    
    try {
      // Fetch parcel from Supabase (public access)
      console.log('[Viewer:loadSpatialParcel] 📡 Fetching from API... (20%)');
      setLoadingProgress({ step: 'spatial_fetching', percent: 20 });
      
      const parcelRes = await fetch(`/api/spatial/parcels/${spatialParcelId}`);
      
      console.log('[Viewer:loadSpatialParcel] 📡 Response received (36%) - status:', parcelRes.status);
      setLoadingProgress({ step: 'spatial_response', percent: 36 });
      
      if (parcelRes.ok) {
        console.log('[Viewer:loadSpatialParcel] ✅ Response OK, parsing JSON... (50%)');
        setLoadingProgress({ step: 'spatial_parsing', percent: 50 });
        
        const { parcel: spatialParcel, centroid } = await parcelRes.json();
        
        console.log('[Viewer:loadSpatialParcel] 📦 JSON parsed (70%) - has parcel:', !!spatialParcel);
        setLoadingProgress({ step: 'spatial_parsed', percent: 70 });
        
        if (spatialParcel) {
          setParcel(spatialParcel);
          console.log('[Viewer:loadSpatialParcel] ✅ Parcel set in state (90%)');
          setLoadingProgress({ step: 'spatial_parcel_set', percent: 90 });
          
          // Update center to parcel centroid
          if (centroid) {
            setEffectiveCenter([centroid.lat, centroid.lng]);
            console.log('[Viewer:loadSpatialParcel] 📍 Center updated (95%):', centroid);
            setLoadingProgress({ step: 'spatial_centered', percent: 95 });
          }
          
          console.log('[Viewer:loadSpatialParcel] ✅ COMPLETE (100%)');
          setLoadingProgress({ step: 'spatial_complete', percent: 100 });
        } else {
          console.warn('[Viewer:loadSpatialParcel] ⚠️ No parcel in response (100%)');
          setLoadingProgress({ step: 'spatial_no_parcel', percent: 100 });
        }
      } else {
        console.warn('[Viewer:loadSpatialParcel] ❌ HTTP error:', parcelRes.status);
        setLoadingProgress({ step: 'spatial_http_error', percent: 100 });
      }
    } catch (err) {
      console.error('[Viewer:loadSpatialParcel] ❌ Exception:', err);
      setLoadingProgress({ step: 'spatial_exception', percent: 100 });
    } finally {
      // Always end main loading after parcel - corridors load separately
      console.log('[Viewer:loadSpatialParcel] 🏁 FINALLY - clearing isLoading');
      setIsLoading(false);
    }
  }, [spatialParcelId]);
  
  // Load spatial corridors from Supabase (requires auth)
  const loadSpatialCorridors = useCallback(async () => {
    if (!spatialParcelId) {
      console.log('[Viewer:loadSpatialCorridors] ⏭️ No spatialParcelId, skipping');
      return;
    }
    
    // Skip if not authenticated - show auth required message instead
    if (!isAuthenticated) {
      setSpatialCorridorsAuthRequired(true);
      console.log('[Viewer:loadSpatialCorridors] 🔒 Not authenticated - skipping fetch, showing auth message');
      // NOTE: This does NOT affect isLoading - main loader should already be cleared by loadSpatialParcel
      return;
    }
    
    console.log('[Viewer:loadSpatialCorridors] ▶️ START - authenticated, fetching corridors');
    setSpatialCorridorsLoading(true);
    setSpatialCorridorsAuthRequired(false);
    
    try {
      console.log('[Viewer:loadSpatialCorridors] 📡 Fetching from API...');
      const corridorRes = await fetch(`/api/spatial/parcels/${spatialParcelId}/corridors`);
      
      console.log('[Viewer:loadSpatialCorridors] 📡 Response received - status:', corridorRes.status);
      
      if (corridorRes.ok) {
        console.log('[Viewer:loadSpatialCorridors] ✅ Response OK, parsing JSON...');
        const data: SpatialCorridorData = await corridorRes.json();
        setSpatialCorridors(data);
        console.log('[Viewer:loadSpatialCorridors] ✅ Loaded spatial corridors:', data.count);
        
        // Auto-enable spatial corridors layer if we have data
        if (data.count > 0) {
          setLayerVisibility(prev => ({ ...prev, spatialCorridors: true }));
        }
      } else if (corridorRes.status === 401 || corridorRes.status === 403) {
        // Auth required or access denied - show message
        setSpatialCorridorsAuthRequired(true);
        console.log('[Viewer:loadSpatialCorridors] 🔒 Corridors require auth (401/403)');
      } else {
        console.warn('[Viewer:loadSpatialCorridors] ❌ Failed to load corridors:', corridorRes.status);
      }
    } catch (err) {
      console.error('[Viewer:loadSpatialCorridors] ❌ Exception:', err);
    } finally {
      console.log('[Viewer:loadSpatialCorridors] 🏁 FINALLY - clearing spatialCorridorsLoading');
      setSpatialCorridorsLoading(false);
    }
  }, [spatialParcelId, isAuthenticated]);

  // Load spatial parcel if spatialParcelId is provided
  useEffect(() => {
    console.log('[Viewer:useEffect:loadSpatialParcel] Triggered - spatialParcelId:', spatialParcelId);
    if (spatialParcelId) {
      console.log('[Viewer:useEffect:loadSpatialParcel] ▶️ spatialParcelId present, calling loadSpatialParcel()');
      loadSpatialParcel();
    }
  }, [spatialParcelId, loadSpatialParcel]);

  // Load spatial corridors when we have a spatial parcel and auth status is known
  useEffect(() => {
    console.log('[Viewer:useEffect:loadSpatialCorridors] Triggered - spatialParcelId:', spatialParcelId, 'sessionStatus:', sessionStatus);
    if (spatialParcelId && sessionStatus !== 'loading') {
      console.log('[Viewer:useEffect:loadSpatialCorridors] ▶️ spatialParcelId present & session ready, calling loadSpatialCorridors()');
      loadSpatialCorridors();
    } else if (sessionStatus === 'loading') {
      console.log('[Viewer:useEffect:loadSpatialCorridors] ⏳ Waiting for session status...');
    }
  }, [spatialParcelId, sessionStatus, loadSpatialCorridors]);

  const toggleLayer = (layer: keyof typeof layerVisibility) => {
    setLayerVisibility(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  // Add debug log entry (keeps last 5 entries)
  const addDebugLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDebugLog(prev => [...prev.slice(-4), `[${timestamp}] ${message}`]);
    console.log(`[Viewer Debug] ${message}`);
  }, []);

  // Load corridor data when toggled on - WITH CLIENT-SIDE TIMEOUT
  const loadCorridors = useCallback(async () => {
    if (!parcel || corridorData || corridorLoading) return;
    
    setCorridorLoading(true);
    const requestStartTime = Date.now();
    const requestId = `req_${Date.now().toString(36)}`;
    
    addDebugLog(`Corridors request started... (id: ${requestId})`);
    
    setComputeStatus(prev => ({
      ...prev,
      corridors: { state: 'processing', request_id: requestId }
    }));
    
    // Create abort controller for client-side timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      addDebugLog(`⏱️ Client timeout after ${CORRIDOR_CLIENT_TIMEOUT_MS / 1000}s`);
    }, CORRIDOR_CLIENT_TIMEOUT_MS);
    
    try {
      const parcelId = (parcel.properties?.parcelId || `parcel_${lat}_${lng}`).replace(/[^a-zA-Z0-9]/g, '_');
      
      const response = await fetch('/api/corridors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcel,
          parcel_id: parcelId,
          state: 'mo',
          county: 'johnson',
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const data: CorridorData = await response.json();
        setCorridorData(data);
        
        // Determine compute state based on mode
        const isSynthetic = data.mode === 'synthetic';
        const isCached = data.metadata?.dem_source?.includes('cached');
        const elapsedMs = Date.now() - requestStartTime;
        
        const statusLabel = isSynthetic ? 'FALLBACK' : (isCached ? 'CACHED' : 'COMPUTED');
        addDebugLog(`Corridors response: ${statusLabel} (${data.request_id || requestId}) ${elapsedMs}ms`);
        
        setComputeStatus(prev => ({
          ...prev,
          corridors: { 
            state: isSynthetic ? 'fallback' : 'computed',
            timestamp: new Date().toISOString(),
            request_id: data.request_id || requestId,
            error_code: data.error_code,
            error_message: data.error_message,
            last_stage: data.last_stage,
            mode: isCached ? 'cached' : (isSynthetic ? 'synthetic' : 'real'),
          }
        }));
        
        console.log('[Viewer] Corridor data loaded:', {
          mode: data.mode,
          request_id: data.request_id,
          error_code: data.error_code,
          last_stage: data.last_stage,
          time_ms: elapsedMs,
        });
      } else {
        clearTimeout(timeoutId);
        const errorText = await response.text().catch(() => 'Unknown error');
        console.warn('[Viewer] Corridor fetch failed:', response.status, errorText);
        
        addDebugLog(`Corridors response: ERROR HTTP_${response.status}`);
        setOverlayError(`Corridor analysis failed (HTTP ${response.status})`);
        setComputeStatus(prev => ({
          ...prev,
          corridors: { 
            state: 'error',
            error_code: `HTTP_${response.status}`,
            error_message: `Server returned ${response.status}`,
            last_stage: 'http_request',
          }
        }));
      }
    } catch (err) {
      clearTimeout(timeoutId);
      
      // Check if this was an abort (timeout)
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const errorCode = isTimeout ? 'TERRAIN_TIMEOUT' : 'CLIENT_ERROR';
      const errorMsg = isTimeout 
        ? `Request timed out after ${CORRIDOR_CLIENT_TIMEOUT_MS / 1000}s` 
        : (err instanceof Error ? err.message : 'Unknown error');
      
      addDebugLog(`Corridors response: ERROR ${errorCode}`);
      console.error('[Viewer] Corridor error:', errorCode, err);
      
      setOverlayError(isTimeout ? 'Corridor analysis timed out' : 'Corridor analysis failed');
      setComputeStatus(prev => ({
        ...prev,
        corridors: { 
          state: 'error',
          error_code: errorCode,
          error_message: errorMsg,
          last_stage: isTimeout ? 'timeout' : 'fetch',
        }
      }));
    } finally {
      setCorridorLoading(false);
    }
  }, [parcel, corridorData, corridorLoading, lat, lng, addDebugLog]);

  // Trigger corridor load when toggled on
  useEffect(() => {
    if (layerVisibility.corridors && !corridorData && !corridorLoading) {
      loadCorridors();
    }
  }, [layerVisibility.corridors, corridorData, corridorLoading, loadCorridors]);

  // Handle parcel click - select parcel for analysis AND auto-load corridors if authenticated
  const handleParcelClick = useCallback((parcelInfo: ActiveParcelInfo) => {
    console.log('[Viewer] Parcel selected:', parcelInfo.id);
    setActiveParcel(parcelInfo);
    // Clear previous corridor data when switching parcels
    setCorridorData(null);
    setComputeStatus(prev => ({
      ...prev,
      corridors: { 
        state: 'idle',
        request_id: undefined,
        error_code: null,
        error_message: null,
        last_stage: null,
        mode: undefined,
        timestamp: undefined,
      }
    }));
    
    // Auto-load spatial corridors if authenticated and spatialParcelId is present
    // This triggers loadSpatialCorridors which checks isAuthenticated
    if (spatialParcelId && isAuthenticated) {
      setSpatialCorridorsLoading(true);
      // The loadSpatialCorridors is already called via useEffect when parcel is selected
      // But we trigger it explicitly here for immediate feedback
      loadSpatialCorridors();
    }
  }, [spatialParcelId, isAuthenticated, loadSpatialCorridors]);

  // Deselect parcel
  const handleDeselectParcel = useCallback(() => {
    setActiveParcel(null);
  }, []);

  // Trigger corridor analysis for active parcel
  const handleAnalyzeCorridors = useCallback(() => {
    if (!activeParcel) return;
    // Turn on corridor layer and load corridors
    setLayerVisibility(prev => ({ ...prev, corridors: true }));
    // loadCorridors will be triggered by the useEffect
  }, [activeParcel]);

  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-slate-800/90 backdrop-blur border-b border-slate-700 flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="text-slate-300 hover:text-white"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back
          </Button>
          <div className="h-6 w-px bg-slate-600" />
          <h1 className="text-white font-semibold truncate max-w-[300px] md:max-w-none">
            {address}
          </h1>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLegend(!showLegend)}
            className={`text-slate-300 hover:text-white ${showLegend ? 'bg-slate-700' : ''}`}
          >
            <Layers className="w-4 h-4 mr-1" />
            Layers
          </Button>
        </div>
      </div>

      {/* Overlay Error Banner (non-fatal) */}
      {overlayError && (
        <div className="bg-amber-900/90 text-amber-100 px-4 py-2 flex items-center justify-between z-40">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">Overlay data unavailable: {overlayError}</span>
          </div>
          <button onClick={() => setOverlayError(null)} className="hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Loading Overlay with Progress */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-900/80 z-30 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent mx-auto mb-4" />
            <p className="text-white mb-2">Loading terrain data...</p>
            <p className="text-slate-400 text-sm">Fetching parcel and analysis layers</p>
            {/* Progress indicator */}
            <div className="mt-4 w-48 mx-auto">
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-amber-500 transition-all duration-300" 
                  style={{ width: `${loadingProgress.percent}%` }}
                />
              </div>
              <p className="text-amber-400/80 text-xs font-mono mt-2">
                {loadingProgress.percent}% — {loadingProgress.step.replace(/_/g, ' ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Map Container */}
      <div className="flex-1 relative">
        <LeafletMap
          center={spatialParcelId ? effectiveCenter : [lat, lng]}
          parcel={parcel}
          layers={layers}
          corridorData={corridorData}
          spatialCorridors={spatialCorridors}
          layerVisibility={layerVisibility}
          provenance={provenance}
          onMapReady={() => setMapReady(true)}
          activeParcel={activeParcel}
          onParcelClick={handleParcelClick}
        />

        {/* Legend Panel */}
        {showLegend && mapReady && (
          <div className="absolute top-4 right-4 bg-slate-800/95 backdrop-blur rounded-lg border border-slate-700 p-3 z-[1000] w-56 shadow-xl">
            <h3 className="text-white font-semibold mb-3 text-sm">Layers</h3>
            
            <div className="space-y-2">
              {/* Parcel */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerVisibility.parcel}
                  onChange={() => toggleLayer('parcel')}
                  className="rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500"
                />
                <div className="w-4 h-4 border-2 border-amber-500 bg-amber-500/20 rounded-sm" />
                <span className="text-slate-200 text-sm">Parcel Boundary</span>
              </label>

              {/* Bedding */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerVisibility.bedding}
                  onChange={() => toggleLayer('bedding')}
                  className="rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500"
                />
                <div className="w-4 h-4 bg-emerald-500/60 border border-emerald-400 rounded-sm" />
                <span className="text-slate-200 text-sm">Bedding Areas</span>
              </label>

              {/* Funnels */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerVisibility.funnels}
                  onChange={() => toggleLayer('funnels')}
                  className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                />
                <div className="w-4 h-1 bg-blue-500 rounded-sm" />
                <span className="text-slate-200 text-sm">Funnels / Corridors</span>
              </label>

              {/* Saddles */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerVisibility.saddles}
                  onChange={() => toggleLayer('saddles')}
                  className="rounded border-slate-600 bg-slate-700 text-purple-500 focus:ring-purple-500"
                />
                <div className="w-4 h-4 bg-purple-500/40 border border-purple-400 rounded-sm" />
                <span className="text-slate-200 text-sm">Saddles / Draws</span>
              </label>

              {/* Stands */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerVisibility.stands}
                  onChange={() => toggleLayer('stands')}
                  className="rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                />
                <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                  <Target className="w-3 h-3 text-white" />
                </div>
                <span className="text-slate-200 text-sm">Stand Sites</span>
              </label>

              {/* Corridors (V1 - Modal geoprocessor) */}
              <label className="flex items-center gap-2 cursor-pointer mt-2 pt-2 border-t border-slate-700">
                <input
                  type="checkbox"
                  checked={layerVisibility.corridors}
                  onChange={() => toggleLayer('corridors')}
                  className="rounded border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500"
                />
                <div className="w-4 h-1 bg-gradient-to-r from-orange-400 to-red-500 rounded-sm" />
                <span className="text-slate-200 text-sm">
                  Travel Corridors
                  {corridorLoading && <span className="text-xs text-amber-400 ml-1">(loading...)</span>}
                </span>
              </label>

              {/* Spatial Corridors (from Supabase) */}
              {spatialParcelId && (
                <div className="mt-1">
                  {spatialCorridorsAuthRequired ? (
                    // Show auth required message
                    <div className="flex items-center gap-2 py-1">
                      <div className="w-4 h-4 flex items-center justify-center opacity-50">
                        <Lock className="w-3 h-3 text-slate-400" />
                      </div>
                      <div className="w-4 h-1 bg-gradient-to-r from-slate-500 to-slate-600 rounded-sm opacity-50" />
                      <span className="text-slate-400 text-sm">
                        DB Corridors
                        <span className="text-xs text-amber-400 ml-1 block">(Sign in to view)</span>
                      </span>
                    </div>
                  ) : (spatialCorridors || spatialCorridorsLoading) ? (
                    // Normal toggle when auth'd or loading
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={layerVisibility.spatialCorridors}
                        onChange={() => toggleLayer('spatialCorridors')}
                        disabled={spatialCorridorsLoading}
                        className="rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 disabled:opacity-50"
                      />
                      <div className="w-4 h-1 bg-gradient-to-r from-cyan-400 to-teal-500 rounded-sm" />
                      <span className="text-slate-200 text-sm">
                        DB Corridors
                        {spatialCorridorsLoading && <span className="text-xs text-cyan-400 ml-1">(loading...)</span>}
                        {spatialCorridors && <span className="text-xs text-slate-400 ml-1">({spatialCorridors.count})</span>}
                      </span>
                    </label>
                  ) : null}
                </div>
              )}
            </div>

            {/* Provenance */}
            {provenance && (
              <div className="mt-4 pt-3 border-t border-slate-700">
                <p className="text-xs text-slate-400">
                  DEM: {provenance.demSource}<br />
                  Resolution: {provenance.demResolution}
                </p>
              </div>
            )}
          </div>
        )}

        {/* System Panel - Bottom Left */}
        {showSystemPanel && mapReady && (
          <div className="absolute bottom-4 left-4 bg-slate-800/95 backdrop-blur rounded-lg border border-slate-700 p-3 z-[1000] min-w-[220px] max-w-[280px] shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-slate-300 font-medium text-xs uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                System Status
              </h4>
              <button 
                onClick={() => setShowSystemPanel(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            
            <div className="space-y-3">
              {/* Terrain Analysis Status */}
              <ComputeIndicator
                label="Terrain Analysis"
                status={computeStatus.terrain}
              />
              
              {/* Corridor Analysis Status - always show when active or toggled */}
              {(computeStatus.corridors.state !== 'idle' || layerVisibility.corridors) && (
                <ComputeIndicator
                  label="Travel Corridors"
                  status={computeStatus.corridors}
                />
              )}
            </div>
          </div>
        )}
        
        {/* System Panel Toggle (when hidden) */}
        {!showSystemPanel && mapReady && (
          <button
            onClick={() => setShowSystemPanel(true)}
            className="absolute bottom-4 left-4 bg-slate-800/90 backdrop-blur rounded-lg border border-slate-700 p-2 z-[1000] hover:bg-slate-700/90 transition-colors"
            title="Show System Status"
          >
            <Activity className="w-4 h-4 text-slate-300" />
          </button>
        )}
        
        {/* Debug Log Panel - Fixed Top Right (below header) */}
        {debugLog.length > 0 && (
          <div className="fixed top-16 right-4 z-[2000] bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg p-2 max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider">Debug Log</span>
              <button 
                onClick={() => setDebugLog([])}
                className="text-slate-500 hover:text-white text-xs"
              >
                Clear
              </button>
            </div>
            <div className="space-y-0.5">
              {debugLog.map((log, i) => (
                <div key={i} className="text-[10px] font-mono text-slate-300 leading-tight">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Build Stamp - Fixed Bottom Right */}
        <div className="fixed bottom-2 right-2 z-[2000] text-[10px] font-mono text-slate-500/70 bg-slate-900/60 backdrop-blur px-2 py-1 rounded select-text">
          Build: v3.4-hitbox | Corridors UI: v5.0 | 2026-02-26
        </div>

        {/* Active Parcel Panel - Bottom Center */}
        {activeParcel && mapReady && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-800/95 backdrop-blur rounded-lg border border-cyan-500/50 shadow-xl shadow-cyan-500/10 z-[1000] min-w-[320px] max-w-[90vw]">
            {/* Header with close */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-cyan-400 font-semibold text-sm uppercase tracking-wide">Working Parcel</span>
              </div>
              <button
                onClick={handleDeselectParcel}
                className="text-slate-400 hover:text-white transition-colors p-1"
                title="Deselect parcel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Parcel Info */}
            <div className="px-4 py-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-3">
                <div>
                  <span className="text-slate-400">Parcel ID</span>
                  <p className="text-white font-mono text-xs truncate" title={activeParcel.id}>
                    {activeParcel.id.length > 20 ? `${activeParcel.id.slice(0, 20)}...` : activeParcel.id}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Location</span>
                  <p className="text-white">
                    {activeParcel.county || 'Unknown'}, {activeParcel.state || 'MO'}
                  </p>
                </div>
                {activeParcel.acreage && (
                  <div>
                    <span className="text-slate-400">Acreage</span>
                    <p className="text-white font-semibold">{activeParcel.acreage.toFixed(1)} ac</p>
                  </div>
                )}
                {activeParcel.address && (
                  <div>
                    <span className="text-slate-400">Address</span>
                    <p className="text-white text-xs truncate" title={activeParcel.address}>
                      {activeParcel.address}
                    </p>
                  </div>
                )}
              </div>
              
              {/* Spatial Corridors Status (when spatialParcelId present) */}
              {spatialParcelId && (
                <div className="mb-3 px-2 py-1.5 bg-slate-700/50 rounded-md flex items-center justify-between">
                  <span className="text-slate-300 text-xs flex items-center gap-1.5">
                    <Route className="w-3.5 h-3.5 text-cyan-400" />
                    DB Corridors
                  </span>
                  {spatialCorridorsLoading ? (
                    <span className="text-cyan-400 text-xs flex items-center gap-1.5">
                      <div className="w-3 h-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                      Loading...
                    </span>
                  ) : spatialCorridorsAuthRequired ? (
                    <span className="text-amber-400 text-xs flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Sign in required
                    </span>
                  ) : spatialCorridors ? (
                    <span className="text-emerald-400 text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {spatialCorridors.count} found
                    </span>
                  ) : (
                    <span className="text-slate-500 text-xs">None</span>
                  )}
                </div>
              )}

              {/* Analysis Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-700">
                <Button
                  size="sm"
                  onClick={handleAnalyzeCorridors}
                  disabled={corridorLoading || (layerVisibility.corridors && !!corridorData)}
                  className={`flex-1 ${
                    corridorLoading 
                      ? 'bg-amber-600 text-white' 
                      : layerVisibility.corridors && corridorData
                        ? 'bg-emerald-600 text-white cursor-default'
                        : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white'
                  }`}
                >
                  {corridorLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      Analyzing...
                    </>
                  ) : layerVisibility.corridors && corridorData ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Corridors Computed
                    </>
                  ) : (
                    <>
                      <Route className="w-4 h-4 mr-1" />
                      Analyze Corridors
                    </>
                  )}
                </Button>
                
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                  title="More analysis options (coming soon)"
                  disabled
                >
                  <Scan className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Hint to click parcel (when no active parcel) */}
        {!activeParcel && mapReady && !isLoading && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-800/80 backdrop-blur rounded-full px-4 py-2 z-[1000] flex items-center gap-2 border border-slate-700">
            <Crosshair className="w-4 h-4 text-amber-400" />
            <span className="text-slate-300 text-sm">Click a parcel to begin analysis</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Compute Indicator Component with full diagnostics
function ComputeIndicator({ 
  label, 
  status
}: { 
  label: string; 
  status: ComputeStatusItem;
}) {
  const { state, timestamp, request_id, error_code, error_message, last_stage, mode } = status;
  
  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  // Short request ID for display
  const shortRequestId = request_id ? request_id.slice(-12) : null;

  return (
    <div className="space-y-1">
      {/* Main status line */}
      <div className="flex items-center gap-2">
        {/* Pulse/Solid Indicator */}
        <div className="relative flex items-center justify-center w-4 h-4 flex-shrink-0">
          {state === 'processing' && (
            <>
              <div className="absolute w-3 h-3 rounded-full bg-amber-500/30 animate-ping" />
              <div className="relative w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            </>
          )}
          {state === 'computed' && (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          )}
          {state === 'fallback' && (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          )}
          {state === 'error' && (
            <AlertTriangle className="w-4 h-4 text-red-400" />
          )}
          {state === 'idle' && (
            <div className="w-2 h-2 rounded-full bg-slate-500" />
          )}
        </div>
        
        {/* Label and State */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300 truncate">{label}</span>
            <span className={`text-[10px] font-medium uppercase tracking-wide ${
              state === 'processing' ? 'text-amber-400' :
              state === 'computed' ? 'text-emerald-400' :
              state === 'fallback' ? 'text-amber-400' :
              state === 'error' ? 'text-red-400' :
              'text-slate-500'
            }`}>
              {state === 'processing' ? 'Processing' :
               state === 'computed' ? 'Computed' :
               state === 'fallback' ? 'Fallback' :
               state === 'error' ? 'Error' :
               'Idle'}
            </span>
          </div>
        </div>
      </div>
      
      {/* Diagnostic detail line */}
      <div className="pl-6 text-[9px] font-mono text-slate-500 leading-tight">
        {state === 'processing' && shortRequestId && (
          <span>req: {shortRequestId}</span>
        )}
        
        {state === 'computed' && (
          <span>
            {mode === 'cached' ? '⚡ cached' : '✓ fresh'}
            {timestamp && ` · ${formatTime(timestamp)}`}
          </span>
        )}
        
        {state === 'fallback' && (
          <span className="text-amber-500/80">
            SYNTHETIC {error_code && `(${error_code})`}
            {last_stage && ` at ${last_stage}`}
          </span>
        )}
        
        {state === 'error' && (
          <span className="text-red-400/80">
            {error_code || 'ERROR'}
            {last_stage && ` at ${last_stage}`}
          </span>
        )}
      </div>
      
      {/* Error message tooltip-style on hover (always visible for errors) */}
      {(state === 'error' || state === 'fallback') && error_message && (
        <div className="pl-6 text-[9px] text-slate-400 italic truncate" title={error_message}>
          {error_message}
        </div>
      )}
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent" />
      </div>
    }>
      <ViewerContent />
    </Suspense>
  );
}
