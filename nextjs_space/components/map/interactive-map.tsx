"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  GoogleMap,
  useLoadScript,
  Marker,
  Polygon,
  InfoWindow,
} from "@react-google-maps/api";
import { Search, MapPin, Layers, X, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAP_LAYERS, MapLayerConfig } from "@/lib/map-layers";

const KANSAS_CITY_CENTER = { lat: 39.0997, lng: -94.5786 };

const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

const mapOptions = {
  mapTypeControl: true,
  streetViewControl: false,
  fullscreenControl: true,
  mapTypeControlOptions: {
    position: typeof google !== "undefined" ? google.maps.ControlPosition.TOP_RIGHT : 3,
  },
};

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

export default function InteractiveMap({
  onParcelSelect,
  onLayersChange,
  initialLayers = [],
}: InteractiveMapProps) {
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(initialLayers);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [mapType, setMapType] = useState<"roadmap" | "satellite" | "hybrid">("roadmap");
  const [infoOpen, setInfoOpen] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey,
    libraries: ["places"],
  });

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    geocoderRef.current = new google.maps.Geocoder();
  }, []);

  const handleMapClick = useCallback(
    async (e: google.maps.MapMouseEvent) => {
      if (!e.latLng || !geocoderRef.current) return;

      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      try {
        const response = await geocoderRef.current.geocode({
          location: { lat, lng },
        });

        if (response.results?.[0]) {
          const result = response.results[0];
          const parcel: SelectedParcel = {
            address: result.formatted_address,
            lat,
            lng,
            parcelId: `KC-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
          };
          setSelectedParcel(parcel);
          setInfoOpen(true);
          onParcelSelect?.(parcel);
        }
      } catch (error) {
        console.error("Geocoding error:", error);
      }
    },
    [onParcelSelect]
  );

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !geocoderRef.current || !mapRef.current) return;

    setIsSearching(true);
    try {
      const response = await geocoderRef.current.geocode({
        address: searchQuery + ", Kansas City",
      });

      if (response.results?.[0]) {
        const result = response.results[0];
        const location = result.geometry.location;
        const lat = location.lat();
        const lng = location.lng();

        mapRef.current.panTo({ lat, lng });
        mapRef.current.setZoom(17);

        const parcel: SelectedParcel = {
          address: result.formatted_address,
          lat,
          lng,
          parcelId: `KC-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        };
        setSelectedParcel(parcel);
        setInfoOpen(true);
        onParcelSelect?.(parcel);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, onParcelSelect]);

  const toggleLayer = useCallback(
    (layerId: string) => {
      setSelectedLayers((prev) => {
        const newLayers = prev.includes(layerId)
          ? prev.filter((id) => id !== layerId)
          : [...prev, layerId];
        onLayersChange?.(newLayers);
        return newLayers;
      });
    },
    [onLayersChange]
  );

  const clearSelection = useCallback(() => {
    setSelectedParcel(null);
    setInfoOpen(false);
    onParcelSelect?.(null);
  }, [onParcelSelect]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full bg-stone-100 rounded-lg">
        <div className="text-center p-8">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-stone-800 mb-2">
            Map Loading Error
          </h3>
          <p className="text-stone-600">
            {apiKey
              ? "Unable to load Google Maps. Please check your API key configuration."
              : "Google Maps API key not configured. Please add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to your environment."}
          </p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full bg-stone-100 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
          <p className="text-stone-600">Loading map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden shadow-lg">
      {/* Search Bar */}
      <div className="absolute top-4 left-4 right-4 z-10 flex gap-2 max-w-xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by address or parcel ID..."
            className="pl-10 bg-white/95 backdrop-blur-sm shadow-md border-stone-200"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={isSearching}
          className="bg-emerald-700 hover:bg-emerald-800 text-white shadow-md"
        >
          {isSearching ? "Searching..." : "Search"}
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
        <div className="absolute top-20 right-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-h-[60vh] overflow-y-auto">
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

      {/* Selected Parcel Info */}
      {selectedParcel && (
        <div className="absolute bottom-4 left-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200">
          <div className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-stone-800 text-sm">
                    {selectedParcel.address}
                  </p>
                  {selectedParcel.parcelId && (
                    <p className="text-xs text-stone-500 mt-1">
                      Parcel ID: {selectedParcel.parcelId}
                    </p>
                  )}
                  <p className="text-xs text-stone-500">
                    {selectedParcel.lat.toFixed(6)}, {selectedParcel.lng.toFixed(6)}
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

      {/* Map Type Toggle */}
      <div className="absolute bottom-4 right-4 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-md overflow-hidden">
        <div className="flex text-sm">
          {(["roadmap", "satellite", "hybrid"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setMapType(type)}
              className={`px-3 py-2 capitalize transition-colors ${
                mapType === type
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Google Map */}
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={KANSAS_CITY_CENTER}
        zoom={11}
        onLoad={onMapLoad}
        onClick={handleMapClick}
        mapTypeId={mapType}
        options={mapOptions}
      >
        {selectedParcel && (
          <Marker
            position={{ lat: selectedParcel.lat, lng: selectedParcel.lng }}
            animation={google.maps.Animation.DROP}
          />
        )}
      </GoogleMap>
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
        <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">
          {layer.description}
        </p>
        <p className="text-xs text-stone-400 mt-1">Source: {layer.dataSource}</p>
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
