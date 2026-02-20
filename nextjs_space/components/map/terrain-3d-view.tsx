"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, RotateCcw, Compass, Mountain, Target, Info, Maximize2, Camera, Pause, Layers, Crosshair } from "lucide-react";
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
  previewMode?: boolean;
  onUnlockIntel?: () => void;
}

export default function Terrain3DView({
  isOpen,
  onClose,
  parcelCenter,
  parcelBounds,
  parcelAddress,
  acreage,
  previewMode = false,
  onUnlockIntel,
}: Terrain3DViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<InstanceType<typeof mapboxgl.Map> | null>(null);
  const spinAnimRef = useRef<number | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(!previewMode);
  const [currentPitch, setCurrentPitch] = useState(60);
  const [currentBearing, setCurrentBearing] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [windDirection] = useState(225); // SW wind default
  
  // Layer toggles
  const [showContours, setShowContours] = useState(true);
  const [showRidgelines, setShowRidgelines] = useState(true);
  const [showHillshade, setShowHillshade] = useState(true);

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

  // Initialize map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    setLoadError(null);
    setIsMapLoaded(false);
    setIsSpinning(false);

    if (!checkWebGLSupport()) {
      setLoadError("Your browser doesn't support WebGL, which is required for 3D terrain viewing.");
      return;
    }

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setLoadError("Map configuration error. Please try again later.");
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
    let hasLoaded = false;

    map.on("error", (e: any) => {
      console.error("Mapbox error:", e);
      if (!hasLoaded && e.error && e.error.status === 401) {
        setLoadError("Map authentication failed. Please try again.");
      }
    });

    const loadTimeout = setTimeout(() => {
      if (!hasLoaded) {
        hasLoaded = true;
        setIsMapLoaded(true);
      }
    }, 5000);

    map.on("load", () => {
      clearTimeout(loadTimeout);
      if (hasLoaded) return;
      hasLoaded = true;

      // ═══ TERRAIN DEM + HIGH-CONTRAST HILLSHADE (LiDAR-esque look) ═══
      try {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

        // HIGH CONTRAST hillshade for that bare-earth LiDAR look
        map.addLayer({
          id: "hillshade",
          type: "hillshade",
          source: "mapbox-dem",
          paint: {
            "hillshade-exaggeration": 0.7,  // Boosted for drama
            "hillshade-shadow-color": "#0a0a0a",
            "hillshade-highlight-color": "#ffffff",
            "hillshade-accent-color": "#3d5a3d",
            "hillshade-illumination-direction": 315,
            "hillshade-illumination-anchor": "viewport",
          },
        }, "waterway-label");
      } catch (err) {
        console.log("Terrain/hillshade setup failed:", err);
      }

      // Sky layer
      try {
        map.addLayer({
          id: "sky",
          type: "sky",
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0.0, 75.0],
            "sky-atmosphere-sun-intensity": 15,
          },
        });
      } catch (err) {
        console.log("Sky layer failed:", err);
      }

      // ═══ CONTOUR LINES — USGS-derived elevation (the yellow topo) ═══
      try {
        map.addSource("mapbox-terrain-v2", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-terrain-v2",
        });

        // Index contours (100ft intervals) — bold yellow
        map.addLayer({
          id: "contour-index",
          type: "line",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: ["==", ["get", "index"], 5],
          paint: {
            "line-color": "#fbbf24",
            "line-width": 2.5,
            "line-opacity": 0.9,
          },
        });

        // Regular contours (20ft intervals)
        map.addLayer({
          id: "contour-regular",
          type: "line",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: ["!=", ["get", "index"], 5],
          paint: {
            "line-color": "#d4a574",
            "line-width": 0.8,
            "line-opacity": 0.5,
          },
        });

        // Contour elevation labels
        map.addLayer({
          id: "contour-labels",
          type: "symbol",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: ["==", ["get", "index"], 5],
          layout: {
            "symbol-placement": "line",
            "text-field": ["concat", ["to-string", ["round", ["*", ["get", "ele"], 3.28084]]], "'"],
            "text-size": 10,
            "text-max-angle": 25,
            "text-padding": 5,
          },
          paint: {
            "text-color": "#fef3c7",
            "text-halo-color": "#1c1917",
            "text-halo-width": 2,
          },
        });

        // ═══ RIDGELINE HIGHLIGHTING — Higher elevation contours ═══
        map.addLayer({
          id: "ridgeline-highlight",
          type: "line",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: [
            "all",
            ["==", ["get", "index"], 5],
            [">=", ["get", "ele"], 200]
          ],
          paint: {
            "line-color": "#fb923c",
            "line-width": 3.5,
            "line-opacity": 0.8,
            "line-blur": 1,
          },
        });

        map.addLayer({
          id: "ridgeline-glow",
          type: "line",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: [
            "all",
            ["==", ["get", "index"], 5],
            [">=", ["get", "ele"], 200]
          ],
          paint: {
            "line-color": "#fb923c",
            "line-width": 10,
            "line-opacity": 0.2,
            "line-blur": 4,
          },
        }, "ridgeline-highlight");

      } catch (contourErr) {
        console.log("Contour layer setup failed:", contourErr);
      }

      // ═══ PARCEL BOUNDARY ═══
      try {
        if (parcelBounds && parcelBounds.length > 0) {
          const coordinates = parcelBounds.map((p) => [p.lng, p.lat]);
          if (coordinates.length > 0 && (coordinates[0][0] !== coordinates[coordinates.length-1][0] || coordinates[0][1] !== coordinates[coordinates.length-1][1])) {
            coordinates.push(coordinates[0]);
          }

          map.addSource("parcel-boundary", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates: [coordinates] },
            },
          });

          // Bold boundary lines
          map.addLayer({ id: "parcel-glow-outer", type: "line", source: "parcel-boundary", paint: { "line-color": "#000000", "line-width": 12, "line-opacity": 0.4, "line-blur": 3 } });
          map.addLayer({ id: "parcel-glow", type: "line", source: "parcel-boundary", paint: { "line-color": "#fbbf24", "line-width": 8, "line-opacity": 0.6, "line-blur": 2 } });
          map.addLayer({ id: "parcel-outline", type: "line", source: "parcel-boundary", paint: { "line-color": "#fbbf24", "line-width": 4 } });
          map.addLayer({ id: "parcel-fill", type: "fill", source: "parcel-boundary", paint: { "fill-color": "#fbbf24", "fill-opacity": 0.05 } });
        }
      } catch (boundaryErr) {
        console.error("Parcel boundary layer error:", boundaryErr);
      }

      // Center marker
      new mapboxgl.Marker({ color: "#f59e0b" })
        .setLngLat([parcelCenter.lng, parcelCenter.lat])
        .addTo(map);

      setIsMapLoaded(true);
    });

    map.on("pitchend", () => setCurrentPitch(Math.round(map.getPitch())));
    map.on("rotateend", () => setCurrentBearing(Math.round(map.getBearing())));
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    return () => {
      clearTimeout(loadTimeout);
      if (spinAnimRef.current) {
        cancelAnimationFrame(spinAnimRef.current);
        spinAnimRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setIsMapLoaded(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, parcelCenter, parcelBounds]);

  // ═══ TOGGLE FUNCTIONS ═══
  const toggleContours = () => {
    if (!mapRef.current || !isMapLoaded) return;
    const map = mapRef.current;
    const newState = !showContours;
    setShowContours(newState);
    const visibility = newState ? "visible" : "none";
    ["contour-index", "contour-regular", "contour-labels"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
    });
  };

  const toggleRidgelines = () => {
    if (!mapRef.current || !isMapLoaded) return;
    const map = mapRef.current;
    const newState = !showRidgelines;
    setShowRidgelines(newState);
    const visibility = newState ? "visible" : "none";
    ["ridgeline-highlight", "ridgeline-glow"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
    });
  };

  const toggleHillshade = () => {
    if (!mapRef.current || !isMapLoaded) return;
    const map = mapRef.current;
    const newState = !showHillshade;
    setShowHillshade(newState);
    if (map.getLayer("hillshade")) {
      map.setLayoutProperty("hillshade", "visibility", newState ? "visible" : "none");
    }
  };

  const resetView = () => {
    if (!mapRef.current) return;
    stopSpin();
    mapRef.current.flyTo({
      center: [parcelCenter.lng, parcelCenter.lat],
      zoom: 15,
      pitch: 60,
      bearing: -20,
      duration: 1500,
    });
  };

  const rotateView = (direction: "left" | "right") => {
    if (!mapRef.current) return;
    stopSpin();
    const cb = mapRef.current.getBearing();
    mapRef.current.easeTo({ bearing: cb + (direction === "right" ? 45 : -45), duration: 500 });
  };

  const tiltView = (direction: "up" | "down") => {
    if (!mapRef.current) return;
    const cp = mapRef.current.getPitch();
    const newPitch = Math.max(0, Math.min(85, cp + (direction === "up" ? -15 : 15)));
    mapRef.current.easeTo({ pitch: newPitch, duration: 500 });
  };

  const startSpin = () => {
    if (!mapRef.current || isSpinning) return;
    setIsSpinning(true);
    const spin = () => {
      if (!mapRef.current) return;
      const bearing = mapRef.current.getBearing() + 0.3;
      mapRef.current.setBearing(bearing % 360);
      spinAnimRef.current = requestAnimationFrame(spin);
    };
    spin();
  };

  const stopSpin = () => {
    if (spinAnimRef.current) {
      cancelAnimationFrame(spinAnimRef.current);
      spinAnimRef.current = null;
    }
    setIsSpinning(false);
  };

  const toggleSpin = () => {
    if (isSpinning) stopSpin();
    else startSpin();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 md:p-4">
      <div className="relative w-full max-w-7xl h-[90vh] bg-stone-900 rounded-xl overflow-hidden shadow-2xl border border-stone-700">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-stone-900/95 via-stone-900/80 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <Mountain className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  3D Terrain {previewMode ? "Preview" : "+ Intel"}
                  {previewMode ? (
                    <span className="text-xs bg-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full">FREE</span>
                  ) : (
                    <span className="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
                  )}
                </h2>
                <p className="text-sm text-stone-400">
                  {parcelAddress || "Selected Parcel"}
                  {acreage && ` • ${acreage.toFixed(1)} acres`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSpin}
                className={`text-xs gap-1.5 ${isSpinning ? 'text-amber-400 bg-amber-500/20' : 'text-stone-400 hover:text-white hover:bg-stone-700'}`}
                title="Cinematic Spin"
              >
                {isSpinning ? <Pause className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                <span className="hidden md:inline">{isSpinning ? 'Stop' : 'Cinematic'}</span>
              </Button>
              {onUnlockIntel && (
                <Button
                  size="sm"
                  onClick={onUnlockIntel}
                  className="bg-red-600 hover:bg-red-500 text-white gap-1.5 text-xs font-semibold animate-pulse"
                  title="View Deer Intel Analysis"
                >
                  <Crosshair className="w-4 h-4" />
                  <span className="hidden sm:inline">Deer Intel</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { stopSpin(); onClose(); }}
                className="text-stone-400 hover:text-white hover:bg-stone-700"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
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
              <p className="text-stone-500 text-xs mt-2">Rendering satellite + elevation data</p>
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
                <Button variant="outline" onClick={onClose} className="border-stone-600 text-stone-300 hover:bg-stone-700">Close</Button>
                <Button onClick={() => { setLoadError(null); setIsMapLoaded(false); }} className="bg-amber-500 hover:bg-amber-600 text-white">Try Again</Button>
              </div>
            </div>
          </div>
        )}

        {/* Controls Panel - Left Side */}
        {isMapLoaded && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
            <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-stone-700">
              <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-2 px-1">View</p>
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="sm" onClick={() => rotateView("left")} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="Rotate Left">
                  <RotateCcw className="w-4 h-4 mr-1" /> ←
                </Button>
                <Button variant="ghost" size="sm" onClick={() => rotateView("right")} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="Rotate Right">
                  <RotateCcw className="w-4 h-4 mr-1 scale-x-[-1]" /> →
                </Button>
                <div className="h-px bg-stone-600 my-1" />
                <Button variant="ghost" size="sm" onClick={() => tiltView("up")} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="Top-Down">
                  <Maximize2 className="w-4 h-4 mr-1" /> ↑
                </Button>
                <Button variant="ghost" size="sm" onClick={() => tiltView("down")} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="3D Tilt">
                  <Mountain className="w-4 h-4 mr-1" /> ↓
                </Button>
                <div className="h-px bg-stone-600 my-1" />
                <Button variant="ghost" size="sm" onClick={resetView} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="Reset View">
                  <Compass className="w-4 h-4 mr-1" /> Reset
                </Button>
              </div>
            </div>
            
            {/* Terrain Layers */}
            <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-amber-500/30">
              <p className="text-[10px] text-amber-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Layers
              </p>
              <div className="flex flex-col gap-1">
                <button
                  onClick={toggleHillshade}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                    showHillshade ? "bg-stone-600/50 text-stone-200" : "text-stone-400 hover:text-white hover:bg-stone-700"
                  }`}
                  title="High-contrast shading"
                >
                  <Mountain className={`w-3 h-3 ${showHillshade ? "text-stone-200" : "text-stone-500"}`} />
                  <span>Hillshade</span>
                </button>
                <button
                  onClick={toggleContours}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                    showContours ? "bg-amber-500/20 text-amber-300" : "text-stone-400 hover:text-white hover:bg-stone-700"
                  }`}
                  title="USGS Elevation Contours"
                >
                  <div className={`w-4 h-0.5 rounded ${showContours ? "bg-amber-400" : "bg-stone-500"}`} />
                  <span>Topo Lines</span>
                </button>
                <button
                  onClick={toggleRidgelines}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                    showRidgelines ? "bg-orange-500/20 text-orange-300" : "text-stone-400 hover:text-white hover:bg-stone-700"
                  }`}
                  title="Ridgeline highlighting"
                >
                  <div className={`w-4 h-1 rounded ${showRidgelines ? "bg-orange-400" : "bg-stone-500"}`} />
                  <span>Ridges</span>
                </button>
              </div>
              <p className="text-[8px] text-stone-500 mt-1.5 px-1 leading-tight">✓ USGS elevation data</p>
            </div>
            
            {/* Wind indicator */}
            <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-stone-700 text-center">
              <p className="text-[10px] text-stone-500 mb-1">Wind</p>
              <div className="relative w-10 h-10 mx-auto">
                <div className="absolute inset-0 rounded-full border border-stone-600" />
                <div
                  className="absolute top-1/2 left-1/2 w-1 h-5 bg-cyan-400 rounded-full origin-bottom"
                  style={{ transform: `translate(-50%, -100%) rotate(${windDirection}deg)` }}
                />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 text-[8px] text-stone-500">N</div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[8px] text-stone-500">S</div>
                <div className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] text-stone-500">W</div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] text-stone-500">E</div>
              </div>
              <p className="text-[9px] text-cyan-400 mt-1">SW 8mph</p>
            </div>
            
            <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-stone-700 text-center">
              <p className="text-[10px] text-stone-500">Pitch {currentPitch}°</p>
              <p className="text-[10px] text-stone-500">Brng {currentBearing}°</p>
            </div>
          </div>
        )}

        {/* Legend Panel - Bottom */}
        {isMapLoaded && (
          <div className="absolute bottom-3 left-3 right-3 z-10">
            <div className="bg-stone-800/95 backdrop-blur rounded-xl shadow-lg border border-stone-700 overflow-hidden">
              <button
                onClick={() => setShowLegend(!showLegend)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-stone-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-white">Terrain Intel</span>
                  <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">LiDAR-Style</span>
                </div>
                <Info className="w-4 h-4 text-stone-400" />
              </button>
              
              {showLegend && (
                <div className="p-3 pt-0 border-t border-stone-700">
                  
                  {/* Explainer */}
                  <div className="bg-stone-700/40 rounded-lg p-2.5 mt-3">
                    <p className="text-[10px] text-stone-400 leading-relaxed">
                      <span className="text-amber-400 font-medium">🏔️ High-contrast hillshade</span> mimics LiDAR bare-earth imagery — ridges and draws pop visually. 
                      <span className="text-amber-400 font-medium"> Yellow topo lines</span> are USGS-verified elevation contours you can walk on-site.
                    </p>
                  </div>

                  {/* Deer Intel CTA */}
                  {onUnlockIntel && (
                    <button
                      onClick={onUnlockIntel}
                      className="w-full mt-3 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white rounded-lg py-2.5 px-4 flex items-center justify-center gap-2 transition-all shadow-lg"
                    >
                      <Crosshair className="w-5 h-5" />
                      <span className="font-semibold">View Full Deer Intel Analysis</span>
                      <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">NEW</span>
                    </button>
                  )}

                  <p className="text-[10px] text-stone-500 mt-3 text-center">
                    Drag to rotate • Scroll to zoom • Right-click to tilt • Hit <span className="text-amber-400">Cinematic</span> for the flyover
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Watermark */}
        <div className="absolute bottom-20 right-4 z-10 text-right">
          <p className="text-[10px] text-stone-500">Powered by</p>
          <p className="text-xs font-bold text-amber-400">Terra Firma Partners™</p>
        </div>
      </div>
    </div>
  );
}
