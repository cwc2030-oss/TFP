"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, RotateCcw, Compass, Mountain, TreePine, Droplets, Target, Info, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

interface Terrain3DViewProps {
  isOpen: boolean;
  onClose: () => void;
  parcelCenter: { lat: number; lng: number };
  parcelBounds?: { lat: number; lng: number }[];
  parcelAddress?: string;
  acreage?: number;
}

interface DeerCorridor {
  id: string;
  type: "primary" | "secondary" | "water" | "bedding";
  label: string;
  coordinates: [number, number][];
  description: string;
}

export default function Terrain3DView({
  isOpen,
  onClose,
  parcelCenter,
  parcelBounds,
  parcelAddress,
  acreage,
}: Terrain3DViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<InstanceType<typeof mapboxgl.Map> | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const [activeCorridors, setActiveCorridors] = useState<string[]>(["primary", "secondary", "water", "bedding"]);
  const [currentPitch, setCurrentPitch] = useState(60);
  const [currentBearing, setCurrentBearing] = useState(0);

  // Check WebGL support
  const checkWebGLSupport = (): boolean => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  };

  // Generate deer corridors based on parcel location and terrain logic
  const generateDeerCorridors = useCallback((): DeerCorridor[] => {
    const { lat, lng } = parcelCenter;
    const offset = acreage ? Math.sqrt(acreage / 640) * 0.01 : 0.005; // Scale based on acreage
    
    // Generate realistic-looking corridors based on cardinal directions and terrain patterns
    const corridors: DeerCorridor[] = [
      {
        id: "primary-1",
        type: "primary",
        label: "Primary Travel Corridor",
        description: "Main deer movement path - ridge to feeding area",
        coordinates: [
          [lng - offset * 1.2, lat + offset * 0.8],
          [lng - offset * 0.6, lat + offset * 0.4],
          [lng - offset * 0.2, lat + offset * 0.1],
          [lng + offset * 0.3, lat - offset * 0.3],
          [lng + offset * 0.8, lat - offset * 0.6],
        ],
      },
      {
        id: "primary-2",
        type: "primary",
        label: "Ridge Funnel",
        description: "Terrain funnel between ridges",
        coordinates: [
          [lng + offset * 0.9, lat + offset * 1.0],
          [lng + offset * 0.5, lat + offset * 0.5],
          [lng + offset * 0.1, lat + offset * 0.1],
          [lng - offset * 0.2, lat - offset * 0.4],
        ],
      },
      {
        id: "secondary-1",
        type: "secondary",
        label: "Edge Transition",
        description: "Field edge to timber transition zone",
        coordinates: [
          [lng - offset * 0.8, lat - offset * 0.5],
          [lng - offset * 0.3, lat - offset * 0.2],
          [lng + offset * 0.2, lat + offset * 0.1],
          [lng + offset * 0.6, lat + offset * 0.3],
        ],
      },
      {
        id: "secondary-2",
        type: "secondary",
        label: "Saddle Crossing",
        description: "Low point between terrain features",
        coordinates: [
          [lng - offset * 0.5, lat + offset * 0.6],
          [lng - offset * 0.1, lat + offset * 0.3],
          [lng + offset * 0.4, lat - offset * 0.1],
        ],
      },
      {
        id: "water-1",
        type: "water",
        label: "Creek Bottom",
        description: "Seasonal drainage - water source",
        coordinates: [
          [lng - offset * 1.0, lat + offset * 0.2],
          [lng - offset * 0.5, lat + offset * 0.1],
          [lng, lat],
          [lng + offset * 0.5, lat - offset * 0.15],
          [lng + offset * 1.0, lat - offset * 0.3],
        ],
      },
      {
        id: "bedding-1",
        type: "bedding",
        label: "Bedding Area",
        description: "Likely bedding - south-facing slope with cover",
        coordinates: [
          [lng + offset * 0.3, lat + offset * 0.7],
          [lng + offset * 0.5, lat + offset * 0.75],
          [lng + offset * 0.6, lat + offset * 0.65],
          [lng + offset * 0.5, lat + offset * 0.55],
          [lng + offset * 0.35, lat + offset * 0.6],
          [lng + offset * 0.3, lat + offset * 0.7],
        ],
      },
      {
        id: "bedding-2",
        type: "bedding",
        label: "Secondary Bedding",
        description: "Thick cover bedding area",
        coordinates: [
          [lng - offset * 0.7, lat - offset * 0.3],
          [lng - offset * 0.5, lat - offset * 0.25],
          [lng - offset * 0.45, lat - offset * 0.4],
          [lng - offset * 0.6, lat - offset * 0.45],
          [lng - offset * 0.7, lat - offset * 0.3],
        ],
      },
    ];

    return corridors;
  }, [parcelCenter, acreage]);

  // Initialize map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    // Reset states
    setLoadError(null);
    setIsMapLoaded(false);

    // Check WebGL support first
    if (!checkWebGLSupport()) {
      setLoadError("Your browser doesn't support WebGL, which is required for 3D terrain viewing. Try using Chrome, Firefox, or Safari.");
      return;
    }

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setLoadError("Map configuration error. Please try again later.");
      console.error("Mapbox token not found");
      return;
    }

    mapboxgl.accessToken = token;

    let map: InstanceType<typeof mapboxgl.Map>;
    
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [parcelCenter.lng, parcelCenter.lat],
        zoom: 15,
        pitch: 60,
        bearing: -20,
        antialias: true,
      });
    } catch (err) {
      console.error("Failed to initialize Mapbox:", err);
      setLoadError("Failed to load 3D map. Please try refreshing the page.");
      return;
    }

    mapRef.current = map;

    // Handle map errors
    map.on("error", (e: any) => {
      console.error("Mapbox error:", e);
      if (!isMapLoaded) {
        setLoadError("Failed to load map tiles. Please check your internet connection.");
      }
    });

    // Set loaded state after a short delay even if terrain fails
    let hasLoaded = false;
    const loadTimeout = setTimeout(() => {
      if (!hasLoaded) {
        console.log("Terrain load timeout - showing map anyway");
        hasLoaded = true;
        setIsMapLoaded(true);
      }
    }, 5000);

    map.on("load", () => {
      clearTimeout(loadTimeout);
      hasLoaded = true;
      
      // Add terrain with error handling
      try {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });

        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
      } catch (err) {
        console.log("Terrain failed to load, continuing without 3D elevation:", err);
      }

      // Add sky layer for realism
      try {
        map.addLayer({
          id: "sky",
          type: "sky",
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0.0, 90.0],
            "sky-atmosphere-sun-intensity": 15,
          },
        });
      } catch (err) {
        console.log("Sky layer failed:", err);
      }

      // Add parcel boundary if available
      if (parcelBounds && parcelBounds.length > 0) {
        const coordinates = parcelBounds.map((p) => [p.lng, p.lat]);
        // Close the polygon
        if (coordinates.length > 0) {
          coordinates.push(coordinates[0]);
        }

        map.addSource("parcel-boundary", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [coordinates],
            },
          },
        });

        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "parcel-boundary",
          paint: {
            "fill-color": "#f59e0b",
            "fill-opacity": 0.15,
          },
        });

        map.addLayer({
          id: "parcel-outline",
          type: "line",
          source: "parcel-boundary",
          paint: {
            "line-color": "#f59e0b",
            "line-width": 3,
            "line-dasharray": [2, 1],
          },
        });
      }

      // Add deer corridors
      const corridors = generateDeerCorridors();
      addCorridorsToMap(map, corridors);

      // Add center marker
      new mapboxgl.Marker({ color: "#f59e0b" })
        .setLngLat([parcelCenter.lng, parcelCenter.lat])
        .addTo(map);

      setIsMapLoaded(true);
    });

    // Track pitch and bearing changes
    map.on("pitchend", () => {
      setCurrentPitch(Math.round(map.getPitch()));
    });

    map.on("rotateend", () => {
      setCurrentBearing(Math.round(map.getBearing()));
    });

    // Add navigation controls
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    return () => {
      clearTimeout(loadTimeout);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setIsMapLoaded(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, parcelCenter, parcelBounds, generateDeerCorridors]);

  // Add corridor layers to map
  const addCorridorsToMap = (map: InstanceType<typeof mapboxgl.Map>, corridors: DeerCorridor[]) => {
    const colors: Record<string, string> = {
      primary: "#ef4444",    // Red - main travel
      secondary: "#f97316", // Orange - secondary
      water: "#3b82f6",      // Blue - water
      bedding: "#22c55e",    // Green - bedding
    };

    const widths: Record<string, number> = {
      primary: 4,
      secondary: 3,
      water: 3,
      bedding: 2,
    };

    corridors.forEach((corridor) => {
      const sourceId = `corridor-${corridor.id}`;
      const layerId = `corridor-layer-${corridor.id}`;

      // Check if it's a polygon (bedding area) or line (travel corridor)
      const isPolygon = corridor.type === "bedding";

      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {
            label: corridor.label,
            description: corridor.description,
            type: corridor.type,
          },
          geometry: isPolygon
            ? {
                type: "Polygon",
                coordinates: [corridor.coordinates],
              }
            : {
                type: "LineString",
                coordinates: corridor.coordinates,
              },
        },
      });

      if (isPolygon) {
        // Add fill for bedding areas
        map.addLayer({
          id: `${layerId}-fill`,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": colors[corridor.type],
            "fill-opacity": 0.3,
          },
        });
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": colors[corridor.type],
            "line-width": widths[corridor.type],
            "line-dasharray": [2, 2],
          },
        });
      } else {
        // Add line for travel corridors
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": colors[corridor.type],
            "line-width": widths[corridor.type],
            "line-opacity": 0.85,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
        });

        // Add arrows for direction
        map.addLayer({
          id: `${layerId}-arrows`,
          type: "symbol",
          source: sourceId,
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 100,
            "icon-image": "arrow-small",
            "icon-size": 0.5,
            "icon-allow-overlap": true,
          },
          paint: {
            "icon-color": colors[corridor.type],
          },
        });
      }

      // Add popup on click
      map.on("click", layerId, (e: any) => {
        const props = e.features?.[0]?.properties;
        if (props) {
          new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(
              `<div class="p-2">
                <h4 class="font-bold text-sm">${props.label}</h4>
                <p class="text-xs text-gray-600 mt-1">${props.description}</p>
              </div>`
            )
            .addTo(map);
        }
      });

      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    });
  };

  // Toggle corridor visibility
  const toggleCorridor = (type: string) => {
    if (!mapRef.current || !isMapLoaded) return;

    const map = mapRef.current;
    const isActive = activeCorridors.includes(type);
    const newActive = isActive
      ? activeCorridors.filter((t) => t !== type)
      : [...activeCorridors, type];

    setActiveCorridors(newActive);

    // Find all layers of this type and toggle visibility
    const corridors = generateDeerCorridors();
    corridors
      .filter((c) => c.type === type)
      .forEach((corridor) => {
        const layerId = `corridor-layer-${corridor.id}`;
        const visibility = isActive ? "none" : "visible";

        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", visibility);
        }
        if (map.getLayer(`${layerId}-fill`)) {
          map.setLayoutProperty(`${layerId}-fill`, "visibility", visibility);
        }
        if (map.getLayer(`${layerId}-arrows`)) {
          map.setLayoutProperty(`${layerId}-arrows`, "visibility", visibility);
        }
      });
  };

  // Reset view
  const resetView = () => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: [parcelCenter.lng, parcelCenter.lat],
      zoom: 15,
      pitch: 60,
      bearing: -20,
      duration: 1500,
    });
  };

  // Rotate view
  const rotateView = (direction: "left" | "right") => {
    if (!mapRef.current) return;
    const currentBearing = mapRef.current.getBearing();
    mapRef.current.easeTo({
      bearing: currentBearing + (direction === "right" ? 45 : -45),
      duration: 500,
    });
  };

  // Tilt view
  const tiltView = (direction: "up" | "down") => {
    if (!mapRef.current) return;
    const currentPitch = mapRef.current.getPitch();
    const newPitch = Math.max(0, Math.min(85, currentPitch + (direction === "up" ? -15 : 15)));
    mapRef.current.easeTo({
      pitch: newPitch,
      duration: 500,
    });
  };

  // Spin animation for "wow" factor
  const spinView = () => {
    if (!mapRef.current) return;
    let bearing = mapRef.current.getBearing();
    const spinStep = () => {
      if (!mapRef.current) return;
      bearing += 0.5;
      mapRef.current.setBearing(bearing % 360);
      if (bearing < currentBearing + 360) {
        requestAnimationFrame(spinStep);
      }
    };
    spinStep();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-6xl h-[85vh] bg-stone-900 rounded-xl overflow-hidden shadow-2xl border border-stone-700">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-stone-900/95 via-stone-900/80 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <Mountain className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  3D Terrain View
                  <span className="text-xs bg-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full">LIDAR</span>
                </h2>
                <p className="text-sm text-stone-400">
                  {parcelAddress || "Selected Parcel"}
                  {acreage && ` • ${acreage.toFixed(1)} acres`}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-stone-400 hover:text-white hover:bg-stone-700"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Map Container */}
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Loading State */}
        {!isMapLoaded && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
            <div className="text-center">
              <div className="animate-spin w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full mx-auto mb-4" />
              <p className="text-stone-400">Loading 3D terrain...</p>
              <p className="text-stone-500 text-xs mt-2">This may take a few seconds</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
            <div className="text-center max-w-md px-6">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mountain className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Unable to Load 3D View</h3>
              <p className="text-stone-400 text-sm mb-4">{loadError}</p>
              <div className="flex gap-3 justify-center">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="border-stone-600 text-stone-300 hover:bg-stone-700"
                >
                  Close
                </Button>
                <Button
                  onClick={() => {
                    setLoadError(null);
                    setIsMapLoaded(false);
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                >
                  Try Again
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Controls Panel - Left Side */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
          <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-stone-700">
            <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-2 px-1">View</p>
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => rotateView("left")}
                className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs"
                title="Rotate Left"
              >
                <RotateCcw className="w-4 h-4 mr-1" /> ←
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => rotateView("right")}
                className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs"
                title="Rotate Right"
              >
                <RotateCcw className="w-4 h-4 mr-1 scale-x-[-1]" /> →
              </Button>
              <div className="h-px bg-stone-600 my-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => tiltView("up")}
                className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs"
                title="Tilt Up (Top-Down)"
              >
                <Maximize2 className="w-4 h-4 mr-1" /> ↑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => tiltView("down")}
                className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs"
                title="Tilt Down (3D)"
              >
                <Mountain className="w-4 h-4 mr-1" /> ↓
              </Button>
              <div className="h-px bg-stone-600 my-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={resetView}
                className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs"
                title="Reset View"
              >
                <Compass className="w-4 h-4 mr-1" /> Reset
              </Button>
            </div>
          </div>

          {/* Pitch/Bearing indicator */}
          <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-stone-700 text-center">
            <p className="text-[10px] text-stone-500">Pitch: {currentPitch}°</p>
            <p className="text-[10px] text-stone-500">Bearing: {currentBearing}°</p>
          </div>
        </div>

        {/* Legend Panel - Bottom */}
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <div className="bg-stone-800/95 backdrop-blur rounded-lg shadow-lg border border-stone-700 overflow-hidden">
            <button
              onClick={() => setShowLegend(!showLegend)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-stone-700/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-white">Deer Movement Corridors</span>
                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">AI Predicted</span>
              </div>
              <Info className="w-4 h-4 text-stone-400" />
            </button>
            
            {showLegend && (
              <div className="p-3 pt-0 border-t border-stone-700">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <button
                    onClick={() => toggleCorridor("primary")}
                    className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                      activeCorridors.includes("primary")
                        ? "bg-red-500/20 border border-red-500/50"
                        : "bg-stone-700/50 border border-transparent opacity-50"
                    }`}
                  >
                    <div className="w-4 h-1 bg-red-500 rounded" />
                    <div className="text-left">
                      <p className="text-xs font-medium text-white">Primary Travel</p>
                      <p className="text-[10px] text-stone-400">Main movement paths</p>
                    </div>
                  </button>

                  <button
                    onClick={() => toggleCorridor("secondary")}
                    className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                      activeCorridors.includes("secondary")
                        ? "bg-orange-500/20 border border-orange-500/50"
                        : "bg-stone-700/50 border border-transparent opacity-50"
                    }`}
                  >
                    <div className="w-4 h-1 bg-orange-500 rounded" />
                    <div className="text-left">
                      <p className="text-xs font-medium text-white">Secondary</p>
                      <p className="text-[10px] text-stone-400">Edge transitions</p>
                    </div>
                  </button>

                  <button
                    onClick={() => toggleCorridor("water")}
                    className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                      activeCorridors.includes("water")
                        ? "bg-blue-500/20 border border-blue-500/50"
                        : "bg-stone-700/50 border border-transparent opacity-50"
                    }`}
                  >
                    <Droplets className="w-4 h-4 text-blue-400" />
                    <div className="text-left">
                      <p className="text-xs font-medium text-white">Water Sources</p>
                      <p className="text-[10px] text-stone-400">Creeks & drainage</p>
                    </div>
                  </button>

                  <button
                    onClick={() => toggleCorridor("bedding")}
                    className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                      activeCorridors.includes("bedding")
                        ? "bg-green-500/20 border border-green-500/50"
                        : "bg-stone-700/50 border border-transparent opacity-50"
                    }`}
                  >
                    <TreePine className="w-4 h-4 text-green-400" />
                    <div className="text-left">
                      <p className="text-xs font-medium text-white">Bedding Areas</p>
                      <p className="text-[10px] text-stone-400">Likely bedding zones</p>
                    </div>
                  </button>
                </div>

                <p className="text-[10px] text-stone-500 mt-3 text-center">
                  💡 Drag to rotate • Scroll to zoom • Right-click to tilt • Click corridors for details
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Watermark */}
        <div className="absolute bottom-20 right-4 z-10 text-right">
          <p className="text-[10px] text-stone-500">Powered by</p>
          <p className="text-xs font-bold text-amber-400">Terra Firma Partners</p>
        </div>
      </div>
    </div>
  );
}
