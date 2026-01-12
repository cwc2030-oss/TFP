"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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

export default function MapPage() {
  const router = useRouter();
  const { data: session } = useSession() || {};
  const [selectedParcel, setSelectedParcel] = useState<SelectedParcel | null>(null);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(["flood_zones"]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [guestEmail, setGuestEmail] = useState("");
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [error, setError] = useState("");

  const handleParcelSelect = useCallback((parcel: SelectedParcel | null) => {
    setSelectedParcel(parcel);
    setError("");
  }, []);

  const handleLayersChange = useCallback((layers: string[]) => {
    setSelectedLayers(layers);
  }, []);

  const handleProceedToCheckout = () => {
    if (!selectedParcel) {
      setError("Please select a property on the map first");
      return;
    }
    if (selectedLayers.length === 0) {
      setError("Please select at least one map layer for your report");
      return;
    }
    setShowCheckout(true);
  };

  const handleCreateOrder = async () => {
    if (!selectedParcel) return;

    if (!session && !guestEmail) {
      setError("Please enter your email address or sign in");
      return;
    }

    setIsCreatingOrder(true);
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
        }),
      });

      if (!orderResponse.ok) {
        throw new Error("Failed to create order");
      }

      const { order } = await orderResponse.json();

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
    }
  };

  return (
    <div className="min-h-screen pt-16">
      <div className="h-[calc(100vh-64px)] flex">
        {/* Map Area */}
        <div className="flex-1 relative">
          <InteractiveMap
            onParcelSelect={handleParcelSelect}
            onLayersChange={handleLayersChange}
            initialLayers={selectedLayers}
          />

          {/* Order Summary Floating Card */}
          {selectedParcel && !showCheckout && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="absolute top-20 right-96 z-20 w-72"
            >
              <Card className="shadow-xl bg-white/95 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5 text-emerald-700" />
                    Order Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-stone-500">Selected Property</p>
                      <p className="text-sm font-medium text-stone-800 line-clamp-2">
                        {selectedParcel.address}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-stone-500">Selected Layers</p>
                      <p className="text-sm font-medium text-stone-800">
                        {selectedLayers.length} layer(s)
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {selectedLayers.slice(0, 3).map((layerId) => {
                          const layer = MAP_LAYERS.find((l) => l.id === layerId);
                          return (
                            <span
                              key={layerId}
                              className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded"
                            >
                              {layer?.displayName || layerId}
                            </span>
                          );
                        })}
                        {selectedLayers.length > 3 && (
                          <span className="text-xs text-stone-500">
                            +{selectedLayers.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-stone-200 pt-4">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-stone-600">Total</span>
                        <span className="text-2xl font-bold text-emerald-700">
                          $350
                        </span>
                      </div>

                      {error && (
                        <div className="flex items-center gap-2 p-2 bg-red-50 text-red-700 rounded text-xs mb-3">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          {error}
                        </div>
                      )}

                      <Button
                        onClick={handleProceedToCheckout}
                        className="w-full bg-emerald-700 hover:bg-emerald-800 text-white"
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Proceed to Checkout
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
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

              {/* Order Details */}
              <div className="space-y-4 mb-6">
                <div className="bg-stone-50 rounded-lg p-4">
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

                <div className="bg-stone-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-stone-800 mb-2">
                    Selected Layers ({selectedLayers.length})
                  </p>
                  <div className="space-y-1">
                    {selectedLayers.map((layerId) => {
                      const layer = MAP_LAYERS.find((l) => l.id === layerId);
                      return (
                        <div key={layerId} className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: layer?.color }}
                          />
                          <span className="text-sm text-stone-600">
                            {layer?.displayName || layerId}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
                  <span className="text-lg text-stone-700">Total</span>
                  <span className="text-3xl font-bold text-emerald-700">$350</span>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm mb-4">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <Button
                onClick={handleCreateOrder}
                disabled={isCreatingOrder}
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
