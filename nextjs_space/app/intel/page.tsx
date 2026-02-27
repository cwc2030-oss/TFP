'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense, useMemo, Component, ErrorInfo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
// NOTE: Deck.gl removed - using native Mapbox sources/layers only for stability
import { 
  Target, TreePine, Wind, Calendar, ChevronLeft, ChevronRight, 
  Compass, Info, CheckCircle, AlertTriangle, Loader2, X, MapPin,
  Mountain, Eye, EyeOff, Layers, Crosshair, Home, ExternalLink,
  Maximize2, Minimize2, RefreshCw, Check, Bug
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import type {
  TerrainLayers,
  TerrainSummary,
  TerrainProvenance,
  TerrainMode,
  TerrainLayerVisibility,
  StandPointProperties,
  BeddingProperties,
  FunnelProperties,
  SeasonProfile,
  WindDirection,
} from '@/types/terrain';

// ========== ERROR BOUNDARY ==========
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class IntelErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[INTEL ERROR BOUNDARY] Caught error:', error);
    console.error('[INTEL ERROR BOUNDARY] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full bg-red-950/80 border border-red-500/50 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <Bug className="h-8 w-8 text-red-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-red-300 mb-2">Intel Page Crashed</h1>
                <div className="bg-black/50 rounded-lg p-4 mb-4 overflow-auto max-h-48">
                  <p className="text-red-200 font-mono text-sm break-words">
                    {this.state.error?.message || 'Unknown error'}
                  </p>
                </div>
                {this.state.error?.stack && (
                  <details className="mb-4">
                    <summary className="text-red-400 text-sm cursor-pointer hover:text-red-300">
                      Stack trace
                    </summary>
                    <pre className="bg-black/50 rounded-lg p-3 mt-2 text-xs text-red-300/80 overflow-auto max-h-64 whitespace-pre-wrap">
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
                {this.state.errorInfo?.componentStack && (
                  <details className="mb-4">
                    <summary className="text-red-400 text-sm cursor-pointer hover:text-red-300">
                      Component stack
                    </summary>
                    <pre className="bg-black/50 rounded-lg p-3 mt-2 text-xs text-red-300/80 overflow-auto max-h-48 whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg font-medium"
                  >
                    Reload Page
                  </button>
                  <Link
                    href="/core"
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg font-medium"
                  >
                    Try /core instead
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Mapbox token
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

// Extend window for debugging
declare global {
  interface Window {
    __TFP_MAP__: mapboxgl.Map | null;
  }
}

// ========== GeoJSON VALIDATION UTILITIES ==========

// Ensure polygon rings are closed (first coord === last coord)
function closePolygonRing(coords: number[][]): number[][] {
  if (coords.length < 4) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...coords, first];
  }
  return coords;
}

// Validate and fix GeoJSON for consumption
function validateGeoJSON(geojson: GeoJSON.FeatureCollection | GeoJSON.Feature | null): GeoJSON.FeatureCollection {
  const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  
  if (!geojson) return emptyFC;
  
  // Normalize to FeatureCollection
  let fc: GeoJSON.FeatureCollection;
  if (geojson.type === 'Feature') {
    fc = { type: 'FeatureCollection', features: [geojson as GeoJSON.Feature] };
  } else if (geojson.type === 'FeatureCollection') {
    fc = geojson as GeoJSON.FeatureCollection;
  } else {
    console.warn('[TFP] Invalid GeoJSON type:', (geojson as any).type);
    return emptyFC;
  }
  
  // Validate each feature
  fc.features = fc.features.filter(f => {
    if (!f || !f.geometry) {
      console.warn('[TFP] Skipping feature with no geometry');
      return false;
    }
    return true;
  }).map(f => {
    const geom = f.geometry;
    
    // Fix polygon rings
    if (geom.type === 'Polygon') {
      const poly = geom as GeoJSON.Polygon;
      poly.coordinates = poly.coordinates.map(ring => closePolygonRing(ring));
    } else if (geom.type === 'MultiPolygon') {
      const mpoly = geom as GeoJSON.MultiPolygon;
      mpoly.coordinates = mpoly.coordinates.map(polygon => 
        polygon.map(ring => closePolygonRing(ring))
      );
    }
    
    return f;
  });
  
  return fc;
}

// Extract only features matching a geometry type
function filterByGeometryType(
  fc: GeoJSON.FeatureCollection, 
  types: string[]
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.filter(f => types.includes(f.geometry?.type || ''))
  };
}

const WIND_DIRECTIONS: WindDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SEASONS: { value: SeasonProfile; label: string; dates: string; icon: string }[] = [
  { value: 'early', label: 'Early Season', dates: 'Sept-Oct', icon: '🌿' },
  { value: 'rut', label: 'Rut', dates: 'Nov', icon: '🦌' },
  { value: 'late', label: 'Late Season', dates: 'Dec-Jan', icon: '❄️' },
];

// Colors as hex (for UI and native Mapbox layers)
const LAYER_COLORS = {
  bedding: '#22c55e',
  beddingOutline: '#16a34a',
  funnelSaddle: '#f97316',
  funnelDraw: '#3b82f6',
  funnelCorridor: '#a855f7',
  standHigh: '#ef4444',
  standMed: '#f59e0b',
  standLow: '#6b7280',
  parcelBoundary: '#fbbf24',
};

// Empty GeoJSON for initializing sources
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function LoadingFallback() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-gray-900">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-amber-500 animate-spin mx-auto mb-4" />
        <p className="text-white text-lg">Loading Deer Intel...</p>
      </div>
    </div>
  );
}

export default function DeerIntelPage() {
  return (
    <IntelErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <DeerIntelContent />
      </Suspense>
    </IntelErrorBoundary>
  );
}

function DeerIntelContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  // URL params
  const lat = parseFloat(searchParams.get('lat') || '38.7958');
  const lng = parseFloat(searchParams.get('lng') || '-94.2733');
  const address = searchParams.get('address') || 'Sample Property';
  const acreageParam = searchParams.get('acreage');

  // Analysis state
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TerrainMode>('preview');
  const [layers, setLayers] = useState<TerrainLayers | null>(null);
  const [summary, setSummary] = useState<TerrainSummary | null>(null);
  const [provenance, setProvenance] = useState<TerrainProvenance | null>(null);

  // Global/unhandled error state
  const [globalError, setGlobalError] = useState<{ message: string; stack?: string } | null>(null);

  // User controls
  const [season, setSeason] = useState<SeasonProfile>('rut');
  const [windDirection, setWindDirection] = useState<WindDirection>('NW');
  const [selectedStand, setSelectedStand] = useState<number | null>(null);
  const [visibility, setVisibility] = useState<TerrainLayerVisibility>({
    bedding: true,
    funnels: true,
    stands: true,
    corridors: true,
  });

  // UI state
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [parcelPolygon, setParcelPolygon] = useState<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);

  // ========== GLOBAL ERROR HANDLERS ==========
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[INTEL] Unhandled promise rejection:', event.reason);
      const errorMsg = event.reason instanceof Error 
        ? event.reason.message 
        : String(event.reason);
      const errorStack = event.reason instanceof Error ? event.reason.stack : undefined;
      setGlobalError({ message: `Unhandled rejection: ${errorMsg}`, stack: errorStack });
      setError(`Unhandled error: ${errorMsg}`);
      setIsLoading(false);
    };

    const handleGlobalError = (event: ErrorEvent) => {
      console.error('[INTEL] Global error:', event.message, event.filename, event.lineno);
      setGlobalError({ 
        message: `${event.message} (${event.filename}:${event.lineno})`,
        stack: event.error?.stack 
      });
      setError(`Error: ${event.message}`);
      setIsLoading(false);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleGlobalError);

    console.log('[INTEL] Global error handlers registered');

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleGlobalError);
    };
  }, []);

  // Check WebGL support
  const checkWebGLSupport = (): boolean => {
    return true; // Let Mapbox handle gracefully
  };

  // Progress step text for UI
  const [progressStep, setProgressStep] = useState<string>('Initializing...');

  // Fetch terrain analysis using shared client
  const runAnalysis = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setProgress(10);
    setProgressStep('Fetching parcel boundary...');
    
    const startTime = Date.now();
    console.log('[INTEL] === ANALYSIS START ===');
    console.log('[INTEL] Coordinates:', lat, lng);
    console.log('[INTEL] Season:', season, 'Wind:', windDirection);

    try {
      // Import shared terrain client
      const { fetchParcelGeometry, fetchTerrainAnalysis, generateSyntheticParcel } = await import('@/lib/terrain-client');
      
      // Get real parcel geometry from Regrid
      setProgress(15);
      const parcel = await fetchParcelGeometry(lat, lng);
      
      if (!parcel) {
        // Use synthetic fallback instead of failing
        console.warn('[INTEL] No Regrid parcel, using synthetic boundary');
        const syntheticParcel = generateSyntheticParcel(lat, lng, parseFloat(acreageParam || '80'));
        setParcelPolygon(syntheticParcel as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
        setProgress(20);
        setProgressStep('Using estimated boundary...');
        
        // Run analysis with synthetic parcel
        const result = await fetchTerrainAnalysis(
          {
            parcel: syntheticParcel,
            seasonProfile: season,
            prevailingWinds: [windDirection],
            bufferMeters: 800,
          },
          (step, prog) => {
            setProgressStep(step);
            setProgress(20 + Math.round(prog * 0.8)); // Scale 0-100 to 20-100
          },
          45_000 // 45 second timeout
        );
        
        if (!result.success) {
          throw new Error(result.error || 'Analysis failed');
        }
        
        const data = result.data!;
        setMode(data.mode);
        setLayers(data.layers);
        setSummary(data.summary);
        setProvenance(data.provenance);
        setProgress(100);
        setProgressStep(`Complete in ${(result.durationMs / 1000).toFixed(1)}s`);
        console.log('[INTEL] Analysis complete (synthetic):', result.durationMs, 'ms');
        return;
      }
      
      setParcelPolygon(parcel);
      setProgress(20);
      setProgressStep('Running terrain analysis...');
      console.log('[INTEL] Got real parcel:', parcel.properties?.parcelId);

      // Run terrain analysis with 120s timeout
      const result = await fetchTerrainAnalysis(
        {
          parcel,
          seasonProfile: season,
          prevailingWinds: [windDirection],
          bufferMeters: 800,
        },
        (step, prog) => {
          setProgressStep(step);
          setProgress(20 + Math.round(prog * 0.8)); // Scale 0-100 to 20-100
        },
        45_000 // 45 second timeout
      );

      const totalDuration = Date.now() - startTime;
      console.log('[INTEL] Total analysis time:', totalDuration, 'ms');

      if (!result.success) {
        // Show the actual error, not generic message
        const errorMsg = result.status 
          ? `Error ${result.status}: ${result.error}` 
          : result.error || 'Analysis failed';
        throw new Error(errorMsg);
      }

      const data = result.data!;
      setMode(data.mode);
      setLayers(data.layers);
      setSummary(data.summary);
      setProvenance(data.provenance);
      setProgress(100);
      setProgressStep(`Complete in ${(result.durationMs / 1000).toFixed(1)}s`);
      
      console.log('[INTEL] === ANALYSIS COMPLETE ===');

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Analysis failed';
      console.error('[INTEL] Analysis error:', errorMsg);
      setError(errorMsg);
      setProgressStep('Failed');
    } finally {
      setIsLoading(false);
    }
  }, [lat, lng, season, windDirection, acreageParam]);

  // ========== NATIVE MAPBOX SOURCES INITIALIZED FLAG ==========
  const overlaySourcesCreated = useRef(false);

  // ========== UPDATE NATIVE MAPBOX SOURCES WHEN DATA CHANGES ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;

    try {
      // Update parcel boundary
      const parcelSource = map.getSource('tfp-parcel') as mapboxgl.GeoJSONSource;
      if (parcelSource && parcelPolygon) {
        parcelSource.setData(validateGeoJSON(parcelPolygon));
      }

      // Update bedding polygons
      const beddingSource = map.getSource('tfp-bedding') as mapboxgl.GeoJSONSource;
      if (beddingSource) {
        const beddingFC = layers?.beddingPolygons ? validateGeoJSON(layers.beddingPolygons) : EMPTY_FC;
        const polygonsOnly = filterByGeometryType(beddingFC, ['Polygon', 'MultiPolygon']);
        beddingSource.setData(polygonsOnly);
      }

      // Update funnel lines (draws, corridors)
      const funnelLinesSource = map.getSource('tfp-funnels-lines') as mapboxgl.GeoJSONSource;
      if (funnelLinesSource) {
        const funnelsFC = layers?.funnels ? validateGeoJSON(layers.funnels) : EMPTY_FC;
        const lines = filterByGeometryType(funnelsFC, ['LineString', 'MultiLineString']);
        funnelLinesSource.setData(lines);
      }

      // Update funnel polygons (saddles)
      const funnelPolysSource = map.getSource('tfp-funnels-polys') as mapboxgl.GeoJSONSource;
      if (funnelPolysSource) {
        const funnelsFC = layers?.funnels ? validateGeoJSON(layers.funnels) : EMPTY_FC;
        const polys = filterByGeometryType(funnelsFC, ['Polygon', 'MultiPolygon']);
        funnelPolysSource.setData(polys);
      }

      console.log('[MAP] Updated native Mapbox sources with terrain data');
    } catch (err) {
      console.error('[MAP] Error updating sources (non-fatal):', err);
    }
  }, [layers, parcelPolygon, mapReady]);

  // ========== UPDATE LAYER VISIBILITY ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;

    try {
      // Bedding visibility
      if (map.getLayer('tfp-bedding-fill')) {
        map.setLayoutProperty('tfp-bedding-fill', 'visibility', visibility.bedding ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-bedding-outline')) {
        map.setLayoutProperty('tfp-bedding-outline', 'visibility', visibility.bedding ? 'visible' : 'none');
      }

      // Funnel visibility
      const funnelVisible = visibility.funnels || visibility.corridors;
      if (map.getLayer('tfp-funnels-lines')) {
        map.setLayoutProperty('tfp-funnels-lines', 'visibility', funnelVisible ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-funnels-polys-fill')) {
        map.setLayoutProperty('tfp-funnels-polys-fill', 'visibility', visibility.funnels ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-funnels-polys-outline')) {
        map.setLayoutProperty('tfp-funnels-polys-outline', 'visibility', visibility.funnels ? 'visible' : 'none');
      }
    } catch (err) {
      console.error('[MAP] Error updating visibility (non-fatal):', err);
    }
  }, [visibility, mapReady]);

  // ========== SINGLE MAPBOX MAP INSTANCE ==========
  // Track instance count for debugging double-mount issues
  const mountIdRef = useRef<string>('');
  
  useEffect(() => {
    const mountId = Date.now().toString(36);
    mountIdRef.current = mountId;
    console.log('[LIFECYCLE] useEffect ENTER id=' + mountId + ' mapRef=' + !!mapRef.current + ' container=' + !!mapContainerRef.current);
    
    if (!mapContainerRef.current) {
      console.log('[LIFECYCLE] No container ref, skipping');
      return;
    }
    
    if (mapRef.current) {
      console.log('[LIFECYCLE] Map already exists, skipping creation');
      return;
    }

    // Check WebGL support
    if (!checkWebGLSupport()) {
      setMapError("Your browser doesn't support WebGL, which is required for 3D terrain viewing.");
      setIsLoading(false);
      return;
    }

    // Check token
    if (!MAPBOX_TOKEN) {
      setMapError("Map configuration error. Please try again later.");
      setIsLoading(false);
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    let map: mapboxgl.Map;

    console.log('[MAP] BEFORE new mapboxgl.Map() id=' + mountId + ' center=[' + lng + ',' + lat + ']');
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: 14,
        pitch: 0,    // Flat 2D view - no 3D terrain
        bearing: 0,  // North up
      });
      console.log('[MAP] AFTER new mapboxgl.Map() id=' + mountId + ' map exists=' + !!map);
      
      // Expose for debugging
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = map;
      }
    } catch (err) {
      console.error("[MAP] FAILED to create Map:", err);
      setMapError("Failed to load map. Please try refreshing the page.");
      setIsLoading(false);
      return;
    }

    // Error handler - log ALL map errors
    map.on('error', (e: any) => {
      console.error("[MAP ERROR]", e?.error || e);
      if (e?.error?.status === 401 || e?.error?.status === 403) {
        setMapError("Map authentication error. Please contact support.");
      }
    });

    // Handler for when map is fully loaded
    const onMapLoad = () => {
      console.log('[MAP] LOAD EVENT FIRED id=' + mountId + ' map.loaded()=' + map.loaded());
      
      // DISABLED: 3D terrain + sky - using flat 2D map only for stability
      // Guard: only call setTerrain if the method exists (Mapbox GL v2+)
      if (typeof map.setTerrain === 'function') {
        console.log('[MAP] setTerrain is available but DISABLED for stability');
      } else {
        console.log('[MAP] setTerrain not available (Mapbox GL v1 or MapLibre)');
      }
      
      // Create native Mapbox sources and layers (NO Deck.gl)
      try {
        console.log('[MAP] Creating native Mapbox sources...');
        
        // Parcel boundary source
        if (!map.getSource('tfp-parcel')) {
          map.addSource('tfp-parcel', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-parcel-outline',
            type: 'line',
            source: 'tfp-parcel',
            paint: {
              'line-color': LAYER_COLORS.parcelBoundary,
              'line-width': 3,
              'line-dasharray': [4, 2],
            },
          });
        }
        
        // Bedding source
        if (!map.getSource('tfp-bedding')) {
          map.addSource('tfp-bedding', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-bedding-fill',
            type: 'fill',
            source: 'tfp-bedding',
            paint: {
              'fill-color': LAYER_COLORS.bedding,
              'fill-opacity': 0.25,
            },
          });
          map.addLayer({
            id: 'tfp-bedding-outline',
            type: 'line',
            source: 'tfp-bedding',
            paint: {
              'line-color': LAYER_COLORS.beddingOutline,
              'line-width': 2,
            },
          });
        }
        
        // Funnel lines source (draws, corridors)
        if (!map.getSource('tfp-funnels-lines')) {
          map.addSource('tfp-funnels-lines', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-funnels-lines',
            type: 'line',
            source: 'tfp-funnels-lines',
            paint: {
              'line-color': LAYER_COLORS.funnelDraw,
              'line-width': 3,
            },
          });
        }
        
        // Funnel polygons source (saddles)
        if (!map.getSource('tfp-funnels-polys')) {
          map.addSource('tfp-funnels-polys', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-funnels-polys-fill',
            type: 'fill',
            source: 'tfp-funnels-polys',
            paint: {
              'fill-color': LAYER_COLORS.funnelSaddle,
              'fill-opacity': 0.2,
            },
          });
          map.addLayer({
            id: 'tfp-funnels-polys-outline',
            type: 'line',
            source: 'tfp-funnels-polys',
            paint: {
              'line-color': '#EA580C',
              'line-width': 2,
            },
          });
        }
        
        overlaySourcesCreated.current = true;
        console.log('[MAP] Native Mapbox sources created successfully');
      } catch (sourceErr) {
        console.error('[MAP] Source/layer setup failed (non-fatal):', sourceErr);
        // Continue anyway - panels must render even if map overlays fail
      }
      
      // ALWAYS set map ready - even if source setup failed
      console.log('[MAP] BEFORE setMapReady(true)');
      setMapReady(true);
      console.log('[MAP] AFTER setMapReady(true) - map should now be interactive');
      
      // Resize map to ensure proper tile loading after navigation
      // (prevents "checkered calendar" tile corruption on layout changes)
      setTimeout(() => {
        try {
          if (map && mapRef.current === map) {
            (map as any).resize();
            console.log('[MAP] map.resize() called to fix tile rendering');
          }
        } catch (e) {
          console.log('[MAP] map.resize() skipped - map may be disposed');
        }
      }, 100);
    };
    
    // Register load handler
    console.log('[MAP] Registering load handler, map.loaded()=' + map.loaded());
    if (map.loaded()) {
      console.log('[MAP] Map already loaded, calling onMapLoad immediately');
      onMapLoad();
    } else {
      console.log('[MAP] Waiting for load event...');
      map.once('load', onMapLoad);
    }

    mapRef.current = map;
    console.log('[MAP] mapRef.current set, useEffect setup complete id=' + mountId);

    return () => {
      console.log('[LIFECYCLE] CLEANUP id=' + mountId + ' (current=' + mountIdRef.current + ')');
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = null;
      }
      overlaySourcesCreated.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []); // Empty deps - only mount once

  // Run analysis immediately on mount, and when season/wind changes
  useEffect(() => {
    runAnalysis();
  }, [season, windDirection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ========== HTML STAND MARKERS (top 2 only) ==========
  useEffect(() => {
    if (!mapRef.current || !mapReady || !layers?.standPoints) return;
    addStandMarkers();
  }, [layers, mapReady]);

  // Toggle visibility of HTML markers
  useEffect(() => {
    markersRef.current.forEach(marker => {
      marker.getElement().style.display = visibility.stands ? 'block' : 'none';
    });
  }, [visibility.stands]);

  const cleanupMarkers = () => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
  };

  const addStandMarkers = () => {
    const map = mapRef.current;
    if (!map || !layers?.standPoints) return;

    cleanupMarkers();

    // Only show TOP 2 stands
    const topTwoStands = layers.standPoints?.features?.slice(0, 2) || [];

    topTwoStands.forEach((feature) => {
      const props = feature.properties as StandPointProperties;
      const coords = feature.geometry.coordinates as [number, number];

      const el = document.createElement('div');
      el.className = 'intel-stand-marker';
      el.innerHTML = `
        <div style="
          width: 48px;
          height: 48px;
          background: ${LAYER_COLORS.standHigh};
          border: 4px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 20px;
          box-shadow: 0 6px 20px rgba(0,0,0,0.5);
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        ">
          ${props.rank}
        </div>
      `;

      el.onmouseenter = () => {
        (el.firstElementChild as HTMLElement).style.transform = 'scale(1.2)';
        (el.firstElementChild as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)';
      };
      el.onmouseleave = () => {
        (el.firstElementChild as HTMLElement).style.transform = 'scale(1)';
        (el.firstElementChild as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
      };

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(coords)
        .addTo(map);

      el.onclick = () => {
        setSelectedStand(props.rank);
        showStandPopup(coords, props);
        map.flyTo({ center: coords, zoom: 16 });
      };

      markersRef.current.push(marker);
    });
  };

  const showStandPopup = (coords: [number, number], props: StandPointProperties) => {
    const map = mapRef.current;
    if (!map) return;

    if (popupRef.current) popupRef.current.remove();

    const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '340px', className: 'intel-popup' })
      .setLngLat(coords)
      .setHTML(`
        <div style="padding: 16px; font-family: system-ui, sans-serif;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <span style="
              background: ${props.rank <= 3 ? LAYER_COLORS.standHigh : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow};
              color: white;
              font-weight: bold;
              padding: 6px 14px;
              border-radius: 16px;
              font-size: 15px;
            ">Stand #${props.rank}</span>
            <span style="font-weight: 700; font-size: 22px;">${props.score}<span style="font-size: 14px; color: #6b7280;">/100</span></span>
          </div>
          
          <p style="margin: 12px 0; font-size: 14px; color: #374151; line-height: 1.5;">
            ${props.reasoning}
          </p>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px;">
            <div style="background: #f3f4f6; padding: 8px 10px; border-radius: 6px;">
              <span style="color: #6b7280; font-size: 11px; display: block;">To Corridor</span>
              <span style="font-weight: 600; font-size: 14px;">${props.distToCorridorMeters}m</span>
            </div>
            <div style="background: #f3f4f6; padding: 8px 10px; border-radius: 6px;">
              <span style="color: #6b7280; font-size: 11px; display: block;">To Bedding</span>
              <span style="font-weight: 600; font-size: 14px;">${props.distToBeddingMeters}m</span>
            </div>
            <div style="background: #dcfce7; padding: 8px 10px; border-radius: 6px;">
              <span style="color: #166534; font-size: 11px; display: block;">✓ Good Wind</span>
              <span style="font-weight: 600; font-size: 14px;">${props.windOk.join(', ')}</span>
            </div>
            <div style="background: #fee2e2; padding: 8px 10px; border-radius: 6px;">
              <span style="color: #991b1b; font-size: 11px; display: block;">✗ Avoid</span>
              <span style="font-weight: 600; font-size: 14px;">${props.windBad.join(', ')}</span>
            </div>
          </div>
          
          <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e5e7eb; display: flex; align-items: center; gap: 12px;">
            <span style="
              padding: 4px 10px;
              border-radius: 6px;
              font-weight: 500;
              font-size: 12px;
              background: ${props.approachRisk === 'low' ? '#dcfce7' : props.approachRisk === 'medium' ? '#fef3c7' : '#fee2e2'};
              color: ${props.approachRisk === 'low' ? '#166534' : props.approachRisk === 'medium' ? '#92400e' : '#991b1b'};
            ">
              ${props.approachRisk.toUpperCase()} approach risk
            </span>
            <span style="color: #6b7280; font-size: 12px;">Elev: ${Math.round(props.elevation)}m</span>
          </div>
        </div>
      `)
      .addTo(map);

    popupRef.current = popup;
  };

  const flyToCenter = () => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 14 });
  };

  // BUILD STAMP - remove after debugging
  const BUILD_STAMP = 'V7-NATIVE-MAPBOX-2026-02-22';

  // ========== GLOBAL ERROR PANEL (catches unhandled errors) ==========
  if (globalError) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-8">
        <div className="max-w-2xl w-full bg-red-950/80 border border-red-500/50 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <Bug className="h-8 w-8 text-red-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-red-300 mb-2">Unhandled Error in /intel</h1>
              <div className="bg-black/50 rounded-lg p-4 mb-4 overflow-auto max-h-48">
                <p className="text-red-200 font-mono text-sm break-words">
                  {globalError.message}
                </p>
              </div>
              {globalError.stack && (
                <details className="mb-4">
                  <summary className="text-red-400 text-sm cursor-pointer hover:text-red-300">
                    Stack trace
                  </summary>
                  <pre className="bg-black/50 rounded-lg p-3 mt-2 text-xs text-red-300/80 overflow-auto max-h-64 whitespace-pre-wrap">
                    {globalError.stack}
                  </pre>
                </details>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => { setGlobalError(null); window.location.reload(); }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg font-medium"
                >
                  Reload Page
                </button>
                <Link
                  href="/core"
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg font-medium"
                >
                  Try /core instead
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-900 relative">
      {/* Map Container - z-0 ensures it's behind UI but visible */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ minHeight: '100vh', minWidth: '100vw' }} />

      {/* BUILD STAMP - visible debug marker */}
      <div className="absolute bottom-2 left-2 z-50 bg-fuchsia-600 text-white px-3 py-1 rounded font-mono text-xs font-bold shadow-lg">
        BUILD: {BUILD_STAMP}
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
        <div className="flex items-center justify-between px-4 py-3 pointer-events-auto">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/80 hover:text-white transition-colors">
              <Home className="h-5 w-5" />
            </Link>
            <div className="h-6 w-px bg-white/30" />
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-red-500" />
              <span className="font-bold text-white text-lg">Deer Intel</span>
            </div>
          </div>

          {/* Mode Badge */}
          <div className={`
            px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2
            ${mode === 'real' 
              ? 'bg-green-500/20 text-green-300 border border-green-500/40' 
              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}
          `}>
            {mode === 'real' ? (
              <><CheckCircle className="h-4 w-4" />USGS 10m DEM</>
            ) : (
              <><Info className="h-4 w-4" />Preview Mode</>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-white/80 hover:text-white hover:bg-white/10"
              onClick={flyToCenter}
            >
              <Crosshair className="h-4 w-4 mr-1" />
              Re-center
            </Button>
          </div>
        </div>
      </div>

      {/* Left Panel - Controls */}
      <div className={`
        absolute top-16 bottom-4 left-4 z-10 transition-all duration-300
        ${panelCollapsed ? 'w-12' : 'w-80'}
      `}>
        <div className="h-full bg-gray-900/95 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden flex flex-col shadow-2xl">
          {/* Collapse Toggle */}
          <button
            onClick={() => setPanelCollapsed(!panelCollapsed)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 bg-gray-800 border border-white/20 rounded-full p-1.5 hover:bg-gray-700 transition-colors"
          >
            {panelCollapsed ? <ChevronRight className="h-4 w-4 text-white" /> : <ChevronLeft className="h-4 w-4 text-white" />}
          </button>

          {panelCollapsed ? (
            <div className="flex flex-col items-center py-4 gap-4 text-white/60">
              <Mountain className="h-5 w-5" />
              <Calendar className="h-5 w-5" />
              <Wind className="h-5 w-5" />
              <Layers className="h-5 w-5" />
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* Property Info */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h2 className="font-semibold text-white text-sm leading-tight">{address}</h2>
                    <p className="text-xs text-white/60 mt-1">
                      {acreageParam ? `${acreageParam} acres` : '~80 acres'} • {lat.toFixed(4)}, {lng.toFixed(4)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Season Selector */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-white">Season Profile</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {SEASONS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => {
                        setSeason(s.value);
                        runAnalysis();
                      }}
                      className={`
                        p-2 rounded-lg text-center transition-all
                        ${season === s.value
                          ? 'bg-amber-500/30 border-2 border-amber-500 text-white'
                          : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'}
                      `}
                    >
                      <span className="text-lg block">{s.icon}</span>
                      <span className="text-xs font-medium block mt-1">{s.label}</span>
                      <span className="text-[10px] text-white/50 block">{s.dates}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Wind Selector */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Wind className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium text-white">Prevailing Wind</span>
                </div>
                <div className="relative w-40 h-40 mx-auto">
                  {/* Compass Rose */}
                  <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                  <div className="absolute inset-4 rounded-full border border-white/10" />
                  <Compass className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 text-white/30" />
                  
                  {WIND_DIRECTIONS.map((dir, i) => {
                    const angle = (i * 45 - 90) * (Math.PI / 180);
                    const radius = 60;
                    const x = 80 + Math.cos(angle) * radius;
                    const y = 80 + Math.sin(angle) * radius;
                    const isSelected = windDirection === dir;
                    
                    return (
                      <button
                        key={dir}
                        onClick={() => {
                          setWindDirection(dir);
                          runAnalysis();
                        }}
                        style={{ left: x - 14, top: y - 14 }}
                        className={`
                          absolute w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
                          ${isSelected
                            ? 'bg-blue-500 text-white scale-110 shadow-lg shadow-blue-500/50'
                            : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'}
                        `}
                      >
                        {dir}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-white/50 text-center mt-2">Select your dominant wind</p>
              </div>

              {/* Analysis Summary */}
              {summary && (
                <div className="p-4 flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium text-white">Analysis Summary</span>
                  </div>
                  <div className="space-y-3">
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-xs">Bedding Acres</span>
                        <span className="text-white font-bold">{summary.totalBeddingAcres.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-xs">Funnels Identified</span>
                        <span className="text-white font-bold">{summary.funnelCount}</span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-xs">Top Stand Score</span>
                        <span className="text-red-400 font-bold">{summary.topStandScore}/100</span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-xs">Analysis Area</span>
                        <span className="text-white font-bold">{summary.analysisAreaAcres.toFixed(0)} acres</span>
                      </div>
                    </div>
                  </div>

                  {/* Provenance */}
                  {provenance && (
                    <div className="mt-4 pt-4 border-t border-white/10 text-xs text-white/40 space-y-1">
                      <p>Source: {provenance.demSource}</p>
                      <p>Resolution: {provenance.demResolution}</p>
                      {provenance.processingTimeSeconds && (
                        <p>Processed in {provenance.processingTimeSeconds.toFixed(2)}s</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Re-analyze Button */}
              <div className="p-4 border-t border-white/10">
                <Button
                  onClick={runAnalysis}
                  disabled={isLoading}
                  className="w-full bg-amber-600 hover:bg-amber-500 text-white"
                >
                  {isLoading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing...</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-2" />Re-analyze Terrain</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Layer Filters + Top 2 Stands */}
      <div className={`
        absolute top-16 bottom-4 right-4 z-10 transition-all duration-300
        ${rightPanelCollapsed ? 'w-12' : 'w-72'}
      `}>
        <div className="h-full bg-gray-900/95 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden flex flex-col shadow-2xl">
          {/* Collapse Toggle */}
          <button
            onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 bg-gray-800 border border-white/20 rounded-full p-1.5 hover:bg-gray-700 transition-colors"
          >
            {rightPanelCollapsed ? <ChevronLeft className="h-4 w-4 text-white" /> : <ChevronRight className="h-4 w-4 text-white" />}
          </button>

          {rightPanelCollapsed ? (
            <div className="flex flex-col items-center py-4 gap-3 text-white/60">
              <Layers className="h-5 w-5" />
              <span className="text-xs [writing-mode:vertical-rl] rotate-180">Filters</span>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* Layer Filters */}
              <div className="p-4 border-b border-white/10">
                <h3 className="font-semibold text-white flex items-center gap-2 mb-3">
                  <Layers className="h-4 w-4 text-purple-400" />
                  Map Layers
                </h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setVisibility(v => ({ ...v, bedding: !v.bedding }))}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                      visibility.bedding ? 'bg-green-500/20 border border-green-500/50' : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <span className="w-4 h-4 rounded" style={{ background: LAYER_COLORS.bedding }} />
                    <span className="text-sm text-white/90 flex-1 text-left">Bedding Areas</span>
                    {visibility.bedding && <Check className="h-4 w-4 text-green-400" />}
                  </button>
                  <button
                    onClick={() => setVisibility(v => ({ ...v, funnels: !v.funnels }))}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                      visibility.funnels ? 'bg-orange-500/20 border border-orange-500/50' : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <span className="w-4 h-4 rounded" style={{ background: LAYER_COLORS.funnelSaddle }} />
                    <span className="text-sm text-white/90 flex-1 text-left">Saddles & Draws</span>
                    {visibility.funnels && <Check className="h-4 w-4 text-orange-400" />}
                  </button>
                  <button
                    onClick={() => setVisibility(v => ({ ...v, corridors: !v.corridors }))}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                      visibility.corridors ? 'bg-purple-500/20 border border-purple-500/50' : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <span className="w-4 h-4 rounded" style={{ background: LAYER_COLORS.funnelCorridor }} />
                    <span className="text-sm text-white/90 flex-1 text-left">Travel Corridors</span>
                    {visibility.corridors && <Check className="h-4 w-4 text-purple-400" />}
                  </button>
                  <button
                    onClick={() => setVisibility(v => ({ ...v, stands: !v.stands }))}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                      visibility.stands ? 'bg-red-500/20 border border-red-500/50' : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full" style={{ background: LAYER_COLORS.standHigh }} />
                    <span className="text-sm text-white/90 flex-1 text-left">Stand Sites</span>
                    {visibility.stands && <Check className="h-4 w-4 text-red-400" />}
                  </button>
                </div>
              </div>

              {/* Top 2 Stand Sites */}
              <div className="p-4 border-b border-white/10">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <Target className="h-4 w-4 text-red-500" />
                  Top 2 Stand Sites
                </h3>
                <p className="text-xs text-white/50 mt-1">Click to fly to location</p>
              </div>

              <div className="flex-1">
                {(layers?.standPoints?.features || []).slice(0, 2).map((feature) => {
                  const props = feature.properties as StandPointProperties;
                  const isSelected = selectedStand === props.rank;
                  const coords = feature.geometry.coordinates as [number, number];

                  return (
                    <button
                      key={props.rank}
                      onClick={() => {
                        setSelectedStand(props.rank);
                        showStandPopup(coords, props);
                        mapRef.current?.flyTo({ center: coords, zoom: 16 });
                      }}
                      className={`
                        w-full px-4 py-3 text-left transition-colors border-b border-white/5
                        ${isSelected ? 'bg-amber-500/20' : 'hover:bg-white/5'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-lg"
                          style={{ background: LAYER_COLORS.standHigh }}
                        >
                          {props.rank}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-white text-lg">{props.score}<span className="text-white/50 text-sm">/100</span></span>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                              props.approachRisk === 'low' ? 'bg-green-500/30 text-green-300' :
                              props.approachRisk === 'medium' ? 'bg-amber-500/30 text-amber-300' :
                              'bg-red-500/30 text-red-300'
                            }`}>
                              {props.approachRisk} risk
                            </span>
                          </div>
                          <p className="text-xs text-white/60 mt-1">{props.reasoning}</p>
                          <div className="flex gap-3 mt-2 text-xs">
                            <span className="text-green-400">✓ Wind: {props.windOk.slice(0,2).join(', ')}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-gray-900/95 rounded-xl p-8 text-center max-w-sm border border-white/10">
            <div className="relative w-20 h-20 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-amber-500/30" />
              <div 
                className="absolute inset-0 rounded-full border-4 border-amber-500 border-t-transparent animate-spin"
                style={{ animationDuration: '1s' }}
              />
              <Target className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-amber-500" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">Analyzing Terrain</h3>
            <p className="text-white/60 text-sm mb-4 font-mono">
              {progressStep}
            </p>
            <div className="text-white/40 text-xs mb-3">{progress}%</div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-white/40 text-xs mt-2">{progress}% complete</p>
          </div>
        </div>
      )}

      {/* Error Toast - shows actual error message */}
      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-red-900/95 border border-red-500/50 rounded-lg px-6 py-4 shadow-xl max-w-lg">
          <div className="flex items-start gap-4">
            <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-red-200 font-medium">Analysis Failed</p>
              <p className="text-red-300/80 text-sm mt-1 font-mono break-words">{error}</p>
              <div className="flex gap-3 mt-3">
                <button 
                  onClick={() => { setError(null); runAnalysis(); }}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded font-medium flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
                <button 
                  onClick={() => setError(null)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/80 text-xs rounded font-medium"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 flex-shrink-0">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Map Error Indicator - subtle notice without blocking UI */}
      {mapError && (
        <div className="absolute bottom-4 left-4 z-30 bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-amber-500/30">
          <p className="text-amber-400 text-xs font-medium">📍 Static View</p>
          <p className="text-white/60 text-xs">Interactive 3D unavailable</p>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-gray-900/90 backdrop-blur rounded-lg px-4 py-2 flex items-center gap-6 text-xs text-white/70 border border-white/10">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.bedding }} />
          <span>Bedding</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelSaddle }} />
          <span>Saddle</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelDraw }} />
          <span>Draw</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelCorridor }} />
          <span>Corridor</span>
        </div>
        <div className="h-4 w-px bg-white/20" />
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.standHigh }} />
          <span>Top 3</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.standMed }} />
          <span>4-7</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.standLow }} />
          <span>8-10</span>
        </div>
      </div>
    </div>
  );
}
