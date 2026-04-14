"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, MapPin, X, CheckCircle, Map as MapIcon, Loader2, RotateCcw, Maximize2, Mountain, Eye, User, Home, Ruler, Building2, MapPinned, Settings, ChevronLeft, ChevronRight, FileText, Mail, Send, Layers, Lock, Unlock, Sparkles, TreePine, Target, Compass, Droplets, Zap, Crown, Calendar, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Terrain3DView from "./terrain-3d-view";
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface SelectedParcel {
  address: string;
  lat: number;
  lng: number;
  parcelId?: string;
  bounds?: { lat: number; lng: number }[];
}

interface InitialParcel {
  lat: number;
  lng: number;
  address: string;
}

interface InteractiveMapProps {
  onParcelSelect?: (parcel: SelectedParcel | null) => void;
  onLayersChange?: (layers: string[]) => void;
  onCheckout?: (product?: string) => void;
  initialLayers?: string[];
  autoOpen3D?: boolean;
  initialParcel?: InitialParcel | null;
}

interface SearchResult {
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

interface ParcelData {
  parcelId: string;
  owner: string;
  mailingAddress: string;
  siteAddress: string;
  acreage: number;
  sqft: number;
  zoning: string;
  useDescription: string;
  coordinates: number[][][] | number[][][][];
  geometryType: string;
  lat: number;
  lng: number;
  regridPath: string;
}

// Sample parcel for demo/free-look 3D preview (761 Schlessman Rd, Pineville, MO)
const SAMPLE_PARCEL_3D: SelectedParcel = {
  address: "761 Schlessman Rd, Pineville, MO 64831",
  lat: 36.638590,
  lng: -94.345581,
  bounds: [
    { lat: 36.644, lng: -94.351 },
    { lat: 36.644, lng: -94.340 },
    { lat: 36.633, lng: -94.340 },
    { lat: 36.633, lng: -94.351 },
  ],
};

// Mapbox style URLs
const MAPBOX_STYLES: Record<string, string> = {
  hybrid: 'mapbox://styles/mapbox/satellite-streets-v12',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  roadmap: 'mapbox://styles/mapbox/streets-v12',
};

export default function InteractiveMap({
  onParcelSelect,
  onLayersChange,
  onCheckout,
  initialLayers = [],
  autoOpen3D = false,
  initialParcel = null,
}: InteractiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  const [parcelData, setParcelData] = useState<ParcelData | null>(null);
  const [terrainLinkCopied, setTerrainLinkCopied] = useState(false);
  const [neighboringParcels, setNeighboringParcels] = useState<ParcelData[]>([]);
  const selectedLayers = [
    "flood_zones", "topography", "soil_types", "property_boundaries", "roads_transportation",
    "building_footprints", "qualified_opportunity_zones", "fema_risk_index", "school_districts"
  ];
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [mapType, setMapType] = useState<"satellite" | "terrain" | "hybrid" | "roadmap">("hybrid");
  const [is3DMode, setIs3DMode] = useState(true);
  const [isLoadingParcel, setIsLoadingParcel] = useState(false);
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [showViewControls, setShowViewControls] = useState(false);
  const [showFullPanel, setShowFullPanel] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(4);
  const [clickModeEnabled, setClickModeEnabled] = useState(true);
  const [showZoomHint, setShowZoomHint] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [show3DView, setShow3DView] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  
  // Premium Layer definitions
  type PremiumLayerStatus = 'preview' | 'coming_soon' | 'available';
  interface PremiumLayer {
    id: string;
    name: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    status: PremiumLayerStatus;
    includedIn?: string;
  }
  const premiumLayers: PremiumLayer[] = [
    { id: 'lidar_terrain', name: 'LiDAR 3D Terrain', icon: Mountain, description: 'Rotatable 3D view with deer corridors', status: 'preview', includedIn: 'hunt_report' },
    { id: 'deer_movement', name: 'Deer Movement', icon: Target, description: 'AI-predicted travel corridors', status: 'coming_soon', includedIn: 'hunt_report' },
    { id: 'bedding_areas', name: 'Bedding Analysis', icon: Compass, description: 'Likely bedding locations', status: 'coming_soon', includedIn: 'hunt_report' },
    { id: 'water_sources', name: 'Water Sources', icon: Droplets, description: 'Creeks, ponds & drainage', status: 'coming_soon', includedIn: 'hunt_report' },
    { id: 'lidar_canopy', name: 'Canopy Height', icon: TreePine, description: 'Tree height analysis', status: 'coming_soon', includedIn: 'land_report' },
    { id: 'stand_placement', name: 'Stand Planner', icon: Zap, description: 'Optimal stand locations', status: 'coming_soon', includedIn: 'hunt_report' },
  ];
  
  const freeLayers = [
    { id: 'parcel_boundaries', name: 'Parcel Boundaries', active: true },
    { id: 'satellite', name: 'Satellite Imagery', active: true },
    { id: 'roads', name: 'Roads & Access', active: true },
  ];
  
  // Detect mobile/tablet
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-open 3D LiDAR with sample parcel when demo mode
  const auto3DTriggered = useRef(false);
  useEffect(() => {
    if (autoOpen3D && !auto3DTriggered.current) {
      auto3DTriggered.current = true;
      const timer = setTimeout(() => {
        setSelectedParcel(SAMPLE_PARCEL_3D);
        onParcelSelect?.(SAMPLE_PARCEL_3D);
        setShow3DView(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [autoOpen3D, onParcelSelect]);

  // Auto-select parcel when initialParcel is provided
  const initialParcelTriggered = useRef(false);
  useEffect(() => {
    if (initialParcel && !initialParcelTriggered.current && mapLoaded) {
      initialParcelTriggered.current = true;
      const timer = setTimeout(() => {
        selectParcel({
          address: initialParcel.address,
          lat: initialParcel.lat,
          lng: initialParcel.lng,
          placeId: `initial-${Date.now()}`,
        });
      }, 500);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialParcel, mapLoaded]);

  const MIN_CLICK_ZOOM = 14;
  
  const flashZoomHint = useCallback(() => {
    setShowZoomHint(true);
    setTimeout(() => setShowZoomHint(false), 3000);
  }, []);

  // Helper: build GeoJSON from parcel coordinates
  const buildParcelGeoJSON = useCallback((parcel: ParcelData): GeoJSON.Feature | null => {
    if (!parcel.coordinates || parcel.coordinates.length === 0) return null;
    try {
      if (parcel.geometryType === "MultiPolygon") {
        return {
          type: 'Feature',
          properties: { parcelId: parcel.parcelId },
          geometry: { type: 'MultiPolygon', coordinates: parcel.coordinates as number[][][][] }
        };
      } else {
        return {
          type: 'Feature',
          properties: { parcelId: parcel.parcelId },
          geometry: { type: 'Polygon', coordinates: parcel.coordinates as number[][][] }
        };
      }
    } catch {
      return null;
    }
  }, []);

  // Clear all parcel layers from map
  const clearParcelLayers = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Remove neighbor layers
    ['neighbor-parcels-fill', 'neighbor-parcels-line'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('neighbor-parcels')) map.removeSource('neighbor-parcels');
    // Remove selected parcel layers
    ['selected-parcel-fill', 'selected-parcel-line'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('selected-parcel')) map.removeSource('selected-parcel');
  }, []);

  // Draw selected parcel on map
  const drawSelectedParcel = useCallback((parcel: ParcelData) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const feature = buildParcelGeoJSON(parcel);
    if (!feature) return;

    // Remove existing selected parcel layers
    ['selected-parcel-fill', 'selected-parcel-line'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('selected-parcel')) map.removeSource('selected-parcel');

    map.addSource('selected-parcel', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [feature] }
    });
    map.addLayer({
      id: 'selected-parcel-fill',
      type: 'fill',
      source: 'selected-parcel',
      paint: { 'fill-color': '#059669', 'fill-opacity': 0.25 }
    });
    map.addLayer({
      id: 'selected-parcel-line',
      type: 'line',
      source: 'selected-parcel',
      paint: { 'line-color': '#059669', 'line-width': 3, 'line-opacity': 1 }
    });

    // Fit bounds to parcel
    try {
      const bounds = new mapboxgl.LngLatBounds();
      let coords: number[][] = [];
      if (parcel.geometryType === "MultiPolygon") {
        const mc = parcel.coordinates as number[][][][];
        mc.forEach(polygon => { if (polygon[0]) coords = coords.concat(polygon[0]); });
      } else {
        const pc = parcel.coordinates as number[][][];
        if (pc[0]) coords = pc[0];
      }
      coords.forEach(coord => bounds.extend([coord[0], coord[1]] as [number, number]));
      const mobile = window.innerWidth < 768;
      map.fitBounds(bounds, {
        padding: mobile
          ? { top: 70, bottom: 150, left: 20, right: 20 }
          : { top: 80, bottom: 20, left: 20, right: 350 },
        maxZoom: 18,
        duration: 1000
      });
      // Tilt for 3D effect after fitting (skip on mobile)
      if (!mobile) {
        setTimeout(() => { if (mapInstanceRef.current) mapInstanceRef.current.easeTo({ pitch: 45, duration: 500 }); }, 1000);
      }
    } catch (e) {
      console.error("Error fitting bounds:", e);
    }
  }, [buildParcelGeoJSON]);

  // Draw neighboring parcels on map
  const drawNeighborParcels = useCallback((neighbors: ParcelData[]) => {
    const map = mapInstanceRef.current;
    if (!map || neighbors.length === 0) return;

    ['neighbor-parcels-fill', 'neighbor-parcels-line'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('neighbor-parcels')) map.removeSource('neighbor-parcels');

    const features = neighbors
      .map(p => buildParcelGeoJSON(p))
      .filter((f): f is GeoJSON.Feature => f !== null);

    if (features.length === 0) return;

    map.addSource('neighbor-parcels', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });
    map.addLayer({
      id: 'neighbor-parcels-fill',
      type: 'fill',
      source: 'neighbor-parcels',
      paint: { 'fill-color': '#6366f1', 'fill-opacity': 0.1 }
    });
    map.addLayer({
      id: 'neighbor-parcels-line',
      type: 'line',
      source: 'neighbor-parcels',
      paint: { 'line-color': '#6366f1', 'line-width': 2, 'line-opacity': 0.7 }
    });

    // Click handler for neighbor parcels
    map.on('click', 'neighbor-parcels-fill', (e) => {
      if (!e.features || e.features.length === 0) return;
      const clickedId = e.features[0].properties?.parcelId;
      const clickedNeighbor = neighbors.find(n => n.parcelId === clickedId);
      if (clickedNeighbor) {
        clearParcelLayers();
        setParcelData(clickedNeighbor);
        setSelectedParcel({
          address: clickedNeighbor.siteAddress,
          lat: clickedNeighbor.lat,
          lng: clickedNeighbor.lng,
          parcelId: clickedNeighbor.parcelId,
        });
        onParcelSelect?.({
          address: clickedNeighbor.siteAddress,
          lat: clickedNeighbor.lat,
          lng: clickedNeighbor.lng,
          parcelId: clickedNeighbor.parcelId,
        });
        drawSelectedParcel(clickedNeighbor);
      }
    });

    // Hover effects
    map.on('mouseenter', 'neighbor-parcels-fill', () => {
      if (map.getCanvas()) map.getCanvas().style.cursor = 'pointer';
      map.setPaintProperty('neighbor-parcels-fill', 'fill-opacity', 0.3);
    });
    map.on('mouseleave', 'neighbor-parcels-fill', () => {
      if (map.getCanvas()) map.getCanvas().style.cursor = '';
      map.setPaintProperty('neighbor-parcels-fill', 'fill-opacity', 0.1);
    });
  }, [buildParcelGeoJSON, clearParcelLayers, drawSelectedParcel, onParcelSelect]);

  // Fetch parcel data from Regrid API
  const fetchParcelData = useCallback(async (lat: number, lng: number, address?: string) => {
    setIsLoadingParcel(true);
    clearParcelLayers();
    
    try {
      const response = await fetch(`/api/parcels?lat=${lat}&lng=${lng}`);
      let data = await response.json();
      
      if ((!data.parcels || data.parcels.length === 0) && address) {
        const addressResponse = await fetch(`/api/parcels?address=${encodeURIComponent(address)}`);
        data = await addressResponse.json();
      }
      
      if (data.parcels && data.parcels.length > 0) {
        const mainParcel = data.parcels[0];
        setParcelData(mainParcel);
        drawSelectedParcel(mainParcel);
        
        // Fetch neighboring parcels
        if (showNeighbors) {
          const neighborsResponse = await fetch("/api/parcels", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lng, radius: 0.002 }),
          });
          const neighborsData = await neighborsResponse.json();
          
          if (neighborsData.parcels) {
            const neighbors = neighborsData.parcels.filter(
              (p: ParcelData) => p.parcelId !== mainParcel.parcelId
            );
            setNeighboringParcels(neighbors);
            drawNeighborParcels(neighbors);
          }
        }
      } else {
        setParcelData(null);
        setNeighboringParcels([]);
      }
    } catch (error) {
      console.error("Error fetching parcel data:", error);
      setParcelData(null);
    } finally {
      setIsLoadingParcel(false);
    }
  }, [clearParcelLayers, drawSelectedParcel, showNeighbors, drawNeighborParcels]);

  // Initialize Mapbox map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    (mapboxgl as any).accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAPBOX_STYLES.hybrid,
      center: [-98.5795, 39.8283],
      zoom: 4,
      pitch: 45,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new (mapboxgl as any).AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      mapInstanceRef.current = map;
      setMapLoaded(true);
    });

    map.on('zoom', () => {
      setCurrentZoom(Math.round(map.getZoom()));
    });

    // Click-to-select parcels
    map.on('click', async (e) => {
      // Don't handle if clicking a neighbor parcel (those have their own handler)
      const neighborFeatures = map.queryRenderedFeatures(e.point, { layers: ['neighbor-parcels-fill'] });
      if (neighborFeatures.length > 0) return;

      const zoom = map.getZoom();
      if (zoom < 14) {
        flashZoomHint();
        return;
      }

      const { lng, lat } = e.lngLat;

      // Place marker
      if (markerRef.current) markerRef.current.remove();
      markerRef.current = new mapboxgl.Marker({ color: '#dc2626' })
        .setLngLat([lng, lat])
        .addTo(map);

      // Fetch parcel data at clicked location
      setIsLoadingParcel(true);
      clearParcelLayers();

      try {
        const response = await fetch(`/api/parcels?lat=${lat}&lng=${lng}`);
        const data = await response.json();

        if (data.parcels && data.parcels.length > 0) {
          const mainParcel = data.parcels[0];
          setParcelData(mainParcel);
          setShowFullPanel(true);
          setSearchQuery(mainParcel.siteAddress || "");
          setHasSearched(true);

          const parcel: SelectedParcel = {
            address: mainParcel.siteAddress || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            lat: mainParcel.lat,
            lng: mainParcel.lng,
            parcelId: mainParcel.parcelId,
          };
          setSelectedParcel(parcel);
          onParcelSelect?.(parcel);

          drawSelectedParcel(mainParcel);

          // Fetch neighboring parcels
          if (showNeighbors) {
            const neighborsResponse = await fetch("/api/parcels", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat: mainParcel.lat, lng: mainParcel.lng, radius: 0.002 }),
            });
            const neighborsData = await neighborsResponse.json();
            if (neighborsData.parcels) {
              const neighbors = neighborsData.parcels.filter(
                (p: ParcelData) => p.parcelId !== mainParcel.parcelId
              );
              setNeighboringParcels(neighbors);
              drawNeighborParcels(neighbors);
            }
          }
        } else {
          setParcelData(null);
          setNeighboringParcels([]);
        }
      } catch (error) {
        console.error("Error fetching parcel at click location:", error);
      } finally {
        setIsLoadingParcel(false);
      }
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map style when mapType changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const newStyle = MAPBOX_STYLES[mapType];
    if (newStyle && (map.getStyle() as any)?.name !== newStyle) {
      (map as any).setStyle(newStyle);
    }
  }, [mapType]);

  // Send parcel details via email
  const handleSendEmail = async () => {
    if (!emailInput || !parcelData) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setIsSendingEmail(true);
    setEmailError("");
    try {
      const response = await fetch("/api/email-parcel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput, parcel: parcelData }),
      });
      const result = await response.json();
      if (result.success) {
        setEmailSent(true);
        setTimeout(() => { setShowEmailModal(false); setEmailSent(false); setEmailInput(""); }, 2000);
      } else {
        setEmailError(result.message || "Failed to send email");
      }
    } catch (error) {
      setEmailError("Something went wrong. Please try again.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  const toggle3DMode = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (is3DMode) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
    } else {
      map.easeTo({ pitch: 45, duration: 500 });
    }
    setIs3DMode(!is3DMode);
  };

  const rotateMap = (degrees: number) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.easeTo({ bearing: map.getBearing() + degrees, duration: 500 });
  };

  const resetView = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.easeTo({
      pitch: 45,
      bearing: 0,
      zoom: selectedParcel ? 18 : 4,
      duration: 800
    });
    setIs3DMode(true);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapboxToken) {
      console.error("Mapbox token not configured");
      return;
    }

    setIsSearching(true);
    setHasSearched(true);

    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          searchQuery + ", USA"
        )}.json?access_token=${mapboxToken}&country=us&limit=5&types=address,place,locality`
      );

      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const results: SearchResult[] = data.features.map((feature: any) => ({
          address: feature.place_name,
          lat: feature.center[1],
          lng: feature.center[0],
          placeId: feature.id,
        }));
        setSearchResults(results);
        
        if (results.length > 0 && mapInstanceRef.current) {
          mapInstanceRef.current.flyTo({
            center: [results[0].lng, results[0].lat],
            zoom: 16,
            pitch: 45,
            duration: 1500
          });
        }
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const selectParcel = async (result: SearchResult) => {
    const parcel: SelectedParcel = {
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      parcelId: `PARCEL-${result.placeId.slice(0, 8).toUpperCase()}`,
    };
    setSelectedParcel(parcel);
    setShowFullPanel(true);
    onParcelSelect?.(parcel);

    const map = mapInstanceRef.current;
    if (map) {
      if (markerRef.current) markerRef.current.remove();
      markerRef.current = new mapboxgl.Marker({ color: '#dc2626' })
        .setLngLat([result.lng, result.lat])
        .addTo(map);

      map.flyTo({
        center: [result.lng, result.lat],
        zoom: 16,
        pitch: 45,
        duration: 1500
      });

      await fetchParcelData(result.lat, result.lng, result.address);
    }
  };

  const clearSelection = () => {
    setSelectedParcel(null);
    setParcelData(null);
    setNeighboringParcels([]);
    setShowFullPanel(false);
    onParcelSelect?.(null);
    clearParcelLayers();
    
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    const map = mapInstanceRef.current;
    if (map) {
      map.flyTo({
        center: [-98.5795, 39.8283],
        zoom: 4,
        pitch: 0,
        duration: 1500
      });
    }
  };

  const formatAcreage = (acres: number) => {
    if (acres >= 1) return `${acres.toFixed(2)} acres`;
    return `${(acres * 43560).toFixed(0)} sq ft`;
  };

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden shadow-lg bg-stone-900">
      {/* Header Banner */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-center py-2 text-sm font-medium">
        <MapIcon className="w-4 h-4 inline mr-2" />
        \uD83C\uDDFA\uD83C\uDDF8 Interactive 3D Map with Parcel Boundaries & Owner Data
      </div>

      {/* Search Bar */}
      <div className={`absolute top-14 z-10 flex gap-2 ${isMobile ? 'left-2 right-2' : 'left-4 right-4 max-w-xl'}`}>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 pointer-events-none" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Enter any US address to view parcel data..."
            className="pl-10 bg-white/95 backdrop-blur-sm shadow-md border-stone-200"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={isSearching}
          className="bg-emerald-700 hover:bg-emerald-800 text-white shadow-md"
        >
          {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : "Search"}
        </Button>
      </div>

      {/* 3D Controls Toggle Button */}
      <div className={`absolute top-28 z-10 ${isMobile ? 'left-2' : 'left-4'}`}>
        <Button
          onClick={() => setShowViewControls(!showViewControls)}
          variant="outline"
          size={isMobile ? "sm" : "default"}
          className="bg-white/95 backdrop-blur-sm shadow-md"
        >
          <Settings className="w-4 h-4" />
          {!isMobile && (showViewControls ? <ChevronLeft className="w-4 h-4 ml-1" /> : <ChevronRight className="w-4 h-4 ml-1" />)}
        </Button>
      </div>

      {/* 3D Controls Panel */}
      {showViewControls && (
        <div className="absolute top-40 left-4 z-10 flex flex-col gap-2">
          <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 p-2 space-y-2">
            <div className="flex items-center justify-between px-2">
              <p className="text-xs font-semibold text-stone-600">View Controls</p>
              <button onClick={() => setShowViewControls(false)} className="text-stone-400 hover:text-stone-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <Button
              onClick={toggle3DMode}
              variant="outline"
              size="sm"
              className={`w-full justify-start gap-2 ${is3DMode ? 'bg-emerald-50 border-emerald-300' : ''}`}
            >
              <Mountain className="w-4 h-4" />
              {is3DMode ? "3D On" : "3D Off"}
            </Button>
            
            <Button
              onClick={() => rotateMap(45)}
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Rotate 45°
            </Button>
            
            <Button
              onClick={resetView}
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
            >
              <Maximize2 className="w-4 h-4" />
              Reset View
            </Button>

            <Button
              onClick={() => setShowNeighbors(!showNeighbors)}
              variant="outline"
              size="sm"
              className={`w-full justify-start gap-2 ${showNeighbors ? 'bg-indigo-50 border-indigo-300' : ''}`}
            >
              <MapPinned className="w-4 h-4" />
              {showNeighbors ? "Neighbors On" : "Neighbors Off"}
            </Button>
            
            <div className="border-t border-stone-200 pt-2 mt-2">
              <p className="text-xs font-semibold text-stone-600 px-2 mb-2">Map Style</p>
              <div className="grid grid-cols-2 gap-1">
                {(["hybrid", "satellite", "terrain", "roadmap"] as const).map((type) => (
                  <Button
                    key={type}
                    onClick={() => setMapType(type)}
                    variant="outline"
                    size="sm"
                    className={`text-xs capitalize ${mapType === type ? 'bg-emerald-50 border-emerald-300' : ''}`}
                  >
                    {type}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Layer Panel Toggle Button */}
      <div className={`absolute top-28 z-10 ${isMobile ? 'right-2' : 'right-4'}`}>
        <Button
          onClick={() => setShowLayerPanel(!showLayerPanel)}
          variant="outline"
          size={isMobile ? "sm" : "default"}
          className={`bg-white/95 backdrop-blur-sm shadow-md ${showLayerPanel ? 'bg-amber-50 border-amber-400' : ''}`}
        >
          <Layers className="w-4 h-4" />
          {!isMobile && <span className="ml-2">Layers</span>}
          {!isMobile && <span className="ml-1 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">NEW</span>}
        </Button>
      </div>

      {/* Layer Buffet Panel */}
      {showLayerPanel && (
        <div className={`absolute z-10 bg-white/98 backdrop-blur-sm shadow-2xl border border-stone-200 flex flex-col
          ${isMobile 
            ? 'top-40 right-2 left-2 rounded-xl max-h-[60vh]' 
            : 'top-40 right-4 w-80 rounded-xl max-h-[70vh]'
          }`}>
          {/* Panel Header */}
          <div className="p-4 border-b border-stone-200 bg-gradient-to-r from-amber-50 to-white rounded-t-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-stone-800">Map Layers</h3>
                <span className="bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">BETA</span>
              </div>
              <button onClick={() => setShowLayerPanel(false)} className="text-stone-400 hover:text-stone-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-stone-500 mt-1">Premium layers for serious land hunters</p>
          </div>

          {/* Scrollable Content */}
          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            
            {/* Free Layers Section */}
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Unlock className="w-3 h-3" /> Included Free
              </p>
              <div className="space-y-1">
                {freeLayers.map((layer) => (
                  <div key={layer.id} className="flex items-center justify-between py-2 px-3 bg-emerald-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-emerald-500 rounded-full" />
                      <span className="text-sm text-stone-700">{layer.name}</span>
                    </div>
                    <span className="text-xs text-emerald-600 font-medium">Active</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Premium Layers Preview */}
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Crown className="w-3 h-3 text-amber-500" /> Deer Intel Layers
              </p>
              <div className="space-y-1.5">
                {premiumLayers.map((layer) => {
                  const IconComponent = layer.icon;
                  return (
                    <div key={layer.id} className="flex items-center justify-between py-2 px-3 bg-stone-50 rounded-lg border border-stone-200 hover:border-amber-300 transition-colors group">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                          <IconComponent className="w-3.5 h-3.5 text-amber-700" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-stone-800">{layer.name}</p>
                          <p className="text-[9px] text-stone-500">{layer.description}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {layer.status === 'preview' ? (
                          <button
                            onClick={() => {
                              if (parcelData) {
                                setShow3DView(true);
                                setShowLayerPanel(false);
                              } else {
                                alert('Select a parcel first to preview 3D terrain');
                              }
                            }}
                            className="text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1 rounded-full font-medium flex items-center gap-1 transition-colors"
                          >
                            <Play className="w-2.5 h-2.5" /> Preview
                          </button>
                        ) : (
                          <span className="text-[9px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full">
                            {layer.includedIn === 'hunt_report' ? 'in $149 report' : 'in $49 report'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-stone-200 pt-1">
              <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-3">Get Your Report</p>
            </div>

            {/* Hunt Intelligence Report */}
            <div style={{background: 'linear-gradient(135deg, #1a3a2a, #2d6a4f)', borderRadius: 12, padding: 16, marginBottom: 12}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8}}>
                <span style={{color:'#c9a84c', fontWeight:'bold', fontSize: 13}}>\uD83E\uDD8C Hunt Intelligence Report</span>
                <span style={{color:'white', fontWeight:'bold', fontSize: 16}}>$149</span>
              </div>
              <p style={{color:'rgba(255,255,255,0.8)', fontSize: 11, marginBottom: 12}}>
                Terrain analysis, stand placement, wind strategy, and satellite hunt map. Indefinite parcel access.
              </p>
              <button
                onClick={() => {
                  if (parcelData) {
                    setShowLayerPanel(false);
                    onCheckout?.('hunt_report');
                  } else {
                    alert('Search for a property first, then order your report.');
                  }
                }}
                style={{width:'100%', background:'#c9a84c', color:'#1a1a1a', border:'none', borderRadius: 8, padding:'10px 0', fontWeight:'bold', fontSize: 13, cursor:'pointer'}}
              >
                Get Hunt Report — $149
              </button>
            </div>

            {/* Land Intelligence Report */}
            <div style={{background: 'white', border: '2px solid #e0e0e0', borderRadius: 12, padding: 16, marginBottom: 12}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8}}>
                <span style={{color:'#1a3a2a', fontWeight:'bold', fontSize: 13}}>\uD83D\uDCCB Land Intelligence Report</span>
                <span style={{color:'#1a3a2a', fontWeight:'bold', fontSize: 16}}>$49</span>
              </div>
              <p style={{color:'#666', fontSize: 11, marginBottom: 12}}>
                Professional land analysis — terrain, water, access, valuation, and market data.
              </p>
              <button
                onClick={() => {
                  if (parcelData) {
                    setShowLayerPanel(false);
                    onCheckout?.('land_report');
                  } else {
                    alert('Search for a property first, then order your report.');
                  }
                }}
                style={{width:'100%', background:'#1a3a2a', color:'white', border:'none', borderRadius: 8, padding:'10px 0', fontWeight:'bold', fontSize: 13, cursor:'pointer'}}
              >
                Get Land Report — $49
              </button>
            </div>

            {/* Season Pass Teaser */}
            <div className="bg-gradient-to-br from-emerald-700 to-emerald-800 rounded-xl p-3.5 text-white">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4" />
                <span className="font-bold text-sm">Season Pass</span>
                <span className="bg-white/20 text-[9px] px-1.5 py-0.5 rounded-full">Sept – Jan</span>
              </div>
              <p className="text-emerald-100 text-[10px] mb-2">Unlimited Hunting Intel reports on any Missouri property, all season long.</p>
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <span className="text-xl font-bold">$199</span>
                  <span className="text-emerald-200 text-xs ml-1">/ season</span>
                </div>
                <div className="text-right">
                  <p className="text-[9px] text-emerald-300">3+ properties = saves you money</p>
                </div>
              </div>
              <button 
                className="w-full bg-white/15 hover:bg-white/25 text-white py-1.5 rounded-lg font-semibold text-xs transition-colors border border-white/20 flex items-center justify-center gap-1.5"
                onClick={() => alert('Season Pass coming Fall 2026! We\'ll email you when it drops.')}
              >
                <Lock className="w-3 h-3" />
                Coming Fall 2026
              </button>
            </div>

            {/* Questions CTA */}
            <div className="bg-stone-100 rounded-lg p-3 text-center">
              <p className="text-[10px] text-stone-600 mb-1">\uD83E\uDD8C Questions? We speak hunter.</p>
              <a 
                href="mailto:clark@terrafirma.partners?subject=Hunting%20Intel%20Question&body=Hey%20Clark%2C%20I%20have%20a%20question%20about..."
                className="text-xs font-semibold text-amber-600 hover:text-amber-700 underline"
              >
                Email Clark →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Mapbox Map Container */}
      <div className="absolute inset-0 pt-10">
        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-100">
            <div className="text-center">
              <Loader2 className="w-12 h-12 animate-spin text-emerald-600 mx-auto mb-4" />
              <p className="text-stone-600">Loading Interactive 3D Map...</p>
            </div>
          </div>
        )}
        <div 
          ref={mapContainerRef} 
          className="w-full h-full" 
          style={{ cursor: currentZoom >= MIN_CLICK_ZOOM && !selectedParcel ? 'crosshair' : 'grab' }}
        />
      </div>

      {/* Search Results Panel */}
      {(hasSearched || searchResults.length > 0) && !parcelData && (
        <div className={`absolute z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-h-[40vh] overflow-y-auto
          ${isMobile ? 'top-28 left-2 right-2' : 'top-72 left-4 w-80'}`}>
          <div className="p-3 border-b border-stone-200 bg-gradient-to-r from-emerald-50 to-white">
            <h3 className="font-semibold text-stone-800 text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-700" />
              Search Results
            </h3>
            <p className="text-xs text-stone-500">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
            </p>
          </div>
          <div className="p-2 space-y-2">
            {isSearching ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              </div>
            ) : searchResults.length > 0 ? (
              searchResults.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => selectParcel(result)}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    selectedParcel?.address === result.address
                      ? "bg-emerald-100 border-2 border-emerald-500"
                      : "bg-stone-50 hover:bg-stone-100 border-2 border-transparent"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-stone-800">{result.address}</p>
                      <p className="text-xs text-stone-500 mt-1">
                        {result.lat.toFixed(4)}°N, {Math.abs(result.lng).toFixed(4)}°W
                      </p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="text-center py-6 text-stone-500">
                <p className="text-sm">No results found</p>
                <p className="text-xs mt-1">Try a different address</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Order Button */}
      {parcelData && !showFullPanel && !isLoadingParcel && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-10 ${isMobile ? 'bottom-4' : 'bottom-6'}`}>
          <button
            onClick={() => { setShowFullPanel(true); onCheckout?.('hunt_report'); }}
            className={`bg-emerald-700 hover:bg-emerald-800 text-white rounded-full font-semibold shadow-2xl flex items-center gap-2 transition-all hover:scale-105 animate-pulse hover:animate-none
              ${isMobile ? 'py-3 px-6 text-base' : 'py-4 px-8 text-lg gap-3'}`}
          >
            <FileText className={isMobile ? 'w-4 h-4' : 'w-5 h-5'} />
            Get Hunt Report — $149
          </button>
          <p className={`text-white text-center mt-2 drop-shadow-lg bg-black/50 rounded-full px-4 py-1 ${isMobile ? 'text-xs' : 'text-sm'}`}>
            {isMobile ? 'Tap for parcel details' : 'Click to see parcel details & order report'}
          </p>
        </div>
      )}

      {/* Loading indicator */}
      {isLoadingParcel && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-white/95 backdrop-blur-sm rounded-full shadow-lg px-6 py-3">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
            <span className="text-stone-700 font-medium">Loading parcel data...</span>
          </div>
        </div>
      )}
      
      {/* Zoom hint toast */}
      {showZoomHint && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 bg-amber-500 text-white px-6 py-3 rounded-lg shadow-lg animate-bounce">
          <div className="flex items-center gap-3">
            <Maximize2 className="w-5 h-5" />
            <span className="font-medium">Zoom in closer to click-select parcels</span>
          </div>
        </div>
      )}

      {/* Full Parcel Data Panel */}
      {parcelData && showFullPanel && (
        <div className={`absolute z-10 bg-white/95 backdrop-blur-sm shadow-lg border border-emerald-300 flex flex-col
          ${isMobile 
            ? 'bottom-0 left-0 right-0 rounded-t-2xl max-h-[70vh] border-b-0' 
            : 'bottom-4 left-4 w-80 rounded-lg max-h-[75vh]'
          }`}>
          {/* Mobile drag indicator */}
          {isMobile && (
            <div className="flex justify-center py-2 bg-gradient-to-r from-emerald-50 to-white">
              <div className="w-12 h-1.5 bg-stone-300 rounded-full" />
            </div>
          )}
          
          {/* Sticky Header with Actions */}
          <div className={`p-3 border-b border-stone-200 bg-gradient-to-r from-emerald-50 to-white flex-shrink-0 ${isMobile ? 'pt-1' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-700 flex-shrink-0" />
                <p className="font-semibold text-stone-800 text-sm">{parcelData.siteAddress || 'Selected Parcel'}</p>
              </div>
              <button onClick={() => setShowFullPanel(false)} className="text-stone-400 hover:text-stone-600 p-1" title="Minimize">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Action Buttons */}
            <div className="space-y-2">
              <button
                onClick={() => onCheckout?.('hunt_report')}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-sm"
              >
                <FileText className="w-4 h-4" />
                Get Hunt Report — $149
              </button>
              <div className="flex gap-2">
                <a
                  href="/api/free-look?v=20260205"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors text-xs"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Sample
                </a>
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="flex-1 border border-stone-300 text-stone-600 hover:bg-stone-50 py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors text-xs"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Email
                </button>
              </div>
            </div>
          </div>
          
          {/* Scrollable Content */}
          <div className="p-3 space-y-2 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-stone-50 rounded p-2">
                <p className="text-stone-500 uppercase text-[10px]">Lot Size</p>
                <p className="text-stone-800 font-medium">{formatAcreage(parcelData.acreage)}</p>
              </div>
              <div className="bg-stone-50 rounded p-2">
                <p className="text-stone-500 uppercase text-[10px]">Zoning</p>
                <p className="text-stone-800 font-medium truncate">{parcelData.zoning !== "N/A" ? parcelData.zoning : parcelData.useDescription || 'N/A'}</p>
              </div>
            </div>
            
            <div className="bg-stone-50 rounded p-2 text-xs">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-stone-500 uppercase text-[10px]">Owner</p>
                  <p className="text-stone-800 font-medium">{parcelData.owner}</p>
                </div>
                <div className="text-right">
                  <p className="text-stone-500 uppercase text-[10px]">APN</p>
                  <p className="text-stone-800 font-mono text-[11px]">{parcelData.parcelId}</p>
                </div>
              </div>
            </div>

            {parcelData.mailingAddress && parcelData.mailingAddress !== 'Not Available' && (
              <div className="bg-stone-50 rounded p-2 text-xs border-t border-stone-100">
                <p className="text-stone-500 uppercase text-[10px] tracking-wide mb-0.5">Mailing Address</p>
                <p className="text-stone-700 text-[11px]">{parcelData.mailingAddress}</p>
              </div>
            )}

            <button
              onClick={() => {
                const link = `https://terrafirma.partners/intel?lat=${parcelData.lat}&lng=${parcelData.lng}&address=${encodeURIComponent(parcelData.siteAddress || '')}`;
                navigator.clipboard.writeText(link);
                setTerrainLinkCopied(true);
                setTimeout(() => setTerrainLinkCopied(false), 2000);
              }}
              className="w-full mt-1 py-2.5 bg-[#1a3a2a] hover:bg-[#224a35] text-[#c9a84c] border border-[#2d6a4f] rounded-lg text-xs font-bold transition-colors"
            >
              {terrainLinkCopied ? '✓ Link Copied!' : `\uD83D\uDCCB Copy Terrain Link for ${parcelData.owner?.split(' ')[0] ?? 'Owner'}`}
            </button>

            {neighboringParcels.length > 0 && (
              <p className="text-xs text-indigo-600 flex items-center gap-1 py-1">
                <MapPinned className="w-3 h-3" />
                {neighboringParcels.length} neighbor{neighboringParcels.length !== 1 ? "s" : ""} in purple • Click to select
              </p>
            )}

            <div className="pt-2 border-t border-stone-200">
              <p className="text-xs font-semibold text-stone-700 mb-1.5">Report Includes:</p>
              <div className="flex flex-wrap gap-1">
                {['Flood Zones', 'Topography', 'Soils', 'Boundaries', 'Roads'].map((item) => (
                  <span key={item} className="bg-emerald-100 text-emerald-700 text-[10px] px-2 py-0.5 rounded-full">
                    ✓ {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Instructions overlay */}
      {!selectedParcel && mapLoaded && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3">
          <a
            href="/api/free-look?v=20260205"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-full text-sm font-medium flex items-center gap-2 shadow-lg transition-colors"
          >
            <Eye className="w-4 h-4" />
            Take a Free Look
          </a>
          <div className="bg-black/70 text-white px-6 py-3 rounded-full text-sm">
            {currentZoom >= MIN_CLICK_ZOOM ? (
              <span className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                Click anywhere on the map to select a parcel
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Search className="w-4 h-4" />
                Search an address or zoom in to click-select parcels
              </span>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      {parcelData && (
        <div className="absolute bottom-4 right-4 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 p-3">
          <p className="text-xs font-semibold text-stone-600 mb-2">Legend</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 bg-emerald-500/30 border-2 border-emerald-600 rounded-sm" />
              <span className="text-xs text-stone-600">Selected Parcel</span>
            </div>
            {showNeighbors && neighboringParcels.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-indigo-500/20 border-2 border-indigo-500 rounded-sm" />
                <span className="text-xs text-stone-600">Neighboring Parcels</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Parcel Modal */}
      {showEmailModal && parcelData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail className="w-6 h-6 text-white" />
                  <h3 className="text-lg font-semibold text-white">Email Me This Parcel</h3>
                </div>
                <button 
                  onClick={() => { setShowEmailModal(false); setEmailError(""); }}
                  className="text-white/80 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6">
              {emailSent ? (
                <div className="text-center py-6">
                  <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                  <h4 className="text-xl font-semibold text-stone-800 mb-2">Sent!</h4>
                  <p className="text-stone-600">Check your inbox for parcel details.</p>
                </div>
              ) : (
                <>
                  <div className="bg-stone-50 rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium text-stone-800">{parcelData.siteAddress}</p>
                    <p className="text-xs text-stone-500 mt-1">
                      {parcelData.acreage >= 1 
                        ? `${parcelData.acreage.toFixed(2)} acres` 
                        : `${(parcelData.acreage * 43560).toFixed(0)} sq ft`
                      } • {parcelData.owner}
                    </p>
                  </div>
                  
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-stone-700">
                      Your email address
                    </label>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={emailInput}
                      onChange={(e) => { setEmailInput(e.target.value); setEmailError(""); }}
                      onKeyDown={(e) => e.key === "Enter" && handleSendEmail()}
                      className="w-full"
                      autoFocus
                    />
                    {emailError && (
                      <p className="text-sm text-red-500">{emailError}</p>
                    )}
                    <p className="text-xs text-stone-500">
                      We&apos;ll send you a summary with a link to return to this parcel. No spam, ever.
                    </p>
                  </div>
                  
                  <button
                    onClick={handleSendEmail}
                    disabled={isSendingEmail || !emailInput}
                    className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    {isSendingEmail ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Send Parcel Details
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3D Terrain View Modal */}
      <Terrain3DView
        isOpen={show3DView}
        onClose={() => setShow3DView(false)}
        parcelCenter={{ lat: parcelData?.lat || selectedParcel?.lat || 38.5, lng: parcelData?.lng || selectedParcel?.lng || -92.5 }}
        parcelBounds={(() => {
          if (!parcelData?.coordinates || parcelData.coordinates.length === 0) return selectedParcel?.bounds;
          try {
            let coords: number[][] = [];
            if (parcelData.geometryType === "MultiPolygon") {
              const mc = parcelData.coordinates as number[][][][];
              mc.forEach(polygon => { if (polygon[0]) coords = coords.concat(polygon[0]); });
            } else {
              const pc = parcelData.coordinates as number[][][];
              if (pc[0]) coords = pc[0];
            }
            if (coords.length > 0) return coords.map(c => ({ lat: c[1], lng: c[0] }));
          } catch (e) { /* fallback */ }
          return selectedParcel?.bounds;
        })()}
        parcelAddress={parcelData?.siteAddress || selectedParcel?.address}
        acreage={parcelData?.acreage}
        previewMode={true}
        onUnlockIntel={() => {
          setShow3DView(false);
          if (parcelData) {
            setShowLayerPanel(false);
            onCheckout?.('hunt_report');
          }
        }}
      />
    </div>
  );
}
