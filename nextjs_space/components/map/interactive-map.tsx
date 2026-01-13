"use client";

import { useState, useEffect, useRef } from "react";
import { Search, MapPin, Layers, X, CheckCircle, Map as MapIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAP_LAYERS, MapLayerConfig } from "@/lib/map-layers";

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
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(initialLayers);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [mapCenter, setMapCenter] = useState({ lat: 39.8283, lng: -98.5795 }); // Center of US
  const [mapZoom, setMapZoom] = useState(4);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

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
      // Use Google Geocoding API
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
        
        // Center map on first result
        if (results.length > 0) {
          setMapCenter({ lat: results[0].lat, lng: results[0].lng });
          setMapZoom(14);
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

  const selectParcel = (result: SearchResult) => {
    const parcel: SelectedParcel = {
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      parcelId: `PARCEL-${result.placeId.slice(0, 8).toUpperCase()}`,
    };
    setSelectedParcel(parcel);
    setMapCenter({ lat: result.lat, lng: result.lng });
    setMapZoom(17);
    onParcelSelect?.(parcel);
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
    setMapZoom(4);
    setMapCenter({ lat: 39.8283, lng: -98.5795 });
    onParcelSelect?.(null);
  };

  // Generate Google Static Map URL
  const getMapUrl = () => {
    if (!apiKey) return null;
    
    let markers = "";
    if (selectedParcel) {
      markers = `&markers=color:red%7Clabel:P%7C${selectedParcel.lat},${selectedParcel.lng}`;
    }
    
    // Return Google Static Maps URL with satellite/hybrid view
    const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
    return `${baseUrl}?center=${mapCenter.lat},${mapCenter.lng}&zoom=${mapZoom}&size=1280x720&maptype=hybrid${markers}&key=${apiKey}`;
  };

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden shadow-lg bg-gradient-to-br from-emerald-50 to-stone-100">
      {/* Header Banner */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-center py-2 text-sm font-medium">
        <MapIcon className="w-4 h-4 inline mr-2" />
        🇺🇸 Nationwide Coverage - Search any address in the United States
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

      {/* Layer Panel */}
      {showLayerPanel && (
        <div className="absolute top-28 right-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-h-[50vh] overflow-y-auto">
          <div className="p-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-semibold text-stone-800">Map Layers</h3>
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

      {/* Map Display */}
      <div className="absolute inset-0 pt-10">
        {apiKey && getMapUrl() ? (
          <img
            src={getMapUrl()!}
            alt="Map"
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback if map fails to load
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="relative w-full h-full overflow-hidden">
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Map_of_USA_with_state_names.svg/1280px-Map_of_USA_with_state_names.svg.png"
              alt="USA Map"
              className="absolute inset-0 w-full h-full object-contain opacity-40"
              style={{ objectPosition: "center 60%" }}
            />
            <div 
              className="absolute inset-0"
              style={{
                background: "linear-gradient(to bottom right, rgba(236, 253, 245, 0.85), rgba(245, 245, 244, 0.8))",
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-stone-500 text-lg">Enter an address above to search</p>
            </div>
          </div>
        )}
      </div>

      {/* Search Results Panel */}
      <div className="absolute top-28 left-4 z-10 w-96 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-h-[55vh] overflow-y-auto">
        <div className="p-4 border-b border-stone-200 bg-gradient-to-r from-emerald-50 to-white">
          <h3 className="font-semibold text-stone-800 flex items-center gap-2">
            <MapIcon className="w-5 h-5 text-emerald-700" />
            {hasSearched ? "Search Results" : "Search for a Property"}
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            {hasSearched 
              ? `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} found` 
              : "Enter an address, city, or ZIP code to find properties"}
          </p>
        </div>
        <div className="p-2 space-y-2">
          {isSearching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
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
          ) : hasSearched ? (
            <div className="text-center py-8 text-stone-500">
              <p>No results found</p>
              <p className="text-xs mt-1">Try a different address or ZIP code</p>
            </div>
          ) : (
            <div className="text-center py-8 text-stone-400">
              <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Search for any US address</p>
              <p className="text-xs mt-1">Example: "123 Main St, Kansas City, MO"</p>
            </div>
          )}
        </div>
      </div>

      {/* Selected Parcel Info */}
      {selectedParcel && (
        <div className="absolute bottom-4 left-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-emerald-300">
          <div className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-stone-800 text-sm">
                    Selected Parcel
                  </p>
                  <p className="text-xs text-stone-600 mt-1">
                    {selectedParcel.address}
                  </p>
                  <p className="text-xs text-stone-500">
                    ID: {selectedParcel.parcelId}
                  </p>
                  <p className="text-xs text-stone-400">
                    {selectedParcel.lat.toFixed(4)}, {selectedParcel.lng.toFixed(4)}
                  </p>
                </div>
              </div>
              <button
                onClick={clearSelection}
                className="text-stone-400 hover:text-stone-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
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
        <p className="text-xs text-stone-500 mt-0.5 truncate">
          {layer.dataSource}
        </p>
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