"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Check,
  FileText,
  Map,
  Layers,
  Download,
  Building2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MAP_LAYERS } from "@/lib/map-layers";

export default function PricingPage() {
  const includedFeatures = [
    "🇺🇸 Nationwide coverage (all 50 states)",
    "Gorgeous bordered aerial property view",
    "High-resolution satellite imagery",
    "Parcel boundaries clearly outlined",
    "Basic layer analysis included",
    "Owner & parcel information",
    "Professional one-page PDF report",
    "Instant download",
  ];

  return (
    <div className="min-h-screen pt-16">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-emerald-800 to-emerald-900 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h1>
            <p className="text-emerald-200 text-lg max-w-2xl mx-auto">
              Get a beautiful aerial view of any property with basic land analysis.
              No hidden fees, no subscriptions.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Pricing Card */}
      <section className="py-16 bg-stone-50 -mt-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Card className="shadow-2xl overflow-hidden">
              <div className="bg-emerald-700 p-8 text-center">
                <h2 className="text-2xl font-semibold text-white mb-2">
                  Basic Land Report
                </h2>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-5xl font-bold text-white">$99</span>
                  <span className="text-emerald-200">per report</span>
                </div>
              </div>

              <CardContent className="p-8">
                <div className="grid md:grid-cols-2 gap-8">
                  {/* What's Included */}
                  <div>
                    <h3 className="font-semibold text-stone-800 mb-4 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-emerald-700" />
                      What's Included
                    </h3>
                    <ul className="space-y-3">
                      {includedFeatures.map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                          <span className="text-stone-700">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Available Layers */}
                  <div>
                    <h3 className="font-semibold text-stone-800 mb-4 flex items-center gap-2">
                      <Layers className="w-5 h-5 text-emerald-700" />
                      Available Map Layers
                    </h3>
                    <ul className="space-y-2">
                      {MAP_LAYERS.map((layer) => (
                        <li
                          key={layer.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: layer.color }}
                          />
                          <span className="text-stone-700">
                            {layer.displayName}
                          </span>
                          {layer.isPremium && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                              Premium
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-8 pt-8 border-t border-stone-200 text-center">
                  <Link href="/map">
                    <Button
                      size="lg"
                      className="bg-emerald-700 hover:bg-emerald-800 text-white px-12"
                    >
                      <Map className="w-5 h-5 mr-2" />
                      Start Your Report
                    </Button>
                  </Link>
                  <p className="text-sm text-stone-500 mt-4">
                    Serving the Kansas City metro area (Missouri & Kansas)
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Target Audience */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-stone-800 mb-4">
              Who Uses Our Reports?
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              viewport={{ once: true }}
            >
              <Card className="h-full hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4">
                    <Users className="w-6 h-6 text-emerald-700" />
                  </div>
                  <CardTitle>Individual Buyers & Sellers</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-stone-600">
                    Make informed decisions with comprehensive property analysis.
                    Understand flood risks, soil conditions, and zoning before
                    buying or selling land.
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              viewport={{ once: true }}
            >
              <Card className="h-full hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center mb-4">
                    <Building2 className="w-6 h-6 text-amber-700" />
                  </div>
                  <CardTitle>Real Estate Brokers</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-stone-600">
                    Provide added value to your clients with professional land
                    analysis reports. Streamline due diligence for commercial and
                    residential land transactions.
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
