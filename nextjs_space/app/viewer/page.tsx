/**
 * /viewer - Leaflet-based 2D map viewer with terrain overlays
 * No WebGL, no Deck.gl, no 3D - pure Leaflet with MapTiler hybrid basemap
 */
'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AlertTriangle, Layers, X, Target, Bed, TreeDeciduous, Droplet, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchTerrainAnalysis, fetchParcelGeometry, generateSyntheticParcel } from '@/lib/terrain-client';
import type { TerrainAnalysisResponse, TerrainLayers, BeddingProperties, FunnelProperties, StandPointProperties } from '@/types/terrain';

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
  });
  const [showLegend, setShowLegend] = useState(true);

  // Fetch parcel and terrain data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setProgress(10);
    setError(null);
    setOverlayError(null);

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
        console.log('[Viewer] Terrain data loaded:', {
          bedding: result.data.layers.beddingPolygons?.features?.length || 0,
          funnels: result.data.layers.funnels?.features?.length || 0,
          stands: result.data.layers.standPoints?.features?.length || 0,
        });
      } else {
        // Non-fatal: viewer still loads, just show banner
        setOverlayError(result.error || 'Could not load terrain overlays');
        console.warn('[Viewer] Overlay fetch failed:', result.error);
      }

      setProgress(100);
    } catch (err) {
      console.error('[Viewer] Load error:', err);
      setOverlayError(err instanceof Error ? err.message : 'Failed to load overlays');
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
