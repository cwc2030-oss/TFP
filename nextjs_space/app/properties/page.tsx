"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  MapPin,
  Calendar,
  Trash2,
  Loader2,
  Lock,
  Unlock,
  ArrowRight,
  Trees,
  Mountain,
} from "lucide-react";

interface SavedParcel {
  id: string;
  name: string;
  type: string;
  totalAcres: number;
  centroidLat: number;
  centroidLng: number;
  terrainScore: number | null;
  primaryMovement: string | null;
  funnelCount: number | null;
  standCount: number | null;
  bedAcres: number | null;
  createdAt: string;
  updatedAt: string;
}

interface PurchaseInfo {
  [key: string]: boolean; // parcelId -> hasAccess
}

export default function PropertiesPage() {
  const router = useRouter();
  const { data: session, status } = useSession() || {};
  const [parcels, setParcels] = useState<SavedParcel[]>([]);
  const [purchases, setPurchases] = useState<PurchaseInfo>({});
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const isPro = (session?.user as any)?.subscriptionStatus === 'pro' || (session?.user as any)?.subscriptionStatus === 'promax';

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=%2Fproperties");
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetchParcels();
    }
  }, [session]);

  const fetchParcels = async () => {
    try {
      const res = await fetch("/api/properties/list");
      const data = await res.json();
      const props = data.properties || [];
      setParcels(props);

      // Check access for each parcel
      if (!isPro && props.length > 0) {
        const accessMap: PurchaseInfo = {};
        await Promise.all(
          props.map(async (p: SavedParcel) => {
            try {
              const r = await fetch(`/api/parcels/check-access?lat=${p.centroidLat}&lng=${p.centroidLng}`);
              const d = await r.json();
              accessMap[p.id] = d.hasAccess;
            } catch {
              accessMap[p.id] = false;
            }
          })
        );
        setPurchases(accessMap);
      }
    } catch (error) {
      console.error("Error fetching properties:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this parcel from your library?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/properties/delete?id=${id}`, { method: "DELETE" });
      setParcels((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error("Delete error:", e);
    } finally {
      setDeletingId(null);
    }
  };

  const openInAnalyzer = (p: SavedParcel) => {
    if (p.type === 'territory') {
      router.push(`/intel?savedPropertyId=${p.id}`);
    } else {
      // Piece 6c — carry the SavedProperty id so the read gate recognises the
      // owner's saved ground and lets them review it read-only after a lapse.
      router.push(`/intel?lat=${p.centroidLat}&lng=${p.centroidLng}&savedParcelId=${p.id}`);
    }
  };

  const hasAccess = (p: SavedParcel) => isPro || purchases[p.id];

  if (status === "loading" || isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0f0d] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f0d]">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0a0f0d]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Mountain className="h-5 w-5 text-amber-500" />
            <span className="text-white font-semibold text-sm tracking-wide">TERRA FIRMA</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/intel"
              className="text-xs text-white/60 hover:text-white transition px-3 py-1.5 rounded border border-white/10 hover:border-white/20"
            >
              Analyzer
            </Link>
            {isPro && (
              <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">
                PRO
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Title Section */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            Terrain Intelligence Library
          </h1>
          <p className="text-white/50 text-sm">
            Your saved parcels and hunt plans. Click any property to reopen in the analyzer.
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-2xl font-bold text-white">{parcels.length}</div>
            <div className="text-[11px] text-white/40 mt-0.5">Saved Parcels</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-2xl font-bold text-amber-400">
              {parcels.filter((p) => hasAccess(p)).length}
            </div>
            <div className="text-[11px] text-white/40 mt-0.5">Unlocked</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-2xl font-bold text-white">
              {parcels.reduce((sum, p) => sum + (p.totalAcres || 0), 0).toFixed(0)}
            </div>
            <div className="text-[11px] text-white/40 mt-0.5">Total Acres</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-2xl font-bold text-emerald-400">
              {parcels.filter((p) => (p.terrainScore || 0) >= 80).length}
            </div>
            <div className="text-[11px] text-white/40 mt-0.5">A-Grade Parcels</div>
          </div>
        </div>

        {/* Parcel Grid */}
        {parcels.length === 0 ? (
          <div className="text-center py-16">
            <Trees className="h-12 w-12 text-white/20 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white/60 mb-2">No saved parcels yet</h3>
            <p className="text-sm text-white/40 mb-6 max-w-md mx-auto">
              Open the Terrain Analyzer to explore a property, then save it to your library.
            </p>
            <Link
              href="/intel"
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
            >
              Open Analyzer <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {parcels.map((p) => {
              const unlocked = hasAccess(p);
              const score = p.terrainScore || 0;
              const grade =
                score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B+" : score >= 60 ? "B" : score >= 50 ? "C" : "D";
              const gradeColor =
                score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-red-400";

              return (
                <div
                  key={p.id}
                  className="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-amber-500/30 rounded-xl overflow-hidden transition-all cursor-pointer"
                  onClick={() => openInAnalyzer(p)}
                >
                  {/* Score Badge */}
                  <div className="flex items-start justify-between p-4 pb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate">{p.name}</h3>
                      <div className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3 text-white/30" />
                        <span className="text-[11px] text-white/40 truncate">
                          {p.totalAcres?.toFixed(0)} acres
                        </span>
                      </div>
                    </div>
                    {score > 0 && (
                      <div className="flex flex-col items-center ml-2">
                        <span className={`text-2xl font-bold ${gradeColor}`}>{grade}</span>
                        <span className="text-[10px] text-white/30">{score}</span>
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="px-4 pb-2">
                    <div className="flex gap-3 text-[11px] text-white/40">
                      {p.standCount != null && p.standCount > 0 && (
                        <span>🎯 {p.standCount} stands</span>
                      )}
                      {p.funnelCount != null && p.funnelCount > 0 && (
                        <span>🫎 {p.funnelCount} funnels</span>
                      )}
                      {p.bedAcres != null && p.bedAcres > 0 && (
                        <span>🌿 {p.bedAcres.toFixed(1)}ac bedding</span>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {unlocked ? (
                        <Unlock className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Lock className="h-3 w-3 text-amber-500" />
                      )}
                      <span className={`text-[10px] font-medium ${unlocked ? 'text-emerald-400' : 'text-amber-500'}`}>
                        {unlocked ? 'UNLOCKED' : '$19 to unlock'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/30 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p.id);
                        }}
                        className="text-white/20 hover:text-red-400 transition p-1"
                        title="Remove from library"
                      >
                        {deletingId === p.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom CTA */}
        {!isPro && parcels.length > 0 && (
          <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-center">
            <p className="text-sm text-amber-300 font-medium mb-1">Upgrade to Pro — $99/yr</p>
            <p className="text-xs text-white/40 mb-3">Unlimited parcel access, territory builder, PDF reports & more</p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition"
            >
              View Plans <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
