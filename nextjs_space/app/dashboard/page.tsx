"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  FileText,
  Download,
  MapPin,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Map,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Order {
  id: string;
  parcelAddress: string;
  parcelId: string | null;
  selectedLayers: string;
  price: number;
  status: string;
  pdfPath: string | null;
  createdAt: string;
  productType?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, status } = useSession() || {};
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // BUG 2b FIX: show a friendly banner when an already-subscribed user was
  // redirected here from the pricing page (?sub=pro|promax) instead of a blank map.
  const [subNotice, setSubNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sub = new URLSearchParams(window.location.search).get("sub");
    if (sub === "promax") setSubNotice("You're already on Pro Max — you have full access to everything.");
    else if (sub === "pro") setSubNotice("You're already on Pro — you have full access to your plan.");
    if (sub) {
      // Clean the URL so the banner doesn't reappear on refresh.
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetchOrders();
    }
  }, [session]);

  const fetchOrders = async () => {
    try {
      const response = await fetch("/api/orders");
      const data = await response.json();
      setOrders(data.orders || []);
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (orderId: string) => {
    setDownloadingId(orderId);
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
        // Convert base64 to blob — handle both PDF and HTML content types
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

        // Show success message
        alert("Report downloaded successfully! A confirmation email has also been sent to your inbox.");

        // Refresh orders to show updated status
        fetchOrders();
      } else {
        alert("Download failed: No PDF data received. Please try again or contact support.");
      }
    } catch (error) {
      console.error("Download error:", error);
      alert("Download failed. Please check your internet connection and try again. If the problem persists, contact support.");
    } finally {
      setDownloadingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
            <CheckCircle className="w-3 h-3" />
            Completed
          </span>
        );
      case "paid":
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
            <CheckCircle className="w-3 h-3" />
            paid
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        );
      case "demo_checkout":
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
            <CheckCircle className="w-3 h-3" />
            Demo Ready
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-stone-100 text-stone-700 px-2 py-1 rounded-full">
            {status}
          </span>
        );
    }
  };

  if (status === "loading" || isLoading) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-emerald-700 mx-auto mb-4" />
          <p className="text-stone-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen pt-16 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* BUG 2b: already-subscribed notice */}
        {subNotice && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800 font-medium">{subNotice}</p>
            </div>
            <button
              onClick={() => setSubNotice(null)}
              className="text-emerald-700 hover:text-emerald-900 text-sm font-semibold flex-shrink-0"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-stone-800">
                Welcome, {session.user?.name || "User"}
              </h1>
              <p className="text-stone-600 mt-1">
                Manage your land analysis reports
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/listings">
                <Button variant="outline" className="border-emerald-700 text-emerald-700 hover:bg-emerald-50">
                  My Listings
                </Button>
              </Link>
              <Link href="/dashboard/inquiries">
                <Button variant="outline" className="border-emerald-700 text-emerald-700 hover:bg-emerald-50">
                  Inquiries
                </Button>
              </Link>
              <Link href="/map">
                <Button className="bg-emerald-700 hover:bg-emerald-800 text-white">
                  <Map className="w-4 h-4 mr-2" />
                  New Report
                </Button>
              </Link>
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid md:grid-cols-3 gap-4 mb-8"
        >
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-emerald-700" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Total Reports</p>
                  <p className="text-2xl font-bold text-stone-800">
                    {orders.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Download className="w-6 h-6 text-blue-700" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Ready to Download</p>
                  <p className="text-2xl font-bold text-stone-800">
                    {orders.filter((o) => o.status === "completed" || o.status === "paid" || o.status === "demo_checkout").length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-stone-100 rounded-lg flex items-center justify-center">
                  <User className="w-6 h-6 text-stone-700" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Account</p>
                  <p className="text-sm font-medium text-stone-800 truncate max-w-[150px]">
                    {session.user?.email}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Orders List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-700" />
                Your Reports
              </CardTitle>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-stone-800 mb-2">
                    No reports yet
                  </h3>
                  <p className="text-stone-600 mb-4">
                    Create your first land analysis report
                  </p>
                  <Link href="/map">
                    <Button className="bg-emerald-700 hover:bg-emerald-800 text-white">
                      Start Mapping
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => {
                    const layers = JSON.parse(order.selectedLayers || "[]");
                    return (
                      <div
                        key={order.id}
                        className="flex flex-col md:flex-row md:items-center gap-4 p-4 bg-stone-50 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-3">
                            <MapPin className="w-5 h-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="font-medium text-stone-800 truncate">
                                {order.parcelAddress}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-stone-500">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {formatDate(order.createdAt)}
                                </span>
                                <span>•</span>
                                <span className="font-medium">{order.productType === "hunting_intel" ? "Hunting Intel" : order.productType === "quick_look" ? "Quick Look" : "Full Report"}</span>
                                <span>•</span>
                                <span>${order.price}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {getStatusBadge(order.status)}
                          {(order.status === "completed" || order.status === "paid" || order.status === "demo_checkout") && (
                            <Button
                              onClick={() => handleDownload(order.id)}
                              disabled={downloadingId === order.id}
                              size="sm"
                              className="bg-emerald-700 hover:bg-emerald-800 text-white"
                            >
                              {downloadingId === order.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <Download className="w-4 h-4 mr-1" />
                                  Download PDF
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
