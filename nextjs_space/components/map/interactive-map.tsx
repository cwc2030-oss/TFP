"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, MapPin, Layers, X, CheckCircle, Map as MapIcon, Loader2, RotateCcw, Maximize2, Mountain, Eye, User, Home, Ruler, Building2, MapPinned, Settings, ChevronLeft, ChevronRight } from "lucide-react";
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

export default function InteractiveMap({
  onParcelSelect,
  onLayersChange,
  initialLayers = [],
}: InteractiveMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const parcelPolygonsRef = useRef<google.maps.Polygon[]>([]);
  const selectedPolygonRef = useRef<google.maps.Polygon | null>(null);
  
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  const [parcelData, setParcelData] = useState<ParcelData | null>(null);
  const [neighboringParcels, setNeighboringParcels] = useState<ParcelData[]>([]);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(initialLayers);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapType, setMapType] = useState<"satellite" | "terrain" | "hybrid" | "roadmap">("hybrid");
  const [is3DMode, setIs3DMode] = useState(true);
  const [isLoadingParcel, setIsLoadingParcel] = useState(false);
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [showViewControls, setShowViewControls] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Clear all parcel polygons from map
  const clearParcelPolygons = useCallback(() => {
    parcelPolygonsRef.current.forEach(polygon => polygon.setMap(null));
    parcelPolygonsRef.current = [];
    if (selectedPolygonRef.current) {
      selectedPolygonRef.current.setMap(null);
      selectedPolygonRef.current = null;
    }
  }, []);

  // Draw a parcel polygon on the map
  const drawParcelPolygon = useCallback((parcel: ParcelData, isSelected: boolean = false) => {
    if (!googleMapRef.current || !parcel.coordinates || parcel.coordinates.length === 0) return null;

    let paths: google.maps.LatLngLiteral[][] = [];
    
    try {
      if (parcel.geometryType === "MultiPolygon") {
        // MultiPolygon: coordinates is number[][][][]
        const multiCoords = parcel.coordinates as number[][][][];
        multiCoords.forEach(polygon => {
          if (polygon[0]) {
            const ring = polygon[0].map(coord => ({
              lat: coord[1],
              lng: coord[0]
            }));
            paths.push(ring);
          }
        });
      } else {
        // Polygon: coordinates is number[][][]
        const polyCoords = parcel.coordinates as number[][][];
        if (polyCoords[0]) {
          const ring = polyCoords[0].map(coord => ({
            lat: coord[1],
            lng: coord[0]
          }));
          paths.push(ring);
        }
      }
    } catch (e) {
      console.error("Error parsing parcel coordinates:", e);
      return null;
    }

    if (paths.length === 0) return null;

    const polygon = new google.maps.Polygon({
      paths: paths,
      strokeColor: isSelected ? "#059669" : "#6366f1",
      strokeOpacity: isSelected ? 1 : 0.7,
      strokeWeight: isSelected ? 3 : 2,
      fillColor: isSelected ? "#059669" : "#6366f1",
      fillOpacity: isSelected ? 0.25 : 0.1,
      map: googleMapRef.current,
      clickable: !isSelected,
    });

    if (!isSelected) {
      polygon.addListener("click", () => {
        // When clicking a neighboring parcel, make it selected
        setParcelData(parcel);
        setSelectedParcel({
          address: parcel.siteAddress,
          lat: parcel.lat,
          lng: parcel.lng,
          parcelId: parcel.parcelId,
        });
        onParcelSelect?.({
          address: parcel.siteAddress,
          lat: parcel.lat,
          lng: parcel.lng,
          parcelId: parcel.parcelId,
        });
        
        // Update visual
        if (selectedPolygonRef.current) {
          selectedPolygonRef.current.setOptions({
            strokeColor: "#6366f1",
            strokeOpacity: 0.7,
            strokeWeight: 2,
            fillColor: "#6366f1",
            fillOpacity: 0.1,
          });
        }
        polygon.setOptions({
          strokeColor: "#059669",
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: "#059669",
          fillOpacity: 0.25,
        });
        selectedPolygonRef.current = polygon;
      });

      polygon.addListener("mouseover", () => {
        if (selectedPolygonRef.current !== polygon) {
          polygon.setOptions({ fillOpacity: 0.3 });
        }
      });

      polygon.addListener("mouseout", () => {
        if (selectedPolygonRef.current !== polygon) {
          polygon.setOptions({ fillOpacity: 0.1 });
        }
      });
    }

    return polygon;
  }, [onParcelSelect]);

  // Fetch parcel data from Regrid API
  const fetchParcelData = useCallback(async (lat: number, lng: number, address?: string) => {
    setIsLoadingParcel(true);
    clearParcelPolygons();
    
    try {
      // Fetch the main parcel at this location - use address if available for better accuracy
      const params = address 
        ? `address=${encodeURIComponent(address)}`
        : `lat=${lat}&lng=${lng}`;
      const response = await fetch(`/api/parcels?${params}`);
      const data = await response.json();
      
      if (data.parcels && data.parcels.length > 0) {
        const mainParcel = data.parcels[0];
        setParcelData(mainParcel);
        
        // Draw the main parcel polygon
        const mainPolygon = drawParcelPolygon(mainParcel, true);
        if (mainPolygon) {
          selectedPolygonRef.current = mainPolygon;
        }
        
        // Fetch neighboring parcels
        if (showNeighbors) {
          const neighborsResponse = await fetch("/api/parcels", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lng, radius: 0.002 }),
          });
          const neighborsData = await neighborsResponse.json();
          
          if (neighborsData.parcels) {
            // Filter out the main parcel
            const neighbors = neighborsData.parcels.filter(
              (p: ParcelData) => p.parcelId !== mainParcel.parcelId
            );
            setNeighboringParcels(neighbors);
            
            // Draw neighboring parcels
            neighbors.forEach((neighbor: ParcelData) => {
              const polygon = drawParcelPolygon(neighbor, false);
              if (polygon) {
                parcelPolygonsRef.current.push(polygon);
              }
            });
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
  }, [clearParcelPolygons, drawParcelPolygon, showNeighbors]);

  // Initialize Google Maps
  const initializeMap = useCallback(() => {
    if (!mapRef.current || !window.google || googleMapRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: 39.8283, lng: -98.5795 },
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
    
    if (window.google && window.google.maps) {
      initializeMap();
      return;
    }

    window.initMap = initializeMap;

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', initializeMap);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap&v=weekly`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, [apiKey, initializeMap]);

  // Update map type
  useEffect(() => {
    if (googleMapRef.current) {
      googleMapRef.current.setMapTypeId(mapType);
    }
  }, [mapType]);

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

  const rotateMap = (degrees: number) => {
    if (!googleMapRef.current) return;
    const currentHeading = googleMapRef.current.getHeading() || 0;
    googleMapRef.current.setHeading(currentHeading + degrees);
  };

  const resetView = () => {
    if (!googleMapRef.current) return;
    googleMapRef.current.setTilt(45);
    googleMapRef.current.setHeading(0);
    googleMapRef.current.setZoom(selectedParcel ? 18 : 4);
    setIs3DMode(true);
  };

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

  const selectParcel = async (result: SearchResult) => {
    const parcel: SelectedParcel = {
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      parcelId: `PARCEL-${result.placeId.slice(0, 8).toUpperCase()}`,
    };
    setSelectedParcel(parcel);
    onParcelSelect?.(parcel);

    if (googleMapRef.current) {
      if (markerRef.current) {
        markerRef.current.setMap(null);
      }

      googleMapRef.current.panTo({ lat: result.lat, lng: result.lng });
      googleMapRef.current.setZoom(18);
      googleMapRef.current.setTilt(45);

      markerRef.current = new google.maps.Marker({
        position: { lat: result.lat, lng: result.lng },
        map: googleMapRef.current,
        title: result.address,
        animation: google.maps.Animation.DROP,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#dc2626",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      // Fetch real parcel data from Regrid
      await fetchParcelData(result.lat, result.lng, result.address);
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
    setParcelData(null);
    setNeighboringParcels([]);
    onParcelSelect?.(null);
    clearParcelPolygons();
    
    if (markerRef.current) {
      markerRef.current.setMap(null);
      markerRef.current = null;
    }

    if (googleMapRef.current) {
      googleMapRef.current.panTo({ lat: 39.8283, lng: -98.5795 });
      googleMapRef.current.setZoom(4);
      googleMapRef.current.setTilt(0);
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
        🇺🇸 Interactive 3D Map with Parcel Boundaries & Owner Data
      </div>

      {/* Search Bar */}
      <div className="absolute top-14 left-4 right-4 z-10 flex gap-2 max-w-xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
          <Input
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
        <Button
          onClick={() => setShowLayerPanel(!showLayerPanel)}
          variant="outline"
          className="bg-white/95 backdrop-blur-sm shadow-md"
        >
          <Layers className="w-5 h-5" />
        </Button>
      </div>

      {/* 3D Controls Toggle Button */}
      <div className="absolute top-28 left-4 z-10">
        <Button
          onClick={() => setShowViewControls(!showViewControls)}
          variant="outline"
          className="bg-white/95 backdrop-blur-sm shadow-md"
        >
          <Settings className="w-5 h-5" />
          {showViewControls ? <ChevronLeft className="w-4 h-4 ml-1" /> : <ChevronRight className="w-4 h-4 ml-1" />}
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

      {/* Layer Panel */}
      {showLayerPanel && (
        <div className="absolute top-28 right-4 z-10 w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-h-[50vh] overflow-y-auto">
          <div className="p-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-semibold text-stone-800">Report Layers</h3>
            <button onClick={() => setShowLayerPanel(false)} className="text-stone-400 hover:text-stone-600">
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
      {(hasSearched || searchResults.length > 0) && !parcelData && (
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

      {/* Parcel Data Panel */}
      {parcelData && (
        <div className="absolute bottom-4 left-4 z-10 w-96 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-emerald-300 max-h-[60vh] overflow-y-auto">
          <div className="p-4 border-b border-stone-200 bg-gradient-to-r from-emerald-50 to-white">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-stone-800">Parcel Information</p>
                  <p className="text-xs text-stone-500">Powered by Regrid</p>
                </div>
              </div>
              <button onClick={clearSelection} className="text-stone-400 hover:text-stone-600">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          {isLoadingParcel ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Parcel ID */}
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-emerald-700 mt-1 flex-shrink-0" />
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide">Parcel ID (APN)</p>
                  <p className="font-mono text-sm text-stone-800">{parcelData.parcelId}</p>
                </div>
              </div>

              {/* Owner */}
              <div className="flex items-start gap-3">
                <User className="w-4 h-4 text-emerald-700 mt-1 flex-shrink-0" />
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide">Owner</p>
                  <p className="text-sm text-stone-800 font-medium">{parcelData.owner}</p>
                </div>
              </div>

              {/* Mailing Address */}
              <div className="flex items-start gap-3">
                <Home className="w-4 h-4 text-emerald-700 mt-1 flex-shrink-0" />
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide">Mailing Address</p>
                  <p className="text-sm text-stone-800">{parcelData.mailingAddress}</p>
                </div>
              </div>

              {/* Site Address */}
              <div className="flex items-start gap-3">
                <MapPinned className="w-4 h-4 text-emerald-700 mt-1 flex-shrink-0" />
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide">Site Address</p>
                  <p className="text-sm text-stone-800">{parcelData.siteAddress}</p>
                </div>
              </div>

              {/* Acreage */}
              <div className="flex items-start gap-3">
                <Ruler className="w-4 h-4 text-emerald-700 mt-1 flex-shrink-0" />
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide">Lot Size</p>
                  <p className="text-sm text-stone-800">
                    {formatAcreage(parcelData.acreage)}
                    {parcelData.sqft > 0 && (
                      <span className="text-stone-500 ml-2">({parcelData.sqft.toLocaleString()} sq ft)</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Zoning */}
              <div className="flex items-start gap-3">
                <Building2 className="w-4 h-4 text-emerald-700 mt-1 flex-shrink-0" />
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide">Zoning / Use</p>
                  <p className="text-sm text-stone-800">
                    {parcelData.zoning !== "N/A" ? parcelData.zoning : parcelData.useDescription}
                  </p>
                </div>
              </div>

              {/* Neighboring parcels count */}
              {neighboringParcels.length > 0 && (
                <div className="pt-3 mt-3 border-t border-stone-200">
                  <p className="text-xs text-indigo-600 flex items-center gap-1">
                    <MapPinned className="w-3 h-3" />
                    {neighboringParcels.length} neighboring parcel{neighboringParcels.length !== 1 ? "s" : ""} shown in purple • Click to select
                  </p>
                </div>
              )}

              {/* Report Layers Toggle Section */}
              <div className="pt-4 mt-4 border-t-2 border-emerald-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-700" />
                    <p className="text-sm font-semibold text-stone-800">Report Layers</p>
                  </div>
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
                    {selectedLayers.length} selected
                  </span>
                </div>
                <p className="text-xs text-stone-500 mb-3">
                  Toggle which layers to include in your report:
                </p>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {MAP_LAYERS.map((layer) => (
                    <CompactLayerToggle
                      key={layer.id}
                      layer={layer}
                      isSelected={selectedLayers.includes(layer.id)}
                      onToggle={() => toggleLayer(layer.id)}
                    />
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      const allLayerIds = MAP_LAYERS.map(l => l.id);
                      setSelectedLayers(allLayerIds);
                      onLayersChange?.(allLayerIds);
                    }}
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-medium"
                  >
                    Select All
                  </button>
                  <span className="text-xs text-stone-300">|</span>
                  <button
                    onClick={() => {
                      setSelectedLayers([]);
                      onLayersChange?.([]);
                    }}
                    className="text-xs text-stone-500 hover:text-stone-700 font-medium"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {/* Controls hint */}
              <div className="pt-3 mt-3 border-t border-stone-200">
                <p className="text-xs text-stone-500 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  Drag to pan • Scroll to zoom • Ctrl+drag to rotate
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instructions overlay when no parcel selected */}
      {!selectedParcel && !hasSearched && mapLoaded && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-black/70 text-white px-6 py-3 rounded-full text-sm">
          <span className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            Search an address to view parcel boundaries & owner data
          </span>
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

function CompactLayerToggle({
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
      className={`w-full flex items-center gap-2 p-2 rounded-lg transition-all text-left ${
        isSelected
          ? "bg-emerald-50 border border-emerald-400"
          : "bg-stone-50 border border-transparent hover:bg-stone-100 hover:border-stone-200"
      }`}
    >
      {/* Toggle Switch */}
      <div
        className={`w-8 h-4 rounded-full relative transition-colors flex-shrink-0 ${
          isSelected ? "bg-emerald-500" : "bg-stone-300"
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
            isSelected ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
      
      {/* Layer Color Indicator */}
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: layer.color }}
      />
      
      {/* Layer Name */}
      <span className={`text-sm flex-1 truncate ${isSelected ? "text-stone-800 font-medium" : "text-stone-600"}`}>
        {layer.displayName}
      </span>
      
      {/* Premium Badge */}
      {layer.isPremium && (
        <span className="text-[10px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded flex-shrink-0">
          Pro
        </span>
      )}
    </button>
  );
}
