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

        {/* Pricing Card */}
        <div className="max-w-lg mx-auto">
          <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl shadow-2xl overflow-hidden border-4 border-emerald-800">
            {/* Badge */}
            <div className="bg-amber-400 text-amber-900 text-center py-2 px-4 font-semibold text-sm">
              ⭐ Everything Included – Premium Value
            </div>
            
            {/* Pricing Header */}
            <div className="p-8 text-center">
              <h2 className="text-3xl font-bold text-white mb-2">
                Land Analysis Report
              </h2>
              <div className="mt-6">
                <span className="text-5xl font-bold text-white">$350</span>
                <span className="text-emerald-100 text-lg ml-2">per report</span>
              </div>
              <p className="text-emerald-100 mt-4 text-sm">
                Comprehensive property intelligence in minutes
              </p>
            </div>

            {/* Features List */}
            <div className="bg-white p-8">
              <h3 className="font-semibold text-stone-900 mb-4 text-lg">
                Every Report Includes:
              </h3>
              <ul className="space-y-3">
                {[
                  "9 Premium Data Layers (Flood, Soil, Topography & More)",
                  "Building Footprints & Structure Analysis",
                  "FEMA Risk Index & Flood Zone Details",
                  "Qualified Opportunity Zone Status",
                  "School District Information",
                  "Property Boundaries & Acreage",
                  "Ownership & Tax Records",
                  "3D Satellite Imagery & Map Views",
                  "Professional PDF Report (Instant Download)",
                  "No Subscription Required"
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <Check className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span className="text-stone-700">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 space-y-3">
                <Link href="/map" className="block">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-6 text-lg font-semibold">
                    Select Your Property
                  </Button>
                </Link>
                <Link href="/api/sample-report" target="_blank" className="block">
                  <Button variant="outline" className="w-full border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 py-6 text-lg font-semibold">
                    View Sample Report
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Trust Indicators */}
          <div className="mt-12 grid grid-cols-3 gap-6 text-center">
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
