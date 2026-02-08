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
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8">
          
          {/* Broker Quick Look Card */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-amber-400">
            <div className="bg-amber-500 text-white text-center py-2 px-4 font-semibold text-sm">
              🏡 Perfect for Listings
            </div>
            
            <div className="p-8 text-center border-b border-stone-200">
              <h2 className="text-2xl font-bold text-stone-800 mb-2">
                Broker Quick Look
              </h2>
              <div className="mt-4">
                <span className="text-5xl font-bold text-amber-600">$49</span>
                <span className="text-stone-500 text-lg ml-2">per report</span>
              </div>
              <p className="text-stone-500 mt-3 text-sm">
                2-page deal-killer checklist
              </p>
            </div>

            <div className="p-8">
              <h3 className="font-semibold text-stone-900 mb-4 text-sm uppercase tracking-wide">
                Includes:
              </h3>
              <ul className="space-y-3">
                {[
                  "Verified acreage & legal boundaries",
                  "FEMA flood zone status",
                  "CWD management zone check",
                  "Soil buildability rating",
                  "Road access verification",
                  "Satellite map with parcel overlay",
                  "Instant PDF download"
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <Check className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <Link href="/map" className="block">
                  <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white py-5 text-base font-semibold">
                    Get Quick Look
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Full Land Analysis Card */}
          <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl shadow-2xl overflow-hidden border-4 border-emerald-800 relative">
            <div className="absolute top-0 right-0 bg-white text-emerald-700 px-3 py-1 text-xs font-bold rounded-bl-lg">
              MOST POPULAR
            </div>
            <div className="bg-emerald-800 text-emerald-100 text-center py-2 px-4 font-semibold text-sm">
              ⭐ Complete Property Intelligence
            </div>
            
            <div className="p-8 text-center">
              <h2 className="text-2xl font-bold text-white mb-2">
                Full Land Analysis
              </h2>
              <div className="mt-4">
                <span className="text-5xl font-bold text-white">$350</span>
                <span className="text-emerald-100 text-lg ml-2">per report</span>
              </div>
              <p className="text-emerald-100 mt-3 text-sm">
                9-page comprehensive report
              </p>
            </div>

            <div className="bg-white p-8">
              <h3 className="font-semibold text-stone-900 mb-4 text-sm uppercase tracking-wide">
                Everything in Quick Look, plus:
              </h3>
              <ul className="space-y-3">
                {[
                  "Detailed hunting intel & harvest data",
                  "Deer/turkey season dates & bag limits",
                  "Complete USDA soil analysis",
                  "Drainage & farmland classification",
                  "County resources & contacts",
                  "Regional area information",
                  "Conservation program info",
                  "Drought status monitoring"
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <Check className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 space-y-3">
                <Link href="/map" className="block">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 text-base font-semibold">
                    Get Full Report
                  </Button>
                </Link>
                <Link href="/api/free-look" target="_blank" className="block">
                  <Button variant="outline" className="w-full border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 py-5 text-base font-semibold">
                    Preview Sample Report
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
