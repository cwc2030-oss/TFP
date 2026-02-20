'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { 
  Target, TreePine, Wind, Calendar, ChevronLeft, ChevronRight, 
  Compass, Info, CheckCircle, AlertTriangle, Loader2, X, MapPin,
  Mountain, Eye, EyeOff, Layers, Crosshair, Home, ExternalLink,
  Maximize2, Minimize2, RefreshCw
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

  // Check WebGL support
  const checkWebGLSupport = (): boolean => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return false;
      if (gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext) {
        return !gl.isContextLost();
      }
      return true;
    } catch (e) {
      console.error("WebGL check failed:", e);
      return false;
    }
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

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Check WebGL support first
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

    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: 14,
        pitch: 45,
        bearing: -20,
      });
    } catch (err) {
      console.error("Failed to initialize Mapbox:", err);
      setMapError("Failed to load 3D map. Please try refreshing the page.");
      setIsLoading(false);
      return;
    }

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      // Add terrain
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.terrain-rgb',
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

      // Add sky
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 90.0],
          'sky-atmosphere-sun-intensity': 15,
        },
      });

      setMapReady(true);
    });

    map.on('error', (e) => {
      console.error("Mapbox error:", e);
      setMapError("Map loading error. Please refresh the page.");
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng]);

  // Run analysis when map is ready
  useEffect(() => {
    if (mapReady) {
      runAnalysis();
    }
  }, [mapReady, runAnalysis]);

  // Render terrain layers on map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layers || !mapReady) return;

    const addLayers = () => {
      // Remove existing
      removeLayers();

      // Bedding polygons
      if (layers.beddingPolygons.features.length > 0) {
        map.addSource('terrain-bedding', {
          type: 'geojson',
          data: layers.beddingPolygons as GeoJSON.FeatureCollection,
        });

        map.addLayer({
          id: 'terrain-bedding-fill',
          type: 'fill',
          source: 'terrain-bedding',
          paint: {
            'fill-color': LAYER_COLORS.bedding,
            'fill-opacity': visibility.bedding ? 0.35 : 0,
          },
        });

        map.addLayer({
          id: 'terrain-bedding-outline',
          type: 'line',
          source: 'terrain-bedding',
          paint: {
            'line-color': LAYER_COLORS.beddingOutline,
            'line-width': 2,
            'line-opacity': visibility.bedding ? 1 : 0,
          },
        });
      }

      // Funnels
      if (layers.funnels.features.length > 0) {
        map.addSource('terrain-funnels', {
          type: 'geojson',
          data: layers.funnels as GeoJSON.FeatureCollection,
        });

        map.addLayer({
          id: 'terrain-funnels-saddle-fill',
          type: 'fill',
          source: 'terrain-funnels',
          filter: ['==', ['get', 'funnelType'], 'saddle'],
          paint: {
            'fill-color': LAYER_COLORS.funnelSaddle,
            'fill-opacity': visibility.funnels ? 0.5 : 0,
          },
        });

        map.addLayer({
          id: 'terrain-funnels-draw',
          type: 'line',
          source: 'terrain-funnels',
          filter: ['==', ['get', 'funnelType'], 'draw'],
          paint: {
            'line-color': LAYER_COLORS.funnelDraw,
            'line-width': 4,
            'line-dasharray': [4, 2],
            'line-opacity': visibility.funnels ? 1 : 0,
          },
        });

        map.addLayer({
          id: 'terrain-funnels-corridor',
          type: 'line',
          source: 'terrain-funnels',
          filter: ['==', ['get', 'funnelType'], 'corridor'],
          paint: {
            'line-color': LAYER_COLORS.funnelCorridor,
            'line-width': 5,
            'line-opacity': visibility.corridors ? 0.9 : 0,
          },
        });
      }

      // Stand markers
      addStandMarkers();
    };

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.once('style.load', addLayers);
    }

  }, [layers, mapReady]);

  // Update visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Bedding
    if (map.getLayer('terrain-bedding-fill')) {
      map.setPaintProperty('terrain-bedding-fill', 'fill-opacity', visibility.bedding ? 0.35 : 0);
      map.setPaintProperty('terrain-bedding-outline', 'line-opacity', visibility.bedding ? 1 : 0);
    }

    // Funnels
    if (map.getLayer('terrain-funnels-saddle-fill')) {
      map.setPaintProperty('terrain-funnels-saddle-fill', 'fill-opacity', visibility.funnels ? 0.5 : 0);
    }
    if (map.getLayer('terrain-funnels-draw')) {
      map.setPaintProperty('terrain-funnels-draw', 'line-opacity', visibility.funnels ? 1 : 0);
    }
    if (map.getLayer('terrain-funnels-corridor')) {
      map.setPaintProperty('terrain-funnels-corridor', 'line-opacity', visibility.corridors ? 0.9 : 0);
    }

    // Markers
    markersRef.current.forEach(marker => {
      marker.getElement().style.display = visibility.stands ? 'block' : 'none';
    });

  }, [visibility, mapReady]);

  const removeLayers = () => {
    const map = mapRef.current;
    if (!map) return;

    ['terrain-bedding-fill', 'terrain-bedding-outline', 'terrain-funnels-saddle-fill', 'terrain-funnels-draw', 'terrain-funnels-corridor'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    ['terrain-bedding', 'terrain-funnels'].forEach(id => {
      if (map.getSource(id)) map.removeSource(id);
    });

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

    layers.standPoints.features.forEach((feature) => {
      const props = feature.properties as StandPointProperties;
      const coords = feature.geometry.coordinates as [number, number];

      const el = document.createElement('div');
      el.className = 'intel-stand-marker';
      el.innerHTML = `
        <div style="
          width: ${props.rank <= 3 ? 40 : 32}px;
          height: ${props.rank <= 3 ? 40 : 32}px;
          background: ${props.rank <= 3 ? LAYER_COLORS.standHigh : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow};
          border: 3px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: ${props.rank <= 3 ? 16 : 14}px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
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
      {/* Map Container */}
      <div ref={mapContainerRef} className="absolute inset-0" />

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

              {/* Layer Visibility */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-medium text-white">Intel Layers</span>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibility.bedding}
                      onChange={() => setVisibility(v => ({ ...v, bedding: !v.bedding }))}
                      className="rounded border-white/30 bg-white/10 text-green-500"
                    />
                    <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.bedding }} />
                    <span className="text-sm text-white/80">Bedding Areas</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibility.funnels}
                      onChange={() => setVisibility(v => ({ ...v, funnels: !v.funnels }))}
                      className="rounded border-white/30 bg-white/10 text-orange-500"
                    />
                    <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelSaddle }} />
                    <span className="text-sm text-white/80">Saddles & Draws</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibility.corridors}
                      onChange={() => setVisibility(v => ({ ...v, corridors: !v.corridors }))}
                      className="rounded border-white/30 bg-white/10 text-purple-500"
                    />
                    <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelCorridor }} />
                    <span className="text-sm text-white/80">Travel Corridors</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibility.stands}
                      onChange={() => setVisibility(v => ({ ...v, stands: !v.stands }))}
                      className="rounded border-white/30 bg-white/10 text-red-500"
                    />
                    <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.standHigh }} />
                    <span className="text-sm text-white/80">Stand Sites</span>
                  </label>
                </div>
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

      {/* Right Panel - Stand List */}
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
              <Target className="h-5 w-5" />
              <span className="text-xs [writing-mode:vertical-rl] rotate-180">Stands</span>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-white/10">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <Target className="h-4 w-4 text-red-500" />
                  Top 10 Stand Sites
                </h3>
                <p className="text-xs text-white/50 mt-1">Click to fly to location</p>
              </div>

              <div className="flex-1 overflow-y-auto">
                {layers?.standPoints.features.map((feature) => {
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
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                          style={{
                            background: props.rank <= 3 ? LAYER_COLORS.standHigh : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow,
                          }}
                        >
                          {props.rank}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white">{props.score}<span className="text-white/50 text-xs">/100</span></span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              props.approachRisk === 'low' ? 'bg-green-500/30 text-green-300' :
                              props.approachRisk === 'medium' ? 'bg-amber-500/30 text-amber-300' :
                              'bg-red-500/30 text-red-300'
                            }`}>
                              {props.approachRisk}
                            </span>
                          </div>
                          <p className="text-xs text-white/50 truncate mt-0.5">{props.reasoning}</p>
                          <div className="flex gap-2 mt-1 text-[10px]">
                            <span className="text-green-400">✓ {props.windOk.slice(0,2).join(',')}</span>
                            <span className="text-red-400">✗ {props.windBad.slice(0,2).join(',')}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
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

      {/* Map Error Overlay */}
      {mapError && (
        <div className="absolute inset-0 z-40 bg-gray-900/95 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mountain className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Unable to Load Map</h3>
            <p className="text-gray-400 text-sm mb-6">{mapError}</p>
            <div className="flex gap-3 justify-center">
              <Link href="/">
                <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-800">
                  Go Home
                </Button>
              </Link>
              <Button onClick={() => window.location.reload()} className="bg-amber-600 hover:bg-amber-500 text-white">
                Refresh Page
              </Button>
            </div>
          </div>
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
