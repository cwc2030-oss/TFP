/**
 * /viewer - Leaflet-based 2D map viewer with terrain overlays
 * No WebGL, no Deck.gl, no 3D - pure Leaflet with MapTiler hybrid basemap
 */
'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AlertTriangle, Layers, X, Target, Bed, TreeDeciduous, Droplet, ChevronRight, Activity, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchTerrainAnalysis, fetchParcelGeometry, generateSyntheticParcel } from '@/lib/terrain-client';
import type { TerrainAnalysisResponse, TerrainLayers, BeddingProperties, FunnelProperties, StandPointProperties } from '@/types/terrain';

// Compute state types
type ComputeState = 'idle' | 'processing' | 'computed' | 'error';

interface ComputeStatus {
  terrain: { state: ComputeState; timestamp?: string };
  corridors: { state: ComputeState; timestamp?: string };
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
  };
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

function ViewerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // URL params
  const lat = parseFloat(searchParams.get('lat') || '38.5');
  const lng = parseFloat(searchParams.get('lng') || '-92.5');
  const address = searchParams.get('address') || 'Unknown Location';
  
  // State
  const [parcel, setParcel] = useState<GeoJSON.Feature | null>(null);
  const [layers, setLayers] = useState<TerrainLayers | null>(null);
  const [provenance, setProvenance] = useState<TerrainAnalysisResponse['provenance'] | null>(null);
  const [corridorData, setCorridorData] = useState<CorridorData | null>(null);
  const [corridorLoading, setCorridorLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  
  // Layer visibility
  const [layerVisibility, setLayerVisibility] = useState({
    parcel: true,
    bedding: true,
    funnels: true,
    saddles: true,
    stands: true,
    corridors: false, // Off by default, user toggles on
  });
  const [showLegend, setShowLegend] = useState(true);
  const [showSystemPanel, setShowSystemPanel] = useState(true);
  
  // Compute status tracking
  const [computeStatus, setComputeStatus] = useState<ComputeStatus>({
    terrain: { state: 'idle' },
    corridors: { state: 'idle' },
  });

  // Fetch parcel and terrain data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setProgress(10);
    setError(null);
    setOverlayError(null);
    
    // Set terrain compute state to processing
    setComputeStatus(prev => ({
      ...prev,
      terrain: { state: 'processing' }
    }));

    try {
      // Step 1: Get parcel geometry
      setProgress(20);
      let parcelFeature = await fetchParcelGeometry(lat, lng);
      
      if (!parcelFeature) {
        // Use synthetic parcel as fallback
        parcelFeature = generateSyntheticParcel(lat, lng, 80);
        console.log('[Viewer] Using synthetic parcel');
      }
      
      setParcel(parcelFeature);
      setProgress(40);

      // Step 2: Fetch terrain analysis
      const result = await fetchTerrainAnalysis(
        {
          parcel: parcelFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
          seasonProfile: 'rut',
          prevailingWinds: ['NW', 'N'],
          bufferMeters: 800,
        },
        (step, pct) => setProgress(40 + pct * 0.5),
        120000
      );

      if (result.success && result.data) {
        setLayers(result.data.layers);
        setProvenance(result.data.provenance);
        setComputeStatus(prev => ({
          ...prev,
          terrain: { state: 'computed', timestamp: new Date().toISOString() }
        }));
        console.log('[Viewer] Terrain data loaded:', {
          bedding: result.data.layers.beddingPolygons?.features?.length || 0,
          funnels: result.data.layers.funnels?.features?.length || 0,
          stands: result.data.layers.standPoints?.features?.length || 0,
        });
      } else {
        // Non-fatal: viewer still loads, just show banner
        setOverlayError(result.error || 'Could not load terrain overlays');
        setComputeStatus(prev => ({
          ...prev,
          terrain: { state: 'error' }
        }));
        console.warn('[Viewer] Overlay fetch failed:', result.error);
      }

      setProgress(100);
    } catch (err) {
      console.error('[Viewer] Load error:', err);
      setOverlayError(err instanceof Error ? err.message : 'Failed to load overlays');
      setComputeStatus(prev => ({
        ...prev,
        terrain: { state: 'error' }
      }));
    } finally {
      setIsLoading(false);
    }
  }, [lat, lng]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleLayer = (layer: keyof typeof layerVisibility) => {
    setLayerVisibility(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  // Load corridor data when toggled on
  const loadCorridors = useCallback(async () => {
    if (!parcel || corridorData || corridorLoading) return;
    
    setCorridorLoading(true);
    setComputeStatus(prev => ({
      ...prev,
      corridors: { state: 'processing' }
    }));
    
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
      });

      if (response.ok) {
        const data = await response.json();
        setCorridorData(data);
        setComputeStatus(prev => ({
          ...prev,
          corridors: { state: 'computed', timestamp: new Date().toISOString() }
        }));
        console.log('[Viewer] Corridor data loaded:', data.mode || 'real');
      } else {
        console.warn('[Viewer] Corridor fetch failed:', response.status);
        setOverlayError('Could not load corridor data');
        setComputeStatus(prev => ({
          ...prev,
          corridors: { state: 'error' }
        }));
      }
    } catch (err) {
      console.error('[Viewer] Corridor error:', err);
      setOverlayError('Corridor analysis failed');
      setComputeStatus(prev => ({
        ...prev,
        corridors: { state: 'error' }
      }));
    } finally {
      setCorridorLoading(false);
    }
  }, [parcel, corridorData, corridorLoading, lat, lng]);

  // Trigger corridor load when toggled on
  useEffect(() => {
    if (layerVisibility.corridors && !corridorData && !corridorLoading) {
      loadCorridors();
    }
  }, [layerVisibility.corridors, corridorData, corridorLoading, loadCorridors]);

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

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-900/80 z-30 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent mx-auto mb-4" />
            <p className="text-white mb-2">Loading terrain data...</p>
            <div className="w-48 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Map Container */}
      <div className="flex-1 relative">
        <LeafletMap
          center={[lat, lng]}
          parcel={parcel}
          layers={layers}
          corridorData={corridorData}
          layerVisibility={layerVisibility}
          provenance={provenance}
          onMapReady={() => setMapReady(true)}
        />

        {/* Legend Panel */}
        {showLegend && mapReady && (
          <div className="absolute top-4 right-4 bg-slate-800/95 backdrop-blur rounded-lg border border-slate-700 p-3 z-20 w-56 shadow-xl">
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

              {/* Corridors (V1) */}
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
          <div className="absolute bottom-4 left-4 bg-slate-800/95 backdrop-blur rounded-lg border border-slate-700 p-3 z-20 min-w-[200px] shadow-xl">
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
            
            <div className="space-y-2">
              {/* Terrain Analysis Status */}
              <ComputeIndicator
                label="Terrain Analysis"
                state={computeStatus.terrain.state}
                timestamp={computeStatus.terrain.timestamp}
              />
              
              {/* Corridor Analysis Status */}
              {(computeStatus.corridors.state !== 'idle' || layerVisibility.corridors) && (
                <ComputeIndicator
                  label="Travel Corridors"
                  state={computeStatus.corridors.state}
                  timestamp={computeStatus.corridors.timestamp}
                />
              )}
            </div>
          </div>
        )}
        
        {/* System Panel Toggle (when hidden) */}
        {!showSystemPanel && mapReady && (
          <button
            onClick={() => setShowSystemPanel(true)}
            className="absolute bottom-4 left-4 bg-slate-800/90 backdrop-blur rounded-lg border border-slate-700 p-2 z-20 hover:bg-slate-700/90 transition-colors"
            title="Show System Status"
          >
            <Activity className="w-4 h-4 text-slate-300" />
          </button>
        )}
      </div>
    </div>
  );
}

// Compute Indicator Component
function ComputeIndicator({ 
  label, 
  state, 
  timestamp 
}: { 
  label: string; 
  state: ComputeState; 
  timestamp?: string;
}) {
  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex items-center gap-2">
      {/* Pulse/Solid Indicator */}
      <div className="relative flex items-center justify-center w-4 h-4">
        {state === 'processing' && (
          <>
            {/* Pulsing ring */}
            <div className="absolute w-3 h-3 rounded-full bg-amber-500/30 animate-ping" />
            {/* Core dot */}
            <div className="relative w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          </>
        )}
        {state === 'computed' && (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
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
            state === 'error' ? 'text-red-400' :
            'text-slate-500'
          }`}>
            {state === 'processing' ? 'Processing' :
             state === 'computed' ? 'Computed' :
             state === 'error' ? 'Error' :
             'Idle'}
          </span>
        </div>
        {/* Timestamp */}
        {timestamp && state === 'computed' && (
          <p className="text-[9px] text-slate-500 mt-0.5">{formatTime(timestamp)}</p>
        )}
      </div>
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
