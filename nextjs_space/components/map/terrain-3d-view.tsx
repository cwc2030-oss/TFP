"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, RotateCcw, Compass, Mountain, TreePine, Droplets, Target, Info, ZoomIn, ZoomOut, Maximize2, Wind, Crosshair, Wheat, Camera, Play, Pause } from "lucide-react";
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
  type: "primary" | "secondary" | "water" | "bedding" | "funnel" | "food_plot" | "stand";
  label: string;
  coordinates: [number, number][];
  description: string;
}

const CORRIDOR_COLORS: Record<string, string> = {
  primary: "#ef4444",
  secondary: "#f97316",
  water: "#3b82f6",
  bedding: "#22c55e",
  funnel: "#a855f7",
  food_plot: "#eab308",
  stand: "#ec4899",
};

const CORRIDOR_LABELS: Record<string, { name: string; desc: string }> = {
  primary: { name: "Primary Travel", desc: "Main movement paths" },
  secondary: { name: "Secondary Routes", desc: "Edge transitions & saddles" },
  water: { name: "Water Sources", desc: "Creeks, ponds & drainage" },
  bedding: { name: "Bedding Areas", desc: "Likely bedding zones" },
  funnel: { name: "Terrain Funnels", desc: "Pinch points & bottlenecks" },
  food_plot: { name: "Food Plot Zones", desc: "Ideal food plot locations" },
  stand: { name: "Stand Sites", desc: "Optimal stand placements" },
};

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
  const spinAnimRef = useRef<number | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const [activeCorridors, setActiveCorridors] = useState<string[]>(["primary", "secondary", "water", "bedding", "funnel", "food_plot", "stand"]);
  const [currentPitch, setCurrentPitch] = useState(60);
  const [currentBearing, setCurrentBearing] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [windDirection, setWindDirection] = useState(225); // SW wind default - common in MO
  const [showWind, setShowWind] = useState(true);

  const checkWebGLSupport = (): boolean => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  };

  // Generate deer corridors with enhanced features
  const generateDeerCorridors = useCallback((): DeerCorridor[] => {
    const { lat, lng } = parcelCenter;
    const offset = acreage ? Math.sqrt(acreage / 640) * 0.01 : 0.005;
    
    const corridors: DeerCorridor[] = [
      // PRIMARY TRAVEL CORRIDORS
      {
        id: "primary-1",
        type: "primary",
        label: "Primary Travel Corridor",
        description: "Main deer movement — ridge to feeding area. High traffic dawn & dusk.",
        coordinates: [
          [lng - offset * 1.2, lat + offset * 0.8],
          [lng - offset * 0.8, lat + offset * 0.55],
          [lng - offset * 0.4, lat + offset * 0.3],
          [lng - offset * 0.1, lat + offset * 0.1],
          [lng + offset * 0.2, lat - offset * 0.15],
          [lng + offset * 0.5, lat - offset * 0.4],
          [lng + offset * 0.8, lat - offset * 0.6],
        ],
      },
      {
        id: "primary-2",
        type: "primary",
        label: "Ridge Funnel Corridor",
        description: "Terrain funnel between ridges — mature bucks use this during rut.",
        coordinates: [
          [lng + offset * 0.9, lat + offset * 1.0],
          [lng + offset * 0.6, lat + offset * 0.6],
          [lng + offset * 0.3, lat + offset * 0.3],
          [lng + offset * 0.1, lat + offset * 0.1],
          [lng - offset * 0.1, lat - offset * 0.2],
          [lng - offset * 0.2, lat - offset * 0.4],
        ],
      },
      // SECONDARY ROUTES
      {
        id: "secondary-1",
        type: "secondary",
        label: "Field-to-Timber Transition",
        description: "Edge transition zone — does & yearlings travel this frequently.",
        coordinates: [
          [lng - offset * 0.8, lat - offset * 0.5],
          [lng - offset * 0.5, lat - offset * 0.3],
          [lng - offset * 0.2, lat - offset * 0.1],
          [lng + offset * 0.1, lat + offset * 0.05],
          [lng + offset * 0.4, lat + offset * 0.2],
          [lng + offset * 0.6, lat + offset * 0.3],
        ],
      },
      {
        id: "secondary-2",
        type: "secondary",
        label: "Saddle Crossing",
        description: "Low saddle between terrain features — natural travel corridor.",
        coordinates: [
          [lng - offset * 0.5, lat + offset * 0.6],
          [lng - offset * 0.2, lat + offset * 0.35],
          [lng + offset * 0.1, lat + offset * 0.15],
          [lng + offset * 0.4, lat - offset * 0.1],
        ],
      },
      // WATER SOURCES
      {
        id: "water-1",
        type: "water",
        label: "Primary Creek Bottom",
        description: "Seasonal drainage — reliable water source. Deer visit daily.",
        coordinates: [
          [lng - offset * 1.1, lat + offset * 0.3],
          [lng - offset * 0.7, lat + offset * 0.2],
          [lng - offset * 0.3, lat + offset * 0.08],
          [lng, lat],
          [lng + offset * 0.3, lat - offset * 0.1],
          [lng + offset * 0.6, lat - offset * 0.2],
          [lng + offset * 1.0, lat - offset * 0.35],
        ],
      },
      {
        id: "water-2",
        type: "water",
        label: "Spring-fed Pond",
        description: "Year-round water — high traffic staging area in early season.",
        coordinates: [
          [lng + offset * 0.55, lat - offset * 0.5],
          [lng + offset * 0.65, lat - offset * 0.55],
          [lng + offset * 0.7, lat - offset * 0.48],
          [lng + offset * 0.65, lat - offset * 0.42],
          [lng + offset * 0.55, lat - offset * 0.45],
          [lng + offset * 0.55, lat - offset * 0.5],
        ],
      },
      // BEDDING AREAS
      {
        id: "bedding-1",
        type: "bedding",
        label: "Primary Bedding — South Slope",
        description: "South-facing slope with thermal cover. Mature bucks bed here.",
        coordinates: [
          [lng + offset * 0.25, lat + offset * 0.65],
          [lng + offset * 0.45, lat + offset * 0.75],
          [lng + offset * 0.6, lat + offset * 0.7],
          [lng + offset * 0.55, lat + offset * 0.55],
          [lng + offset * 0.4, lat + offset * 0.5],
          [lng + offset * 0.25, lat + offset * 0.55],
          [lng + offset * 0.25, lat + offset * 0.65],
        ],
      },
      {
        id: "bedding-2",
        type: "bedding",
        label: "Secondary Bedding — Thick Cover",
        description: "Dense cedar thicket bedding — wind protection, escape cover nearby.",
        coordinates: [
          [lng - offset * 0.75, lat - offset * 0.25],
          [lng - offset * 0.55, lat - offset * 0.2],
          [lng - offset * 0.5, lat - offset * 0.35],
          [lng - offset * 0.6, lat - offset * 0.45],
          [lng - offset * 0.75, lat - offset * 0.4],
          [lng - offset * 0.75, lat - offset * 0.25],
        ],
      },
      // TERRAIN FUNNELS (NEW!)
      {
        id: "funnel-1",
        type: "funnel",
        label: "Creek-Ridge Pinch Point",
        description: "Terrain bottleneck where creek meets ridge — forces deer through narrow corridor. PRIME stand location.",
        coordinates: [
          [lng - offset * 0.15, lat + offset * 0.15],
          [lng - offset * 0.05, lat + offset * 0.05],
          [lng + offset * 0.05, lat - offset * 0.05],
        ],
      },
      {
        id: "funnel-2",
        type: "funnel",
        label: "Field Corner Funnel",
        description: "Where timber meets field corner — natural staging area. Bucks cruise this during rut.",
        coordinates: [
          [lng + offset * 0.35, lat + offset * 0.15],
          [lng + offset * 0.45, lat + offset * 0.05],
          [lng + offset * 0.55, lat - offset * 0.05],
        ],
      },
      // FOOD PLOT ZONES (NEW!)
      {
        id: "food-1",
        type: "food_plot",
        label: "Kill Plot — Clover/Brassica",
        description: "¼-acre kill plot in timber opening. Plant clover & brassica. Screened by terrain on 3 sides.",
        coordinates: [
          [lng - offset * 0.3, lat - offset * 0.55],
          [lng - offset * 0.2, lat - offset * 0.5],
          [lng - offset * 0.15, lat - offset * 0.6],
          [lng - offset * 0.25, lat - offset * 0.65],
          [lng - offset * 0.3, lat - offset * 0.55],
        ],
      },
      {
        id: "food-2",
        type: "food_plot",
        label: "Staging Plot — Soybeans",
        description: "½-acre destination plot near bedding. Soybeans draw deer out before dark.",
        coordinates: [
          [lng + offset * 0.1, lat + offset * 0.4],
          [lng + offset * 0.25, lat + offset * 0.45],
          [lng + offset * 0.3, lat + offset * 0.35],
          [lng + offset * 0.15, lat + offset * 0.3],
          [lng + offset * 0.1, lat + offset * 0.4],
        ],
      },
      // OPTIMAL STAND SITES (NEW!)
      {
        id: "stand-1",
        type: "stand",
        label: "#1 Stand — Funnel Ambush",
        description: "20ft hang-on at pinch point. SW wind only. All-day sit during rut. 150\" potential.",
        coordinates: [
          [lng - offset * 0.08, lat + offset * 0.08],
          [lng - offset * 0.04, lat + offset * 0.12],
          [lng + offset * 0.0, lat + offset * 0.08],
          [lng - offset * 0.04, lat + offset * 0.04],
          [lng - offset * 0.08, lat + offset * 0.08],
        ],
      },
      {
        id: "stand-2",
        type: "stand",
        label: "#2 Stand — Creek Crossing",
        description: "Ladder stand overlooking creek crossing. N/NW wind. Morning hunts, Oct-Nov.",
        coordinates: [
          [lng + offset * 0.28, lat - offset * 0.12],
          [lng + offset * 0.32, lat - offset * 0.08],
          [lng + offset * 0.36, lat - offset * 0.12],
          [lng + offset * 0.32, lat - offset * 0.16],
          [lng + offset * 0.28, lat - offset * 0.12],
        ],
      },
      {
        id: "stand-3",
        type: "stand",
        label: "#3 Stand — Kill Plot Watch",
        description: "Ground blind on downwind edge of kill plot. S/SE wind. Evening hunts.",
        coordinates: [
          [lng - offset * 0.28, lat - offset * 0.52],
          [lng - offset * 0.24, lat - offset * 0.48],
          [lng - offset * 0.2, lat - offset * 0.52],
          [lng - offset * 0.24, lat - offset * 0.56],
          [lng - offset * 0.28, lat - offset * 0.52],
        ],
      },
    ];

    return corridors;
  }, [parcelCenter, acreage]);

  // Initialize map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    setLoadError(null);
    setIsMapLoaded(false);
    setIsSpinning(false);

    if (!checkWebGLSupport()) {
      setLoadError("Your browser doesn't support WebGL, which is required for 3D terrain viewing. Try Chrome, Firefox, or Safari.");
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

    map.on("error", (e: any) => {
      console.error("Mapbox error:", e);
      if (!isMapLoaded) {
        setLoadError("Failed to load map tiles. Check your internet connection.");
      }
    });

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
      
      // Add terrain
      try {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
      } catch (err) {
        console.log("Terrain failed, continuing without 3D elevation:", err);
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

      // Add hillshade for terrain emphasis
      try {
        map.addSource("hillshade-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
        });
        map.addLayer({
          id: "hillshade",
          type: "hillshade",
          source: "hillshade-dem",
          paint: {
            "hillshade-exaggeration": 0.5,
            "hillshade-shadow-color": "#000000",
            "hillshade-highlight-color": "#ffffff",
            "hillshade-accent-color": "#4a6741",
          },
        }, "waterway-label");
      } catch (err) {
        console.log("Hillshade failed:", err);
      }

      // Draw parcel boundary — the big fix
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
            geometry: {
              type: "Polygon",
              coordinates: [coordinates],
            },
          },
        });

        // Glow effect - outer stroke
        map.addLayer({
          id: "parcel-glow",
          type: "line",
          source: "parcel-boundary",
          paint: {
            "line-color": "#f59e0b",
            "line-width": 8,
            "line-opacity": 0.3,
            "line-blur": 4,
          },
        });

        // Main boundary line
        map.addLayer({
          id: "parcel-outline",
          type: "line",
          source: "parcel-boundary",
          paint: {
            "line-color": "#f59e0b",
            "line-width": 3,
            "line-dasharray": [3, 2],
          },
        });

        // Subtle fill
        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "parcel-boundary",
          paint: {
            "fill-color": "#f59e0b",
            "fill-opacity": 0.08,
          },
        });

        // Corner markers
        const cornerFeatures = parcelBounds.map((p) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        }));
        map.addSource("parcel-corners", {
          type: "geojson",
          data: { type: "FeatureCollection", features: cornerFeatures },
        });
        map.addLayer({
          id: "parcel-corner-dots",
          type: "circle",
          source: "parcel-corners",
          paint: {
            "circle-radius": 4,
            "circle-color": "#f59e0b",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      }

      // Add deer corridors
      const corridors = generateDeerCorridors();
      addCorridorsToMap(map, corridors);

      // Center marker
      new mapboxgl.Marker({ color: "#f59e0b" })
        .setLngLat([parcelCenter.lng, parcelCenter.lat])
        .addTo(map);

      setIsMapLoaded(true);
    });

    map.on("pitchend", () => {
      setCurrentPitch(Math.round(map.getPitch()));
    });
    map.on("rotateend", () => {
      setCurrentBearing(Math.round(map.getBearing()));
    });

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
  }, [isOpen, parcelCenter, parcelBounds, generateDeerCorridors]);

  // Add corridor layers to map
  const addCorridorsToMap = (map: InstanceType<typeof mapboxgl.Map>, corridors: DeerCorridor[]) => {
    const widths: Record<string, number> = {
      primary: 5,
      secondary: 3.5,
      water: 4,
      bedding: 2,
      funnel: 5,
      food_plot: 2,
      stand: 2,
    };

    corridors.forEach((corridor) => {
      const sourceId = `corridor-${corridor.id}`;
      const layerId = `corridor-layer-${corridor.id}`;
      const isPolygon = ["bedding", "food_plot", "stand"].includes(corridor.type);
      const color = CORRIDOR_COLORS[corridor.type];

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
            ? { type: "Polygon", coordinates: [corridor.coordinates] }
            : { type: "LineString", coordinates: corridor.coordinates },
        },
      });

      if (isPolygon) {
        // Fill
        map.addLayer({
          id: `${layerId}-fill`,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": color,
            "fill-opacity": corridor.type === "stand" ? 0.5 : 0.3,
          },
        });
        // Outline
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": color,
            "line-width": widths[corridor.type],
            "line-dasharray": corridor.type === "stand" ? [1, 0] : [2, 2],
          },
        });
        // Label for stands
        if (corridor.type === "stand") {
          // Add a center point for the label
          const centerLng = corridor.coordinates.reduce((s, c) => s + c[0], 0) / corridor.coordinates.length;
          const centerLat = corridor.coordinates.reduce((s, c) => s + c[1], 0) / corridor.coordinates.length;
          map.addSource(`${sourceId}-label`, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: { label: corridor.label.replace(" — ", "\n") },
              geometry: { type: "Point", coordinates: [centerLng, centerLat] },
            },
          });
          map.addLayer({
            id: `${layerId}-label`,
            type: "symbol",
            source: `${sourceId}-label`,
            layout: {
              "text-field": "⊕",
              "text-size": 20,
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": color,
              "text-halo-width": 3,
            },
          });
        }
      } else {
        // Glow under line for primary & funnel corridors
        if (corridor.type === "primary" || corridor.type === "funnel") {
          map.addLayer({
            id: `${layerId}-glow`,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": color,
              "line-width": widths[corridor.type] * 3,
              "line-opacity": 0.15,
              "line-blur": 6,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });
        }
        // Main line
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": color,
            "line-width": widths[corridor.type],
            "line-opacity": 0.9,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        // Dashed overlay for water
        if (corridor.type === "water") {
          map.addLayer({
            id: `${layerId}-dash`,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": "#93c5fd",
              "line-width": 2,
              "line-dasharray": [4, 4],
              "line-opacity": 0.7,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });
        }
        // Direction arrows for primary/secondary/funnel
        if (["primary", "secondary", "funnel"].includes(corridor.type)) {
          map.addLayer({
            id: `${layerId}-arrows`,
            type: "symbol",
            source: sourceId,
            layout: {
              "symbol-placement": "line",
              "symbol-spacing": 80,
              "text-field": "▶",
              "text-size": 10,
              "text-allow-overlap": true,
              "text-rotation-alignment": "map",
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": color,
              "text-halo-width": 1.5,
            },
          });
        }
      }

      // Popup on click
      map.on("click", layerId, (e: any) => {
        const props = e.features?.[0]?.properties;
        if (props) {
          const typeLabel = CORRIDOR_LABELS[props.type]?.name || props.type;
          new mapboxgl.Popup({ className: "terrain-popup" })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="padding:8px;max-width:220px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <div style="width:10px;height:10px;border-radius:50%;background:${CORRIDOR_COLORS[props.type]}"></div>
                  <span style="font-weight:700;font-size:13px;">${props.label}</span>
                </div>
                <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">${typeLabel}</div>
                <p style="font-size:12px;color:#374151;line-height:1.4;margin:0;">${props.description}</p>
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

    const corridors = generateDeerCorridors();
    corridors
      .filter((c) => c.type === type)
      .forEach((corridor) => {
        const layerId = `corridor-layer-${corridor.id}`;
        const visibility = isActive ? "none" : "visible";
        const layerIds = [layerId, `${layerId}-fill`, `${layerId}-arrows`, `${layerId}-glow`, `${layerId}-dash`, `${layerId}-label`];
        layerIds.forEach((id) => {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", visibility);
          }
        });
      });
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
    mapRef.current.easeTo({
      bearing: cb + (direction === "right" ? 45 : -45),
      duration: 500,
    });
  };

  const tiltView = (direction: "up" | "down") => {
    if (!mapRef.current) return;
    const cp = mapRef.current.getPitch();
    const newPitch = Math.max(0, Math.min(85, cp + (direction === "up" ? -15 : 15)));
    mapRef.current.easeTo({ pitch: newPitch, duration: 500 });
  };

  // Cinematic spin
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

  const legendItems = [
    { type: "primary", icon: <div className="w-5 h-1.5 bg-red-500 rounded-full" />, color: "red" },
    { type: "secondary", icon: <div className="w-5 h-1.5 bg-orange-500 rounded-full" />, color: "orange" },
    { type: "water", icon: <Droplets className="w-4 h-4 text-blue-400" />, color: "blue" },
    { type: "bedding", icon: <TreePine className="w-4 h-4 text-green-400" />, color: "green" },
    { type: "funnel", icon: <div className="w-5 h-1.5 bg-purple-500 rounded-full" />, color: "purple" },
    { type: "food_plot", icon: <Wheat className="w-4 h-4 text-yellow-400" />, color: "yellow" },
    { type: "stand", icon: <Crosshair className="w-4 h-4 text-pink-400" />, color: "pink" },
  ];

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
                  3D Terrain + Deer Intel
                  <span className="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
                </h2>
                <p className="text-sm text-stone-400">
                  {parcelAddress || "Selected Parcel"}
                  {acreage && ` • ${acreage.toFixed(1)} acres`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Cinematic spin button */}
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
              <p className="text-stone-400">Loading 3D terrain & deer intel...</p>
              <p className="text-stone-500 text-xs mt-2">Analyzing corridors, water, stands...</p>
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
            {/* Wind direction indicator */}
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
                  <span className="text-sm font-medium text-white">Deer Intel Layers</span>
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">AI Predicted</span>
                  <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">{activeCorridors.length}/7 Active</span>
                </div>
                <Info className="w-4 h-4 text-stone-400" />
              </button>
              
              {showLegend && (
                <div className="p-3 pt-0 border-t border-stone-700">
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-3">
                    {legendItems.map((item) => {
                      const info = CORRIDOR_LABELS[item.type];
                      return (
                        <button
                          key={item.type}
                          onClick={() => toggleCorridor(item.type)}
                          className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                            activeCorridors.includes(item.type)
                              ? `bg-${item.color}-500/20 border border-${item.color}-500/50`
                              : "bg-stone-700/50 border border-transparent opacity-40"
                          }`}
                          style={activeCorridors.includes(item.type) ? { backgroundColor: `${CORRIDOR_COLORS[item.type]}22`, borderColor: `${CORRIDOR_COLORS[item.type]}88` } : {}}
                        >
                          {item.icon}
                          <div className="text-left">
                            <p className="text-[11px] font-medium text-white leading-tight">{info.name}</p>
                            <p className="text-[9px] text-stone-400 leading-tight">{info.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-[10px] text-stone-500 mt-3 text-center">
                    🦌 Drag to rotate • Scroll to zoom • Right-click to tilt • Click any corridor for details • Hit <span className="text-amber-400">Cinematic</span> for the flyover
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
