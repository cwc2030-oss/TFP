"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search, MapPin, Layers, X, AlertTriangle, CheckCircle, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAP_LAYERS, MapLayerConfig } from "@/lib/map-layers";

const KANSAS_CITY_CENTER = { lat: 39.0997, lng: -94.5786 };

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

// Demo parcels for demonstration mode
const DEMO_PARCELS = [
  { address: "1 Kansas City Place, Kansas City, MO 64105", lat: 39.0997, lng: -94.5786, parcelId: "KC-DEMO-001" },
  { address: "400 Grand Blvd, Kansas City, MO 64106", lat: 39.1018, lng: -94.5844, parcelId: "KC-DEMO-002" },
  { address: "1020 Main St, Kansas City, MO 64105", lat: 39.1014, lng: -94.5818, parcelId: "KC-DEMO-003" },
  { address: "6501 Johnson Dr, Mission, KS 66202", lat: 39.0278, lng: -94.6558, parcelId: "KS-DEMO-001" },
  { address: "11500 Roe Ave, Leawood, KS 66211", lat: 38.9178, lng: -94.6328, parcelId: "KS-DEMO-002" },
];

export default function InteractiveMap({
  onParcelSelect,
  onLayersChange,
  initialLayers = [],
}: InteractiveMapProps) {
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(initialLayers);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [filteredParcels, setFilteredParcels] = useState(DEMO_PARCELS);

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      setFilteredParcels(DEMO_PARCELS);
      return;
    }
    const filtered = DEMO_PARCELS.filter(
      (p) =>
        p.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.parcelId.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredParcels(filtered.length > 0 ? filtered : DEMO_PARCELS);
  };

  const selectParcel = (parcel: SelectedParcel) => {
    setSelectedParcel(parcel);
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
    onParcelSelect?.(null);
  };

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden shadow-lg bg-gradient-to-br from-emerald-50 to-stone-100">
      {/* Demo Mode Banner */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-amber-500 text-white text-center py-2 text-sm font-medium">
        <AlertTriangle className="w-4 h-4 inline mr-2" />
        Demo Mode - Select a sample parcel below. Configure Google Maps API for full interactive functionality.
      </div>

      {/* Search Bar */}
      <div className="absolute top-14 left-4 right-4 z-10 flex gap-2 max-w-xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search demo parcels..."
            className="pl-10 bg-white/95 backdrop-blur-sm shadow-md border-stone-200"
          />
        </div>
        <Button
          onClick={handleSearch}
          className="bg-emerald-700 hover:bg-emerald-800 text-white shadow-md"
        >
          Search
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

      {/* Demo Map Visual - Static Map Background */}
      <div className="absolute inset-0 pt-10">
        <div 
          className="w-full h-full bg-stone-200"
          style={{
            backgroundImage: `url('https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Tiled_web_map_numbering.png/320px-Tiled_web_map_numbering.png linear-gradient(to bottom right, #e7f5ee, #f5f5f4)`,
            backgroundSize: "256px 256px, cover",
            backgroundRepeat: "repeat, no-repeat",
            backgroundPosition: "center",
          }}
        >
          {/* Map grid overlay for visual effect */}
          <div 
            className="absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(rgba(16, 185, 129, 0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(16, 185, 129, 0.1) 1px, transparent 1px)
              `,
              backgroundSize: "50px 50px",
            }}
          />
        </div>
      </div>

      {/* Demo Parcel List */}
      <div className="absolute top-28 left-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-h-[50vh] overflow-y-auto">
        <div className="p-4 border-b border-stone-200">
          <h3 className="font-semibold text-stone-800 flex items-center gap-2">
            <MapIcon className="w-5 h-5 text-emerald-700" />
            Sample Parcels (Kansas City Metro)
          </h3>
          <p className="text-xs text-stone-500 mt-1">Click to select a parcel for your report</p>
        </div>
        <div className="p-2 space-y-2">
          {filteredParcels.map((parcel, idx) => (
            <button
              key={idx}
              onClick={() => selectParcel(parcel)}
              className={`w-full text-left p-3 rounded-lg transition-all ${
                selectedParcel?.parcelId === parcel.parcelId
                  ? "bg-emerald-100 border-2 border-emerald-500"
                  : "bg-stone-50 hover:bg-stone-100 border-2 border-transparent"
              }`}
            >
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-stone-800">{parcel.address}</p>
                  <p className="text-xs text-stone-500">{parcel.parcelId}</p>
                </div>
              </div>
            </button>
          ))}
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