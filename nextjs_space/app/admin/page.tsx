"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Shield,
  Database,
  Users,
  FileText,
  DollarSign,
  Loader2,
  MapPin,
  Calendar,
  TrendingUp,
  CheckCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Stats {
  totalUsers: number;
  totalOrders: number;
  completedOrders: number;
  revenue: number;
}

interface Order {
  id: string;
  parcelAddress: string;
  price: number;
  status: string;
  createdAt: string;
  user: { name: string; email: string } | null;
  guestEmail: string | null;
}

export default function AdminPage() {
  const router = useRouter();
  const { data: session, status } = useSession() || {};
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (session?.user?.role !== "admin" && status === "authenticated") {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  useEffect(() => {
    if (session?.user?.role === "admin") {
      fetchAdminData();
    }
  }, [session]);

  const fetchAdminData = async () => {
    try {
      const response = await fetch("/api/admin/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch admin data");
      }
      const data = await response.json();
      setStats(data.stats);
      setRecentOrders(data.recentOrders || []);
    } catch (err) {
      setError("Failed to load admin data");
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    setUpdatingOrderId(orderId);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error("Failed to update order");
      }

      // Refresh data
      await fetchAdminData();
    } catch (err) {
      setError("Failed to update order status");
    } finally {
      setUpdatingOrderId(null);
    }
  };

  if (status === "loading" || isLoading) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-emerald-700 mx-auto mb-4" />
          <p className="text-stone-600">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (session?.user?.role !== "admin") {
    return null;
  }

  return (
    <div className="min-h-screen pt-16 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-amber-600" />
              <h1 className="text-3xl font-bold text-stone-800">Admin Panel</h1>
            </div>
            <a
              href="/admin/usage"
              className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 hover:text-emerald-800 border border-emerald-200 rounded-md px-3 py-1.5 bg-emerald-50"
            >
              <Database className="w-4 h-4" /> Regrid &amp; Cache Usage
            </a>
          </div>
          <p className="text-stone-600">Terra Firma Partners LLC Dashboard</p>
        </motion.div>

        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Stats Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid md:grid-cols-4 gap-4 mb-8"
        >
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Users className="w-6 h-6 text-blue-700" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Total Users</p>
                  <p className="text-2xl font-bold text-stone-800">
                    {stats?.totalUsers || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-emerald-700" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Total Orders</p>
                  <p className="text-2xl font-bold text-stone-800">
                    {stats?.totalOrders || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-amber-700" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Completed</p>
                  <p className="text-2xl font-bold text-stone-800">
                    {stats?.completedOrders || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-green-700" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Revenue</p>
                  <p className="text-2xl font-bold text-stone-800">
                    ${(stats?.revenue || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Orders */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-700" />
                Recent Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentOrders.length === 0 ? (
                <p className="text-center text-stone-500 py-8">No orders yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-stone-200">
                        <th className="text-left py-3 px-4 text-sm font-medium text-stone-500">
                          Property
                        </th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-stone-500">
                          Customer
                        </th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-stone-500">
                          Status
                        </th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-stone-500">
                          Amount
                        </th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-stone-500">
                          Date
                        </th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-stone-500">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrders.map((order) => (
                        <tr
                          key={order.id}
                          className="border-b border-stone-100 hover:bg-stone-50"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-stone-400" />
                              <span className="text-sm text-stone-800 truncate max-w-[200px]">
                                {order.parcelAddress}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm text-stone-600">
                              {order.user?.name || order.guestEmail || "Guest"}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs px-2 py-1 rounded-full ${
                                order.status === "completed"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : order.status === "demo_checkout"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {order.status}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm font-medium text-stone-800">
                              ${order.price}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm text-stone-500">
                              {formatDate(order.createdAt)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {order.status === "pending" && (
                              <Button
                                onClick={() => updateOrderStatus(order.id, "paid")}
                                disabled={updatingOrderId === order.id}
                                size="sm"
                                className="bg-emerald-700 hover:bg-emerald-800 text-white"
                              >
                                {updatingOrderId === order.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <>
                                    <CheckCircle className="w-4 h-4 mr-1" />
                                    Mark Paid
                                  </>
                                )}
                              </Button>
                            )}
                            {order.status === "paid" && (
                              <span className="text-xs text-emerald-600">✓ Paid</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
