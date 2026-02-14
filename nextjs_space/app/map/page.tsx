"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  ShoppingCart,
  FileText,
  AlertCircle,
  Loader2,
  X,
  MapPin,
  Mail,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MAP_LAYERS } from "@/lib/map-layers";

const InteractiveMap = dynamic(
  () => import("@/components/map/interactive-map"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-stone-100 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
          <p className="text-stone-600">Loading map...</p>
        </div>
      </div>
    ),
  }
);

interface SelectedParcel {
  address: string;
  lat: number;
  lng: number;
  parcelId?: string;
  bounds?: { lat: number; lng: number }[];
}

type ProductType = "full_report" | "quick_look" | "hunting_intel";

const PRODUCTS = {
  quick_look: {
    name: "Broker Quick Look",
    price: 49,
    description: "2-page deal-killer checklist",
    features: ["Verified acreage & boundaries", "FEMA flood zone status", "CWD zone check", "Soil buildability", "Road access verification"],
    color: "amber",
  },
  hunting_intel: {
    name: "Hunting Intelligence",
    price: 79,
    description: "5-page deer intel playbook",
    features: ["7 layers of deer corridors", "Stand site recommendations", "Season playbook (early/rut/late)", "\"How We Know\" methodology", "CWD & harvest pressure data"],
    color: "red",
  },
  full_report: {
    name: "Full Land Analysis",
    price: 350,
    description: "9-page comprehensive report",
    features: ["Everything in Hunting Intel", "Complete USDA soil analysis", "Property tax snapshot", "County resources & contacts", "Conservation programs"],
    color: "emerald",
  },
} as const;

export default function MapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession() || {};
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  // Basic Report - all 5 layers pre-selected
  const [selectedLayers] = useState<string[]>(["flood_zones", "topography", "soil_types", "property_boundaries", "roads_transportation"]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductType>("full_report");
  const [guestEmail, setGuestEmail] = useState("");
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isDemoCheckout, setIsDemoCheckout] = useState(false);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  // Read product type and demo mode from URL parameters
  const autoOpen3D = searchParams.get("demo") === "3d";
  useEffect(() => {
    const productParam = searchParams.get("product");
    if (productParam === "quick_look" || productParam === "full_report" || productParam === "hunting_intel") {
      setSelectedProduct(productParam);
    }
  }, [searchParams]);

  // Check if user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      if (session?.user?.email) {
        try {
          const res = await fetch("/api/admin/stats");
          if (res.ok) {
            setIsAdmin(true);
          }
        } catch {
          setIsAdmin(false);
        }
      }
    };
    checkAdmin();
  }, [session]);

  const handleParcelSelect = useCallback((parcel: SelectedParcel | null) => {
    setSelectedParcel(parcel);
    setError("");
  }, []);



  const handleProceedToCheckout = (product?: string) => {
    if (!selectedParcel) {
      setError("Please select a property on the map first");
      return;
    }
    if (product) {
      setSelectedProduct(product as ProductType);
    }
    if (selectedLayers.length === 0) {
      setError("Please select at least one map layer for your report");
      return;
    }
    setShowCheckout(true);
  };

  const handleCreateOrder = async (isDemo = false) => {
    if (!selectedParcel) return;

    if (!session && !guestEmail && !isDemo) {
      setError("Please enter your email address or sign in");
      return;
    }

    if (isDemo) {
      setIsDemoCheckout(true);
    } else {
      setIsCreatingOrder(true);
    }
    setError("");

    try {
      // Create order
      const orderResponse = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parcelAddress: selectedParcel.address,
          parcelId: selectedParcel.parcelId,
          parcelLat: selectedParcel.lat,
          parcelLng: selectedParcel.lng,
          parcelBounds: selectedParcel.bounds,
          selectedLayers,
          guestEmail: session ? undefined : guestEmail,
          productType: selectedProduct,
          isDemo: isDemo, // Flag for demo orders
        }),
      });

      if (!orderResponse.ok) {
        throw new Error("Failed to create order");
      }

      const { order } = await orderResponse.json();

      // If demo mode, skip Stripe and go directly to success
      if (isDemo) {
        // Mark order as demo-paid
        await fetch(`/api/orders/${order.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ demo: true }),
        });
        router.push(`/checkout/success?orderId=${order.id}&demo=true`);
        return;
      }

      // Proceed to checkout
      const checkoutResponse = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });

      if (!checkoutResponse.ok) {
        throw new Error("Failed to create checkout session");
      }

      const { url } = await checkoutResponse.json();
      window.location.href = url;
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setIsCreatingOrder(false);
      setIsDemoCheckout(false);
    }
  };

  return (
    <div className="min-h-screen pt-16">
      <div className="h-[calc(100vh-64px)] flex">
        {/* Map Area */}
        <div className="flex-1 relative">
          <InteractiveMap
            onParcelSelect={handleParcelSelect}
            onCheckout={handleProceedToCheckout}
            autoOpen3D={autoOpen3D}
          />

{/* Order Summary card removed - checkout button now in parcel panel */}
        </div>
      </div>

      {/* Checkout Modal */}
      {showCheckout && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-stone-800">
                  Complete Your Order
                </h2>
                <button
                  onClick={() => setShowCheckout(false)}
                  className="text-stone-400 hover:text-stone-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Property Info */}
              <div className="bg-stone-50 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-stone-800">
                      {selectedParcel?.address}
                    </p>
                    <p className="text-xs text-stone-500 mt-1">
                      {selectedParcel?.parcelId && `Parcel ID: ${selectedParcel.parcelId}`}
                    </p>
                  </div>
                </div>
              </div>

              {/* Product Selection */}
              <div className="space-y-3 mb-6">
                <p className="text-sm font-medium text-stone-700">Choose Your Report</p>
                
                {/* Quick Look Option */}
                <button
                  onClick={() => setSelectedProduct("quick_look")}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                    selectedProduct === "quick_look"
                      ? "border-amber-500 bg-amber-50"
                      : "border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        selectedProduct === "quick_look" ? "border-amber-500" : "border-stone-300"
                      }`}>
                        {selectedProduct === "quick_look" && (
                          <div className="w-2 h-2 rounded-full bg-amber-500" />
                        )}
                      </div>
                      <span className="font-semibold text-stone-800 text-sm">{PRODUCTS.quick_look.name}</span>
                    </div>
                    <span className="text-lg font-bold text-amber-600">${PRODUCTS.quick_look.price}</span>
                  </div>
                  <p className="text-xs text-stone-500 ml-6">{PRODUCTS.quick_look.description}</p>
                  {selectedProduct === "quick_look" && (
                    <ul className="mt-2 ml-6 space-y-1">
                      {PRODUCTS.quick_look.features.slice(0, 3).map((f, i) => (
                        <li key={i} className="text-xs text-stone-600 flex items-center gap-1">
                          <span className="text-amber-500">✓</span> {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </button>

                {/* Hunting Intelligence Option */}
                <button
                  onClick={() => setSelectedProduct("hunting_intel")}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                    selectedProduct === "hunting_intel"
                      ? "border-red-500 bg-red-50"
                      : "border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        selectedProduct === "hunting_intel" ? "border-red-500" : "border-stone-300"
                      }`}>
                        {selectedProduct === "hunting_intel" && (
                          <div className="w-2 h-2 rounded-full bg-red-500" />
                        )}
                      </div>
                      <span className="font-semibold text-stone-800 text-sm">{PRODUCTS.hunting_intel.name}</span>
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">🦌 NEW</span>
                    </div>
                    <span className="text-lg font-bold text-red-600">${PRODUCTS.hunting_intel.price}</span>
                  </div>
                  <p className="text-xs text-stone-500 ml-6">{PRODUCTS.hunting_intel.description}</p>
                  {selectedProduct === "hunting_intel" && (
                    <ul className="mt-2 ml-6 space-y-1">
                      {PRODUCTS.hunting_intel.features.slice(0, 4).map((f, i) => (
                        <li key={i} className="text-xs text-stone-600 flex items-center gap-1">
                          <span className="text-red-500">✓</span> {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </button>

                {/* Full Report Option */}
                <button
                  onClick={() => setSelectedProduct("full_report")}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                    selectedProduct === "full_report"
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        selectedProduct === "full_report" ? "border-emerald-500" : "border-stone-300"
                      }`}>
                        {selectedProduct === "full_report" && (
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        )}
                      </div>
                      <span className="font-semibold text-stone-800 text-sm">{PRODUCTS.full_report.name}</span>
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Most Complete</span>
                    </div>
                    <span className="text-lg font-bold text-emerald-600">${PRODUCTS.full_report.price}</span>
                  </div>
                  <p className="text-xs text-stone-500 ml-6">{PRODUCTS.full_report.description}</p>
                  {selectedProduct === "full_report" && (
                    <ul className="mt-2 ml-6 space-y-1">
                      {PRODUCTS.full_report.features.slice(0, 4).map((f, i) => (
                        <li key={i} className="text-xs text-stone-600 flex items-center gap-1">
                          <span className="text-emerald-500">✓</span> {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </button>
              </div>

              {/* Guest Email */}
              {!session && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-stone-700 mb-2">
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                    <Input
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="pl-10"
                    />
                  </div>
                  <p className="text-xs text-stone-500 mt-1">
                    Your report will be sent to this email
                  </p>
                </div>
              )}

              {/* Price */}
              <div className="border-t border-stone-200 pt-4 mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-lg text-stone-700">Total</span>
                    <p className="text-xs text-stone-500">{PRODUCTS[selectedProduct].name}</p>
                  </div>
                  <span className={`text-3xl font-bold ${selectedProduct === "quick_look" ? "text-amber-600" : selectedProduct === "hunting_intel" ? "text-red-600" : "text-emerald-700"}`}>
                    ${PRODUCTS[selectedProduct].price}
                  </span>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm mb-4">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <Button
                onClick={() => handleCreateOrder(false)}
                disabled={isCreatingOrder || isDemoCheckout}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white h-12 text-lg"
              >
                {isCreatingOrder ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Proceed to Payment"
                )}
              </Button>

              {/* Admin Demo Checkout - Skip Stripe */}
              {isAdmin && (
                <Button
                  onClick={() => handleCreateOrder(true)}
                  disabled={isCreatingOrder || isDemoCheckout}
                  variant="outline"
                  className="w-full mt-3 border-amber-500 text-amber-700 hover:bg-amber-50 h-10"
                >
                  {isDemoCheckout ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating Demo...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Demo Checkout (Admin Only)
                    </>
                  )}
                </Button>
              )}

              <p className="text-xs text-stone-500 text-center mt-4">
                Secure payment powered by Stripe
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
