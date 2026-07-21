"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Search, Shield, Layers, Target, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { trackAddressSearch } from "@/lib/gtag";

// ─────────────────────────────────────────────────────────────
// /demo — address-first terrain demo.
//
// PRIVACY: This page intentionally contains NO browsable sample
// parcels. It never surfaces a real street address or owner name.
// The only action is "enter your own address," consistent with the
// homepage — you only ever see terrain for land you look up yourself.
// ─────────────────────────────────────────────────────────────

export default function DemoPage() {
  const router = useRouter();

  const [address, setAddress] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ description: string; place_id: string; lat?: number; lng?: number }>
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = async (input: string) => {
    if (input.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/places-autocomplete?input=${encodeURIComponent(input)}`
      );
      const data = await res.json();
      if (data.predictions) {
        setSuggestions(data.predictions.slice(0, 5));
        setShowSuggestions(true);
      }
    } catch (err) {
      console.error("Autocomplete error:", err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAddress(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  const handleSuggestionClick = async (suggestion: {
    description: string;
    place_id: string;
    lat?: number;
    lng?: number;
  }) => {
    setAddress(suggestion.description);
    setShowSuggestions(false);
    setIsSearching(true);
    setSearchError("");

    try {
      if (suggestion.lat && suggestion.lng) {
        trackAddressSearch(suggestion.description);
        router.push(
          `/preview?lat=${suggestion.lat}&lng=${suggestion.lng}&address=${encodeURIComponent(
            suggestion.description
          )}`
        );
        return;
      }

      const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        suggestion.description
      )}.json?access_token=${mapboxToken}&country=us&limit=1`;
      const res = await fetch(geocodeUrl);
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        trackAddressSearch(suggestion.description);
        router.push(
          `/preview?lat=${lat}&lng=${lng}&address=${encodeURIComponent(
            suggestion.description
          )}`
        );
      } else {
        setSearchError("Could not locate address.");
        setIsSearching(false);
      }
    } catch (err) {
      setSearchError("Search failed. Please try again.");
      setIsSearching(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;

    setIsSearching(true);
    setSearchError("");
    setShowSuggestions(false);

    // Coordinate shortcut: "lat, lng" jumps straight to the analyzer.
    const coordPattern = /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/;
    const coordMatch = address.trim().match(coordPattern);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (
        !Number.isNaN(lat) &&
        !Number.isNaN(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      ) {
        trackAddressSearch(`${lat}, ${lng}`);
        router.push(`/intel?lat=${lat}&lng=${lng}`);
        return;
      }
    }

    try {
      const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        address
      )}.json?access_token=${mapboxToken}&country=us&limit=1`;
      const res = await fetch(geocodeUrl);
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const formattedAddress = data.features[0].place_name;
        trackAddressSearch(formattedAddress);
        router.push(
          `/preview?lat=${lat}&lng=${lng}&address=${encodeURIComponent(
            formattedAddress
          )}`
        );
      } else {
        setSearchError("Address not found. Try including city and state.");
        setIsSearching(false);
      }
    } catch (err) {
      setSearchError("Search failed. Please try again.");
      setIsSearching(false);
    }
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
            Enter your own address to see The Terrain Brain in action.
          </p>
        </div>
      </div>

      {/* ─── Hero ──────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 pt-10 sm:pt-16 pb-4 text-center">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">
          See What Your Land Is Hiding
        </h1>
        <p className="text-stone-400 mt-3 text-sm sm:text-base max-w-xl mx-auto">
          Enter any address and watch LiDAR-powered terrain analysis trace deer
          movement corridors and funnel zones from the real ridgelines — and
          read the four measured terrain drivers on your own land.
        </p>

        {/* ─── Address Search ──────────────────────────────── */}
        <form onSubmit={handleSearch} className="mt-6 sm:mt-8">
          <div className="relative">
            <div className="relative flex items-center">
              <MapPin className="absolute left-4 w-5 h-5 text-stone-500 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={address}
                onChange={handleInputChange}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                placeholder="Enter your property address…"
                autoComplete="off"
                className="w-full bg-stone-900/90 border border-stone-700 focus:border-emerald-500 rounded-xl pl-12 pr-4 py-4 text-white placeholder-stone-500 outline-none transition-colors text-base"
              />
            </div>

            {/* Autocomplete suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-20 left-0 right-0 mt-2 bg-stone-900 border border-stone-700 rounded-xl overflow-hidden shadow-2xl text-left"
              >
                {suggestions.map((s) => (
                  <button
                    key={s.place_id}
                    type="button"
                    onClick={() => handleSuggestionClick(s)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-stone-300 hover:bg-stone-800 hover:text-white transition-colors text-sm"
                  >
                    <MapPin className="w-4 h-4 text-stone-500 flex-shrink-0" />
                    <span className="truncate">{s.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={isSearching}
            className="mt-3 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base sm:text-lg px-8 py-4 h-auto rounded-xl shadow-lg shadow-emerald-900/30 disabled:opacity-60"
          >
            {isSearching ? (
              "Locating…"
            ) : (
              <span className="inline-flex items-center gap-2">
                <Search className="w-5 h-5" />
                Analyze My Land
              </span>
            )}
          </Button>

          {searchError && (
            <p className="text-red-400 text-sm mt-3">{searchError}</p>
          )}
        </form>

        <p className="text-stone-600 text-xs mt-4">
          No signup required · You only ever see terrain for land you look up
          yourself.
        </p>
      </div>

      {/* ─── What You'll See ──────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 pt-8 sm:pt-12 pb-8">
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-stone-900/80 backdrop-blur border border-stone-800 rounded-xl p-5 text-center">
            <div className="inline-flex bg-gradient-to-br from-emerald-600 to-teal-700 rounded-lg p-3 mb-3">
              <Layers className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-white font-semibold text-sm sm:text-base">
              Movement Corridors
            </h3>
            <p className="text-stone-400 text-xs sm:text-sm mt-1">
              See how deer travel your terrain, derived from LiDAR elevation.
            </p>
          </div>
          <div className="bg-stone-900/80 backdrop-blur border border-stone-800 rounded-xl p-5 text-center">
            <div className="inline-flex bg-gradient-to-br from-sky-600 to-indigo-700 rounded-lg p-3 mb-3">
              <Target className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-white font-semibold text-sm sm:text-base">
              The Four Terrain Drivers
            </h3>
            <p className="text-stone-400 text-xs sm:text-sm mt-1">
              Bench, Saddle, Ridge and Convergence — measured on your ground,
              so you read the land the way the deer do.
            </p>
          </div>
          <div className="bg-stone-900/80 backdrop-blur border border-stone-800 rounded-xl p-5 text-center">
            <div className="inline-flex bg-gradient-to-br from-amber-600 to-orange-700 rounded-lg p-3 mb-3">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-white font-semibold text-sm sm:text-base">
              Your Land, Your Privacy
            </h3>
            <p className="text-stone-400 text-xs sm:text-sm mt-1">
              We never publish owner names or addresses. Your lookups stay
              yours.
            </p>
          </div>
        </div>
      </div>

      {/* ─── CTA Section ──────────────────────────────────── */}
      <div className="bg-gradient-to-t from-stone-900 to-stone-950 border-t border-stone-800">
        <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12 text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
            Ready to scout your own land?
          </h2>
          <p className="text-stone-400 text-sm sm:text-base mb-6 max-w-md mx-auto">
            Unlock property data, terrain analysis, and hunting intel for any
            parcel.
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
          <div className="mt-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-sm transition-colors"
            >
              <Search className="w-4 h-4" />
              Search from the homepage
              <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
