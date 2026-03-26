"use client";

import { useRouter } from "next/navigation";
import { MapPin, Shield, AlertTriangle, TreePine, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { trackEvent } from "@/lib/gtag";

// ─── Demo Parcels ───────────────────────────────────────
const DEMO_PARCELS = [
  {
    id: "parcel-1",
    slug: "scout-public-land",
    label: "Scout Public Land",
    subtitle: "Public Conservation Land · 156 ac · Adair County",
    address: "FOREST LAKE, Benton, MO 63501",
    lat: 40.158988,
    lng: -92.629880,
    acreage: 156,
    owner: "Conservation Commission of the State of Missouri",
    emoji: "🏕️",
    gradient: "from-emerald-600 to-teal-700",
    borderColor: "border-emerald-500/30",
    tags: [
      { text: "Public hunting — no permission needed", type: "good" as const },
      { text: "CWD Zone: YES (established)", type: "warn" as const },
      { text: "Mandatory sampling Nov 15-16", type: "warn" as const },
      { text: "No bait/minerals", type: "warn" as const },
      { text: "APR lifted", type: "good" as const },
    ],
  },
  {
    id: "parcel-2",
    slug: "big-acreage-buy",
    label: "Big Acreage Buy",
    subtitle: "Large Private Parcel · 317 ac · Miller County",
    address: "Dog Creek School Rd, Glaze, MO",
    lat: 38.1496,
    lng: -92.4619,
    acreage: 317,
    owner: "Shelton Larry D & Brouk Deitra DN",
    emoji: "🦌",
    gradient: "from-amber-600 to-orange-700",
    borderColor: "border-amber-500/30",
    tags: [
      { text: "Private — permission required", type: "good" as const },
      { text: "CWD Zone: YES — newly added 2025", type: "warn" as const },
      { text: "Mandatory sampling Nov 15-16", type: "warn" as const },
      { text: "No bait/minerals", type: "warn" as const },
      { text: "APR lifted", type: "good" as const },
    ],
  },
  {
    id: "parcel-3",
    slug: "classic-hunting-property",
    label: "Classic Hunting Property",
    subtitle: "Classic Hunting Property · ~100 ac · Caldwell County",
    address: "NE 324th St / NE Tri County Line, Shoal, MO",
    lat: 39.6661,
    lng: -93.9878,
    acreage: 100,
    owner: "Moore William Bruce & Martha, Trustees",
    emoji: "🎯",
    gradient: "from-red-600 to-rose-700",
    borderColor: "border-red-500/30",
    tags: [
      { text: "Private — permission required", type: "good" as const },
      { text: "CWD Zone: YES (established)", type: "warn" as const },
      { text: "Mandatory sampling Nov 15-16", type: "warn" as const },
      { text: "No bait/minerals", type: "warn" as const },
      { text: "APR lifted", type: "good" as const },
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
          Tap a property below to explore real terrain intelligence — deer movement corridors, funnel zones, and optimal stand placements — powered by LiDAR elevation data.
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
              <p className="text-stone-500 text-xs pl-5 truncate">
                Owner: {parcel.owner}
              </p>
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
            Get a full Land Report with property data, terrain analysis, and CWD zone status for any Missouri parcel.
          </p>
          <Link href="/pricing">
            <Button
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base sm:text-lg px-8 py-4 h-auto rounded-xl shadow-lg shadow-emerald-900/30 w-full sm:w-auto"
            >
              Get My Report — $49
            </Button>
          </Link>
          <p className="text-stone-600 text-xs mt-3">
            No signup required · Instant download
          </p>
        </div>
      </div>
    </div>
  );
}
