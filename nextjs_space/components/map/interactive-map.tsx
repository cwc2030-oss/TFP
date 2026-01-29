"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, MapPin, X, CheckCircle, Map as MapIcon, Loader2, RotateCcw, Maximize2, Mountain, Eye, User, Home, Ruler, Building2, MapPinned, Settings, ChevronLeft, ChevronRight, FileText, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


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
  onCheckout?: () => void;
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
  onCheckout,
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
  // Basic Report layers - pre-selected for $99 report, no user configuration
  const selectedLayers = ["flood_zones", "topography", "soil_types", "property_boundaries", "roads_transportation"];
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
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
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  
  // Detect mobile/tablet
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  
  // Get responsive padding for fitBounds - smaller on mobile for better parcel visibility
  const getFitBoundsPadding = useCallback(() => {
    const mobile = window.innerWidth < 768;
    return mobile 
      ? { top: 70, bottom: 150, left: 20, right: 20 }
      : { top: 80, bottom: 20, left: 20, right: 350 };
  }, []);
  
  // Send parcel details via email
  const handleSendEmail = async () => {
    if (!emailInput || !parcelData) return;
    
    // Basic email validation
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
        body: JSON.stringify({
          email: emailInput,
          parcel: parcelData,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setEmailSent(true);
        setTimeout(() => {
          setShowEmailModal(false);
          setEmailSent(false);
          setEmailInput("");
        }, 2000);
      } else {
        setEmailError(result.message || "Failed to send email");
      }
    } catch (error) {
      setEmailError("Something went wrong. Please try again.");
    } finally {
      setIsSendingEmail(false);
    }
  };
  
  // Minimum zoom level required for click-to-select (roughly county level)
  const MIN_CLICK_ZOOM = 14;
  
  // Show zoom hint briefly when user clicks while too zoomed out
  const flashZoomHint = useCallback(() => {
    setShowZoomHint(true);
    setTimeout(() => setShowZoomHint(false), 3000);
  }, []);

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
      // Always use coordinates for parcel lookup - more accurate than address matching
      const params = `lat=${lat}&lng=${lng}`;
      const response = await fetch(`/api/parcels?${params}`);
      const data = await response.json();
      
      if (data.parcels && data.parcels.length > 0) {
        const mainParcel = data.parcels[0];
        setParcelData(mainParcel);
        
        // Draw the main parcel polygon
        const mainPolygon = drawParcelPolygon(mainParcel, true);
        if (mainPolygon) {
          selectedPolygonRef.current = mainPolygon;
          
          // Fit map to parcel bounds for proper framing
          if (googleMapRef.current && mainParcel.coordinates) {
            const bounds = new google.maps.LatLngBounds();
            try {
              let coords: number[][] = [];
              if (mainParcel.geometryType === "MultiPolygon") {
                const multiCoords = mainParcel.coordinates as number[][][][];
                multiCoords.forEach(polygon => {
                  if (polygon[0]) coords = coords.concat(polygon[0]);
                });
              } else {
                const polyCoords = mainParcel.coordinates as number[][][];
                if (polyCoords[0]) coords = polyCoords[0];
              }
              coords.forEach(coord => {
                bounds.extend({ lat: coord[1], lng: coord[0] });
              });
              googleMapRef.current.fitBounds(bounds, getFitBoundsPadding());
              // Add slight tilt for 3D effect after fitting (skip on mobile for smoother experience)
              setTimeout(() => {
                if (googleMapRef.current && window.innerWidth >= 768) googleMapRef.current.setTilt(45);
              }, 300);
            } catch (e) {
              console.error("Error fitting bounds:", e);
            }
          }
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
  }, [clearParcelPolygons, drawParcelPolygon, showNeighbors, getFitBoundsPadding]);

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
    
    // Track zoom level for click-to-select feature
    map.addListener("zoom_changed", () => {
      const zoom = map.getZoom();
      if (zoom !== undefined) {
        setCurrentZoom(zoom);
      }
    });
    
    // Click-to-select parcels on the map
    map.addListener("click", async (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return;
      
      const zoom = map.getZoom() || 4;
      if (zoom < 14) {
        // Too zoomed out - prompt user to zoom in
        flashZoomHint();
        return;
      }
      
      const lat = event.latLng.lat();
      const lng = event.latLng.lng();
      
      // Create a temporary marker at click location
      if (markerRef.current) {
        markerRef.current.setMap(null);
      }
      
      markerRef.current = new google.maps.Marker({
        position: { lat, lng },
        map: map,
        title: "Selected Location",
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
      
      // Fetch parcel data at clicked location
      setIsLoadingParcel(true);
      clearParcelPolygons();
      
      try {
        const response = await fetch(`/api/parcels?lat=${lat}&lng=${lng}`);
        const data = await response.json();
        
        if (data.parcels && data.parcels.length > 0) {
          const mainParcel = data.parcels[0];
          setParcelData(mainParcel);
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
          
          // Draw the main parcel polygon
          const mainPolygon = drawParcelPolygon(mainParcel, true);
          if (mainPolygon) {
            selectedPolygonRef.current = mainPolygon;
            
            // Fit map to parcel bounds
            if (mainParcel.coordinates) {
              const bounds = new google.maps.LatLngBounds();
              try {
                let coords: number[][] = [];
                if (mainParcel.geometryType === "MultiPolygon") {
                  const multiCoords = mainParcel.coordinates as number[][][][];
                  multiCoords.forEach((polygon: number[][][]) => {
                    if (polygon[0]) coords = coords.concat(polygon[0]);
                  });
                } else {
                  const polyCoords = mainParcel.coordinates as number[][][];
                  if (polyCoords[0]) coords = polyCoords[0];
                }
                coords.forEach((coord: number[]) => {
                  bounds.extend({ lat: coord[1], lng: coord[0] });
                });
                map.fitBounds(bounds, getFitBoundsPadding());
                setTimeout(() => {
                  if (window.innerWidth >= 768) map.setTilt(45);
                }, 300);
              } catch (e) {
                console.error("Error fitting bounds:", e);
              }
            }
          }
          
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
              
              neighbors.forEach((neighbor: ParcelData) => {
                const polygon = drawParcelPolygon(neighbor, false);
                if (polygon) {
                  parcelPolygonsRef.current.push(polygon);
                }
              });
            }
          }
        } else {
          // No parcel found at location - let user know
          setParcelData(null);
          setNeighboringParcels([]);
        }
      } catch (error) {
        console.error("Error fetching parcel at click location:", error);
      } finally {
        setIsLoadingParcel(false);
      }
    });
  }, [clearParcelPolygons, drawParcelPolygon, onParcelSelect, showNeighbors, flashZoomHint, getFitBoundsPadding]);

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap&libraries=places&v=weekly`;
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

  // Initialize Google Places Autocomplete
  useEffect(() => {
    if (!mapLoaded || !searchInputRef.current || !window.google?.maps?.places || autocompleteRef.current) return;

    const autocomplete = new google.maps.places.Autocomplete(searchInputRef.current, {
      types: ["address"],
      componentRestrictions: { country: "us" },
      fields: ["formatted_address", "geometry", "place_id"],
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (place.geometry?.location && place.formatted_address) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        
        setSearchQuery(place.formatted_address);
        setSearchResults([]);
        setHasSearched(true);
        
        // Directly select this location
        selectParcel({
          address: place.formatted_address,
          lat,
          lng,
          placeId: place.place_id || "",
        });
      }
    });

    autocompleteRef.current = autocomplete;
  }, [mapLoaded]);

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

      // Pan to location first, fitBounds will adjust zoom after parcel data loads
      googleMapRef.current.panTo({ lat: result.lat, lng: result.lng });
      googleMapRef.current.setZoom(16); // Initial zoom, will be adjusted by fitBounds

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


  const clearSelection = () => {
    setSelectedParcel(null);
    setParcelData(null);
    setNeighboringParcels([]);
    setShowFullPanel(false);
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

      {/* 3D Controls Toggle Button - Hidden on very small mobile */}
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

      {/* Layer Panel */}

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
        <div 
          ref={mapRef} 
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

      {/* Floating Order Button - Shows when parcel selected but panel not expanded */}
      {parcelData && !showFullPanel && !isLoadingParcel && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-10 ${isMobile ? 'bottom-4' : 'bottom-6'}`}>
          <button
            onClick={() => setShowFullPanel(true)}
            className={`bg-emerald-700 hover:bg-emerald-800 text-white rounded-full font-semibold shadow-2xl flex items-center gap-2 transition-all hover:scale-105 animate-pulse hover:animate-none
              ${isMobile ? 'py-3 px-6 text-base' : 'py-4 px-8 text-lg gap-3'}`}
          >
            <FileText className={isMobile ? 'w-4 h-4' : 'w-5 h-5'} />
            Order Land Analysis – $99
          </button>
          <p className={`text-white text-center mt-2 drop-shadow-lg bg-black/50 rounded-full px-4 py-1 ${isMobile ? 'text-xs' : 'text-sm'}`}>
            {isMobile ? 'Tap for parcel details' : 'Click to see parcel details & order report'}
          </p>
        </div>
      )}

      {/* Loading indicator when fetching parcel */}
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

      {/* Full Parcel Data Panel - Shows when expanded */}
      {parcelData && showFullPanel && (
        <div className={`absolute z-10 bg-white/95 backdrop-blur-sm shadow-lg border border-emerald-300 overflow-y-auto
          ${isMobile 
            ? 'bottom-0 left-0 right-0 rounded-t-2xl max-h-[70vh] border-b-0' 
            : 'bottom-4 left-4 w-96 rounded-lg max-h-[60vh]'
          }`}>
          {/* Mobile drag indicator */}
          {isMobile && (
            <div className="flex justify-center py-2 bg-gradient-to-r from-emerald-50 to-white">
              <div className="w-12 h-1.5 bg-stone-300 rounded-full" />
            </div>
          )}
          <div className={`p-4 border-b border-stone-200 bg-gradient-to-r from-emerald-50 to-white ${isMobile ? 'pt-1' : ''}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-stone-800">Parcel Information</p>
                  <p className="text-xs text-stone-500">Powered by Regrid</p>
                </div>
              </div>
              <button onClick={() => setShowFullPanel(false)} className="text-stone-400 hover:text-stone-600 p-1" title="Minimize">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          
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

            {/* Basic Report Includes */}
            <div className="pt-4 mt-4 border-t-2 border-emerald-200">
              <p className="text-sm font-semibold text-stone-800 mb-2">Basic Report Includes:</p>
              <ul className="text-xs text-stone-600 space-y-1">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                  FEMA Flood Zones
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                  Topography & Elevation
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                  Soil Types
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                  Property Boundaries
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                  Roads & Transportation
                </li>
              </ul>
            </div>

            {/* Checkout Button */}
            <div className="pt-4 mt-4 border-t border-stone-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-stone-600">Basic Land Report</span>
                <span className="text-xl font-bold text-emerald-700">$99</span>
              </div>
              <button
                onClick={onCheckout}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Order Property Report
              </button>
              <a
                href="/api/sample-report?v=20260122"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full mt-2 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 py-2 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-sm"
              >
                <Eye className="w-4 h-4" />
                Preview Sample Report
              </a>
              <button
                onClick={() => setShowEmailModal(true)}
                className="w-full mt-2 border border-stone-300 text-stone-600 hover:bg-stone-50 py-2 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-sm"
              >
                <Mail className="w-4 h-4" />
                Email Me This Parcel
              </button>
              <p className="text-xs text-stone-400 text-center mt-2">
                Save parcel details to your inbox
              </p>
            </div>

            {/* Controls hint */}
            <div className="pt-3 mt-3 border-t border-stone-200">
              <p className="text-xs text-stone-500 flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {isMobile 
                  ? 'Pinch to zoom • Drag to pan • Two fingers to rotate'
                  : 'Drag to pan • Scroll to zoom • Ctrl+drag to rotate'
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Instructions overlay when no parcel selected */}
      {!selectedParcel && mapLoaded && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3">
          <a
            href="/api/sample-report?v=20260122"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-full text-sm font-medium flex items-center gap-2 shadow-lg transition-colors"
          >
            <Eye className="w-4 h-4" />
            View Sample Report
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
            {/* Modal Header */}
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
            
            {/* Modal Body */}
            <div className="p-6">
              {emailSent ? (
                <div className="text-center py-6">
                  <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                  <h4 className="text-xl font-semibold text-stone-800 mb-2">Sent!</h4>
                  <p className="text-stone-600">Check your inbox for parcel details.</p>
                </div>
              ) : (
                <>
                  {/* Parcel Preview */}
                  <div className="bg-stone-50 rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium text-stone-800">{parcelData.siteAddress}</p>
                    <p className="text-xs text-stone-500 mt-1">
                      {parcelData.acreage >= 1 
                        ? `${parcelData.acreage.toFixed(2)} acres` 
                        : `${(parcelData.acreage * 43560).toFixed(0)} sq ft`
                      } • {parcelData.owner}
                    </p>
                  </div>
                  
                  {/* Email Input */}
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
                  
                  {/* Send Button */}
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
    </div>
  );
}

