"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Mountain, ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";

declare const mapboxgl: any;

function PreviewContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parcelInfo, setParcelInfo] = useState<{
    address: string;
    county: string;
    acreage: number;
    lat: number;
    lng: number;
  } | null>(null);
  
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  const address = searchParams.get('address') || '';
  
  // Fetch parcel info
  useEffect(() => {
    if (!lat || !lng) {
      setError('No location provided');
      setIsLoading(false);
      return;
    }
    
    async function fetchParcel() {
      try {
        const res = await fetch(`/api/parcels?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        
        if (data.error) {
          setParcelInfo({
            address: address || 'Property Location',
            county: 'Unknown',
            acreage: 0,
            lat,
            lng
          });
        } else {
          setParcelInfo({
            address: data.siteAddress || address || 'Property Location',
            county: data.county || 'Unknown',
            acreage: data.acreage || 0,
            lat,
            lng
          });
        }
      } catch (e) {
        setParcelInfo({
          address: address || 'Property Location',
          county: 'Unknown',
          acreage: 0,
          lat,
          lng
        });
      }
    }
    
    fetchParcel();
  }, [lat, lng, address]);
  
  // Initialize cinematic 3D map
  useEffect(() => {
    if (!parcelInfo || !mapContainerRef.current) return;
    if (mapRef.current) return;
    
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.error('No Mapbox token found');
      setError('Map configuration error');
      setIsLoading(false);
      return;
    }
    
    // Check if mapboxgl is already loaded
    if (typeof window !== 'undefined' && (window as any).mapboxgl) {
      initMap((window as any).mapboxgl);
      return;
    }
    
    // Load Mapbox script
    const existingScript = document.querySelector('script[src*="mapbox-gl"]');
    if (existingScript) {
      // Script already exists, wait for it
      const checkMapbox = setInterval(() => {
        if ((window as any).mapboxgl) {
          clearInterval(checkMapbox);
          initMap((window as any).mapboxgl);
        }
      }, 100);
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js';
    script.async = true;
    script.onload = () => {
      const link = document.createElement('link');
      link.href = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
      
      // Wait for mapboxgl to be available
      const checkMapbox = setInterval(() => {
        if ((window as any).mapboxgl) {
          clearInterval(checkMapbox);
          initMap((window as any).mapboxgl);
        }
      }, 50);
      
      // Timeout fallback
      setTimeout(() => {
        if (!mapRef.current) {
          setError('Failed to load map');
          setIsLoading(false);
        }
      }, 10000);
    };
    script.onerror = () => {
      setError('Failed to load map library');
      setIsLoading(false);
    };
    document.head.appendChild(script);
    
    function initMap(mapboxgl: any) {
      if (!mapContainerRef.current || mapRef.current) return;
      
      try {
        mapboxgl.accessToken = token;
        
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/satellite-streets-v12',
          center: [parcelInfo!.lng, parcelInfo!.lat],
          zoom: 15,
          pitch: 60,
          bearing: 0,
          interactive: false,
        });
        
        mapRef.current = map;
        
        map.on('load', () => {
          try {
            // Add terrain
            map.addSource('mapbox-dem', {
              type: 'raster-dem',
              url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
              tileSize: 512,
              maxzoom: 14
            });
            
            map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
            
            // Start cinematic rotation
            let bearing = 0;
            const rotate = () => {
              if (!mapRef.current) return;
              bearing = (bearing + 0.3) % 360;
              map.setBearing(bearing);
              requestAnimationFrame(rotate);
            };
            rotate();
            
            setIsLoading(false);
          } catch (e) {
            console.error('Terrain setup error:', e);
            setIsLoading(false);
          }
        });
        
        map.on('error', (e: any) => {
          console.error('Map error:', e);
          setIsLoading(false);
        });
      } catch (e) {
        console.error('Map init error:', e);
        setError('Failed to initialize map');
        setIsLoading(false);
      }
    }
    
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [parcelInfo]);
  
  const handleUnlock = () => {
    // Go to map page with parcel pre-selected and checkout ready
    router.push(`/map?lat=${lat}&lng=${lng}&product=hunting_intel&checkout=true`);
  };
  
  if (error) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">{error}</p>
          <Link href="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-stone-900 relative overflow-hidden">
      {/* 3D Map Background */}
      <div ref={mapContainerRef} className="absolute inset-0" />
      
      {/* Loading overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-stone-900 flex items-center justify-center z-20"
          >
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mx-auto mb-4" />
              <p className="text-white text-lg">Loading terrain...</p>
              {parcelInfo && (
                <p className="text-stone-400 mt-2">{parcelInfo.address}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Top gradient */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-stone-900/80 to-transparent z-10 pointer-events-none" />
      
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo-tfp.png" alt="TFP" width={40} height={40} className="rounded" />
            <span className="text-white font-bold hidden sm:block">Terra Firma Partners</span>
          </Link>
          <div className="flex items-center gap-2 bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-sm border border-emerald-500/30">
            <Mountain className="w-4 h-4" />
            <span>3D Terrain Preview</span>
          </div>
        </div>
      </div>
      
      {/* Bottom gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-stone-900 via-stone-900/90 to-transparent z-10 pointer-events-none" />
      
      {/* Bottom CTA Panel */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="max-w-2xl mx-auto"
        >
          {/* Property info */}
          {parcelInfo && (
            <div className="text-center mb-4">
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">
                {parcelInfo.address.split(',')[0]}
              </h1>
              <p className="text-stone-400">
                {parcelInfo.county} County
                {parcelInfo.acreage > 0 && ` • ${parcelInfo.acreage.toFixed(1)} acres`}
              </p>
            </div>
          )}
          
          {/* Locked features teaser */}
          <div className="bg-stone-800/90 backdrop-blur rounded-xl border border-stone-700 p-4 mb-4">
            <div className="flex items-center justify-center gap-2 text-amber-400 mb-3">
              <Lock className="w-4 h-4" />
              <span className="font-medium">Deer Intelligence Locked</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              {[
                '🦌 Travel Corridors',
                '💧 Water Sources', 
                '🛏️ Bedding Areas',
                '🌾 Food Plot Sites',
                '🎯 Stand Locations',
                '📅 Season Calendar',
                '⚠️ CWD Status',
                '📊 Harvest Data'
              ].map((feature, i) => (
                <div key={i} className="text-stone-400 flex items-center gap-1">
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={handleUnlock}
              size="lg"
              className="bg-amber-500 hover:bg-amber-600 text-stone-900 font-bold px-8 text-lg shadow-lg"
            >
              Unlock Deer Intel — $79
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Link href={`/map?lat=${lat}&lng=${lng}`}>
              <Button
                size="lg"
                variant="outline"
                className="border-stone-500 text-white hover:bg-stone-800 w-full sm:w-auto"
              >
                Explore Map
              </Button>
            </Link>
          </div>
          
          {/* Trust line */}
          <p className="text-center text-stone-500 text-sm mt-4">
            Terrain-derived insights • Missouri hunting experts • Instant PDF delivery
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export default function PreviewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
      </div>
    }>
      <PreviewContent />
    </Suspense>
  );
}
