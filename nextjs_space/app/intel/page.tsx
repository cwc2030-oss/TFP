'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { 
  Target, TreePine, Wind, Calendar, ChevronLeft, ChevronRight, 
  Compass, Info, CheckCircle, AlertTriangle, Loader2, X, MapPin,
  Mountain, Eye, EyeOff, Layers, Crosshair, Home, ExternalLink,
  Maximize2, Minimize2, RefreshCw, Check
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

// Mapbox token
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

// Extend window for debugging
declare global {
  interface Window {
    __TFP_MAP__: mapboxgl.Map | null;
    __TFP_LAYERS_INITIALIZED__: boolean;
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

// Validate and fix GeoJSON for Mapbox consumption
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

// ========== LAYER STATE MACHINE ==========
const LAYER_IDS = {
  // Sources
  PARCEL_SOURCE: 'tfp-parcel',
  BEDDING_SOURCE: 'tfp-bedding',
  FUNNELS_SOURCE: 'tfp-funnels',
  
  // Layers
  PARCEL_LINE: 'tfp-parcel-line',
  BEDDING_FILL: 'tfp-bedding-fill',
  BEDDING_LINE: 'tfp-bedding-line',
  FUNNELS_FILL: 'tfp-funnels-fill',
  FUNNELS_LINE: 'tfp-funnels-line',
  FUNNELS_POINTS: 'tfp-funnels-points',
} as const;

const WIND_DIRECTIONS: WindDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SEASONS: { value: SeasonProfile; label: string; dates: string; icon: string }[] = [
  { value: 'early', label: 'Early Season', dates: 'Sept-Oct', icon: '🌿' },
  { value: 'rut', label: 'Rut', dates: 'Nov', icon: '🦌' },
  { value: 'late', label: 'Late Season', dates: 'Dec-Jan', icon: '❄️' },
];

const LAYER_COLORS = {
  bedding: '#22c55e',
  beddingOutline: '#16a34a',
  funnelSaddle: '#f97316',
  funnelDraw: '#3b82f6',
  funnelCorridor: '#a855f7',
  standHigh: '#ef4444',
  standMed: '#f59e0b',
  standLow: '#6b7280',
};

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
    <Suspense fallback={<LoadingFallback />}>
      <DeerIntelContent />
    </Suspense>
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
  const [parcelPolygon, setParcelPolygon] = useState<GeoJSON.Feature<GeoJSON.Polygon> | null>(null);

  // Check WebGL support
  const checkWebGLSupport = (): boolean => {
    // Skip check - let Mapbox handle it gracefully
    // Most modern browsers support WebGL
    return true;
  };

  // Generate parcel polygon from center point
  const generateParcelPolygon = useCallback((centerLat: number, centerLng: number, acres: number = 80): GeoJSON.Feature<GeoJSON.Polygon> => {
    // Create a rough square parcel
    const sqMeters = acres * 4046.86;
    const sideMeters = Math.sqrt(sqMeters);
    const latOffset = (sideMeters / 2) / 111000;
    const lngOffset = (sideMeters / 2) / 85000;

    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [centerLng - lngOffset, centerLat - latOffset],
          [centerLng + lngOffset, centerLat - latOffset],
          [centerLng + lngOffset, centerLat + latOffset],
          [centerLng - lngOffset, centerLat + latOffset],
          [centerLng - lngOffset, centerLat - latOffset],
        ]],
      },
    };
  }, []);

  // Fetch terrain analysis
  const runAnalysis = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setProgress(10);

    try {
      const acreage = acreageParam ? parseFloat(acreageParam) : 80;
      const parcel = generateParcelPolygon(lat, lng, acreage);
      setParcelPolygon(parcel); // Save for map display

      setProgress(30);

      const response = await fetch('/api/terrain-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcel,
          bufferMeters: 800,
          seasonProfile: season,
          prevailingWinds: [windDirection],
        }),
      });

      setProgress(70);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Analysis failed');
      }

      const data = await response.json();
      setProgress(90);

      setMode(data.mode);
      setLayers(data.layers);
      setSummary(data.summary);
      setProvenance(data.provenance);
      setProgress(100);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  }, [lat, lng, season, windDirection, acreageParam, generateParcelPolygon]);

  // ========== TERRAIN LAYERS INITIALIZATION (State Machine) ==========
  const initTerrainLayers = useCallback((map: mapboxgl.Map) => {
    if (typeof window !== 'undefined' && window.__TFP_LAYERS_INITIALIZED__) {
      console.log('[TFP] Layers already initialized, skipping init');
      return;
    }
    
    console.log('[TFP] ====== initTerrainLayers START ======');
    
    // Find a suitable beforeId - we want to be above satellite but below labels
    // Look for first symbol layer (usually labels)
    let beforeId: string | undefined;
    const styleLayers = map.getStyle()?.layers || [];
    for (const layer of styleLayers) {
      if (layer.type === 'symbol') {
        beforeId = layer.id;
        break;
      }
    }
    console.log('[TFP] Will insert layers before:', beforeId || '(top of stack)');
    
    // Empty GeoJSON for initial sources
    const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    
    try {
      // 1. PARCEL SOURCE & LAYER (yellow boundary line)
      if (!map.getSource(LAYER_IDS.PARCEL_SOURCE)) {
        map.addSource(LAYER_IDS.PARCEL_SOURCE, { type: 'geojson', data: emptyFC });
        console.log('[TFP] Added source:', LAYER_IDS.PARCEL_SOURCE);
      }
      if (!map.getLayer(LAYER_IDS.PARCEL_LINE)) {
        map.addLayer({
          id: LAYER_IDS.PARCEL_LINE,
          type: 'line',
          source: LAYER_IDS.PARCEL_SOURCE,
          paint: {
            'line-color': '#fbbf24',
            'line-width': 4,
            'line-dasharray': [3, 2],
          },
        }, beforeId);
        console.log('[TFP] Added layer:', LAYER_IDS.PARCEL_LINE);
      }
      
      // 2. BEDDING SOURCE & LAYERS (green fill + outline)
      if (!map.getSource(LAYER_IDS.BEDDING_SOURCE)) {
        map.addSource(LAYER_IDS.BEDDING_SOURCE, { type: 'geojson', data: emptyFC });
        console.log('[TFP] Added source:', LAYER_IDS.BEDDING_SOURCE);
      }
      if (!map.getLayer(LAYER_IDS.BEDDING_FILL)) {
        map.addLayer({
          id: LAYER_IDS.BEDDING_FILL,
          type: 'fill',
          source: LAYER_IDS.BEDDING_SOURCE,
          paint: {
            'fill-color': LAYER_COLORS.bedding,
            'fill-opacity': 0.4,
          },
        }, beforeId);
        console.log('[TFP] Added layer:', LAYER_IDS.BEDDING_FILL);
      }
      if (!map.getLayer(LAYER_IDS.BEDDING_LINE)) {
        map.addLayer({
          id: LAYER_IDS.BEDDING_LINE,
          type: 'line',
          source: LAYER_IDS.BEDDING_SOURCE,
          paint: {
            'line-color': LAYER_COLORS.beddingOutline,
            'line-width': 2,
          },
        }, beforeId);
        console.log('[TFP] Added layer:', LAYER_IDS.BEDDING_LINE);
      }
      
      // 3. FUNNELS SOURCE & LAYERS (fill for saddles, lines for draws/corridors, circles for points)
      if (!map.getSource(LAYER_IDS.FUNNELS_SOURCE)) {
        map.addSource(LAYER_IDS.FUNNELS_SOURCE, { type: 'geojson', data: emptyFC });
        console.log('[TFP] Added source:', LAYER_IDS.FUNNELS_SOURCE);
      }
      // Saddle fills (orange polygons)
      if (!map.getLayer(LAYER_IDS.FUNNELS_FILL)) {
        map.addLayer({
          id: LAYER_IDS.FUNNELS_FILL,
          type: 'fill',
          source: LAYER_IDS.FUNNELS_SOURCE,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'fill-color': LAYER_COLORS.funnelSaddle,
            'fill-opacity': 0.5,
          },
        }, beforeId);
        console.log('[TFP] Added layer:', LAYER_IDS.FUNNELS_FILL);
      }
      // Draw/corridor lines
      if (!map.getLayer(LAYER_IDS.FUNNELS_LINE)) {
        map.addLayer({
          id: LAYER_IDS.FUNNELS_LINE,
          type: 'line',
          source: LAYER_IDS.FUNNELS_SOURCE,
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: {
            'line-color': [
              'case',
              ['==', ['get', 'funnelType'], 'draw'], LAYER_COLORS.funnelDraw,
              ['==', ['get', 'funnelType'], 'corridor'], LAYER_COLORS.funnelCorridor,
              LAYER_COLORS.funnelSaddle
            ],
            'line-width': 5,
            'line-opacity': 0.9,
          },
        }, beforeId);
        console.log('[TFP] Added layer:', LAYER_IDS.FUNNELS_LINE);
      }
      // Funnel points (circles)
      if (!map.getLayer(LAYER_IDS.FUNNELS_POINTS)) {
        map.addLayer({
          id: LAYER_IDS.FUNNELS_POINTS,
          type: 'circle',
          source: LAYER_IDS.FUNNELS_SOURCE,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 10,
            'circle-color': LAYER_COLORS.funnelSaddle,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
        }, beforeId);
        console.log('[TFP] Added layer:', LAYER_IDS.FUNNELS_POINTS);
      }
      
      if (typeof window !== 'undefined') {
        window.__TFP_LAYERS_INITIALIZED__ = true;
      }
      console.log('[TFP] ====== initTerrainLayers COMPLETE ======');
      
    } catch (err) {
      console.error('[TFP] Error in initTerrainLayers:', err);
    }
  }, []);
  
  // ========== UPDATE LAYER DATA (setData, no add/remove) ==========
  const updateLayerData = useCallback((map: mapboxgl.Map) => {
    console.log('[TFP] ====== updateLayerData START ======');
    
    // 1. Update parcel boundary
    if (parcelPolygon) {
      const parcelFC = validateGeoJSON(parcelPolygon);
      const source = map.getSource(LAYER_IDS.PARCEL_SOURCE) as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(parcelFC);
        console.log('[TFP] Updated parcel data:', parcelFC.features.length, 'features');
      } else {
        console.warn('[TFP] Parcel source not found');
      }
    }
    
    // 2. Update bedding
    if (layers?.beddingPolygons) {
      const beddingFC = validateGeoJSON(layers.beddingPolygons);
      // Only keep polygon/multipolygon geometries for fill layers
      const filteredBedding = filterByGeometryType(beddingFC, ['Polygon', 'MultiPolygon']);
      const source = map.getSource(LAYER_IDS.BEDDING_SOURCE) as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(filteredBedding);
        console.log('[TFP] Updated bedding data:', filteredBedding.features.length, 'polygon features');
      } else {
        console.warn('[TFP] Bedding source not found');
      }
    }
    
    // 3. Update funnels (mixed geometry types)
    if (layers?.funnels) {
      const funnelsFC = validateGeoJSON(layers.funnels);
      const source = map.getSource(LAYER_IDS.FUNNELS_SOURCE) as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(funnelsFC);
        console.log('[TFP] Updated funnels data:', funnelsFC.features.length, 'features');
        // Log geometry type breakdown
        const geomTypes: Record<string, number> = {};
        funnelsFC.features.forEach(f => {
          const t = f.geometry?.type || 'unknown';
          geomTypes[t] = (geomTypes[t] || 0) + 1;
        });
        console.log('[TFP] Funnel geometry breakdown:', geomTypes);
      } else {
        console.warn('[TFP] Funnels source not found');
      }
    }
    
    console.log('[TFP] ====== updateLayerData COMPLETE ======');
  }, [parcelPolygon, layers]);

  // Initialize map
  useEffect(() => {
    console.log('[TFP] Map init effect running, container:', !!mapContainerRef.current, 'mapRef:', !!mapRef.current);
    
    if (!mapContainerRef.current || mapRef.current) {
      console.log('[TFP] Skipping - container or map already exists');
      return;
    }

    // Check WebGL support first
    if (!checkWebGLSupport()) {
      console.log('[TFP] WebGL check failed');
      setMapError("Your browser doesn't support WebGL, which is required for 3D terrain viewing.");
      setIsLoading(false);
      return;
    }

    // Check token
    if (!MAPBOX_TOKEN) {
      console.log('[TFP] No Mapbox token');
      setMapError("Map configuration error. Please try again later.");
      setIsLoading(false);
      return;
    }

    console.log('[TFP] Creating Mapbox map with token:', MAPBOX_TOKEN.substring(0, 20) + '...');
    mapboxgl.accessToken = MAPBOX_TOKEN;

    // Reset layer init flag on new map
    if (typeof window !== 'undefined') {
      window.__TFP_LAYERS_INITIALIZED__ = false;
    }

    let map: mapboxgl.Map;

    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: 14,
        pitch: 45,
        bearing: -20,
      });
      console.log('[TFP] Mapbox Map instance created');
      
      // Expose for debugging
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = map;
        console.log('[TFP] window.__TFP_MAP__ set for debugging');
      }
    } catch (err) {
      console.error("[TFP] Failed to initialize Mapbox:", err);
      setMapError("Failed to load 3D map. Please try refreshing the page.");
      setIsLoading(false);
      return;
    }

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    console.log('[TFP] Navigation control added');

    // Comprehensive error logging
    map.on('error', (e: any) => {
      console.error("[TFP] ====== MAPBOX ERROR ======");
      console.error("[TFP] Error event:", e);
      console.error("[TFP] Error message:", e?.error?.message || e?.message || 'Unknown');
      console.error("[TFP] Error status:", e?.error?.status);
      console.error("[TFP] Source ID:", e?.sourceId);
      console.error("[TFP] Tile:", e?.tile);
      
      // Only set UI error for critical failures
      if (e?.error?.status === 401) {
        setMapError("Map authentication error. Please contact support.");
      } else if (e?.error?.status === 403) {
        setMapError("Map access denied. Please contact support.");
      }
    });

    // Style load handler - initialize our layers
    const handleStyleLoad = () => {
      console.log('[TFP] style.load event fired');
      
      // Add terrain DEM
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.terrain-rgb',
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
        console.log('[TFP] Added terrain DEM');
      }

      // Add sky atmosphere
      if (!map.getLayer('sky')) {
        map.addLayer({
          id: 'sky',
          type: 'sky',
          paint: {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 90.0],
            'sky-atmosphere-sun-intensity': 15,
          },
        });
        console.log('[TFP] Added sky layer');
      }
      
      // Initialize our terrain layers (state machine)
      initTerrainLayers(map);
      
      setMapReady(true);
      console.log('[TFP] Map ready state set to true');
    };

    // Handle both initial load and style changes
    map.on('load', handleStyleLoad);
    map.on('style.load', () => {
      console.log('[TFP] style.load event - checking if re-init needed');
      if (typeof window !== 'undefined') {
        window.__TFP_LAYERS_INITIALIZED__ = false;
      }
      handleStyleLoad();
    });

    mapRef.current = map;

    return () => {
      console.log('[TFP] Cleaning up map');
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = null;
        window.__TFP_LAYERS_INITIALIZED__ = false;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, initTerrainLayers]);

  // Run analysis immediately on mount, and when season/wind changes
  useEffect(() => {
    runAnalysis();
  }, [season, windDirection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ========== DATA UPDATE EFFECT ==========
  // When layers or parcelPolygon change, update the source data (no add/remove)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      console.log('[TFP] Skipping data update - map not ready');
      return;
    }
    if (!layers && !parcelPolygon) {
      console.log('[TFP] Skipping data update - no data yet');
      return;
    }

    console.log('[TFP] Data update effect triggered');
    console.log('[TFP] parcelPolygon:', parcelPolygon ? 'exists' : 'null');
    console.log('[TFP] layers:', layers ? 'exists' : 'null');
    console.log('[TFP] layers initialized:', typeof window !== 'undefined' ? window.__TFP_LAYERS_INITIALIZED__ : 'N/A');

    // Ensure layers are initialized
    if (typeof window !== 'undefined' && !window.__TFP_LAYERS_INITIALIZED__) {
      console.log('[TFP] Layers not initialized yet, calling initTerrainLayers');
      initTerrainLayers(map);
    }

    // Small delay to ensure sources exist after init
    const timerId = setTimeout(() => {
      updateLayerData(map);
      // Also add stand markers (HTML elements)
      addStandMarkers();
    }, 100);

    return () => clearTimeout(timerId);
  }, [layers, mapReady, parcelPolygon, initTerrainLayers, updateLayerData]);

  // ========== VISIBILITY TOGGLE EFFECT ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    console.log('[TFP] Visibility update:', visibility);

    // Bedding layers
    if (map.getLayer(LAYER_IDS.BEDDING_FILL)) {
      map.setPaintProperty(LAYER_IDS.BEDDING_FILL, 'fill-opacity', visibility.bedding ? 0.4 : 0);
    }
    if (map.getLayer(LAYER_IDS.BEDDING_LINE)) {
      map.setPaintProperty(LAYER_IDS.BEDDING_LINE, 'line-opacity', visibility.bedding ? 1 : 0);
    }

    // Funnel layers (fill = saddles which use funnels toggle)
    if (map.getLayer(LAYER_IDS.FUNNELS_FILL)) {
      map.setPaintProperty(LAYER_IDS.FUNNELS_FILL, 'fill-opacity', visibility.funnels ? 0.5 : 0);
    }
    // Funnel lines (draws/corridors)
    if (map.getLayer(LAYER_IDS.FUNNELS_LINE)) {
      // Line visibility depends on both funnels and corridors toggles
      // For now, use funnels toggle (can be refined if draws need separate control)
      map.setPaintProperty(LAYER_IDS.FUNNELS_LINE, 'line-opacity', visibility.funnels || visibility.corridors ? 0.9 : 0);
    }
    // Funnel points
    if (map.getLayer(LAYER_IDS.FUNNELS_POINTS)) {
      map.setPaintProperty(LAYER_IDS.FUNNELS_POINTS, 'circle-opacity', visibility.funnels ? 1 : 0);
    }

    // Stand markers (HTML elements)
    markersRef.current.forEach(marker => {
      marker.getElement().style.display = visibility.stands ? 'block' : 'none';
    });

  }, [visibility, mapReady]);

  // Clean up layers (called before re-adding markers)
  const removeLayers = () => {
    const map = mapRef.current;
    if (!map) return;

    // Remove layers first
    [LAYER_IDS.PARCEL_LINE, LAYER_IDS.BEDDING_FILL, LAYER_IDS.BEDDING_LINE, 
     LAYER_IDS.FUNNELS_FILL, LAYER_IDS.FUNNELS_LINE, LAYER_IDS.FUNNELS_POINTS].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    // Then remove sources
    [LAYER_IDS.PARCEL_SOURCE, LAYER_IDS.BEDDING_SOURCE, LAYER_IDS.FUNNELS_SOURCE].forEach(id => {
      if (map.getSource(id)) map.removeSource(id);
    });

    // Reset init flag
    if (typeof window !== 'undefined') {
      window.__TFP_LAYERS_INITIALIZED__ = false;
    }

    // Clean up markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
    
    console.log('[TFP] Layers removed');
  };

  const addStandMarkers = () => {
    const map = mapRef.current;
    if (!map || !layers?.standPoints) return;

    // Clear existing markers first
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Only show TOP 2 stands on the map
    const topTwoStands = layers.standPoints.features.slice(0, 2);
    console.log('[TFP] Adding', topTwoStands.length, 'stand markers (top 2 only)');

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
        map.flyTo({ center: coords, zoom: 16, pitch: 60 });
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
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, pitch: 45, bearing: -20 });
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-900 relative">
      {/* Map Container - z-0 ensures it's behind UI but visible */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ minHeight: '100vh', minWidth: '100vw' }} />

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
                {layers?.standPoints.features.slice(0, 2).map((feature) => {
                  const props = feature.properties as StandPointProperties;
                  const isSelected = selectedStand === props.rank;
                  const coords = feature.geometry.coordinates as [number, number];

                  return (
                    <button
                      key={props.rank}
                      onClick={() => {
                        setSelectedStand(props.rank);
                        showStandPopup(coords, props);
                        mapRef.current?.flyTo({ center: coords, zoom: 16, pitch: 60 });
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
            <p className="text-white/60 text-sm mb-4">
              {progress < 30 ? 'Fetching elevation data...' :
               progress < 60 ? 'Calculating slopes & aspect...' :
               progress < 80 ? 'Identifying bedding & funnels...' :
               'Scoring stand sites...'}
            </p>
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

      {/* Error Toast */}
      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-red-900/90 border border-red-500/50 rounded-lg px-6 py-4 flex items-center gap-4 shadow-xl">
          <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-red-200 font-medium">Analysis Error</p>
            <p className="text-red-300/80 text-sm">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X className="h-5 w-5" />
          </button>
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
