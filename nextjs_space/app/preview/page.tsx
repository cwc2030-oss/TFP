"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";

// Dynamically import Terrain3DView to avoid SSR issues with Mapbox
const Terrain3DView = dynamic(
  () => import("@/components/map/terrain-3d-view").then(mod => mod.default),
  { ssr: false, loading: () => <LoadingScreen /> }
);

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mx-auto mb-4" />
        <p className="text-white text-lg">Loading terrain...</p>
      </div>
    </div>
  );
}

function PreviewContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [isLoading, setIsLoading] = useState(true);
  const [parcelInfo, setParcelInfo] = useState<{
    address: string;
    county: string;
    acreage: number;
    lat: number;
    lng: number;
    bounds?: { lat: number; lng: number }[];
  } | null>(null);
  
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  const address = searchParams.get('address') || '';
  
  // Fetch parcel info
  useEffect(() => {
    if (!lat || !lng) {
      router.push('/');
      return;
    }
    
    async function fetchParcel() {
      try {
        const res = await fetch(`/api/parcels?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        
        // API returns {parcels: [...]} array
        const parcel = data.parcels?.[0];
        
        if (!parcel) {
          // Use URL params if no parcel found
          setParcelInfo({
            address: address || 'Property Location',
            county: 'Unknown',
            acreage: 0,
            lat,
            lng
          });
        } else {
          // Capitalize county name
          const countyName = parcel.county 
            ? parcel.county.charAt(0).toUpperCase() + parcel.county.slice(1).toLowerCase()
            : 'Unknown';
          
          // Use user-entered address if Regrid returns "No Situs Address"
          let displayAddress = parcel.siteAddress || address || 'Property Location';
          if (displayAddress.toLowerCase().includes('no situs')) {
            displayAddress = address || 'Rural Property';
          }
          
          // Extract parcel bounds from coordinates - format is [[[lng,lat], [lng,lat], ...]]
          let bounds: { lat: number; lng: number }[] | undefined;
          if (parcel.coordinates && Array.isArray(parcel.coordinates)) {
            try {
              // Get the first polygon ring (outer boundary)
              const ring = parcel.coordinates[0];
              if (Array.isArray(ring) && ring.length > 0) {
                bounds = ring
                  .filter((coord: any) => Array.isArray(coord) && coord.length >= 2)
                  .map((coord: any) => ({ lng: coord[0], lat: coord[1] }));
              }
            } catch (e) {
              console.error('Error parsing bounds:', e);
            }
          }
          
          setParcelInfo({
            address: displayAddress,
            county: countyName,
            acreage: parcel.acreage || 0,
            lat: parcel.lat || lat,
            lng: parcel.lng || lng,
            bounds
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
      setIsLoading(false);
    }
    
    fetchParcel();
  }, [lat, lng, address, router]);
  
  const handleUnlock = () => {
    // Go to the new Deer Intel page with terrain analysis
    router.push(`/intel?lat=${parcelInfo?.lat || lat}&lng=${parcelInfo?.lng || lng}&address=${encodeURIComponent(parcelInfo?.address || address)}&acreage=${parcelInfo?.acreage || 80}`);
  };
  
  const handleExploreMap = () => {
    router.push(`/map?lat=${lat}&lng=${lng}`);
  };
  
  if (isLoading || !parcelInfo) {
    return <LoadingScreen />;
  }
  
  return (
    <Terrain3DView
      isOpen={true}
      onClose={() => router.push('/')}
      parcelCenter={{ lat: parcelInfo.lat, lng: parcelInfo.lng }}
      parcelBounds={parcelInfo.bounds}
      parcelAddress={parcelInfo.address}
      acreage={parcelInfo.acreage}
      previewMode={true}
      onUnlockIntel={handleUnlock}
    />
  );
}

export default function PreviewPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <PreviewContent />
    </Suspense>
  );
}
