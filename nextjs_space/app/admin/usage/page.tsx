"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Database,
  TrendingDown,
  DollarSign,
  Percent,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface CacheBlock {
  regridCallsMade: number;
  regridCallsSaved: number;
  totalCacheHits: number;
  totalLookups: number;
  hitRate: number;
  costPerCall: number;
  estimatedDollarsSaved: number;
  hitsByTag: { tag: string; count: number }[];
  hitsByDate: { date: string; count: number }[];
}

interface UsageData {
  period: { startDate: string; endDate: string; days: number };
  grandTotal: number;
  tagTotals: { tag: string; count: number }[];
  dailyTotals: { date: string; total: number; breakdown: Record<string, number> }[];
  cache: CacheBlock;
}

export default function AdminUsagePage() {
  const router = useRouter();
  const { data: session, status } = useSession() || {};
  const [data, setData] = useState<UsageData | null>(null);
  const [days, setDays] = useState(30);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [purging, setPurging] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (session?.user?.role !== "admin" && status === "authenticated") {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  const fetchData = async (d: number) => {
    setIsLoading(true);
    setError("");
    try {
      const resp = await fetch(`/api/admin/regrid-usage?days=${d}`);
      if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
      const json = await resp.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || "Failed to load usage");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user?.role === "admin") fetchData(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, days]);

  const handlePurge = async (scope: string) => {
    if (!confirm(`Purge the "${scope}" cache? This forces fresh lookups until the cache re-warms.`)) return;
    setPurging(scope);
    try {
      const resp = await fetch("/api/admin/cache-purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Purge failed");
      alert(`Purged: ${JSON.stringify(json.deleted)}`);
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setPurging(null);
    }
  };

  if (status === "loading" || (isLoading && !data)) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (session?.user?.role !== "admin") return null;

  const cache = data?.cache;

  return (
    <div className="min-h-screen bg-stone-50 py-10 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
              <Database className="w-6 h-6 text-emerald-600" /> Regrid & Cache Usage
            </h1>
            <p className="text-stone-500 text-sm mt-1">
              {data?.period.startDate} → {data?.period.endDate} ({data?.period.days} days)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              className="border border-stone-300 rounded-md px-3 py-1.5 text-sm bg-white text-stone-800"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => fetchData(days)} className="text-stone-700">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 mb-4 text-sm">{error}</div>
        )}

        {/* Headline metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-stone-500 flex items-center gap-1">
                <Percent className="w-3.5 h-3.5" /> Cache Hit Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-600">{cache?.hitRate ?? 0}%</div>
              <p className="text-xs text-stone-400 mt-1">of parcel lookups served from cache</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-stone-500 flex items-center gap-1">
                <TrendingDown className="w-3.5 h-3.5" /> Regrid Calls Made
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-stone-900">{cache?.regridCallsMade?.toLocaleString() ?? 0}</div>
              <p className="text-xs text-stone-400 mt-1">billable API calls in period</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-stone-500 flex items-center gap-1">
                <Database className="w-3.5 h-3.5" /> Calls Saved
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-600">{cache?.regridCallsSaved?.toLocaleString() ?? 0}</div>
              <p className="text-xs text-stone-400 mt-1">served from cache (0 Regrid calls)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-stone-500 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5" /> Est. Saved
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-600">${cache?.estimatedDollarsSaved?.toFixed(2) ?? "0.00"}</div>
              <p className="text-xs text-stone-400 mt-1">est. @ ${cache?.costPerCall?.toFixed(3)}/call</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Regrid calls by endpoint */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-stone-800">Regrid Calls by Endpoint</CardTitle>
            </CardHeader>
            <CardContent>
              {data && data.tagTotals.length > 0 ? (
                <div className="space-y-2">
                  {data.tagTotals.map((t) => (
                    <div key={t.tag} className="flex justify-between text-sm">
                      <span className="text-stone-600 font-mono">{t.tag}</span>
                      <span className="font-semibold text-stone-900">{t.count.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="border-t border-stone-200 pt-2 flex justify-between text-sm font-bold">
                    <span className="text-stone-700">Total</span>
                    <span className="text-stone-900">{data.grandTotal.toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-stone-400">No Regrid calls in this period.</p>
              )}
            </CardContent>
          </Card>

          {/* Cache hits by type */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-stone-800">Cache Hits by Type</CardTitle>
            </CardHeader>
            <CardContent>
              {cache && cache.hitsByTag.length > 0 ? (
                <div className="space-y-2">
                  {cache.hitsByTag.map((t) => (
                    <div key={t.tag} className="flex justify-between text-sm">
                      <span className="text-stone-600 font-mono">{t.tag}</span>
                      <span className="font-semibold text-emerald-700">{t.count.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="border-t border-stone-200 pt-2 flex justify-between text-sm font-bold">
                    <span className="text-stone-700">Total hits</span>
                    <span className="text-emerald-700">{cache.totalCacheHits.toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-stone-400">No cache hits recorded yet. Metrics accumulate as traffic hits warm caches.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Manual purge */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-stone-800 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-500" /> Manual Cache Purge
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-stone-500 mb-3">
              Caches are long-lived because parcel geometry is static and terrain is version-keyed.
              Use these only to force a fresh pull for a scope. Terrain normally auto-busts on an engine version bump.
            </p>
            <div className="flex flex-wrap gap-2">
              {["parcel", "neighbor", "adjacent", "terrain", "all"].map((scope) => (
                <Button
                  key={scope}
                  variant="outline"
                  size="sm"
                  disabled={purging !== null}
                  onClick={() => handlePurge(scope)}
                  className="text-stone-700 border-stone-300"
                >
                  {purging === scope ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                  )}
                  {scope}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
