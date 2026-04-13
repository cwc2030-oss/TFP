'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { MapPin, TreePine, Crosshair, Layers, ArrowRight, Share2, Loader2, ExternalLink, Star } from 'lucide-react';

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
  sharedBy: string;
  createdAt: string;
}

export default function SharedTerritoryPage() {
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
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
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

  const initMap = useCallback(() => {
    if (!territory || !mapRef.current || mapInitializedRef.current) return;
    if (typeof google === 'undefined' || !google.maps) return;
    mapInitializedRef.current = true;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: territory.centroidLat, lng: territory.centroidLng },
      zoom: 14,
      mapTypeId: 'hybrid',
      disableDefaultUI: true,
      zoomControl: true,
    });
    mapInstanceRef.current = map;

    const bounds = new google.maps.LatLngBounds();
    territory.parcels.forEach((parcel, idx) => {
      const geo = parcel.geometry;
      const coords = geo?.geometry?.coordinates;
      if (!coords) return;

      const geoType = geo?.geometry?.type;
      const rings: number[][][] = geoType === 'MultiPolygon'
        ? (coords as number[][][][]).flatMap(p => p)
        : coords as number[][][];

      const paths = rings.map(ring =>
        ring.map(([lng, lat]) => {
          const ll = new google.maps.LatLng(lat, lng);
          bounds.extend(ll);
          return ll;
        })
      );

      new google.maps.Polygon({
        map,
        paths,
        strokeColor: idx === 0 ? '#22c55e' : '#60a5fa',
        strokeWeight: 2,
        fillColor: idx === 0 ? '#22c55e' : '#60a5fa',
        fillOpacity: 0.25,
      });
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 60);
    }
  }, [territory]);

  useEffect(() => {
    if (!territory) return;

    if (typeof google !== 'undefined' && google.maps) {
      initMap();
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', initMap);
      return;
    }

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = initMap;
    document.head.appendChild(script);
  }, [territory, initMap]);

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

  const scoreColor = (territory.terrainScore ?? 0) >= 80 ? 'text-green-400' :
    (territory.terrainScore ?? 0) >= 60 ? 'text-yellow-400' : 'text-red-400';

  const onxUrl = `https://app.onxmaps.com/hunt/map/14/${territory.centroidLat}/${territory.centroidLng}`;

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

      {/* Stats */}
      {territory.terrainScore !== null && (
        <div className="max-w-6xl mx-auto px-4 pb-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              icon={<Crosshair className="w-5 h-5" />}
              label="Terrain Score"
              value={<span className={scoreColor}>{territory.terrainScore}/100</span>}
            />
            <StatCard
              icon={<Layers className="w-5 h-5" />}
              label="Funnels"
              value={territory.funnelCount ?? '—'}
            />
            <StatCard
              icon={<MapPin className="w-5 h-5" />}
              label="Intercept Sites"
              value={territory.standCount ?? '—'}
            />
            <StatCard
              icon={<TreePine className="w-5 h-5" />}
              label="Bedding Acres"
              value={territory.bedAcres != null ? territory.bedAcres.toFixed(1) : '—'}
            />
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

      {/* Action Buttons: onX → Claim → Pro Nudge */}
      <div className="max-w-6xl mx-auto px-4 pb-8">
        <div className="flex flex-col gap-3 max-w-md mx-auto">

          {/* Button 1 — onX (orange) */}
          <a
            href={onxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2.5 w-full px-5 py-3 rounded-xl
                       font-semibold text-white transition-all duration-200
                       shadow-lg shadow-orange-900/20 hover:shadow-orange-900/40"
            style={{ backgroundColor: '#FF6B00' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#e05f00')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#FF6B00')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/onx-icon.png" alt="" className="h-5 w-5 rounded-sm" />
            <span>Open Territory in onX Hunt</span>
            <ExternalLink className="w-4 h-4 opacity-70" />
          </a>

          {/* Button 2 — Claim (amber) */}
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
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <div className="bg-gradient-to-r from-green-900/40 to-emerald-900/30 border border-green-800/50 rounded-xl p-6 text-center">
          <h3 className="text-xl font-bold mb-2">Run Your Own Terrain Analysis</h3>
          <p className="text-gray-400 text-sm mb-5">Get deer movement corridors, intercept placements, and wind strategy for any property.</p>
          <Link
            href={`/intel?lat=${territory.centroidLat}&lng=${territory.centroidLng}&address=${encodeURIComponent(territory.parcels[0]?.address || territory.name)}`}
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
