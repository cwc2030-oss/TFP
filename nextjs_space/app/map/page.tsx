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

type ProductType = "hunt_report" | "land_report";

const PRODUCTS = {
  hunt_report: {
    name: "Hunt Intelligence Report",
    description: "Terrain analysis, stand placement, wind strategy, and satellite hunt map. Indefinite parcel access.",
    price: 149,
    color: "red",
    badge: "🦌 MOST POPULAR",
  },
  land_report: {
    name: "Land Intelligence Report",
    description: "Professional land analysis including terrain, water, access, valuation, and market data.",
    price: 49,
    color: "emerald",
    badge: null as string | null,
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
  const [selectedProduct, setSelectedProduct] = useState<ProductType>("hunt_report");
  const [guestEmail, setGuestEmail] = useState("");
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isDemoCheckout, setIsDemoCheckout] = useState(false);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  // Read product type, demo mode, and initial parcel from URL parameters
  const autoOpen3D = searchParams.get("demo") === "3d";
  const initialParcel = (() => {
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    if (lat && lng) {
      return {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        address: searchParams.get("address") || "Selected Parcel",
      };
    }
    return null;
  })();

  useEffect(() => {
    const productParam = searchParams.get("product");
    if (productParam === "hunt_report" || productParam === "land_report") {
      setSelectedProduct(productParam);
    } else {
      setSelectedProduct("hunt_report"); // default to most popular
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
    // Both products are fixed — no layer selection needed
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
            initialParcel={initialParcel}
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
                
                {(Object.keys(PRODUCTS) as ProductType[]).map((key) => {
                  const product = PRODUCTS[key];
                  const isSelected = selectedProduct === key;
                  const colorMap = { red: { border: "border-red-500", bg: "bg-red-50", dot: "bg-red-500", dotBorder: "border-red-500", price: "text-red-600", check: "text-red-500", badgeBg: "bg-red-100", badgeText: "text-red-700" }, emerald: { border: "border-emerald-500", bg: "bg-emerald-50", dot: "bg-emerald-500", dotBorder: "border-emerald-500", price: "text-emerald-600", check: "text-emerald-500", badgeBg: "bg-emerald-100", badgeText: "text-emerald-700" } };
                  const c = colorMap[product.color];
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedProduct(key)}
                      className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                        isSelected ? `${c.border} ${c.bg}` : "border-stone-200 hover:border-stone-300"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? c.dotBorder : "border-stone-300"
                          }`}>
                            {isSelected && <div className={`w-2 h-2 rounded-full ${c.dot}`} />}
                          </div>
                          <span className="font-semibold text-stone-800 text-sm">{product.name}</span>
                          {product.badge && (
                            <span className={`text-xs ${c.badgeBg} ${c.badgeText} px-2 py-0.5 rounded font-medium`}>{product.badge}</span>
                          )}
                        </div>
                        <span className={`text-lg font-bold ${c.price}`}>${product.price}</span>
                      </div>
                      <p className="text-xs text-stone-500 ml-6">{product.description}</p>
                    </button>
                  );
                })}
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
                  <span className={`text-3xl font-bold ${selectedProduct === "hunt_report" ? "text-red-600" : "text-emerald-700"}`}>
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
