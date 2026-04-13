'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { MapPin, TreePine, Crosshair, Layers, ArrowRight, Share2, Loader2 } from 'lucide-react';

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
  const shareId = params?.shareId as string;
  const [territory, setTerritory] = useState<TerritoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const mapInitializedRef = useRef(false);

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

    // Check if Google Maps is already loaded
    if (typeof google !== 'undefined' && google.maps) {
      initMap();
      return;
    }

    // Load Google Maps script
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
      // Fallback
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
