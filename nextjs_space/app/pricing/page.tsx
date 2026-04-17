"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Check, Shield, Zap, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { trackPricingPageViewed } from "@/lib/gtag";

export default function PricingPage() {
  const [billing, setBilling] = useState<"annual" | "monthly">("annual");
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null);
  const router = useRouter();
  const { data: session } = useSession() || {};

  useEffect(() => {
    trackPricingPageViewed();
  }, []);

  async function handleUpgrade(tier: "pro" | "promax") {
    if (!session?.user) {
      // Preserve intent so user can continue after signing in
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-stone-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-stone-600 max-w-2xl mx-auto">
            From single-parcel scouting to multi-property territory planning — pick the tier that fits your hunt.
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-3 mb-12">
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

        {/* ──── 3-Tier Pricing Cards ──── */}
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6 items-start mb-16">

          {/* ── FREE ── */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-stone-200">
            <div className="bg-stone-100 text-stone-700 text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              FREE
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <div className="mt-1 mb-1">
                <span className="text-5xl font-bold text-stone-700">$0</span>
              </div>
              <p className="text-stone-500 text-sm">Free forever</p>
            </div>
            <div className="p-6">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                What&apos;s included:
              </h3>
              <ul className="space-y-3">
                {[
                  "Single parcel terrain analysis",
                  "Deer Flow, bedding zones, intercept points",
                  "Hunt File download",
                  "onX integration",
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
                    Get Started Free
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* ── PRO — Most Popular ── */}
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-4 border-emerald-500 relative transform md:scale-105">
            <div className="absolute top-0 right-0 bg-emerald-600 text-white px-3 py-1 text-xs font-bold rounded-bl-lg">
              MOST POPULAR
            </div>
            <div className="bg-emerald-600 text-white text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              🏆 PRO
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <div className="mt-1 mb-1">
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
            <div className="p-6">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Everything in Free, plus:
              </h3>
              <ul className="space-y-3">
                {[
                  "5-parcel Territory Mode",
                  "Unified Deer Flow across parcels",
                  "Territory Hunt Certificate",
                  "Save & share territories",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm font-medium">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
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
              </div>
            </div>
          </div>

          {/* ── PRO MAX ── */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-[#8b6b1f] relative">
            <div className="absolute top-0 right-0 bg-[#6b4f14] text-[#f5e6b8] px-3 py-1 text-xs font-bold rounded-bl-lg tracking-wide">
              BEST VALUE
            </div>
            <div className="bg-gradient-to-r from-[#8b6b1f] to-[#5a4211] text-[#f5e6b8] text-center py-2.5 px-4 font-semibold text-sm tracking-wide">
              ⚡ PRO MAX
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <div className="mt-1 mb-1">
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
            <div className="p-6">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Everything in Pro, plus:
              </h3>
              <ul className="space-y-3">
                {[
                  "10-parcel Territory Mode",
                  "Priority terrain processing",
                  "Best for outfitters & multi-property hunters",
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
              </div>
            </div>
          </div>
        </div>

        {/* Trust Indicators */}
        <div className="max-w-2xl mx-auto grid grid-cols-3 gap-6 text-center mb-20">
          <div className="flex flex-col items-center">
            <Target className="h-8 w-8 text-emerald-600 mb-2" />
            <p className="text-sm text-stone-600 font-medium">AI-Powered Analysis</p>
          </div>
          <div className="flex flex-col items-center">
            <Shield className="h-8 w-8 text-emerald-600 mb-2" />
            <p className="text-sm text-stone-600 font-medium">Secure Payment</p>
          </div>
          <div className="flex flex-col items-center">
            <Zap className="h-8 w-8 text-emerald-600 mb-2" />
            <p className="text-sm text-stone-600 font-medium">Instant Access</p>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-10">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="font-semibold text-stone-900 mb-2">
                What do I get with the free tier?
              </h3>
              <p className="text-stone-600">
                Analyze any single parcel with our full terrain engine — Deer Flow corridors, bedding zones, intercept points, wind strategy, and a downloadable Hunt File for onX. No credit card required.
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="font-semibold text-stone-900 mb-2">
                What is Territory Mode?
              </h3>
              <p className="text-stone-600">
                Territory Mode lets you combine multiple adjacent parcels into one unified hunting territory. Deer Flow, corridors, and intercept points are computed across all parcels together — not individually — giving you the full picture of deer movement on your property.
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="font-semibold text-stone-900 mb-2">
                Can I switch between monthly and annual?
              </h3>
              <p className="text-stone-600">
                Yes. You can switch billing cycles anytime from your account settings. If you switch from monthly to annual, you&apos;ll save over 30%.
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="font-semibold text-stone-900 mb-2">
                What data sources do you use?
              </h3>
              <p className="text-stone-600">
                We aggregate data from Regrid (156M+ parcel records), USDA, USGS, FEMA, and high-resolution terrain models to deliver the most comprehensive hunting terrain intelligence available.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
