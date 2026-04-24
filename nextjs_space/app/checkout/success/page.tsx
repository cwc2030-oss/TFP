"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle, FileText, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function SuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams?.get("orderId") || "";
  const sessionId = searchParams?.get("session_id") || "";
  const isDemo = searchParams?.get("demo") === "true";
  const [orderCompleted, setOrderCompleted] = useState(false);

  // Complete the order when page loads (for any legacy pending orders)
  useEffect(() => {
    const completeOrder = async () => {
      if (!orderId || orderCompleted) return;
      try {
        await fetch(`/api/orders/${orderId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId || `demo_${Date.now()}` }),
        });
        setOrderCompleted(true);
      } catch (error) {
        console.error("Error completing order:", error);
      }
    };
    completeOrder();
  }, [orderId, sessionId, orderCompleted]);

  return (
    <div className="min-h-screen pt-16 bg-gradient-to-br from-emerald-50 to-stone-50 flex items-center justify-center py-12 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="shadow-xl text-center">
          <CardContent className="p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6"
            >
              <CheckCircle className="w-10 h-10 text-emerald-600" />
            </motion.div>

            <h1 className="text-2xl font-bold text-stone-800 mb-2">
              {isDemo ? "Demo Order Complete!" : "Payment Successful!"}
            </h1>
            <p className="text-stone-600 mb-6">
              Thank you — your order is confirmed. A receipt has been emailed
              to you. Visit your dashboard to view order history and any
              unlocked parcels.
            </p>

            {isDemo && (
              <div className="bg-blue-50 text-blue-700 text-sm p-3 rounded-lg mb-6">
                <strong>Demo Mode:</strong> This is a test order.
              </div>
            )}

            <div className="space-y-3">
              <Link href="/dashboard" className="block">
                <Button className="w-full bg-emerald-700 hover:bg-emerald-800 text-white h-12">
                  <FileText className="w-4 h-4 mr-2" />
                  View in Dashboard
                </Button>
              </Link>

              <Link href="/map" className="block">
                <Button variant="ghost" className="w-full text-stone-600">
                  Back to Map
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen pt-16 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-700" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
