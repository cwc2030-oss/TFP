"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Check, Search, ArrowRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import PrivacyPromise from "@/components/privacy-promise";
import { trackPricingPageViewed, trackAddressSearch } from "@/lib/gtag";

export default function PricingPage() {
  const [billing, setBilling] = useState<"annual" | "monthly">("annual");
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null);
  const [passLoading, setPassLoading] = useState(false);
  const router = useRouter();
  const { data: session } = useSession() || {};

  // ── Address autocomplete state ──
  const [address, setAddress] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    trackPricingPageViewed();
  }, []);

  // ── Autocomplete fetch ──
  const fetchSuggestions = useCallback(async (input: string) => {
    if (input.length < 3) { setSuggestions([]); return; }
    try {
      const res = await fetch(`/api/places-autocomplete?input=${encodeURIComponent(input)}`);
      const data = await res.json();
      setSuggestions(data.predictions || []);
    } catch { setSuggestions([]); }
  }, []);

  function handleAddressChange(value: string) {
    setAddress(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  }

  function handleSuggestionClick(s: any) {
    setAddress(s.description);
    setSuggestions([]);
    trackAddressSearch(s.description);
    if (s.lat && s.lng) {
      router.push(`/preview?lat=${s.lat}&lng=${s.lng}`);
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setIsSearching(true);
    setSearchError('');
    trackAddressSearch(address.trim());
    try {
      const res = await fetch(`/api/places-autocomplete?input=${encodeURIComponent(address.trim())}`);
      const data = await res.json();
      const first = data.predictions?.[0];
      if (first?.lat && first?.lng) {
        router.push(`/preview?lat=${first.lat}&lng=${first.lng}`);
      } else {
        setSearchError('Could not find that address. Try a full street address.');
      }
    } catch {
      setSearchError('Search failed — please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  // ── Season Pass checkout ($39, one-time per season) ──
  // Wired to /api/reads/unlock — the SAME endpoint the in-app wall uses, which
  // charges STRIPE_SEASON_PASS_PRICE_ID ($39). One number everywhere.
  async function handleSeasonPass() {
    if (!session?.user) {
      router.push(`/signup?callbackUrl=${encodeURIComponent("/pricing")}`);
      return;
    }
    setPassLoading(true);
    try {
      const res = await fetch("/api/reads/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.alreadyUnlocked) {
        // Already a pass holder / Pro / admin — nothing to buy. Send them scouting.
        router.push("/intel");
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      console.error("[pricing] Season Pass checkout failed:", data?.error || "unknown");
      setPassLoading(false);
    } catch (err) {
      console.error("[pricing] Season Pass checkout error:", err);
      setPassLoading(false);
    }
  }

  // ── Pro / Outfitter subscription checkout ──
  async function handleUpgrade(tier: "pro" | "promax") {
    if (!session?.user) {
      router.push(`/login?callbackUrl=${encodeURIComponent("/pricing")}`);
      return;
    }
    const plan = billing === "annual" ? "annual" : "monthly";
    setUpgradeLoading(`${tier}_${plan}`);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, tier }),
      });
      const data = await res.json();
      if (data.alreadySubscribed) {
        router.push(`/dashboard?sub=${data.currentTier || 'pro'}`);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      console.error("[pricing] Checkout failed:", data?.error || "unknown");
      setUpgradeLoading(null);
    } catch (err) {
      console.error("[pricing] Checkout error:", err);
      setUpgradeLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-emerald-50">
      <Navbar />

      {/* ═══════════════════════════════════════════
          HERO
         ═══════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-stone-950 text-stone-100 pt-28 pb-20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/30 via-stone-950 to-stone-950" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight mb-5">
            Your ground already knows where the deer go.
          </h1>
          <p className="text-stone-300 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            TerraFirma reads the terrain&nbsp;&mdash; ridges, funnels, bedding,
            water&nbsp;&mdash; and shows you the deer flow across your parcel. We
            don&apos;t predict deer. We read the land they&apos;re already using.
          </p>

          {/* Address bar */}
          <form onSubmit={handleSearch} className="relative max-w-xl mx-auto mb-4">
            <div className="flex">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                <input
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  placeholder="Enter your address"
                  className="w-full pl-12 pr-4 py-4 rounded-l-xl bg-white text-stone-900 placeholder:text-stone-400 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {/* Suggestions dropdown */}
                {suggestions.length > 0 && (
                  <ul className="absolute z-50 left-0 right-0 top-full bg-white border border-stone-200 rounded-b-xl shadow-xl max-h-64 overflow-y-auto">
                    {suggestions.map((s: any, i: number) => (
                      <li key={s.place_id || i}>
                        <button
                          type="button"
                          onClick={() => handleSuggestionClick(s)}
                          className="w-full text-left px-4 py-3 text-sm text-stone-700 hover:bg-emerald-50 transition-colors"
                        >
                          {s.description}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="submit"
                disabled={isSearching}
                className="px-6 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-r-xl transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {isSearching ? (
                  <span className="h-5 w-5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>It&apos;s free <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
            {searchError && (
              <p className="mt-2 text-red-400 text-sm text-left pl-4">{searchError}</p>
            )}
          </form>

          {/* Privacy promise — directly under address bar */}
          <div className="max-w-xl mx-auto">
            <PrivacyPromise className="text-stone-400 justify-center" />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          HOOK LINE
         ═══════════════════════════════════════════ */}
      <section className="bg-stone-900 text-stone-300 py-10">
        <p className="max-w-3xl mx-auto px-4 text-center text-base sm:text-lg leading-relaxed">
          The flow doesn&apos;t stop at your property line. Add the
          neighbor&apos;s ground and watch it stitch together&nbsp;&mdash; the
          more ground you read, the fuller the picture.
        </p>
      </section>

      {/* ═══════════════════════════════════════════
          PRICING TIERS
         ═══════════════════════════════════════════ */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        {/* Billing Toggle — Pro / Outfitter only */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <span className={`text-sm font-medium ${billing === "monthly" ? "text-stone-900" : "text-stone-400"}`}>Monthly</span>
          <button
            onClick={() => setBilling(billing === "annual" ? "monthly" : "annual")}
            className={`relative w-14 h-7 rounded-full transition-colors ${billing === "annual" ? "bg-emerald-600" : "bg-stone-300"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${billing === "annual" ? "translate-x-7" : ""}`} />
          </button>
          <span className={`text-sm font-medium ${billing === "annual" ? "text-stone-900" : "text-stone-400"}`}>
            Annual <span className="text-emerald-600 font-semibold text-xs ml-1">Save 30%+</span>
          </span>
        </div>
        <p className="text-center text-xs text-stone-500 mb-14">
          The billing toggle applies to the <span className="font-semibold">Pro / Outfitter</span> subscription only.
          The <span className="font-semibold">Season Pass is a flat $39 per season</span> &mdash; not monthly or annual.
        </p>

        {/* ──── 3-Tier Cards ──── */}
        <div className="grid md:grid-cols-3 gap-6 items-start">

          {/* ── FREE ── */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-stone-200 flex flex-col md:mt-6">
            <div className="bg-stone-100 text-stone-700 text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              FREE
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <p className="text-lg font-bold text-stone-800 mb-1">Read the ground.</p>
              <div className="mt-2 mb-1">
                <span className="text-5xl font-bold text-stone-700">$0</span>
              </div>
              <p className="text-stone-500 text-sm">3 reads every season</p>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <ul className="space-y-3 flex-1">
                {[
                  "3 reads — see the deer flow on any 3 pieces of ground",
                  "First read is instant, no signup — a quick email unlocks reads 2 & 3",
                  "Every read shows the real flow lines + the four measured terrain drivers (Bench · Saddle · Ridge · Convergence)",
                  "Own the ground? Claim your parcel — it reads free, always",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-stone-400 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-600 text-sm">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/intel" className="block">
                  <Button className="w-full bg-stone-700 hover:bg-stone-800 text-white py-4 text-sm font-semibold">
                    Start free
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* ── SEASON PASS — $39 / season · HERO ── */}
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-4 border-emerald-500 relative flex flex-col">
            <div className="absolute top-0 right-0 bg-emerald-600 text-white px-3 py-1 text-xs font-bold rounded-bl-lg tracking-wide">
              BEST VALUE
            </div>
            <div className="bg-emerald-600 text-white text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              🦌 SEASON PASS
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <p className="text-lg font-bold text-emerald-700 mb-1">
                Scout as much ground as you want.
              </p>
              <div className="mt-2 mb-1">
                <span className="text-5xl font-bold text-emerald-600">$39</span>
                <span className="text-stone-500 text-sm ml-1">/ season</span>
              </div>
              <p className="text-stone-500 text-sm">flat per season · no auto-renew</p>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Everything in Free, plus:
              </h3>
              <ul className="space-y-3 flex-1">
                {[
                  "Unlimited reads, all season — roam the map and read as much ground as you want",
                  "Save your parcels (My Parcels)",
                  "Same honest read on every parcel — real flow lines + the four measured drivers",
                  "One-time per season — no surprise auto-renew",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm font-medium">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Button
                  onClick={handleSeasonPass}
                  disabled={passLoading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 text-base font-semibold disabled:opacity-60"
                >
                  {passLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                      Redirecting…
                    </span>
                  ) : (
                    "Get the Season Pass — $39"
                  )}
                </Button>
                <div className="mt-3">
                  <PrivacyPromise />
                </div>
              </div>
            </div>
          </div>

          {/* ── PRO / OUTFITTER ── */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-stone-200 flex flex-col md:mt-6">
            <div className="bg-[#8b6b1f] text-[#f5e6b8] text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              🏆 PRO / OUTFITTER
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <p className="text-lg font-bold text-[#8b6b1f] mb-1">
                Run the whole neighborhood.
              </p>
              <div className="mt-2 mb-1">
                <span className="text-5xl font-bold text-[#8b6b1f]">
                  {billing === "annual" ? "$99" : "$12"}
                </span>
                <span className="text-stone-500 text-sm ml-1">
                  /{billing === "annual" ? "year" : "month"}
                </span>
              </div>
              <p className="text-stone-500 text-sm">
                {billing === "annual" ? "Just $8.25/mo — billed annually" : "$12/mo — or save with annual"}
              </p>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Everything in the Season Pass, plus:
              </h3>
              <ul className="space-y-3 flex-1">
                {[
                  "Territory Mode — deer flow stitched across property lines; the read sharpens the more ground you add",
                  "Multiple parcels — save and manage many pieces of ground at once",
                  "Built for thousands of acres, multiple leases, and outfits",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#8b6b1f] flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm font-medium">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Button
                  onClick={() => handleUpgrade("pro")}
                  disabled={upgradeLoading?.startsWith("pro_") ?? false}
                  className="w-full bg-[#8b6b1f] hover:bg-[#6b4f14] text-[#f5e6b8] py-4 text-base font-semibold disabled:opacity-60"
                >
                  {upgradeLoading === `pro_${billing}` ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 border-2 border-[#f5e6b8]/70 border-t-transparent rounded-full animate-spin" />
                      Redirecting…
                    </span>
                  ) : (
                    "Go Pro"
                  )}
                </Button>
                {/* Pro Max — optional, for the biggest operations */}
                <button
                  onClick={() => handleUpgrade("promax")}
                  disabled={upgradeLoading?.startsWith("promax_") ?? false}
                  className="w-full mt-3 text-center text-xs text-stone-500 hover:text-[#8b6b1f] transition-colors disabled:opacity-60"
                >
                  {upgradeLoading === `promax_${billing}` ? (
                    "Redirecting…"
                  ) : (
                    <>Running real ground? <span className="font-semibold underline">Pro Max — {billing === "annual" ? "$199/yr" : "$24/mo"}</span> · unlimited parcels</>
                  )}
                </button>
                <div className="mt-3">
                  <PrivacyPromise />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            LANDOWNER CALLOUT — not a priced tier
           ═══════════════════════════════════════════ */}
        <div className="max-w-4xl mx-auto mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-shrink-0 h-12 w-12 rounded-full bg-emerald-600 text-white flex items-center justify-center">
            <MapPin className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-emerald-900 mb-1">Own the ground? Claim it free.</p>
            <p className="text-emerald-800 text-sm leading-relaxed">
              Your parcels read free&nbsp;&mdash; always&nbsp;&mdash; and you&apos;ll be able to
              list them when the marketplace opens.
            </p>
          </div>
          <Link href="/intel" className="flex-shrink-0">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white py-3 px-6 text-sm font-semibold">
              Claim your parcel
            </Button>
          </Link>
        </div>

        {/* ═══════════════════════════════════════════
            CLOSING BAND
           ═══════════════════════════════════════════ */}
        <div className="max-w-3xl mx-auto mt-16 mb-20 rounded-2xl bg-stone-900 text-stone-200 p-8 sm:p-12 text-center">
          <p className="text-base sm:text-lg leading-relaxed">
            The deer flow is written into the land&nbsp;&mdash; the ridges,
            benches, saddles, and pinch points that funnel movement. Read one
            parcel or stitch a whole territory together. The more ground you
            read, the fuller the picture.
          </p>
        </div>

        {/* FAQ Section */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-10">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            <FaqItem
              q="What do I get for free?"
              a="Enter any address and get a full terrain read — the real deer flow lines plus the four measured terrain drivers (Bench, Saddle, Ridge, Convergence). Your first read is instant with no signup; a quick email unlocks reads 2 and 3. That's 3 reads every season, free — and a free read is the same honest read as a paid one, just limited in quantity."
            />
            <FaqItem
              q="What's the difference between the Season Pass and Pro?"
              a="The Season Pass ($39, flat per season) unlocks unlimited reads so you can scout as much ground as you want all season — no per-parcel limit. Pro / Outfitter ($99/yr) adds Territory Mode, where deer flow is stitched across multiple property lines so you can read a whole territory as one, plus tools built for running many parcels, leases, and outfits."
            />
            <FaqItem
              q="What is Territory Mode?"
              a="Territory Mode lets you combine multiple adjacent parcels into one unified read. Deer flow is computed across all the ground together — not one parcel at a time — so you can see how movement runs across property lines through the pinch points and crossings that funnel it."
            />
            <FaqItem
              q="Does the Season Pass auto-renew?"
              a="No. The Season Pass is a one-time $39 charge that unlocks unlimited reads for the current season. There's no subscription and no surprise renewal — when a new season opens, you simply grab a pass again if you want it."
            />
            <FaqItem
              q="Can I switch between monthly and annual?"
              a="Yes — for the Pro / Outfitter subscription. You can switch billing cycles anytime from your account settings, and switching from monthly to annual saves over 30%. (The Season Pass isn't a subscription, so it has no monthly/annual option — it's a flat $39 per season.)"
            />
            <FaqItem
              q="What data sources power the terrain read?"
              a="We aggregate parcel data from Regrid (156M+ records) with high-resolution USGS elevation models and public USDA/FEMA layers to read the terrain that drives deer movement — the ridges, benches, saddles, and pinch points on your ground."
            />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="bg-white rounded-lg p-6 shadow-sm">
      <h3 className="font-semibold text-stone-900 mb-2">{q}</h3>
      <p className="text-stone-600">{a}</p>
    </div>
  );
}
