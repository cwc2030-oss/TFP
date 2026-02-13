"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, MapPin, FileText, Shield, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

export default function PricingPage() {
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
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
          
          {/* Broker Quick Look Card */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-amber-400">
            <div className="bg-amber-500 text-white text-center py-2 px-4 font-semibold text-sm">
              🏡 Perfect for Listings
            </div>
            
            <div className="p-6 text-center border-b border-stone-200">
              <h2 className="text-xl font-bold text-stone-800 mb-2">
                Broker Quick Look
              </h2>
              <div className="mt-3">
                <span className="text-4xl font-bold text-amber-600">$49</span>
                <span className="text-stone-500 text-sm ml-1">per report</span>
              </div>
              <p className="text-stone-500 mt-2 text-sm">
                2-page deal-killer checklist
              </p>
            </div>

            <div className="p-6">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Includes:
              </h3>
              <ul className="space-y-2.5">
                {[
                  "Verified acreage & boundaries",
                  "FEMA flood zone status",
                  "CWD management zone check",
                  "Soil buildability rating",
                  "Road access verification",
                  "Satellite map with parcel overlay",
                  "Instant PDF download"
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <Link href="/map?product=quick_look" className="block">
                  <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white py-4 text-base font-semibold">
                    Get Quick Look
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Hunting Intelligence Card — CENTER SPOTLIGHT */}
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-4 border-red-500 relative transform md:scale-105">
            <div className="absolute top-0 right-0 bg-red-600 text-white px-3 py-1 text-xs font-bold rounded-bl-lg">
              🦌 NEW
            </div>
            <div className="bg-gradient-to-r from-red-600 to-orange-600 text-white text-center py-2 px-4 font-semibold text-sm">
              🎯 For Landowners Who Hunt
            </div>
            
            <div className="p-6 text-center border-b border-stone-200">
              <h2 className="text-xl font-bold text-stone-800 mb-2">
                Hunting Intelligence
              </h2>
              <div className="mt-3">
                <span className="text-4xl font-bold text-red-600">$79</span>
                <span className="text-stone-500 text-sm ml-1">per report</span>
              </div>
              <p className="text-stone-500 mt-2 text-sm">
                5-page deer intel playbook
              </p>
            </div>

            <div className="p-6">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                7 Layers of Deer Intel:
              </h3>
              <ul className="space-y-2.5">
                {[
                  "Primary travel corridors (ridgelines)",
                  "Secondary routes (timber edges)",
                  "Water sources & creek drainages",
                  "Predicted bedding areas",
                  "Terrain funnels & pinch points",
                  "Food plot zone recommendations",
                  "Optimal stand site placements",
                  "Season playbook (early/rut/late)",
                  "\"How We Know\" methodology",
                  "CWD zone & harvest pressure data",
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <Link href="/map?product=hunting_intel" className="block">
                  <Button className="w-full bg-red-600 hover:bg-red-700 text-white py-4 text-base font-semibold">
                    Get Hunting Intel
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Full Land Analysis Card */}
          <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl shadow-xl overflow-hidden border-2 border-emerald-800 relative">
            <div className="absolute top-0 right-0 bg-white text-emerald-700 px-3 py-1 text-xs font-bold rounded-bl-lg">
              MOST COMPLETE
            </div>
            <div className="bg-emerald-800 text-emerald-100 text-center py-2 px-4 font-semibold text-sm">
              ⭐ Complete Property Intelligence
            </div>
            
            <div className="p-6 text-center">
              <h2 className="text-xl font-bold text-white mb-2">
                Full Land Analysis
              </h2>
              <div className="mt-3">
                <span className="text-4xl font-bold text-white">$350</span>
                <span className="text-emerald-100 text-sm ml-1">per report</span>
              </div>
              <p className="text-emerald-100 mt-2 text-sm">
                9-page comprehensive report
              </p>
            </div>

            <div className="bg-white p-6">
              <h3 className="font-semibold text-stone-900 mb-3 text-xs uppercase tracking-wide">
                Everything in Hunting Intel, plus:
              </h3>
              <ul className="space-y-2.5">
                {[
                  "Complete USDA soil analysis",
                  "Drainage & farmland classification",
                  "Crop yield estimates (corn/soy)",
                  "Property tax snapshot",
                  "FEMA flood & water rights",
                  "County resources & contacts",
                  "Conservation program info",
                  "Drought status monitoring",
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Check className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 space-y-2.5">
                <Link href="/map?product=full_report" className="block">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 text-base font-semibold">
                    Get Full Report
                  </Button>
                </Link>
                <Link href="/api/free-look" target="_blank" className="block">
                  <Button variant="outline" className="w-full border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 py-4 text-sm font-semibold">
                    Preview Sample
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
                What if the property I'm interested in isn't showing up?
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
