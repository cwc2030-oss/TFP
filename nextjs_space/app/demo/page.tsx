"use client";

import { useRouter } from "next/navigation";
import { MapPin, Shield, AlertTriangle, TreePine, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { trackEvent } from "@/lib/gtag";

// ─── Demo Parcels ───────────────────────────────────────
const DEMO_PARCELS = [
  {
    id: "territory-osage",
    slug: "osage-county-territory",
    label: "717-Acre Territory",
    subtitle: "4-Parcel Hunting Territory · 717 ac · Osage County, OK",
    address: "Osage County, Oklahoma",
    lat: 36.934637,
    lng: -96.214819,
    acreage: 717,
    owner: "",
    isTerritory: true,
    parcelCount: 4,
    territoryUrl:
      "/intel?territory=true&name=Osage%20County%20Territory&p1lat=36.929885&p1lng=-96.206485&p2lat=36.934760&p2lng=-96.210069&p3lat=36.939034&p3lng=-96.215077&p4lat=36.932875&p4lng=-96.220187&p5lat=36.936633&p5lng=-96.222278",
    emoji: "🗺️",
    gradient: "from-sky-600 to-indigo-700",
    borderColor: "border-sky-500/30",
    tags: [
      { text: "4 adjoining parcels stitched together", type: "good" as const },
      { text: "717 acres of terrain analyzed", type: "good" as const },
      { text: "Osage County, OK", type: "good" as const },
    ],
  },
  {
    id: "parcel-kirksville",
    slug: "kirksville-140",
    label: "140 Hunting Acres",
    subtitle: "Mid-Size Hunting Tract · 140 ac · Adair County",
    address: "27934 Yager Trl, Kirksville, MO 63501",
    lat: 40.083338,
    lng: -92.6373,
    acreage: 140.37995,
    owner: "Private landowner",
    emoji: "🏕️",
    gradient: "from-emerald-600 to-teal-700",
    borderColor: "border-emerald-500/30",
    tags: [
      { text: "Private — permission required", type: "good" as const },
      { text: "Mid-size hunting tract", type: "good" as const },
      { text: "Adair County", type: "good" as const },
    ],
  },
  {
    id: "parcel-3",
    slug: "hunting-35-acres",
    label: "35 Hunting Acres",
    subtitle: "Compact Hunting Parcel · 35 ac · Ste. Genevieve County",
    address: "19189 Pleasant Valley Dr, Ste. Genevieve, MO 63670",
    lat: 37.909137,
    lng: -90.096130,
    acreage: 35,
    owner: "GEGG THOMAS RUSSELL & MELODECE D",
    emoji: "🎯",
    gradient: "from-red-600 to-rose-700",
    borderColor: "border-red-500/30",
    tags: [
      { text: "Private — permission required", type: "good" as const },
      { text: "Compact hunting property", type: "good" as const },
      { text: "Ste. Genevieve County", type: "good" as const },
    ],
  },
];

function TagBadge({ text, type }: { text: string; type: "good" | "warn" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
        type === "good"
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-amber-500/15 text-amber-400"
      }`}
    >
      {type === "good" ? (
        <Shield className="w-3 h-3" />
      ) : (
        <AlertTriangle className="w-3 h-3" />
      )}
      {text}
    </span>
  );
}

export default function DemoPage() {
  const router = useRouter();

  const handleCardClick = (parcel: (typeof DEMO_PARCELS)[number]) => {
    trackEvent("demo_parcel_clicked", {
      parcel_label: parcel.label,
      address: parcel.address,
    });
    // Territory cards launch the multi-parcel analysis; single parcels use lat/lng.
    if ("territoryUrl" in parcel && parcel.territoryUrl) {
      router.push(parcel.territoryUrl);
      return;
    }
    router.push(
      `/intel?lat=${parcel.lat}&lng=${parcel.lng}&address=${encodeURIComponent(parcel.address)}&acreage=${parcel.acreage}`
    );
  };

  return (
    <div className="min-h-screen bg-stone-950 pt-16">
      {/* ─── Demo Banner ──────────────────────────────────── */}
      <div className="bg-gradient-to-r from-emerald-900/60 to-stone-900 border-b border-emerald-500/20">
        <div className="max-w-4xl mx-auto px-4 py-4 sm:py-5 text-center">
          <p className="text-emerald-400 font-semibold text-sm sm:text-base tracking-wide uppercase">
            Demo Mode
          </p>
          <p className="text-stone-300 text-sm sm:text-base mt-1">
            Enter your own address to get your Hunt Report.
          </p>
          <Link href="/" className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-sm mt-2 transition-colors">
            <Search className="w-4 h-4" />
            Search your address
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* ─── Hero ──────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 pt-8 sm:pt-12 pb-4 text-center">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">
          See What Your Land Is Hiding
        </h1>
        <p className="text-stone-400 mt-3 text-sm sm:text-base max-w-xl mx-auto">
          Tap a property below to explore real terrain intelligence — deer movement corridors, funnel zones, and optimal intercept placements — powered by LiDAR elevation data.
        </p>
      </div>

      {/* ─── Parcel Cards ─────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 pb-8 space-y-4 sm:space-y-5">
        {DEMO_PARCELS.map((parcel) => (
          <button
            key={parcel.id}
            onClick={() => handleCardClick(parcel)}
            className={`w-full text-left bg-stone-900/80 backdrop-blur border ${parcel.borderColor} rounded-xl p-4 sm:p-5 hover:bg-stone-800/90 hover:border-emerald-500/50 transition-all duration-200 active:scale-[0.99] group`}
          >
            {/* Card Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl sm:text-2xl">{parcel.emoji}</span>
                  <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                    {parcel.label}
                  </h2>
                </div>
                <p className="text-stone-400 text-xs sm:text-sm">
                  {parcel.subtitle}
                </p>
              </div>
              <div className={`flex-shrink-0 bg-gradient-to-br ${parcel.gradient} rounded-lg p-2.5 sm:p-3 group-hover:scale-105 transition-transform`}>
                <TreePine className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
            </div>

            {/* Address & Owner */}
            <div className="mt-3 space-y-1">
              <div className="flex items-center gap-1.5 text-stone-300 text-xs sm:text-sm">
                <MapPin className="w-3.5 h-3.5 text-stone-500 flex-shrink-0" />
                <span className="truncate">{parcel.address}</span>
              </div>
              {"isTerritory" in parcel && parcel.isTerritory ? (
                <p className="text-stone-500 text-xs pl-5 truncate">
                  {(parcel as any).parcelCount} adjoining parcels · {parcel.acreage} total acres
                </p>
              ) : (
                <p className="text-stone-500 text-xs pl-5 truncate">
                  Owner: {parcel.owner}
                </p>
              )}
            </div>

            {/* Tags */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {parcel.tags.map((tag, i) => (
                <TagBadge key={i} text={tag.text} type={tag.type} />
              ))}
            </div>

            {/* CTA hint */}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-emerald-500 text-xs sm:text-sm font-medium group-hover:text-emerald-400 transition-colors">
                Tap to explore terrain →
              </span>
              <ChevronRight className="w-4 h-4 text-stone-600 group-hover:text-emerald-500 transition-colors" />
            </div>
          </button>
        ))}
      </div>

      {/* ─── CTA Section ──────────────────────────────────── */}
      <div className="bg-gradient-to-t from-stone-900 to-stone-950 border-t border-stone-800">
        <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12 text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
            Ready to scout your own land?
          </h2>
          <p className="text-stone-400 text-sm sm:text-base mb-6 max-w-md mx-auto">
            Unlock property data, terrain analysis, and hunting intel for any parcel.
          </p>
          <Link href="/pricing">
            <Button
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base sm:text-lg px-8 py-4 h-auto rounded-xl shadow-lg shadow-emerald-900/30 w-full sm:w-auto"
            >
              See Plans &amp; Pricing
            </Button>
          </Link>
          <p className="text-stone-600 text-xs mt-3">
            Single-parcel unlock or unlimited with Pro
          </p>
        </div>
      </div>
    </div>
  );
}
