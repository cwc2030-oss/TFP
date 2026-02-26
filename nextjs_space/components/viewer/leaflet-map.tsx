/**
 * Leaflet Map Component for /viewer
 * Pure 2D map with MapTiler hybrid basemap (imagery + labels)
 * No WebGL, no Deck.gl, no 3D
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TerrainLayers, BeddingProperties, FunnelProperties, StandPointProperties } from '@/types/terrain';
import type { TerrainAnalysisResponse } from '@/types/terrain';

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

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

// Active parcel info for bottom panel
export interface ActiveParcelInfo {
  id: string;
  geometry: GeoJSON.Geometry;
  county?: string;
  state?: string;
  acreage?: number;
  owner?: string;
  address?: string;
}

// Spatial corridor data from Supabase
interface SpatialCorridorData {
  parcelId: string;
  corridors: GeoJSON.FeatureCollection;
  count: number;
}

interface LeafletMapProps {
  center: [number, number];
  parcel: GeoJSON.Feature | null;
  layers: TerrainLayers | null;
  corridorData: CorridorData | null;
  spatialCorridors?: SpatialCorridorData | null;
  layerVisibility: {
    parcel: boolean;
    bedding: boolean;
    funnels: boolean;
    saddles: boolean;
    stands: boolean;
    corridors: boolean;
    spatialCorridors?: boolean;
  };
  provenance: TerrainAnalysisResponse['provenance'] | null;
  onMapReady?: () => void;
  activeParcel?: ActiveParcelInfo | null;
  onParcelClick?: (parcelInfo: ActiveParcelInfo) => void;
}

export default function LeafletMap({
  center,
  parcel,
  layers,
  corridorData,
  spatialCorridors,
  layerVisibility,
  provenance,
  onMapReady,
  activeParcel,
  onParcelClick,
}: LeafletMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupsRef = useRef<{
    parcel: L.LayerGroup | null;
    bedding: L.LayerGroup | null;
    funnels: L.LayerGroup | null;
    saddles: L.LayerGroup | null;
    stands: L.LayerGroup | null;
    corridors: L.LayerGroup | null;
    spatialCorridors: L.LayerGroup | null;
  }>({
    parcel: null,
    bedding: null,
    funnels: null,
    saddles: null,
    stands: null,
    corridors: null,
    spatialCorridors: null,
  });

  // MapTiler API key from env
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';
  
  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    try {
      // Create map
      const map = L.map(mapContainerRef.current, {
        center: center,
        zoom: 15,
        zoomControl: true,
        attributionControl: true,
      });

      // OpenStreetMap basemap (known-good fallback)
      const osmUrl = ['https:/', '/', '{s}.tile.openstreetmap.org', '/{z}/{x}/{y}.png'].join('');
      L.tileLayer(osmUrl, { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);

      // Initialize layer groups (order matters for z-index - later = on top)
      layerGroupsRef.current = {
        parcel: L.layerGroup().addTo(map),
        bedding: L.layerGroup().addTo(map),
        funnels: L.layerGroup().addTo(map),
        saddles: L.layerGroup().addTo(map),
        corridors: L.layerGroup().addTo(map),
        spatialCorridors: L.layerGroup().addTo(map), // Above corridors
        stands: L.layerGroup().addTo(map), // Stands on top
      };

      mapRef.current = map;
      onMapReady?.();

      // Cleanup
      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (err) {
      console.error('[LeafletMap] Init error:', err);
    }
  }, [maptilerKey, onMapReady]); // Removed center from deps - handled separately

  // Re-center map when center prop changes (for spatial parcel loading)
  useEffect(() => {
    if (mapRef.current && center) {
      console.log('[LeafletMap] Re-centering map to:', center);
      mapRef.current.setView(center, 15, { animate: true });
    }
  }, [center]);

  // Update parcel layer with click interaction
  useEffect(() => {
    const group = layerGroupsRef.current.parcel;
    if (!group || !mapRef.current) return;

    group.clearLayers();

    if (parcel && layerVisibility.parcel) {
      try {
        const props = parcel.properties || {};
        const parcelId = props.parcelId || props.ll_uuid || `parcel_${center[0]}_${center[1]}`;
        const isActive = activeParcel?.id === parcelId;
        
        console.log('[LeafletMap] Rendering parcel layer, isActive:', isActive, 'parcelId:', parcelId);
        
        const parcelLayer = L.geoJSON(parcel, {
          style: {
            // Active parcel: solid cyan glow, inactive: amber dashed
            color: isActive ? '#06b6d4' : '#f59e0b', // cyan-500 vs amber-500
            weight: isActive ? 4 : 3,
            fillColor: isActive ? '#06b6d4' : '#f59e0b',
            fillOpacity: isActive ? 0.2 : 0.1,
            dashArray: isActive ? '' : '5, 5',
          },
          onEachFeature: (feature, layer) => {
            const featureProps = feature.properties || {};
            const featureParcelId = featureProps.parcelId || featureProps.ll_uuid || parcelId;
            
            // Click handler - select parcel (fires before popup)
            layer.on('click', (e: L.LeafletMouseEvent) => {
              console.log('[LeafletMap] Parcel CLICKED!', featureParcelId);
              
              // Stop event propagation to prevent map click
              L.DomEvent.stopPropagation(e);
              
              if (onParcelClick) {
                const parcelInfo: ActiveParcelInfo = {
                  id: featureParcelId,
                  geometry: feature.geometry,
                  county: featureProps.county || featureProps.county_name,
                  state: featureProps.state || featureProps.state_abbr || 'MO',
                  acreage: featureProps.acreage || featureProps.ll_gisacre,
                  owner: featureProps.owner || featureProps.owner_name,
                  address: featureProps.address || featureProps.siteaddr,
                };
                console.log('[LeafletMap] Calling onParcelClick with:', parcelInfo);
                onParcelClick(parcelInfo);
              } else {
                console.warn('[LeafletMap] onParcelClick callback is not defined!');
              }
            });

            // Hover effects
            layer.on('mouseover', () => {
              if (!isActive) {
                (layer as L.Path).setStyle({
                  weight: 4,
                  fillOpacity: 0.15,
                });
              }
            });
            layer.on('mouseout', () => {
              if (!isActive) {
                (layer as L.Path).setStyle({
                  weight: 3,
                  fillOpacity: 0.1,
                });
              }
            });

            // Tooltip on hover instead of popup on click (so click is free for selection)
            layer.bindTooltip(`
              <div class="font-sans text-sm">
                <strong>${isActive ? '✓ Selected' : 'Click to select'}</strong><br/>
                ${featureProps.address || featureProps.siteaddr || 'Parcel'}
              </div>
            `, {
              sticky: true,
              direction: 'top',
              offset: [0, -10],
              className: 'parcel-tooltip',
            });
          },
        }).addTo(group);

        // Fit map to parcel bounds on initial load
        const bounds = parcelLayer.getBounds();
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds, { padding: [50, 50] });
        }
      } catch (err) {
        console.error('[LeafletMap] Parcel render error:', err);
      }
    }
  }, [parcel, layerVisibility.parcel, activeParcel, onParcelClick, center]);

  // Update bedding layer
  useEffect(() => {
    const group = layerGroupsRef.current.bedding;
    if (!group) return;

    group.clearLayers();

    if (layers?.beddingPolygons?.features && layerVisibility.bedding) {
      try {
        L.geoJSON(layers.beddingPolygons, {
          style: (feature) => {
            const props = feature?.properties as BeddingProperties;
            const typeColors: Record<string, string> = {
              thermal_bedding: '#10b981', // emerald-500
              transition_bedding: '#22c55e', // green-500
              escape_cover: '#84cc16', // lime-500
            };
            return {
              color: typeColors[props?.type] || '#10b981',
              weight: 2,
              fillColor: typeColors[props?.type] || '#10b981',
              fillOpacity: 0.35,
            };
          },
          onEachFeature: (feature, layer) => {
            const props = feature.properties as BeddingProperties;
            layer.bindPopup(`
              <div class="font-sans">
                <h3 class="font-bold text-emerald-600 mb-1">🛏️ Bedding Area</h3>
                <p><strong>Type:</strong> ${props.type?.replace(/_/g, ' ')}</p>
                <p><strong>Slope:</strong> ${props.slopeRange?.[0]}° – ${props.slopeRange?.[1]}°</p>
                <p><strong>Aspect:</strong> ${props.aspect} (${props.aspectDegrees}°)</p>
                <p><strong>Area:</strong> ${props.areaAcres?.toFixed(2)} ac</p>
                <p><strong>Confidence:</strong> ${(props.confidence * 100).toFixed(0)}%</p>
                <p class="text-xs text-gray-500 mt-1">Provenance: DEM slope/aspect analysis</p>
              </div>
            `);
          },
        }).addTo(group);
      } catch (err) {
        console.error('[LeafletMap] Bedding render error:', err);
      }
    }
  }, [layers?.beddingPolygons, layerVisibility.bedding]);

  // Update funnels layer (lines)
  useEffect(() => {
    const funnelGroup = layerGroupsRef.current.funnels;
    const saddleGroup = layerGroupsRef.current.saddles;
    if (!funnelGroup || !saddleGroup) return;

    funnelGroup.clearLayers();
    saddleGroup.clearLayers();

    if (layers?.funnels?.features) {
      try {
        layers.funnels.features.forEach((feature) => {
          const props = feature.properties as FunnelProperties;
          const isSaddleOrDraw = props.funnelType === 'saddle' || props.funnelType === 'draw';
          const isLine = feature.geometry.type === 'LineString';

          if (isLine && layerVisibility.funnels) {
            // Corridor/funnel lines
            L.geoJSON(feature, {
              style: {
                color: '#3b82f6', // blue-500
                weight: 3,
                opacity: 0.8,
                dashArray: props.leastCostPath ? '' : '8, 4',
              },
              onEachFeature: (f, layer) => {
                layer.bindPopup(`
                  <div class="font-sans">
                    <h3 class="font-bold text-blue-600 mb-1">🦌 Movement Corridor</h3>
                    <p><strong>Type:</strong> ${props.funnelType}</p>
                    <p><strong>Corridor Score:</strong> ${(props.corridorScore * 100).toFixed(0)}%</p>
                    ${props.leastCostPath ? '<p class="text-green-600">✓ Least-cost path</p>' : ''}
                    ${props.connectsBeddingToFood ? '<p class="text-amber-600">✓ Connects bedding to food</p>' : ''}
                    <p class="text-xs text-gray-500 mt-1">Provenance: TPI + flow accumulation</p>
                  </div>
                `);
              },
            }).addTo(funnelGroup);
          } else if (!isLine && isSaddleOrDraw && layerVisibility.saddles) {
            // Saddle/draw polygons
            const color = props.funnelType === 'saddle' ? '#a855f7' : '#8b5cf6'; // purple variants
            L.geoJSON(feature, {
              style: {
                color: color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.3,
              },
              onEachFeature: (f, layer) => {
                layer.bindPopup(`
                  <div class="font-sans">
                    <h3 class="font-bold text-purple-600 mb-1">⛰️ ${props.funnelType === 'saddle' ? 'Saddle' : 'Draw'}</h3>
                    <p><strong>Type:</strong> ${props.funnelType}</p>
                    ${props.narrowestWidthMeters ? `<p><strong>Narrowest:</strong> ${props.narrowestWidthMeters.toFixed(0)}m</p>` : ''}
                    <p><strong>Corridor Score:</strong> ${(props.corridorScore * 100).toFixed(0)}%</p>
                    ${props.flowAccumulation ? `<p><strong>Flow Accumulation:</strong> ${props.flowAccumulation}</p>` : ''}
                    <p class="text-xs text-gray-500 mt-1">Provenance: DEM saddle detection</p>
                  </div>
                `);
              },
            }).addTo(saddleGroup);
          }
        });
      } catch (err) {
        console.error('[LeafletMap] Funnels render error:', err);
      }
    }
  }, [layers?.funnels, layerVisibility.funnels, layerVisibility.saddles]);

  // Update stands layer (markers)
  useEffect(() => {
    const group = layerGroupsRef.current.stands;
    if (!group) return;

    group.clearLayers();

    if (layers?.standPoints?.features && layerVisibility.stands) {
      try {
        layers.standPoints.features.forEach((feature) => {
          const props = feature.properties as StandPointProperties;
          const coords = (feature.geometry as GeoJSON.Point).coordinates;
          
          // Custom icon for stand sites
          const standIcon = L.divIcon({
            className: 'custom-stand-marker',
            html: `
              <div style="
                width: 28px;
                height: 28px;
                background: linear-gradient(135deg, #ef4444, #dc2626);
                border: 3px solid white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                font-weight: bold;
                color: white;
                font-size: 12px;
              ">${props.rank}</div>
            `,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -14],
          });

          const marker = L.marker([coords[1], coords[0]], { icon: standIcon });
          
          const riskColor = {
            low: 'text-green-600',
            medium: 'text-amber-600',
            high: 'text-red-600',
          }[props.approachRisk] || 'text-gray-600';

          marker.bindPopup(`
            <div class="font-sans min-w-[200px]">
              <h3 class="font-bold text-red-600 mb-2">🎯 Stand Site #${props.rank}</h3>
              <p><strong>Score:</strong> <span class="text-lg font-bold">${props.score}</span>/100</p>
              <p><strong>Elevation:</strong> ${props.elevation?.toFixed(0)}m</p>
              <p><strong>To Corridor:</strong> ${props.distToCorridorMeters?.toFixed(0)}m</p>
              <p><strong>To Bedding:</strong> ${props.distToBeddingMeters?.toFixed(0)}m</p>
              <p><strong>Approach Risk:</strong> <span class="${riskColor} font-semibold">${props.approachRisk?.toUpperCase()}</span></p>
              <p><strong>Good Winds:</strong> ${props.windOk?.join(', ') || 'N/A'}</p>
              <p><strong>Bad Winds:</strong> ${props.windBad?.join(', ') || 'N/A'}</p>
              ${props.reasoning ? `<p class="mt-2 text-sm text-gray-600 italic">${props.reasoning}</p>` : ''}
              <p class="text-xs text-gray-500 mt-2">Provenance: Multi-criteria stand optimization</p>
            </div>
          `);

          marker.addTo(group);
        });
      } catch (err) {
        console.error('[LeafletMap] Stands render error:', err);
      }
    }
  }, [layers?.standPoints, layerVisibility.stands]);

  // Update corridors layer (V1 - GeoJSON lines with probability styling)
  useEffect(() => {
    const group = layerGroupsRef.current.corridors;
    if (!group) return;

    group.clearLayers();

    if (corridorData?.corridors?.features && layerVisibility.corridors) {
      try {
        corridorData.corridors.features.forEach((feature) => {
          const props = feature.properties || {};
          const probability = props.probability || 70;
          
          // Color based on probability: higher = more red/orange
          const color = probability > 80 
            ? '#ef4444' // red-500 for high probability
            : probability > 60 
              ? '#f97316' // orange-500 for medium
              : '#fbbf24'; // amber-400 for lower
          
          // Width based on probability
          const weight = Math.max(2, probability / 20);

          L.geoJSON(feature as GeoJSON.Feature, {
            style: {
              color,
              weight,
              opacity: 0.8,
              lineCap: 'round',
              lineJoin: 'round',
            },
            onEachFeature: (f, layer) => {
              layer.bindPopup(`
                <div class="font-sans min-w-[200px]">
                  <h3 class="font-bold text-orange-600 mb-1">🦌 Travel Corridor</h3>
                  <p><strong>ID:</strong> ${props.corridor_id || 'N/A'}</p>
                  <p><strong>Movement Probability:</strong> <span class="font-bold">${probability}%</span></p>
                  <p><strong>Type:</strong> ${props.type || 'predicted'}</p>
                  ${props.length_m ? `<p><strong>Length:</strong> ${props.length_m}m</p>` : ''}
                  ${props.width_m ? `<p><strong>Width:</strong> ${Math.round(props.width_m)}m</p>` : ''}
                  <hr class="my-2 border-gray-300" />
                  <p class="text-xs text-gray-600"><strong>Provenance:</strong></p>
                  <p class="text-xs text-gray-500">DEM: ${corridorData?.metadata?.dem_source || 'SRTMGL1'}</p>
                  <p class="text-xs text-gray-500">Resolution: ${corridorData?.metadata?.resolution_m || '~30'}m</p>
                  <p class="text-xs text-gray-500">Slope pref: ${corridorData?.metadata?.weights?.slope_preference || 'moderate'}</p>
                  <p class="text-xs text-gray-500">Concavity wt: ${corridorData?.metadata?.weights?.concavity_weight || 0.4}</p>
                </div>
              `);
            },
          }).addTo(group);
        });
      } catch (err) {
        console.error('[LeafletMap] Corridors render error:', err);
      }
    }
  }, [corridorData, layerVisibility.corridors]);

  // Update spatial corridors layer (from Supabase - DUAL-LAYER: visual + hitbox)
  // The hitbox layer has wide, invisible lines for easy clicking
  // The visual layer shows styled corridors that highlight on hover
  useEffect(() => {
    const group = layerGroupsRef.current.spatialCorridors;
    if (!group) return;

    group.clearLayers();

    if (spatialCorridors?.corridors?.features && layerVisibility.spatialCorridors) {
      try {
        spatialCorridors.corridors.features.forEach((feature) => {
          const props = feature.properties || {};
          const score = typeof props.score === 'number' ? props.score : 0.5;
          const scorePercent = Math.round(score * 100);
          const corridorType = props.type || 'unknown';
          const metaNote = props.meta?.note || '';
          const corridorId = props.id || 'N/A';
          
          // Color based on score: higher = more cyan/teal
          const baseColor = score > 0.7 
            ? '#06b6d4' // cyan-500 for high score
            : score > 0.4 
              ? '#14b8a6' // teal-500 for medium
              : '#0d9488'; // teal-600 for lower
          
          // Base visual width (thin)
          const baseWeight = Math.max(3, score * 5);
          
          // --- VISUAL LAYER (thin, styled, non-interactive) ---
          const visualLayer = L.geoJSON(feature as GeoJSON.Feature, {
            style: {
              color: baseColor,
              weight: baseWeight,
              opacity: 0.85,
              lineCap: 'round',
              lineJoin: 'round',
            },
            interactive: false, // Visual layer is NOT interactive
          });
          visualLayer.addTo(group);
          
          // --- HITBOX LAYER (wide, invisible, interactive) ---
          const hitboxLayer = L.geoJSON(feature as GeoJSON.Feature, {
            style: {
              color: baseColor,
              weight: 24, // Wide hitbox for easy clicking
              opacity: 0, // Invisible
              lineCap: 'round',
              lineJoin: 'round',
            },
            interactive: true,
            onEachFeature: (f, layer) => {
              // CLICK: Show popup with corridor details
              layer.bindPopup(`
                <div class="font-sans min-w-[220px]">
                  <h3 class="font-bold text-cyan-600 mb-2">🦌 Travel Corridor</h3>
                  <div class="space-y-1">
                    <p><strong>Type:</strong> <span class="capitalize">${corridorType.replace(/_/g, ' ')}</span></p>
                    <p><strong>Score:</strong> <span class="font-bold text-cyan-700">${scorePercent}%</span></p>
                    ${metaNote ? `<p><strong>Note:</strong> <em class="text-gray-600">${metaNote}</em></p>` : ''}
                  </div>
                  <hr class="my-2 border-gray-300" />
                  <p class="text-xs text-gray-500">ID: <code>${corridorId}</code></p>
                  <p class="text-xs text-gray-400 mt-1">Source: Supabase PostGIS</p>
                </div>
              `, {
                className: 'corridor-popup',
                maxWidth: 280,
              });
              
              // HOVER: Highlight the visual layer
              layer.on('mouseover', () => {
                visualLayer.setStyle({
                  weight: baseWeight + 4, // Thicker
                  opacity: 1, // Full opacity
                  color: '#22d3ee', // Brighter cyan-400
                });
              });
              
              layer.on('mouseout', () => {
                visualLayer.setStyle({
                  weight: baseWeight,
                  opacity: 0.85,
                  color: baseColor,
                });
              });
            },
          });
          hitboxLayer.addTo(group);
        });
        
        console.log('[LeafletMap] Rendered', spatialCorridors.corridors.features.length, 'spatial corridors (dual-layer)');
      } catch (err) {
        console.error('[LeafletMap] Spatial corridors render error:', err);
      }
    }
  }, [spatialCorridors, layerVisibility.spatialCorridors]);

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
}