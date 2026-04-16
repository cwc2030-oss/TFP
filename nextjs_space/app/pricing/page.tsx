"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Check, MapPin, FileText, Shield, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { trackPricingPageViewed } from "@/lib/gtag";

export default function PricingPage() {
  useEffect(() => {
    trackPricingPageViewed();
  }, []);
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-emerald-50">
      <Navbar />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-stone-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-stone-600 max-w-2xl mx-auto">
            Professional land analysis reports with comprehensive data layers – all included
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8">
          
          {/* Land Intelligence Report */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-emerald-400">
            <div className="bg-emerald-600 text-white text-center py-2 px-4 font-semibold text-sm">
              🏡 For Buyers, Sellers &amp; Agents
            </div>
            
            <div className="p-6 text-center border-b border-stone-200">
              <h2 className="text-xl font-bold text-stone-800 mb-2">
                Land Intelligence Report
              </h2>
              <div className="mt-3">
                <span className="text-4xl font-bold text-emerald-600">$49</span>
                <span className="text-stone-500 text-sm ml-1">per report</span>
              </div>
              <p className="text-stone-500 mt-2 text-sm">
                Professional land analysis for buyers, sellers, and agents
              </p>
            </div>

            <div className="p-6">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Includes:
              </h3>
              <ul className="space-y-2.5">
                {[
                  "Property overview & valuation",
                  "Terrain & topography analysis",
                  "Water, flood & access data",
                  "Market context & insights",
                  "Certificate of analysis",
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <Link href="/map?product=land_report" className="block">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 text-base font-semibold">
                    Get Land Report
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Hunt Intelligence Report — FEATURED */}
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-4 border-red-500 relative transform md:scale-105">
            <div className="absolute top-0 right-0 bg-red-600 text-white px-3 py-1 text-xs font-bold rounded-bl-lg">
              🦌 MOST POPULAR
            </div>
            <div className="bg-gradient-to-r from-red-600 to-orange-600 text-white text-center py-2 px-4 font-semibold text-sm">
              🎯 Complete Terrain Intelligence for Serious Hunters
            </div>
            
            <div className="p-6 text-center border-b border-stone-200">
              <h2 className="text-xl font-bold text-stone-800 mb-2">
                Hunt Intelligence Report
              </h2>
              <div className="mt-3">
                <span className="text-4xl font-bold text-red-600">$149</span>
                <span className="text-stone-500 text-sm ml-1">per report</span>
              </div>
              <p className="text-stone-500 mt-2 text-sm">
                Complete terrain intelligence + full land analysis. Two premium reports in one package — terrain analysis, intercept placement, wind strategy, satellite hunt map, soil data, flood risk, county hunting seasons, and market data. Indefinite parcel access included.
              </p>
            </div>

            <div className="p-6">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Includes:
              </h3>
              <ul className="space-y-2.5">
                {[
                  "Everything in Land Report",
                  "Deer movement corridor analysis",
                  "Top 3 intercept placements with wind strategy",
                  "Seasonal huntability scoring",
                  "Satellite terrain hunt map",
                  "12-page Land Intelligence Report included",
                  "County hunting seasons & CWD status",
                  "Soil, flood & market analysis",
                  "Indefinite parcel access",
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <Link href="/map?product=hunt_report" className="block">
                  <Button className="w-full bg-red-600 hover:bg-red-700 text-white py-4 text-base font-semibold">
                    Get Hunt Report
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ──── Subscription Tiers ──── */}
        <div className="mt-20 text-center mb-10">
          <h2 className="text-3xl font-bold text-stone-900 mb-3">Terrain Analyzer Subscriptions</h2>
          <p className="text-lg text-stone-600 max-w-2xl mx-auto">
            Unlock Territory Mode to analyze multiple parcels as one hunting property
          </p>
        </div>

        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6 mb-16">
          {/* Free */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-stone-200">
            <div className="bg-stone-100 text-stone-700 text-center py-2 px-4 font-semibold text-sm">
              FREE
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <div className="mt-2">
                <span className="text-4xl font-bold text-stone-700">$0</span>
              </div>
              <p className="text-stone-500 mt-2 text-sm">Single parcel analysis</p>
            </div>
            <div className="p-6">
              <ul className="space-y-2.5">
                {[
                  "1 parcel terrain analysis",
                  "Deer flow & corridor mapping",
                  "Top 3 intercept placements",
                  "Hunt File (onX export)",
                  "Wind & season strategy",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-stone-400 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-600 text-sm">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Link href="/intel" className="block">
                  <Button className="w-full bg-stone-600 hover:bg-stone-700 text-white py-3 text-sm font-semibold">
                    Try Free
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Pro */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-emerald-500 relative">
            <div className="bg-emerald-600 text-white text-center py-2 px-4 font-semibold text-sm">
              🏆 PRO
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <div className="mt-2">
                <span className="text-4xl font-bold text-emerald-600">$99</span>
                <span className="text-stone-500 text-sm ml-1">/year</span>
              </div>
              <p className="text-stone-500 mt-1 text-sm">or $12/month</p>
            </div>
            <div className="p-6">
              <ul className="space-y-2.5">
                {[
                  "Everything in Free",
                  "Territory Mode — 5 parcels",
                  "Save & share properties",
                  "Shareable territory links",
                  "Unlimited property saves",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Link href="/intel" className="block">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 text-sm font-semibold">
                    Upgrade to Pro
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Pro Max */}
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-4 border-amber-500 relative transform md:scale-105">
            <div className="absolute top-0 right-0 bg-amber-500 text-white px-3 py-1 text-xs font-bold rounded-bl-lg">
              BEST VALUE
            </div>
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-center py-2 px-4 font-semibold text-sm">
              ⚡ PRO MAX
            </div>
            <div className="p-6 text-center border-b border-stone-200">
              <div className="mt-2">
                <span className="text-4xl font-bold text-amber-600">$199</span>
                <span className="text-stone-500 text-sm ml-1">/year</span>
              </div>
              <p className="text-stone-500 mt-1 text-sm">or $24/month</p>
            </div>
            <div className="p-6">
              <ul className="space-y-2.5">
                {[
                  "Everything in Pro",
                  "Territory Mode — 10 parcels",
                  "Priority terrain analysis",
                  "Extended territory coverage",
                  "Large ranch / lease support",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Link href="/intel" className="block">
                  <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 text-sm font-semibold">
                    Upgrade to Pro Max
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Trust Indicators */}
        <div className="mt-12 max-w-2xl mx-auto grid grid-cols-3 gap-6 text-center">
          <div className="flex flex-col items-center">
            <Clock className="h-8 w-8 text-emerald-600 mb-2" />
            <p className="text-sm text-stone-600 font-medium">Instant Delivery</p>
          </div>
          <div className="flex flex-col items-center">
            <Shield className="h-8 w-8 text-emerald-600 mb-2" />
            <p className="text-sm text-stone-600 font-medium">Secure Payment</p>
          </div>
          <div className="flex flex-col items-center">
            <FileText className="h-8 w-8 text-emerald-600 mb-2" />
            <p className="text-sm text-stone-600 font-medium">Professional PDF</p>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-10">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="font-semibold text-stone-900 mb-2">
                What data sources do you use?
              </h3>
              <p className="text-stone-600">
                We aggregate data from Regrid (156M+ parcel records), FEMA, USDA, USGS, and local government databases to provide the most comprehensive property intelligence available.
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="font-semibold text-stone-900 mb-2">
                How quickly will I receive my report?
              </h3>
              <p className="text-stone-600">
                Reports are generated instantly after payment. Download your professional PDF immediately from your dashboard.
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="font-semibold text-stone-900 mb-2">
                Can I get reports for multiple properties?
              </h3>
              <p className="text-stone-600">
                Yes! Each property requires a separate report purchase. Access all your reports anytime from your dashboard.
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="font-semibold text-stone-900 mb-2">
                What if the property I&apos;m interested in isn&apos;t showing up?
              </h3>
              <p className="text-stone-600">
                Our database covers 99%+ of US properties. Try searching by address, coordinates, or parcel ID. Contact support if you still have issues.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}