'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import type {
  TerrainLayers,
  TerrainSummary,
  TerrainProvenance,
  TerrainMode,
  TerrainLayerVisibility,
  StandPointProperties,
  BeddingProperties,
  FunnelProperties,
} from '@/types/terrain';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Layers, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

interface TerrainIntelOverlayProps {
  map: mapboxgl.Map | null;
  layers: TerrainLayers | null;
  summary: TerrainSummary | null;
  provenance: TerrainProvenance | null;
  mode: TerrainMode;
  isLoading: boolean;
  progress: number;
  error: string | null;
  onRetry?: () => void;
  onToggleMode?: () => void;
}

const LAYER_COLORS = {
  bedding: '#22c55e',      // green-500
  beddingOutline: '#16a34a', // green-600
  funnelSaddle: '#f97316', // orange-500
  funnelDraw: '#3b82f6',   // blue-500
  funnelCorridor: '#a855f7', // purple-500
  standHigh: '#ef4444',    // red-500 (rank 1-3)
  standMed: '#f59e0b',     // amber-500 (rank 4-7)
  standLow: '#6b7280',     // gray-500 (rank 8-10)
};

export default function TerrainIntelOverlay({
  map,
  layers,
  summary,
  provenance,
  mode,
  isLoading,
  progress,
  error,
  onRetry,
  onToggleMode,
}: TerrainIntelOverlayProps) {
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [visibility, setVisibility] = useState<TerrainLayerVisibility>({
    bedding: true,
    funnels: true,
    saddles: true,
    draws: true,
    stands: true,
    corridors: true,
    ridgeSpines: true,
  });
  const [selectedStand, setSelectedStand] = useState<number | null>(null);
  const [showLegend, setShowLegend] = useState(true);

  // Add/remove layers when data changes
  useEffect(() => {
    if (!map || !layers) return;

    const addLayers = () => {
      // Remove existing layers first
      removeLayers();

      // Add bedding polygons
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
            'fill-opacity': 0.3,
          },
        });

        map.addLayer({
          id: 'terrain-bedding-outline',
          type: 'line',
          source: 'terrain-bedding',
          paint: {
            'line-color': LAYER_COLORS.beddingOutline,
            'line-width': 2,
          },
        });
      }

      // Add funnels (polygons and lines)
      if (layers.funnels.features.length > 0) {
        map.addSource('terrain-funnels', {
          type: 'geojson',
          data: layers.funnels as GeoJSON.FeatureCollection,
        });

        // Saddle fills
        map.addLayer({
          id: 'terrain-funnels-saddle-fill',
          type: 'fill',
          source: 'terrain-funnels',
          filter: ['==', ['get', 'funnelType'], 'saddle'],
          paint: {
            'fill-color': LAYER_COLORS.funnelSaddle,
            'fill-opacity': 0.4,
          },
        });

        map.addLayer({
          id: 'terrain-funnels-saddle-outline',
          type: 'line',
          source: 'terrain-funnels',
          filter: ['==', ['get', 'funnelType'], 'saddle'],
          paint: {
            'line-color': LAYER_COLORS.funnelSaddle,
            'line-width': 2,
            'line-dasharray': [2, 2],
          },
        });

        // Draw lines
        map.addLayer({
          id: 'terrain-funnels-draw',
          type: 'line',
          source: 'terrain-funnels',
          filter: ['==', ['get', 'funnelType'], 'draw'],
          paint: {
            'line-color': LAYER_COLORS.funnelDraw,
            'line-width': 3,
            'line-dasharray': [4, 2],
          },
        });

        // Corridor lines
        map.addLayer({
          id: 'terrain-funnels-corridor',
          type: 'line',
          source: 'terrain-funnels',
          filter: ['==', ['get', 'funnelType'], 'corridor'],
          paint: {
            'line-color': LAYER_COLORS.funnelCorridor,
            'line-width': 4,
            'line-opacity': 0.8,
          },
        });
      }

      // Add stand point markers
      addStandMarkers();

      // Add click handlers
      map.on('click', 'terrain-bedding-fill', handleBeddingClick);
      map.on('click', 'terrain-funnels-saddle-fill', handleFunnelClick);
      map.on('click', 'terrain-funnels-draw', handleFunnelClick);
      map.on('click', 'terrain-funnels-corridor', handleFunnelClick);

      // Change cursor on hover
      map.on('mouseenter', 'terrain-bedding-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'terrain-bedding-fill', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'terrain-funnels-saddle-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'terrain-funnels-saddle-fill', () => { map.getCanvas().style.cursor = ''; });
    };

    // Wait for map style to load
    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.once('style.load', addLayers);
    }

    return () => {
      removeLayers();
    };
  }, [map, layers]);

  // Update layer visibility
  useEffect(() => {
    if (!map) return;

    const beddingLayers = ['terrain-bedding-fill', 'terrain-bedding-outline'];
    const funnelLayers = ['terrain-funnels-saddle-fill', 'terrain-funnels-saddle-outline', 'terrain-funnels-draw', 'terrain-funnels-corridor'];

    beddingLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visibility.bedding ? 'visible' : 'none');
      }
    });

    funnelLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visibility.funnels ? 'visible' : 'none');
      }
    });

    // Toggle markers
    markersRef.current.forEach(marker => {
      const el = marker.getElement();
      el.style.display = visibility.stands ? 'block' : 'none';
    });
  }, [map, visibility]);

  const removeLayers = useCallback(() => {
    if (!map) return;

    const layerIds = [
      'terrain-bedding-fill',
      'terrain-bedding-outline',
      'terrain-funnels-saddle-fill',
      'terrain-funnels-saddle-outline',
      'terrain-funnels-draw',
      'terrain-funnels-corridor',
    ];

    layerIds.forEach(id => {
      if (map.getLayer(id)) {
        map.removeLayer(id);
      }
    });

    if (map.getSource('terrain-bedding')) {
      map.removeSource('terrain-bedding');
    }
    if (map.getSource('terrain-funnels')) {
      map.removeSource('terrain-funnels');
    }

    // Remove markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Remove popup
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, [map]);

  const addStandMarkers = useCallback(() => {
    if (!map || !layers?.standPoints) return;

    layers.standPoints.features.forEach((feature) => {
      const props = feature.properties as StandPointProperties;
      const coords = feature.geometry.coordinates as [number, number];

      // Create custom marker element
      const el = document.createElement('div');
      el.className = 'stand-marker';
      el.innerHTML = `
        <div class="stand-marker-inner" style="
          width: ${props.rank <= 3 ? 36 : 28}px;
          height: ${props.rank <= 3 ? 36 : 28}px;
          background: ${props.rank <= 3 ? LAYER_COLORS.standHigh : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow};
          border: 2px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: ${props.rank <= 3 ? 14 : 12}px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          cursor: pointer;
          transition: transform 0.2s;
        ">
          ${props.rank}
        </div>
      `;

      el.addEventListener('mouseenter', () => {
        const inner = el.querySelector('.stand-marker-inner') as HTMLElement;
        if (inner) inner.style.transform = 'scale(1.2)';
      });
      el.addEventListener('mouseleave', () => {
        const inner = el.querySelector('.stand-marker-inner') as HTMLElement;
        if (inner) inner.style.transform = 'scale(1)';
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(coords)
        .addTo(map);

      el.addEventListener('click', () => {
        setSelectedStand(props.rank);
        showStandPopup(coords, props);
      });

      markersRef.current.push(marker);
    });
  }, [map, layers]);

  const showStandPopup = (coords: [number, number], props: StandPointProperties) => {
    if (!map) return;

    if (popupRef.current) {
      popupRef.current.remove();
    }

    const popup = new mapboxgl.Popup({
      closeButton: true,
      maxWidth: '320px',
      className: 'stand-popup',
    })
      .setLngLat(coords)
      .setHTML(`
        <div style="padding: 12px; font-family: system-ui, sans-serif;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="
              background: ${props.rank <= 3 ? LAYER_COLORS.standHigh : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow};
              color: white;
              font-weight: bold;
              padding: 4px 10px;
              border-radius: 12px;
              font-size: 14px;
            ">Stand #${props.rank}</span>
            <span style="font-weight: 600; font-size: 18px;">${props.score}/100</span>
          </div>
          
          <p style="margin: 8px 0; font-size: 13px; color: #374151; line-height: 1.4;">
            ${props.reasoning}
          </p>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; font-size: 12px;">
            <div style="background: #f3f4f6; padding: 6px 8px; border-radius: 4px;">
              <span style="color: #6b7280;">To Corridor:</span>
              <span style="font-weight: 600; margin-left: 4px;">${props.distToCorridorMeters}m</span>
            </div>
            <div style="background: #f3f4f6; padding: 6px 8px; border-radius: 4px;">
              <span style="color: #6b7280;">To Bedding:</span>
              <span style="font-weight: 600; margin-left: 4px;">${props.distToBeddingMeters}m</span>
            </div>
            <div style="background: #dcfce7; padding: 6px 8px; border-radius: 4px;">
              <span style="color: #166534;">Good Wind:</span>
              <span style="font-weight: 600; margin-left: 4px;">${props.windOk.join(', ')}</span>
            </div>
            <div style="background: #fee2e2; padding: 6px 8px; border-radius: 4px;">
              <span style="color: #991b1b;">Avoid:</span>
              <span style="font-weight: 600; margin-left: 4px;">${props.windBad.join(', ')}</span>
            </div>
          </div>
          
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px;">
            <span style="
              padding: 2px 8px;
              border-radius: 4px;
              font-weight: 500;
              background: ${props.approachRisk === 'low' ? '#dcfce7' : props.approachRisk === 'medium' ? '#fef3c7' : '#fee2e2'};
              color: ${props.approachRisk === 'low' ? '#166534' : props.approachRisk === 'medium' ? '#92400e' : '#991b1b'};
            ">
              ${props.approachRisk.toUpperCase()} approach risk
            </span>
            <span style="color: #6b7280; margin-left: 8px;">Elev: ${Math.round(props.elevation)}m</span>
          </div>
        </div>
      `)
      .addTo(map);

    popupRef.current = popup;
  };

  const handleBeddingClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
    if (!map || !e.features || e.features.length === 0) return;

    const props = e.features[0].properties as BeddingProperties;
    const coords = e.lngLat;

    if (popupRef.current) {
      popupRef.current.remove();
    }

    const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(coords)
      .setHTML(`
        <div style="padding: 12px; font-family: system-ui, sans-serif;">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color: ${LAYER_COLORS.bedding};">
            💤 ${formatBeddingType(props.type)}
          </div>
          <div style="font-size: 12px; color: #374151;">
            <p><strong>Aspect:</strong> ${props.aspect} (${Math.round(props.aspectDegrees)}°)</p>
            <p><strong>Slope:</strong> ${props.slopeRange[0]}° - ${props.slopeRange[1]}°</p>
            <p><strong>Area:</strong> ${props.areaAcres.toFixed(1)} acres</p>
            <p><strong>Confidence:</strong> ${Math.round(props.confidence * 100)}%</p>
          </div>
        </div>
      `)
      .addTo(map);

    popupRef.current = popup;
  };

  const handleFunnelClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
    if (!map || !e.features || e.features.length === 0) return;

    const props = e.features[0].properties as FunnelProperties;
    const coords = e.lngLat;

    if (popupRef.current) {
      popupRef.current.remove();
    }

    const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(coords)
      .setHTML(`
        <div style="padding: 12px; font-family: system-ui, sans-serif;">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color: ${getFunnelColor(props.funnelType)};">
            ${getFunnelIcon(props.funnelType)} ${formatFunnelType(props.funnelType)}
          </div>
          <div style="font-size: 12px; color: #374151;">
            <p><strong>Corridor Score:</strong> ${Math.round(props.corridorScore * 100)}%</p>
            ${props.narrowestWidthMeters ? `<p><strong>Pinch Width:</strong> ${Math.round(props.narrowestWidthMeters)}m</p>` : ''}
            ${props.flowAccumulation ? `<p><strong>Flow:</strong> ${Math.round(props.flowAccumulation)} cells</p>` : ''}
            ${props.connectsBeddingToFood ? `<p style="color: #166534;">✓ Connects bedding to food</p>` : ''}
          </div>
        </div>
      `)
      .addTo(map);

    popupRef.current = popup;
  };

  const toggleLayer = (layer: keyof TerrainLayerVisibility) => {
    setVisibility(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur rounded-lg shadow-lg p-4 w-72">
        <div className="flex items-center gap-3 mb-3">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-amber-500 border-t-transparent" />
          <span className="font-medium text-gray-700">Analyzing terrain...</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-amber-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">{progress}% complete</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="absolute bottom-4 left-4 bg-red-50 border border-red-200 rounded-lg shadow-lg p-4 w-72">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <span className="font-medium text-red-700">Analysis Failed</span>
        </div>
        <p className="text-sm text-red-600 mb-3">{error}</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} className="w-full">
            Try Again
          </Button>
        )}
      </div>
    );
  }

  // No data state
  if (!layers) {
    return null;
  }

  return (
    <>
      {/* Control Panel */}
      <div className="absolute bottom-4 left-4 z-10">
        {/* Mode Badge */}
        <div className="mb-2 flex items-center gap-2">
          <span className={`
            px-3 py-1 rounded-full text-xs font-medium
            ${mode === 'real' 
              ? 'bg-green-100 text-green-700 border border-green-200' 
              : 'bg-amber-100 text-amber-700 border border-amber-200'}
          `}>
            {mode === 'real' ? (
              <><CheckCircle className="inline h-3 w-3 mr-1" />Terrain Intel: Real</>
            ) : (
              <><Info className="inline h-3 w-3 mr-1" />Terrain Intel: Preview (approx.)</>
            )}
          </span>
          {onToggleMode && (
            <Button size="sm" variant="ghost" onClick={onToggleMode} className="text-xs h-6 px-2">
              Switch
            </Button>
          )}
        </div>

        {/* Layer Controls */}
        <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-gray-600" />
              <span className="font-medium text-gray-700">Intel Layers</span>
            </div>
            {showLegend ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
          </button>

          {showLegend && (
            <div className="px-4 pb-4 space-y-2">
              {/* Bedding Toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibility.bedding}
                  onChange={() => toggleLayer('bedding')}
                  className="rounded border-gray-300"
                />
                <span className="w-4 h-4 rounded" style={{ background: LAYER_COLORS.bedding }} />
                <span className="text-sm text-gray-700">Bedding Areas ({layers.beddingPolygons.features.length})</span>
              </label>

              {/* Funnels Toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibility.funnels}
                  onChange={() => toggleLayer('funnels')}
                  className="rounded border-gray-300"
                />
                <span className="w-4 h-4 rounded" style={{ background: LAYER_COLORS.funnelCorridor }} />
                <span className="text-sm text-gray-700">Funnels & Corridors ({layers.funnels.features.length})</span>
              </label>

              {/* Stands Toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibility.stands}
                  onChange={() => toggleLayer('stands')}
                  className="rounded border-gray-300"
                />
                <span className="w-4 h-4 rounded-full" style={{ background: LAYER_COLORS.standHigh }} />
                <span className="text-sm text-gray-700">Stand Sites (10)</span>
              </label>

              {/* Summary Stats */}
              {summary && (
                <div className="pt-3 mt-3 border-t border-gray-200 text-xs text-gray-600 space-y-1">
                  <p>💤 {summary.totalBeddingAcres.toFixed(1)} acres bedding</p>
                  <p>🎯 Top stand: {summary.topStandScore}/100</p>
                  <p>📍 {summary.analysisAreaAcres.toFixed(0)} acre analysis area</p>
                </div>
              )}

              {/* Provenance */}
              {provenance && (
                <div className="pt-2 mt-2 border-t border-gray-100 text-xs text-gray-400">
                  <p>Source: {provenance.demSource}</p>
                  <p>Resolution: {provenance.demResolution}</p>
                  {provenance.processingTimeSeconds && (
                    <p>Processed in {provenance.processingTimeSeconds.toFixed(1)}s</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stand List (Right Side) */}
      {visibility.stands && (
        <div className="absolute top-4 right-4 bg-white/95 backdrop-blur rounded-lg shadow-lg w-64 max-h-96 overflow-auto z-10">
          <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white/95">
            <h3 className="font-semibold text-gray-800">Top 10 Stand Sites</h3>
            <p className="text-xs text-gray-500">Click markers or list items</p>
          </div>
          <div className="divide-y divide-gray-100">
            {layers.standPoints.features.map((feature) => {
              const props = feature.properties as StandPointProperties;
              const isSelected = selectedStand === props.rank;
              return (
                <button
                  key={props.rank}
                  onClick={() => {
                    setSelectedStand(props.rank);
                    const coords = feature.geometry.coordinates as [number, number];
                    map?.flyTo({ center: coords, zoom: 16 });
                    showStandPopup(coords, props);
                  }}
                  className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                    isSelected ? 'bg-amber-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{
                        background: props.rank <= 3 ? LAYER_COLORS.standHigh : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow,
                      }}
                    >
                      {props.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{props.score}/100</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          props.approachRisk === 'low' ? 'bg-green-100 text-green-700' :
                          props.approachRisk === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {props.approachRisk}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{props.reasoning}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ============ Helper Functions ============

function formatBeddingType(type: BeddingProperties['type']): string {
  switch (type) {
    case 'thermal_bedding': return 'Thermal Bedding';
    case 'transition_bedding': return 'Transition Bedding';
    case 'escape_cover': return 'Escape Cover';
    default: return 'Bedding Area';
  }
}

function formatFunnelType(type: FunnelProperties['funnelType']): string {
  switch (type) {
    case 'saddle': return 'Ridge Saddle';
    case 'draw': return 'Draw / Drainage';
    case 'corridor': return 'Travel Corridor';
    default: return 'Funnel';
  }
}

function getFunnelColor(type: FunnelProperties['funnelType']): string {
  switch (type) {
    case 'saddle': return LAYER_COLORS.funnelSaddle;
    case 'draw': return LAYER_COLORS.funnelDraw;
    case 'corridor': return LAYER_COLORS.funnelCorridor;
    default: return LAYER_COLORS.funnelSaddle;
  }
}

function getFunnelIcon(type: FunnelProperties['funnelType']): string {
  switch (type) {
    case 'saddle': return '⛰️';
    case 'draw': return '💧';
    case 'corridor': return '🧭';
    default: return '📍';
  }
}