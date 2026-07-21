"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Shield, Loader2, CheckCircle, XCircle, ArrowLeft, Clock } from "lucide-react";

type Owner = { name: string | null; email: string | null };
type Row = {
  id: string;
  title: string | null;
  status: string;
  state: string | null;
  county: string | null;
  acres: number | null;
  askingPriceMin: number | null;
  askingPriceMax: number | null;
  leaseType: string | null;
  description: string | null;
  photos: string[];
  createdAt: string;
  publishedAt: string | null;
  owner: Owner;
};

function fmtTitle(r: Row) {
  if (r.title && r.title.trim()) return r.title;
  return `${r.acres ? Math.round(r.acres) : "?"} ac in ${r.county ?? "?"}, ${r.state ?? "?"}`;
}

export default function AdminListingsPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Row[]>([]);
  const [published, setPublished] = useState<Row[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/listings");
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setPending(data.pending ?? []);
      setPublished(data.published ?? []);
    } catch {
      setError("Failed to load the review queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    } else if (session?.user?.role !== "admin" && status === "authenticated") {
      router.push("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    if (session?.user?.role === "admin") load();
  }, [session, load]);

  async function moderate(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/listings/${id}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "action failed");
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600 mx-auto mb-3" />
          <p className="text-stone-600">Loading review queue...</p>
        </div>
      </div>
    );
  }

  if (session?.user?.role !== "admin") return null;

  const Card = ({ r, mode }: { r: Row; mode: "pending" | "published" }) => (
    <div className="bg-white border border-stone-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold text-stone-800 truncate">{fmtTitle(r)}</div>
          <div className="text-sm text-stone-500 mt-0.5">
            {r.county ?? "?"} County, {r.state ?? "?"} · {r.acres ? Math.round(r.acres) : "?"} ac · ${r.askingPriceMin ?? "?"}–{r.askingPriceMax ?? "?"} {r.leaseType ?? ""}
          </div>
          <div className="text-xs text-stone-400 mt-1">
            {r.owner?.name || r.owner?.email || "unknown owner"} · submitted {new Date(r.createdAt).toLocaleDateString("en-US", { timeZone: "UTC" })}
          </div>
          {r.description && (
            <p className="text-sm text-stone-600 mt-2 line-clamp-2">{r.description}</p>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {mode === "pending" && (
            <button
              onClick={() => moderate(r.id, "approve")}
              disabled={busyId === r.id}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md px-3 py-1.5"
            >
              {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Approve
            </button>
          )}
          <button
            onClick={() => moderate(r.id, "reject")}
            disabled={busyId === r.id}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-md px-3 py-1.5"
          >
            {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} {mode === "pending" ? "Reject" : "Pull down"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pt-16 bg-stone-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <a href="/admin" className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-700 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Admin
        </a>
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-8 h-8 text-amber-600" />
          <h1 className="text-3xl font-bold text-stone-800">Listing Review</h1>
        </div>
        <p className="text-stone-600 mb-8">
          New listings land here as <span className="font-medium">Pending Review</span> and only reach the public marketplace after you approve them.
        </p>

        {error && <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6">{error}</div>}

        <section className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-stone-800">Pending Review ({pending.length})</h2>
          </div>
          {pending.length === 0 ? (
            <div className="text-stone-500 text-sm bg-white border border-dashed border-stone-200 rounded-lg p-6 text-center">
              Nothing waiting for review. New submissions will appear here.
            </div>
          ) : (
            <div className="space-y-3">{pending.map((r) => <Card key={r.id} r={r} mode="pending" />)}</div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-stone-800">Live on Marketplace ({published.length})</h2>
          </div>
          {published.length === 0 ? (
            <div className="text-stone-500 text-sm bg-white border border-dashed border-stone-200 rounded-lg p-6 text-center">
              No published listings.
            </div>
          ) : (
            <div className="space-y-3">{published.map((r) => <Card key={r.id} r={r} mode="published" />)}</div>
          )}
        </section>
      </div>
    </div>
  );
}
