"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  CheckCircle,
  Download,
  FileText,
  Loader2,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trackPurchaseCompleted } from "@/lib/gtag";

function SuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams?.get("orderId") || "";
  const sessionId = searchParams?.get("session_id") || "";
  const isDemo = searchParams?.get("demo") === "true";
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [orderCompleted, setOrderCompleted] = useState(false);
  const [orderDetails, setOrderDetails] = useState<{
    productType: string;
    parcelLat: number;
    parcelLng: number;
    parcelAddress: string;
  } | null>(null);
  // Part 1 & 2: Track whether hunt_report has terrainData ready
  const [terrainDataReady, setTerrainDataReady] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Complete the order when page loads
  useEffect(() => {
    const completeOrder = async () => {
      if (!orderId || orderCompleted) return;
      
      try {
        const response = await fetch(`/api/orders/${orderId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId || `demo_${Date.now()}` }),
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.order) {
            setOrderDetails({
              productType: data.order.productType,
              parcelLat: data.order.parcelLat,
              parcelLng: data.order.parcelLng,
              parcelAddress: data.order.parcelAddress,
            });
            trackPurchaseCompleted(orderId, data.order.productType, data.order.parcelAddress || '');
            // Check if terrainData is already populated (e.g. user ran analyzer before checkout)
            if (data.order.terrainData) {
              setTerrainDataReady(true);
            }
          }
          setOrderCompleted(true);
        }
      } catch (error) {
        console.error("Error completing order:", error);
      }
    };
    
    completeOrder();
  }, [orderId, sessionId, orderCompleted]);

  // Part 2: Poll every 5s for terrainData on hunt_report orders that don't have it yet
  useEffect(() => {
    // Only poll if: hunt_report, no terrainData yet, and order is completed
    if (
      !orderId ||
      !orderCompleted ||
      terrainDataReady ||
      orderDetails?.productType !== 'hunt_report'
    ) {
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.order?.terrainData) {
            setTerrainDataReady(true);
            // Stop polling once data is found
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        }
      } catch {
        // Silently retry on next interval
      }
    };

    pollingRef.current = setInterval(poll, 5000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [orderId, orderCompleted, terrainDataReady, orderDetails?.productType]);

  // Determine if download should be blocked for hunt_report without terrain data
  const isHuntReport = orderDetails?.productType === 'hunt_report';
  const huntDownloadBlocked = isHuntReport && !terrainDataReady;

  const handleDownload = async () => {
    if (!orderId) return;

    setIsDownloading(true);
    try {
      const response = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        alert(`Download failed: ${data.error}`);
        return;
      }

      if (data.pdf) {
        // Handle both PDF and HTML content types (hunt reports are HTML)
        const contentType = data.contentType || 'application/pdf';
        const byteCharacters = atob(data.pdf);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: contentType });

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        setDownloadComplete(true);
        
        // Show success message
        alert("Report downloaded successfully! A confirmation email has also been sent to your inbox. Check your email (including spam folder) for a copy.");
      } else {
        alert("Download failed: No PDF data received. Please try again or contact support at info@terrafirmapartners.com");
      }
    } catch (error) {
      console.error("Download error:", error);
      alert("Download failed. Please check your internet connection and try again. If the problem persists, contact support at info@terrafirmapartners.com");
    } finally {
      setIsDownloading(false);
    }
  };

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
              {isDemo
                ? "Your demo report is ready for download."
                : "Thank you for your purchase. Your land analysis report is ready."}
            </p>

            {isDemo && (
              <div className="bg-blue-50 text-blue-700 text-sm p-3 rounded-lg mb-6">
                <strong>Demo Mode:</strong> This is a test order. Stripe is not
                configured yet.
              </div>
            )}

            <div className="space-y-4">
              {/* Part 1: Show warning when hunt_report terrainData not yet available */}
              {huntDownloadBlocked && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-800 text-sm font-medium">
                      Run the Terrain Analyzer first to generate your Hunt Report
                    </p>
                    <p className="text-amber-600 text-xs mt-1">
                      Your download will unlock automatically when complete.
                    </p>
                  </div>
                </div>
              )}

              <Button
                onClick={handleDownload}
                disabled={isDownloading || downloadComplete || huntDownloadBlocked}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white h-12"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating Report...
                  </>
                ) : downloadComplete ? (
                  <>
                    <CheckCircle className="w-5 h-5 mr-2" />
                    Downloaded!
                  </>
                ) : huntDownloadBlocked ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Waiting for Terrain Analysis...
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5 mr-2" />
                    {isHuntReport ? 'Download Hunt Package (2 Reports)' : 'Download Land Intelligence Report'}
                  </>
                )}
              </Button>

              {isHuntReport && (
                <div style={{marginTop: 16, textAlign: 'center'}}>
                  <a
                    href={`/intel?lat=${orderDetails?.parcelLat}&lng=${orderDetails?.parcelLng}&address=${encodeURIComponent(orderDetails?.parcelAddress || '')}&orderId=${orderId}`}
                    style={{
                      display: 'inline-block',
                      background: '#1a3a2a',
                      color: 'white',
                      padding: '14px 32px',
                      borderRadius: 8,
                      fontWeight: 'bold',
                      fontSize: 15,
                      textDecoration: 'none',
                      marginTop: 8,
                    }}
                  >
                    🦌 Open Terrain Analyzer
                  </a>
                  <p style={{fontSize: 11, color: '#666', marginTop: 8}}>
                    Your parcel is saved — access your Terrain Analyzer anytime
                  </p>
                  {!terrainDataReady && (
                    <p style={{fontSize: 13, color: '#666', textAlign: 'center', marginTop: 8}}>
                      Open your analyzer, run the terrain analysis, then click &quot;Download Parcel Hunt File&quot; inside the analyzer to get your Hunt Intelligence Report. Your download button here will also unlock automatically.
                    </p>
                  )}
                  {terrainDataReady && (
                    <p style={{fontSize: 12, color: '#2d6a4f', textAlign: 'center', marginTop: 8, fontWeight: 600}}>
                      ✅ Terrain analysis complete — your Hunt Package is ready to download above!
                    </p>
                  )}
                </div>
              )}

              <Link href="/dashboard" className="block">
                <Button variant="outline" className="w-full">
                  <FileText className="w-4 h-4 mr-2" />
                  View in Dashboard
                </Button>
              </Link>

              <Link href="/map" className="block">
                <Button variant="ghost" className="w-full text-stone-600">
                  Create Another Report
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
