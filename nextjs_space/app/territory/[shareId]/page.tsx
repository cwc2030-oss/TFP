'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { MapPin, TreePine, ArrowRight, Share2, Loader2, ExternalLink, Star, Mountain, Route, GitMerge } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { BackboneState } from '@/lib/listing-backbone';

export const dynamic = 'force-dynamic';

interface ParcelData {
  address: string;
  acres: number;
  geometry: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
}

interface TerritoryData {
  name: string;
  type: string;
  parcels: ParcelData[];
  totalAcres: number;
  centroidLat: number;
  centroidLng: number;
  terrainScore: number | null;
  primaryMovement: string | null;
  funnelCount: number | null;
  standCount: number | null;
  bedAcres: number | null;
  // Real 3-state backbone verdict (same source as the map + Hunt Report)
  backboneState: BackboneState | null;
  backboneRank: number | null;
  ridgeSpineCount: number | null;
  saddleCrossings: number | null;
  convergenceZoneCount: number | null;
  sharedBy: string;
  createdAt: string;
}

export default function SharedTerritoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
      </div>
    }>
      <SharedTerritoryContent />
    </Suspense>
  );
}

function SharedTerritoryContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status } = useSession() || {};
  const shareId = params?.shareId as string;
  const autoClaim = searchParams?.get('claim') === 'true';

  const [territory, setTerritory] = useState<TerritoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const mapInitializedRef = useRef(false);
  const autoClaimFired = useRef(false);

  useEffect(() => {
    if (!shareId) return;
    fetch(`/api/territory/${shareId}`)
      .then(r => {
        if (!r.ok) throw new Error('Territory not found');
        return r.json();
      })
      .then(data => { setTerritory(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [shareId]);

  // Auto-claim after signin redirect
  useEffect(() => {
    if (autoClaim && session?.user && territory && !autoClaimFired.current && !claimed) {
      autoClaimFired.current = true;
      handleClaim();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoClaim, session, territory, claimed]);

  // Initialize Mapbox map
  useEffect(() => {
    if (!territory || !mapRef.current || mapInitializedRef.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    mapInitializedRef.current = true;
    (mapboxgl as any).accessToken = token;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: mapRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [territory.centroidLng, territory.centroidLat],
        zoom: 14,
        attributionControl: false,
      });
    } catch (err) {
      console.error('[Territory] Map init failed:', err);
      mapInitializedRef.current = false;
      return;
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    mapInstanceRef.current = map;

    map.on('load', () => {
      try {
        const bounds = new mapboxgl.LngLatBounds();
        const features: GeoJSON.Feature[] = [];

        territory.parcels.forEach((parcel, idx) => {
          const geo = parcel.geometry;
          // Handle both Feature and raw Geometry formats
          const geom = geo?.geometry ?? geo;
          const coords = geom?.coordinates;
          if (!coords) return;

          const geoType = geom?.type;
          const rings: number[][][] = geoType === 'MultiPolygon'
            ? (coords as number[][][][]).flatMap(p => p)
            : coords as number[][][];

          rings.forEach(ring => {
            if (!Array.isArray(ring)) return;
            ring.forEach(pt => {
              if (!Array.isArray(pt) || pt.length < 2) return;
              bounds.extend([pt[0], pt[1]] as [number, number]);
            });
          });

          features.push({
            type: 'Feature',
            properties: { idx, color: idx === 0 ? '#22c55e' : '#60a5fa' },
            geometry: (geo?.geometry ?? geo) as GeoJSON.Geometry
          });
        });

        map.addSource('territory-parcels', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });

        map.addLayer({
          id: 'territory-fill',
          type: 'fill',
          source: 'territory-parcels',
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.25
          }
        });

        map.addLayer({
          id: 'territory-line',
          type: 'line',
          source: 'territory-parcels',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2
          }
        });

        if (bounds.getNorthEast() && bounds.getSouthWest()) {
          map.fitBounds(bounds, { padding: 60, maxZoom: 16 });
        }
      } catch (err) {
        console.error('[Territory] Map layer setup error:', err);
      }
    });

    return () => { try { map.remove(); } catch {} };
  }, [territory]);

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/territory/${shareId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  async function handleClaim() {
    if (!session?.user) {
      // Redirect to signin with callback back here with ?claim=true
      router.push(`/login?callbackUrl=${encodeURIComponent(`/territory/${shareId}?claim=true`)}`);
      return;
    }

    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch('/api/territory/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId })
      });
      if (!res.ok) {
        const data = await res.json();
        setClaimError(data.error || 'Failed to save territory');
        return;
      }
      setClaimed(true);
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (e) {
      setClaimError('Network error — please try again');
    } finally {
      setClaiming(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-green-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading shared territory…</p>
        </div>
      </div>
    );
  }

  if (error || !territory) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center max-w-md">
          <MapPin className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Territory Not Found</h2>
          <p className="text-gray-400 mb-6">This share link is invalid or the territory is no longer shared.</p>
          <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold transition-colors">
            Go to Terra Firma <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  const onxUrl = `https://app.onxmaps.com/hunt/map/14/${territory.centroidLat}/${territory.centroidLng}`;

  // Real 3-state backbone verdict (same read the map + Hunt Report use).
  const bbState = territory.backboneState;
  const verdict = bbState
    ? {
        confirmed: {
          label: 'Confirmed Backbone',
          headline: 'Real terrain backbone confirmed',
          sub: 'Ridge structure, saddle crossings and convergence detected — terrain-driven movement.',
          accent: 'text-emerald-400',
          ring: 'border-emerald-700/50 bg-emerald-950/30',
        },
        marginal: {
          label: 'Marginal Backbone',
          headline: 'Some structure, not a full backbone',
          sub: 'A modest spine reads here, but the terrain does not fully commit deer to it.',
          accent: 'text-amber-400',
          ring: 'border-amber-700/50 bg-amber-950/30',
        },
        flat: {
          label: 'Flat / Low-Relief',
          headline: 'No confirmed terrain backbone',
          sub: 'Gentle, low-relief ground — movement here is dispersed, not funneled. Read the food, cover and sign.',
          accent: 'text-stone-300',
          ring: 'border-stone-700/50 bg-stone-900/40',
        },
      }[bbState]
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-green-400 hover:text-green-300 transition-colors">
            <TreePine className="w-5 h-5" />
            <span className="font-bold text-sm tracking-wide">TERRA FIRMA PARTNERS</span>
          </Link>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
          >
            <Share2 className="w-4 h-4" />
            {copied ? '✅ Copied!' : 'Copy Link'}
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-2">
          <h1 className="text-3xl font-bold">{territory.name}</h1>
          <span className="text-sm text-gray-500 pb-0.5">
            Shared by {territory.sharedBy}
          </span>
        </div>
        <p className="text-gray-400 text-sm">
          {territory.parcels.length} parcel{territory.parcels.length !== 1 ? 's' : ''} · {territory.totalAcres.toFixed(1)} acres
        </p>
      </div>

      {/* Map */}
      <div className="max-w-6xl mx-auto px-4 pb-8">
        <div
          ref={mapRef}
          className="w-full rounded-xl overflow-hidden border border-gray-800"
          style={{ height: 420 }}
        />
      </div>

      {/* Terrain Backbone verdict — the real 3-state read (map + report source) */}
      {verdict && (
        <div className="max-w-6xl mx-auto px-4 pb-8">
          <div className={`rounded-xl border p-5 ${verdict.ring}`}>
            <div className="flex items-center gap-2 mb-1">
              <Mountain className={`w-5 h-5 ${verdict.accent}`} />
              <span className={`text-sm font-bold tracking-wide uppercase ${verdict.accent}`}>
                {verdict.label}
              </span>
            </div>
            <p className="text-lg font-semibold text-white">{verdict.headline}</p>
            <p className="text-sm text-gray-400 mt-1 max-w-2xl">{verdict.sub}</p>

            {bbState !== 'flat' && (
              <div className="grid grid-cols-3 gap-3 mt-4">
                <StatCard
                  icon={<Mountain className="w-5 h-5" />}
                  label="Ridge Spines"
                  value={territory.ridgeSpineCount ?? 0}
                />
                <StatCard
                  icon={<Route className="w-5 h-5" />}
                  label="Saddle Crossings"
                  value={territory.saddleCrossings ?? 0}
                />
                <StatCard
                  icon={<GitMerge className="w-5 h-5" />}
                  label="Convergence Zones"
                  value={territory.convergenceZoneCount ?? 0}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Parcel list */}
      <div className="max-w-6xl mx-auto px-4 pb-8">
        <h2 className="text-lg font-semibold mb-4">Parcels in Territory</h2>
        <div className="space-y-3">
          {territory.parcels.map((p, i) => (
            <div key={i} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
              <div>
                <p className="font-medium text-sm">{p.address || `Parcel ${i + 1}`}</p>
                <p className="text-xs text-gray-500">{p.acres.toFixed(1)} acres</p>
              </div>
              <span className="text-xs text-gray-600">#{i + 1}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons: Claim (primary) → Pro Nudge → onX (quiet secondary) */}
      <div className="max-w-6xl mx-auto px-4 pb-8">
        <div className="flex flex-col gap-3 max-w-md mx-auto">

          {/* Primary — Claim (amber) */}
          {!claimed ? (
            <div>
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="flex items-center justify-center gap-2.5 w-full px-5 py-3 rounded-xl
                           font-semibold text-white transition-all duration-200
                           bg-amber-600 hover:bg-amber-500 disabled:opacity-60 disabled:cursor-wait
                           shadow-lg shadow-amber-900/20 hover:shadow-amber-900/40"
              >
                {claiming ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Star className="w-5 h-5 fill-current" />
                )}
                <span>{claiming ? 'Saving…' : '⭐ Save to My TerraFirma Account'}</span>
              </button>
              {!session?.user && status !== 'loading' && (
                <p className="text-center text-xs text-gray-500 mt-2">
                  Free account required — 30 seconds
                </p>
              )}
              {claimError && (
                <p className="text-center text-xs text-red-400 mt-2">{claimError}</p>
              )}
            </div>
          ) : (
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl
                              bg-green-700 text-white font-semibold">
                ✅ Saved! Taking you to My Properties...
              </div>
              {/* Button 3 — Pro nudge (green, after success) */}
              <div className="mt-4 bg-gradient-to-r from-green-900/50 to-emerald-900/40 border border-green-700/40 rounded-xl p-4">
                <p className="text-sm text-green-300 font-medium mb-2.5">Pro members save unlimited territories</p>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold text-sm transition-colors"
                >
                  Upgrade to Pro <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}

          {/* Secondary (quiet) — open the same coordinates in onX. This leaves TerraFirma
              and carries none of our terrain read, so it stays a low-emphasis text link. */}
          <a
            href={onxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg
                       text-sm font-medium text-gray-400 hover:text-gray-200
                       border border-gray-800 hover:border-gray-700 bg-transparent transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/onx-icon.png" alt="" className="h-4 w-4 rounded-sm opacity-80" />
            <span>View location in onX</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-60" />
          </a>
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <div className="bg-gradient-to-r from-green-900/40 to-emerald-900/30 border border-green-800/50 rounded-xl p-6 text-center">
          <h3 className="text-xl font-bold mb-2">Run Your Own Terrain Analysis</h3>
          <p className="text-gray-400 text-sm mb-5">Get deer movement corridors, funnel zones, and the four measured terrain drivers for any property.</p>
          <Link
            href={(() => {
              // Build territory-mode URL if multiple parcels
              if (territory.type === 'territory' && territory.parcels.length >= 2) {
                const params = new URLSearchParams({
                  territory: 'true',
                  name: territory.name,
                });
                territory.parcels.slice(0, 5).forEach((p, i) => {
                  // Use geometry centroid or stored lat/lng for each parcel
                  const geo = p.geometry?.geometry ?? p.geometry;
                  const coords = geo?.coordinates;
                  if (coords) {
                    const gType = geo?.type;
                    const ring = gType === 'MultiPolygon' ? (coords as number[][][][])[0]?.[0] : (coords as number[][][])?.[0];
                    if (ring && ring.length > 0) {
                      const lats = ring.map((c: number[]) => c[1]);
                      const lngs = ring.map((c: number[]) => c[0]);
                      const cLat = lats.reduce((a: number, b: number) => a + b, 0) / lats.length;
                      const cLng = lngs.reduce((a: number, b: number) => a + b, 0) / lngs.length;
                      params.set(`p${i + 1}lat`, cLat.toFixed(6));
                      params.set(`p${i + 1}lng`, cLng.toFixed(6));
                    }
                  }
                });
                return `/intel?${params.toString()}`;
              }
              // Single parcel — use simple lat/lng
              return `/intel?lat=${territory.centroidLat}&lng=${territory.centroidLng}&address=${encodeURIComponent(territory.parcels[0]?.address || territory.name)}`;
            })()}
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold transition-colors"
          >
            Open in Terrain Analyzer <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-500 mb-2">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
