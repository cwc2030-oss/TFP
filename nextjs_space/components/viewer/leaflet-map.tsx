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
}

interface LeafletMapProps {
  center: [number, number];
  parcel: GeoJSON.Feature | null;
  layers: TerrainLayers | null;
  corridorData: CorridorData | null;
  layerVisibility: {
    parcel: boolean;
    bedding: boolean;
    funnels: boolean;
    saddles: boolean;
    stands: boolean;
    corridors: boolean;
  };
  provenance: TerrainAnalysisResponse['provenance'] | null;
  onMapReady?: () => void;
}

export default function LeafletMap({
  center,
  parcel,
  layers,
  corridorData,
  layerVisibility,
  provenance,
  onMapReady,
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
  }>({
    parcel: null,
    bedding: null,
    funnels: null,
    saddles: null,
    stands: null,
    corridors: null,
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

      // Add MapTiler hybrid basemap (satellite + labels)
      // Fallback to OpenStreetMap if no key
      if (maptilerKey) {
        // Satellite imagery layer
        L.tileLayer(
          `https://i.ytimg.com/vi/TmG8o21vB7E/maxresdefault.jpg`,
          {
            attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a>',
            maxZoom: 20,
          }
        ).addTo(map);

        // Labels overlay
        L.tileLayer(
          `https://media.maptiler.com/old/img/tools/mercator2.png`,
          {
            attribution: '',
            maxZoom: 20,
          }
        ).addTo(map);
      } else {
        // Fallback: ESRI World Imagery (free, no key required)
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 19,
          }
        ).addTo(map);

        // OpenStreetMap labels overlay
        L.tileLayer(
          'https://i.ytimg.com/vi/RF4-Ddoti9A/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLDKvCdYDwMewgJQhS9t-rVkjAYo2g',
          {
            attribution: '&copy; OSM, CARTO',
            maxZoom: 19,
          }
        ).addTo(map);
      }

      // Initialize layer groups
      layerGroupsRef.current = {
        parcel: L.layerGroup().addTo(map),
        bedding: L.layerGroup().addTo(map),
        funnels: L.layerGroup().addTo(map),
        saddles: L.layerGroup().addTo(map),
        stands: L.layerGroup().addTo(map),
        corridors: L.layerGroup().addTo(map),
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
  }, [center, maptilerKey, onMapReady]);

  // Update parcel layer
  useEffect(() => {
    const group = layerGroupsRef.current.parcel;
    if (!group || !mapRef.current) return;

    group.clearLayers();

    if (parcel && layerVisibility.parcel) {
      try {
        const parcelLayer = L.geoJSON(parcel, {
          style: {
            color: '#f59e0b', // amber-500
            weight: 3,
            fillColor: '#f59e0b',
            fillOpacity: 0.1,
            dashArray: '5, 5',
          },
          onEachFeature: (feature, layer) => {
            const props = feature.properties || {};
            layer.bindPopup(`
              <div class="font-sans">
                <h3 class="font-bold text-amber-600 mb-1">Parcel Boundary</h3>
                <p><strong>Parcel ID:</strong> ${props.parcelId || 'N/A'}</p>
                <p><strong>Owner:</strong> ${props.owner || 'N/A'}</p>
                <p><strong>Acreage:</strong> ${props.acreage?.toFixed(1) || 'N/A'} ac</p>
                <p><strong>Address:</strong> ${props.address || 'N/A'}</p>
                ${props.synthetic ? '<p class="text-xs text-gray-500 mt-1">⚠️ Synthetic boundary (Regrid unavailable)</p>' : ''}
              </div>
            `);
          },
        }).addTo(group);

        // Fit map to parcel bounds
        const bounds = parcelLayer.getBounds();
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds, { padding: [50, 50] });
        }
      } catch (err) {
        console.error('[LeafletMap] Parcel render error:', err);
      }
    }
  }, [parcel, layerVisibility.parcel]);

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
                <div class="font-sans min-w-[180px]">
                  <h3 class="font-bold text-orange-600 mb-1">🦌 Travel Corridor</h3>
                  <p><strong>ID:</strong> ${props.corridor_id || 'N/A'}</p>
                  <p><strong>Movement Probability:</strong> <span class="font-bold">${probability}%</span></p>
                  <p><strong>Type:</strong> ${props.type || 'predicted'}</p>
                  ${props.width_m ? `<p><strong>Estimated Width:</strong> ${props.width_m.toFixed(0)}m</p>` : ''}
                  <p class="text-xs text-gray-500 mt-2">Provenance: DEM slope + concavity analysis (V1)</p>
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

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
}
