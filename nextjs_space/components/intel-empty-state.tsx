"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Mountain, ArrowLeft } from "lucide-react";
import { trackAddressSearch } from "@/lib/gtag";

interface Suggestion {
  description: string;
  place_id: string;
  lat?: number;
  lng?: number;
}

/**
 * Empty state shown on /intel when the page loads WITHOUT a selected parcel
 * (no lat/lng, or lat/lng 0,0). Replaces the old blank "null image" 0,0 map.
 * Mirrors the homepage address-entry flow: the address box is the only way in,
 * routing the user into /preview once they pick / submit an address.
 */
export default function IntelEmptyState() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = async (input: string) => {
    if (input.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await fetch(`/api/places-autocomplete?input=${encodeURIComponent(input)}`);
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

  const goToPreview = (lat: number, lng: number, label: string) => {
    trackAddressSearch(label);
    router.push(`/preview?lat=${lat}&lng=${lng}&address=${encodeURIComponent(label)}`);
  };

  const handleSuggestionClick = async (s: Suggestion) => {
    setAddress(s.description);
    setShowSuggestions(false);
    setIsSearching(true);
    setSearchError("");
    if (s.lat && s.lng) {
      goToPreview(s.lat, s.lng, s.description);
      return;
    }
    setSearchError("Could not locate that address. Try a full street address.");
    setIsSearching(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setIsSearching(true);
    setSearchError("");
    setShowSuggestions(false);

    // Coordinate shortcut: "lat, lng"
    const coordMatch = address.trim().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        goToPreview(lat, lng, `${lat}, ${lng}`);
        return;
      }
    }

    try {
      const res = await fetch(`/api/places-autocomplete?input=${encodeURIComponent(address.trim())}`);
      const data = await res.json();
      const first = data.predictions?.[0];
      if (first?.lat && first?.lng) {
        goToPreview(first.lat, first.lng, first.description || address.trim());
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
    <div className="h-screen w-screen overflow-hidden relative flex items-center justify-center bg-gradient-to-br from-stone-800 via-emerald-900 to-stone-900 px-4">
      {/* Back to home */}
      <Link
        href="/"
        className="absolute top-5 left-5 inline-flex items-center gap-2 text-stone-300 hover:text-white text-sm font-medium transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to home
      </Link>

      <div className="relative w-full max-w-xl text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30 mb-6">
          <Mountain className="w-7 h-7 text-emerald-400" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
          Enter a property address to begin
        </h1>
        <p className="text-stone-300 text-lg mb-8">
          The Terrain Brain reads the land for any US address — ridges, funnels,
          bedding, and how the deer flow across it. Start with an address.
        </p>

        <form onSubmit={handleSearch} className="text-left">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 z-10" />
              <input
                type="text"
                value={address}
                onChange={handleInputChange}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="Enter property address..."
                className="w-full pl-12 pr-4 py-4 bg-stone-800/80 border border-stone-600 rounded-xl text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-lg"
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-stone-800 border border-stone-600 rounded-xl overflow-hidden z-50 shadow-xl">
                  {suggestions.map((s) => (
                    <button
                      key={s.place_id}
                      type="button"
                      onClick={() => handleSuggestionClick(s)}
                      className="w-full px-4 py-3 text-left text-white hover:bg-stone-700 flex items-center gap-3 border-b border-stone-700 last:border-0"
                    >
                      <MapPin className="w-4 h-4 text-stone-400 flex-shrink-0" />
                      <span className="truncate">{s.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={isSearching || !address.trim()}
              className="inline-flex items-center justify-center bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg px-8 py-4 rounded-xl text-lg font-semibold whitespace-nowrap disabled:opacity-50 transition-colors"
            >
              {isSearching ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Loading...
                </>
              ) : (
                <>
                  <Mountain className="w-5 h-5 mr-2" />
                  View in 3D
                </>
              )}
            </button>
          </div>
          {searchError && <p className="text-red-400 text-sm mt-2">{searchError}</p>}
        </form>

        <p className="text-stone-400 text-sm mt-5">
          No signup required · Works for any US address · Instant results
        </p>
      </div>
    </div>
  );
}
