"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Check, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import PrivacyPromise from "@/components/privacy-promise";
import { trackPricingPageViewed, trackAddressSearch } from "@/lib/gtag";

export default function PricingPage() {
  const [billing, setBilling] = useState<"annual" | "monthly">("annual");
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null);
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

  // ── Stripe checkout ──
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
        router.push("/intel?upgrade=already");
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
          neighbor&apos;s ground and watch it stitch together. Drop your pins,
          log every sit, and the read sharpens every season.
        </p>
      </section>

      {/* ═══════════════════════════════════════════
          PRICING TIERS
         ═══════════════════════════════════════════ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        {/* Billing Toggle */}
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
          Billing toggle applies to Pro &amp; Pro Max subscriptions. The Parcel Unlock is always a one-time $19.
        </p>

        {/* ──── 4-Tier Cards ──── */}
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 lg:grid-cols-4 gap-6 items-start mb-8">

          {/* ── FREE ── */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-stone-200 flex flex-col">
            <div className="bg-stone-100 text-stone-700 text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              FREE
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <p className="text-lg font-bold text-stone-800 mb-1">Read your ground.</p>
              <div className="mt-2 mb-1">
                <span className="text-5xl font-bold text-stone-700">$0</span>
              </div>
              <p className="text-stone-500 text-sm">Free forever</p>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <ul className="space-y-3 flex-1">
                {[
                  "Deer flow on your home parcel",
                  "Terrain read: ridges, funnels, bedding, water",
                  "Shareable ScoreCard",
                  "See your flow run to the property line, then follow it next door with Territory",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-stone-400 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-600 text-sm">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/intel" className="block">
                  <Button className="w-full bg-stone-600 hover:bg-stone-700 text-white py-4 text-sm font-semibold">
                    Start free
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* ── PARCEL UNLOCK — $19 one-time ── */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden border-2 border-amber-600/70 relative flex flex-col">
            <div className="absolute top-0 right-0 bg-amber-700 text-amber-50 px-3 py-1 text-xs font-bold rounded-bl-lg tracking-wide">
              ONE-TIME
            </div>
            <div className="bg-amber-700 text-amber-50 text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              🎯 PARCEL UNLOCK
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <p className="text-lg font-bold text-amber-800 mb-1">
                Try the whole system on one piece of ground.
              </p>
              <div className="mt-2 mb-1">
                <span className="text-5xl font-bold text-amber-800">$19</span>
                <span className="text-stone-500 text-sm ml-1">/ one parcel</span>
              </div>
              <p className="text-stone-500 text-sm">one-time · no subscription</p>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Everything in Free, plus:
              </h3>
              <ul className="space-y-3 flex-1">
                {[
                  "Clean Hunt Report (no watermark)",
                  "Save your sit pins and stand journal",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-amber-700 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm font-medium">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/intel" className="block">
                  <Button className="w-full bg-amber-700 hover:bg-amber-800 text-amber-50 py-4 text-base font-semibold">
                    Unlock my parcel
                  </Button>
                </Link>
                <div className="mt-3">
                  <PrivacyPromise />
                </div>
              </div>
            </div>
          </div>

          {/* ── PRO — Most Popular ── */}
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-4 border-emerald-500 relative flex flex-col">
            <div className="absolute top-0 right-0 bg-emerald-600 text-white px-3 py-1 text-xs font-bold rounded-bl-lg">
              WHERE MOST HUNTERS LAND
            </div>
            <div className="bg-emerald-600 text-white text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              🏆 PRO
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <p className="text-lg font-bold text-emerald-700 mb-1">
                Run the whole neighborhood.
              </p>
              <div className="mt-2 mb-1">
                <span className="text-5xl font-bold text-emerald-600">
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
                Everything in Parcel Unlock, plus:
              </h3>
              <ul className="space-y-3 flex-1">
                {[
                  "Up to 25 parcels",
                  "Territory Mode — deer flow stitched across property lines (the read gets sharper the more ground you add)",
                  "Sit pins + stand journal on every parcel",
                  "Unlimited clean Hunt Reports",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm font-medium">{f}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-stone-500 italic">
                $99 a year is about 2% of what you already spend chasing deer.
              </p>
              <div className="mt-6">
                <Button
                  onClick={() => handleUpgrade("pro")}
                  disabled={upgradeLoading?.startsWith("pro_") ?? false}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 text-base font-semibold disabled:opacity-60"
                >
                  {upgradeLoading === `pro_${billing}` ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                      Redirecting…
                    </span>
                  ) : (
                    "Go Pro"
                  )}
                </Button>
                <div className="mt-3">
                  <PrivacyPromise />
                </div>
              </div>
            </div>
          </div>

          {/* ── PRO MAX ── */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-[#8b6b1f] relative flex flex-col">
            <div className="bg-[#8b6b1f] text-[#f5e6b8] text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              ⚡ PRO MAX
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <p className="text-lg font-bold text-[#8b6b1f] mb-1">
                For the man running real ground.
              </p>
              <div className="mt-2 mb-1">
                <span className="text-5xl font-bold text-[#8b6b1f]">
                  {billing === "annual" ? "$199" : "$24"}
                </span>
                <span className="text-stone-500 text-sm ml-1">
                  /{billing === "annual" ? "year" : "month"}
                </span>
              </div>
              <p className="text-stone-500 text-sm">
                {billing === "annual" ? "Just $16.58/mo — billed annually" : "$24/mo — or save with annual"}
              </p>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Everything in Pro, plus:
              </h3>
              <ul className="space-y-3 flex-1">
                {[
                  "Unlimited parcels — save as much ground as you run",
                  "Built for thousands of acres, multiple leases, and outfits",
                  "First access to new tools as the hunt-scoring engine comes online",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-[#8b6b1f] flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm font-medium">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Button
                  onClick={() => handleUpgrade("promax")}
                  disabled={upgradeLoading?.startsWith("promax_") ?? false}
                  className="w-full bg-[#8b6b1f] hover:bg-[#6b4f14] text-[#f5e6b8] py-4 text-base font-semibold disabled:opacity-60"
                >
                  {upgradeLoading === `promax_${billing}` ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 border-2 border-[#f5e6b8]/70 border-t-transparent rounded-full animate-spin" />
                      Redirecting…
                    </span>
                  ) : (
                    "Go Pro Max"
                  )}
                </Button>
                <div className="mt-3">
                  <PrivacyPromise />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            CLOSING BAND
           ═══════════════════════════════════════════ */}
        <div className="max-w-3xl mx-auto mt-16 mb-20 rounded-2xl bg-stone-900 text-stone-200 p-8 sm:p-12 text-center">
          <p className="text-base sm:text-lg leading-relaxed">
            Every pin you drop and every hunt you log feeds back in. Your stand
            journal tracks what&apos;s working, so next season&apos;s read is
            built on this season&apos;s truth. The more you hunt it, the smarter
            it gets.
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
              a="Enter any address and get a full terrain read — deer flow corridors, ridges, funnels, bedding, water — plus a shareable ScoreCard. No credit card, no sign-up wall. When you're ready to save your pins and download a clean report, unlock the parcel for $19."
            />
            <FaqItem
              q="What's the difference between Parcel Unlock and Pro?"
              a="Parcel Unlock ($19) is a one-time buy that unlocks sit pins, stand journal, and a clean Hunt Report for one parcel — forever. Pro ($99/yr) unlocks up to 25 parcels plus Territory Mode, where deer flow is stitched across multiple property lines for the full picture."
            />
            <FaqItem
              q="What is Territory Mode?"
              a="Territory Mode lets you combine multiple adjacent parcels into one unified hunting territory. Deer flow, corridors, and intercept points are computed across all parcels together — not individually — giving you the full picture of how deer move across the landscape."
            />
            <FaqItem
              q="Can I switch between monthly and annual?"
              a="Yes. You can switch billing cycles anytime from your account settings. Switching from monthly to annual saves over 30%."
            />
            <FaqItem
              q="What data sources power the terrain read?"
              a="We aggregate data from Regrid (156M+ parcel records), USDA, USGS, FEMA, and high-resolution terrain models to deliver the most comprehensive hunting terrain intelligence available."
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
