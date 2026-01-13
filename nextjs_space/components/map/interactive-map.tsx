"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, MapPin, Layers, X, CheckCircle, Map as MapIcon, Loader2, RotateCcw, Maximize2, Mountain, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAP_LAYERS, MapLayerConfig } from "@/lib/map-layers";

declare global {
  interface Window {
    google: typeof google;
    initMap: () => void;
  }
}

interface SelectedParcel {
  address: string;
  lat: number;
  lng: number;
  parcelId?: string;
  bounds?: { lat: number; lng: number }[];
}

interface InteractiveMapProps {
  onParcelSelect?: (parcel: SelectedParcel | null) => void;
  onLayersChange?: (layers: string[]) => void;
  initialLayers?: string[];
}

interface SearchResult {
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

export default function InteractiveMap({
  onParcelSelect,
  onLayersChange,
  initialLayers = [],
}: InteractiveMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(initialLayers);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapType, setMapType] = useState<"satellite" | "terrain" | "hybrid" | "roadmap">("hybrid");
  const [is3DMode, setIs3DMode] = useState(true);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Initialize Google Maps
  const initializeMap = useCallback(() => {
    if (!mapRef.current || !window.google || googleMapRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: 39.8283, lng: -98.5795 }, // Center of US
      zoom: 4,
      mapTypeId: "hybrid",
      tilt: 45,
      heading: 0,
      mapTypeControl: false,
      streetViewControl: true,
      fullscreenControl: false,
      zoomControl: true,
      zoomControlOptions: {
        position: google.maps.ControlPosition.RIGHT_BOTTOM,
      },
      gestureHandling: "greedy",
      rotateControl: true,
    });

    googleMapRef.current = map;
    setMapLoaded(true);
  }, []);

  // Load Google Maps Script
  useEffect(() => {
    if (!apiKey) return;
    
    // Check if already loaded
    if (window.google && window.google.maps) {
      initializeMap();
      return;
    }

    // Define callback
    window.initMap = initializeMap;

    // Check if script already exists
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', initializeMap);
      return;
    }

    // Load script
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap&v=weekly`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    return () => {
      // Cleanup not needed as we want the script to persist
    };
  }, [apiKey, initializeMap]);

  // Update map type
  useEffect(() => {
    if (googleMapRef.current) {
      googleMapRef.current.setMapTypeId(mapType);
    }
  }, [mapType]);

  // Handle 3D mode toggle
  const toggle3DMode = () => {
    if (!googleMapRef.current) return;
    
    if (is3DMode) {
      googleMapRef.current.setTilt(0);
      googleMapRef.current.setHeading(0);
    } else {
      googleMapRef.current.setTilt(45);
    }
    setIs3DMode(!is3DMode);
  };

  // Rotate map
  const rotateMap = (degrees: number) => {
    if (!googleMapRef.current) return;
    const currentHeading = googleMapRef.current.getHeading() || 0;
    googleMapRef.current.setHeading(currentHeading + degrees);
  };

  // Reset view
  const resetView = () => {
    if (!googleMapRef.current) return;
    googleMapRef.current.setTilt(45);
    googleMapRef.current.setHeading(0);
    googleMapRef.current.setZoom(selectedParcel ? 18 : 4);
    setIs3DMode(true);
  };

  // Handle search
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    if (!apiKey) {
      console.error("Google Maps API key not configured");
      return;
    }

    setIsSearching(true);
    setHasSearched(true);

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          searchQuery + ", USA"
        )}&key=${apiKey}`
      );

      const data = await response.json();

      if (data.status === "OK" && data.results) {
        const results: SearchResult[] = data.results.slice(0, 5).map((result: any) => ({
          address: result.formatted_address,
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          placeId: result.place_id,
        }));
        setSearchResults(results);
        
        // Pan to first result
        if (results.length > 0 && googleMapRef.current) {
          googleMapRef.current.panTo({ lat: results[0].lat, lng: results[0].lng });
          googleMapRef.current.setZoom(16);
          googleMapRef.current.setTilt(45);
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

  // Select a parcel
  const selectParcel = (result: SearchResult) => {
    const parcel: SelectedParcel = {
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      parcelId: `PARCEL-${result.placeId.slice(0, 8).toUpperCase()}`,
    };
    setSelectedParcel(parcel);
    onParcelSelect?.(parcel);

    // Update map
    if (googleMapRef.current) {
      // Remove existing marker
      if (markerRef.current) {
        markerRef.current.setMap(null);
      }

      // Pan to location with animation
      googleMapRef.current.panTo({ lat: result.lat, lng: result.lng });
      googleMapRef.current.setZoom(18);
      googleMapRef.current.setTilt(60);

      // Add marker
      markerRef.current = new google.maps.Marker({
        position: { lat: result.lat, lng: result.lng },
        map: googleMapRef.current,
        title: result.address,
        animation: google.maps.Animation.DROP,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: "#059669",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
    }
  };

  const toggleLayer = (layerId: string) => {
    setSelectedLayers((prev) => {
      const newLayers = prev.includes(layerId)
        ? prev.filter((id) => id !== layerId)
        : [...prev, layerId];
      onLayersChange?.(newLayers);
      return newLayers;
    });
  };

  const clearSelection = () => {
    setSelectedParcel(null);
    onParcelSelect?.(null);
    
    // Remove marker
    if (markerRef.current) {
      markerRef.current.setMap(null);
      markerRef.current = null;
    }

    // Reset map view
    if (googleMapRef.current) {
      googleMapRef.current.panTo({ lat: 39.8283, lng: -98.5795 });
      googleMapRef.current.setZoom(4);
      googleMapRef.current.setTilt(0);
    }
  };

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden shadow-lg bg-stone-900">
      {/* Header Banner */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-center py-2 text-sm font-medium">
        <MapIcon className="w-4 h-4 inline mr-2" />
        🇺🇸 Interactive 3D Map - Pan, Zoom, Tilt & Rotate
      </div>

      {/* Search Bar */}
      <div className="absolute top-14 left-4 right-4 z-10 flex gap-2 max-w-xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Enter any US address, city, or ZIP code..."
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
        <Button
          onClick={() => setShowLayerPanel(!showLayerPanel)}
          variant="outline"
          className="bg-white/95 backdrop-blur-sm shadow-md"
        >
          <Layers className="w-5 h-5" />
        </Button>
      </div>

      {/* 3D Controls */}
      <div className="absolute top-28 left-4 z-10 flex flex-col gap-2">
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 p-2 space-y-2">
          <p className="text-xs font-semibold text-stone-600 px-2">View Controls</p>
          
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

      {/* Layer Panel */}
      {showLayerPanel && (
        <div className="absolute top-28 right-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-h-[50vh] overflow-y-auto">
          <div className="p-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-semibold text-stone-800">Report Layers</h3>
            <button
              onClick={() => setShowLayerPanel(false)}
              className="text-stone-400 hover:text-stone-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            {MAP_LAYERS.map((layer) => (
              <LayerToggle
                key={layer.id}
                layer={layer}
                isSelected={selectedLayers.includes(layer.id)}
                onToggle={() => toggleLayer(layer.id)}
              />
            ))}
          </div>
          <div className="p-4 bg-stone-50 border-t border-stone-200">
            <p className="text-xs text-stone-500">
              {selectedLayers.length} layer{selectedLayers.length !== 1 ? "s" : ""} selected for report
            </p>
          </div>
        </div>
      )}

      {/* Google Map Container */}
      <div className="absolute inset-0 pt-10">
        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-100">
            <div className="text-center">
              <Loader2 className="w-12 h-12 animate-spin text-emerald-600 mx-auto mb-4" />
              <p className="text-stone-600">Loading Interactive 3D Map...</p>
            </div>
          </div>
        )}
        <div ref={mapRef} className="w-full h-full" />
      </div>

      {/* Search Results Panel */}
      {(hasSearched || searchResults.length > 0) && (
        <div className="absolute top-72 left-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-h-[40vh] overflow-y-auto">
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

      {/* Selected Parcel Info */}
      {selectedParcel && (
        <div className="absolute bottom-4 left-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-emerald-300">
          <div className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-stone-800 text-sm">Selected Parcel</p>
                  <p className="text-xs text-stone-600 mt-1">{selectedParcel.address}</p>
                  <p className="text-xs text-stone-500">ID: {selectedParcel.parcelId}</p>
                  <p className="text-xs text-stone-400">
                    {selectedParcel.lat.toFixed(4)}, {selectedParcel.lng.toFixed(4)}
                  </p>
                </div>
              </div>
              <button onClick={clearSelection} className="text-stone-400 hover:text-stone-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 pt-3 border-t border-stone-200">
              <p className="text-xs text-emerald-700 flex items-center gap-1">
                <Eye className="w-3 h-3" />
                Use mouse to drag, scroll to zoom, Ctrl+drag to rotate
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Instructions overlay when no parcel selected */}
      {!selectedParcel && !hasSearched && mapLoaded && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-black/70 text-white px-6 py-3 rounded-full text-sm">
          <span className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            Search for an address to explore in 3D
          </span>
        </div>
      )}
    </div>
  );
}

function LayerToggle({
  layer,
  isSelected,
  onToggle,
}: {
  layer: MapLayerConfig;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-start gap-3 p-3 rounded-lg transition-all text-left ${
        isSelected
          ? "bg-emerald-50 border-2 border-emerald-500"
          : "bg-stone-50 border-2 border-transparent hover:bg-stone-100"
      }`}
    >
      <div
        className="w-4 h-4 rounded-full mt-0.5 flex-shrink-0"
        style={{ backgroundColor: layer.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-stone-800">
            {layer.displayName}
          </span>
          {layer.isPremium && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
              Premium
            </span>
          )}
        </div>
        <p className="text-xs text-stone-500 mt-0.5 truncate">{layer.dataSource}</p>
      </div>
      <div className="flex-shrink-0">
        {isSelected ? (
          <CheckCircle className="w-5 h-5 text-emerald-600" />
        ) : (
          <div className="w-5 h-5 rounded-full border-2 border-stone-300" />
        )}
      </div>
    </button>
  );
}
