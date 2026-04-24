"use client";

import { useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

const InteractiveMap = dynamic(
  () => import("@/components/map/interactive-map"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-stone-100 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
          <p className="text-stone-600">Loading map...</p>
        </div>
      </div>
    ),
  }
);

interface SelectedParcel {
  address: string;
  lat: number;
  lng: number;
  parcelId?: string;
  bounds?: { lat: number; lng: number }[];
}

export default function MapPage() {
  const searchParams = useSearchParams();
  const [, setSelectedParcel] = useState<SelectedParcel | null>(null);

  // Read demo mode and initial parcel from URL parameters
  const autoOpen3D = searchParams.get("demo") === "3d";
  const initialParcel = (() => {
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    if (lat && lng) {
      return {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        address: searchParams.get("address") || "Selected Parcel",
      };
    }
    return null;
  })();

  const handleParcelSelect = useCallback((parcel: SelectedParcel | null) => {
    setSelectedParcel(parcel);
  }, []);

  return (
    <div className="min-h-screen pt-16">
      <div className="h-[calc(100vh-64px)] flex">
        <div className="flex-1 relative">
          <InteractiveMap
            onParcelSelect={handleParcelSelect}
            autoOpen3D={autoOpen3D}
            initialParcel={initialParcel}
          />
        </div>
      </div>
    </div>
  );
}
