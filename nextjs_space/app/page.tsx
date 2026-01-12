"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import {
  Map,
  FileText,
  Layers,
  Shield,
  CheckCircle,
  ArrowRight,
  Waves,
  Mountain,
  Zap,
  LayoutGrid,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MAP_LAYERS } from "@/lib/map-layers";

export default function HomePage() {
  return (
    <div className="pt-16">
      {/* Hero Section */}
      <HeroSection />

      {/* Features Section */}
      <FeaturesSection />

      {/* Map Layers Section */}
      <MapLayersSection />

      {/* How It Works Section */}
      <HowItWorksSection />

      {/* CTA Section */}
      <CTASection />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative min-h-[80vh] flex items-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 via-emerald-800 to-stone-900">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='https://www.shutterstock.com/image-vector/green-emerald-color-triangle-poly-260nw-2584786423.jpg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center"
        >
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">
            Professional Land Parcel
            <span className="text-emerald-400"> Analysis</span>
          </h1>
          <p className="text-xl text-emerald-100 max-w-3xl mx-auto mb-8">
            Comprehensive mapping reports for Kansas City metro area properties.
            Flood zones, topography, zoning, and more - all in one detailed PDF report.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/map">
              <Button
                size="lg"
                className="bg-white text-emerald-800 hover:bg-emerald-50 shadow-lg px-8"
              >
                <Map className="w-5 h-5 mr-2" />
                Start Mapping
              </Button>
            </Link>
            <Link href="/pricing">
              <Button
                size="lg"
                variant="outline"
                className="border-white text-white hover:bg-white/10 px-8"
              >
                View Pricing
              </Button>
            </Link>
          </div>

          <div className="mt-12 flex items-center justify-center gap-8 text-emerald-200">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              <span>FEMA Flood Data</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              <span>8+ Map Layers</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              <span>PDF Reports</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const features = [
    {
      icon: Map,
      title: "Interactive Mapping",
      description:
        "Click to select any parcel or search by address in the Kansas City metro area.",
    },
    {
      icon: Layers,
      title: "Multiple Data Layers",
      description:
        "Choose from flood zones, topography, soil types, zoning, and more.",
    },
    {
      icon: FileText,
      title: "Professional Reports",
      description:
        "Download detailed PDF reports with maps, data, and analysis for each layer.",
    },
    {
      icon: Shield,
      title: "Trusted Sources",
      description:
        "Data from FEMA, USGS, USDA, and local government agencies.",
    },
  ];

  return (
    <section ref={ref} className="py-20 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-stone-800 mb-4">
            Everything You Need for Land Analysis
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            Whether you're a realtor, land buyer, or broker, our tools provide the
            insights you need for informed decisions.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.1 }}
            >
              <Card className="h-full hover:shadow-lg transition-shadow bg-white">
                <CardContent className="p-6">
                  <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4">
                    <feature.icon className="w-6 h-6 text-emerald-700" />
                  </div>
                  <h3 className="text-lg font-semibold text-stone-800 mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-stone-600 text-sm">{feature.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MapLayersSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const iconMap: Record<string, any> = {
    Waves: Waves,
    Mountain: Mountain,
    Zap: Zap,
    LayoutGrid: LayoutGrid,
    Layers: Layers,
  };

  return (
    <section ref={ref} className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-stone-800 mb-4">
            Available Map Layers
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            Select the data layers most relevant to your analysis. Each layer is
            included as a dedicated page in your report.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {MAP_LAYERS.map((layer, index) => (
            <motion.div
              key={layer.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={isInView ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.4, delay: index * 0.05 }}
              className="bg-stone-50 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                  style={{ backgroundColor: layer.color }}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-stone-800">
                      {layer.displayName}
                    </h4>
                    {layer.isPremium && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        Premium
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 mt-1">{layer.dataSource}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="text-center mt-8">
          <Link href="/map">
            <Button className="bg-emerald-700 hover:bg-emerald-800 text-white">
              Explore All Layers
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const steps = [
    {
      number: "01",
      title: "Select Your Property",
      description:
        "Click on the map or search by address to select the parcel you want to analyze.",
    },
    {
      number: "02",
      title: "Choose Data Layers",
      description:
        "Select the map layers you want included in your report - flood zones, soil types, and more.",
    },
    {
      number: "03",
      title: "Generate Report",
      description:
        "Complete checkout and receive a professional PDF report instantly.",
    },
  ];

  return (
    <section ref={ref} className="py-20 bg-emerald-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            How It Works
          </h2>
          <p className="text-emerald-200 max-w-2xl mx-auto">
            Get your comprehensive land analysis report in three simple steps.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.2 }}
              className="text-center"
            >
              <div className="w-16 h-16 bg-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-emerald-200">
                {step.number}
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                {step.title}
              </h3>
              <p className="text-emerald-200">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (isInView && count < 350) {
      const timer = setTimeout(() => {
        setCount((prev) => Math.min(prev + 10, 350));
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isInView, count]);

  return (
    <section ref={ref} className="py-20 bg-stone-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-stone-800 mb-4">
            Ready to Analyze Your Property?
          </h2>
          <p className="text-stone-600 mb-8">
            Get a comprehensive land parcel report for just{" "}
            <span className="text-emerald-700 font-bold text-2xl">${count}</span>{" "}
            per report.
          </p>

          <Link href="/map">
            <Button
              size="lg"
              className="bg-emerald-700 hover:bg-emerald-800 text-white shadow-lg px-10"
            >
              Get Started Now
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>

          <p className="text-sm text-stone-500 mt-6">
            Serving the Kansas City metro area - Missouri & Kansas
          </p>
        </motion.div>
      </div>
    </section>
  );
}
