'use client';

/**
 * DeerFlowPreview — Signed-in tier Deer Flow map for /listings/[slug].
 *
 * Renders the saved terrainFlowData (green/blue/black runs + convergence)
 * over the parcel boundary.  Flow + grade only — NO stand pins, no precise
 * stand intel.
 *
 * Data is fetched client-side from /api/listings/[id]/flow (auth-gated).
 * Anonymous users see a sign-in CTA instead.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession, signIn } from 'next-auth/react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  mergeAndClassifyFlows,
  countByTier,
  FLOW_TIER_COLORS,
} from '@/lib/flow-tiering';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface FlowSnapshot {
  v: number;
  centroid: { lat: number; lng: number };
  parcelBounds: GeoJSON.Geometry;
  flowPrimary: GeoJSON.FeatureCollection | null;
  flowSecondary: GeoJSON.FeatureCollection | null;
  convergenceZones: GeoJSON.FeatureCollection | null;
  flowMode: string | null;
  demSource: string | null;
}

interface Props {
  listingId: string;
  grade: string;
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export default function DeerFlowPreview({ listingId, grade }: Props) {
  const { data: session, status } = useSession() || {};
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [flowData, setFlowData] = useState<FlowSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch flow data when authenticated
  const fetchFlow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/flow`);
      if (res.status === 401) {
        setError('sign-in-required');
        return;
      }
      if (!res.ok) {
        setError('Flow data not available');
        return;
      }
      const json = await res.json();
      setFlowData(json.flow as FlowSnapshot);
    } catch {
      setError('Failed to load Deer Flow data');
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchFlow();
    }
  }, [status, fetchFlow]);

  // Initialize Mapbox when flow data arrives
  useEffect(() => {
    if (!flowData || !mapContainer.current || !MAPBOX_TOKEN) return;
    if (mapRef.current) return; // already initialized

    mapboxgl.accessToken = MAPBOX_TOKEN;

    // Compute bounds from parcel geometry
    const bounds = new mapboxgl.LngLatBounds();
    const addCoords = (coords: any) => {
      if (typeof coords[0] === 'number') {
        bounds.extend(coords as [number, number]);
        return;
      }
      for (const c of coords) addCoords(c);
    };
    addCoords((flowData.parcelBounds as any).coordinates);

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [flowData.centroid.lng, flowData.centroid.lat],
      zoom: 14,
      attributionControl: false,
    });
    map.fitBounds(bounds, { padding: 60 });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // Parcel boundary
      map.addSource('listing-parcel', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: flowData.parcelBounds,
          properties: {},
        },
      });
      map.addLayer({
        id: 'listing-parcel-fill',
        type: 'fill',
        source: 'listing-parcel',
        paint: {
          'fill-color': '#c9a84c',
          'fill-opacity': 0.08,
        },
      });
      map.addLayer({
        id: 'listing-parcel-outline',
        type: 'line',
        source: 'listing-parcel',
        paint: {
          'line-color': '#c9a84c',
          'line-width': 2,
          'line-opacity': 0.7,
        },
      });

      // Merge & classify flow tiers
      const tiered = mergeAndClassifyFlows(
        flowData.flowPrimary,
        flowData.flowSecondary,
      );

      // Flow tiers source
      map.addSource('listing-flow-tiers', {
        type: 'geojson',
        data: tiered,
      });

      // Glow layer
      map.addLayer({
        id: 'listing-flow-glow',
        type: 'line',
        source: 'listing-flow-tiers',
        paint: {
          'line-color': [
            'match', ['get', 'flowTier'],
            'green', FLOW_TIER_COLORS.greenGlow,
            'blue', FLOW_TIER_COLORS.blueGlow,
            FLOW_TIER_COLORS.blackGlow,
          ],
          'line-width': 8,
          'line-blur': 6,
          'line-opacity': 0.3,
        },
      });

      // Black tier (dashed)
      map.addLayer({
        id: 'listing-flow-black',
        type: 'line',
        source: 'listing-flow-tiers',
        filter: ['==', ['get', 'flowTier'], 'black'],
        paint: {
          'line-color': FLOW_TIER_COLORS.black,
          'line-width': 2,
          'line-opacity': 0.7,
          'line-dasharray': [8, 4],
        },
      });

      // Blue tier (solid)
      map.addLayer({
        id: 'listing-flow-blue',
        type: 'line',
        source: 'listing-flow-tiers',
        filter: ['==', ['get', 'flowTier'], 'blue'],
        paint: {
          'line-color': FLOW_TIER_COLORS.blue,
          'line-width': 2.5,
          'line-opacity': 0.8,
        },
      });

      // Green tier (solid, widest)
      map.addLayer({
        id: 'listing-flow-green',
        type: 'line',
        source: 'listing-flow-tiers',
        filter: ['==', ['get', 'flowTier'], 'green'],
        paint: {
          'line-color': FLOW_TIER_COLORS.green,
          'line-width': 3,
          'line-opacity': 0.9,
        },
      });

      // Convergence zones
      if (flowData.convergenceZones?.features?.length) {
        map.addSource('listing-convergence', {
          type: 'geojson',
          data: flowData.convergenceZones,
        });
        map.addLayer({
          id: 'listing-convergence-pulse',
          type: 'circle',
          source: 'listing-convergence',
          paint: {
            'circle-radius': 12,
            'circle-color': '#c9a84c',
            'circle-opacity': 0.25,
            'circle-blur': 0.6,
          },
        });
        map.addLayer({
          id: 'listing-convergence-core',
          type: 'circle',
          source: 'listing-convergence',
          paint: {
            'circle-radius': 5,
            'circle-color': '#c9a84c',
            'circle-opacity': 0.85,
            'circle-stroke-color': '#1a1a1a',
            'circle-stroke-width': 1,
          },
        });
      }
    });

    mapRef.current = map;

    return () => {
      try { map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
    };
  }, [flowData]);

  // --- Render states ---

  // Not authenticated: sign-in gate
  if (status === 'unauthenticated') {
    return (
      <section className="rounded-2xl border border-emerald-800/60 bg-gradient-to-br from-stone-900 via-emerald-950/30 to-stone-900 p-6 sm:p-8 mb-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-900/60 border border-emerald-700/50 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-emerald-400">
              <path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-stone-100 mb-2">
            Unlock the Deer Flow Map
          </h3>
          <p className="text-stone-400 text-sm max-w-md mb-5 leading-relaxed">
            Sign in to reveal the AI-analyzed deer movement corridors for this
            property — green, blue, and black runs mapped from real terrain data.
            {grade && grade !== '—' && (
              <span className="block mt-1 text-emerald-400 font-medium">
                This Grade {grade} property has verified flow data.
              </span>
            )}
          </p>
          <button
            onClick={() => signIn(undefined, { callbackUrl: window.location.href })}
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            Sign in to view Deer Flow
          </button>
          <p className="text-stone-600 text-xs mt-3">
            Free — no payment required to view flow data.
          </p>
        </div>
      </section>
    );
  }

  // Loading session
  if (status === 'loading') {
    return (
      <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-6 mb-8">
        <div className="animate-pulse flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-stone-700" />
          <div className="h-4 bg-stone-700 rounded w-48" />
        </div>
      </section>
    );
  }

  // Authenticated but loading flow
  if (loading) {
    return (
      <section className="rounded-2xl border border-emerald-800/40 bg-gradient-to-br from-stone-900 via-emerald-950/20 to-stone-900 p-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-stone-300 text-sm">Loading Deer Flow map…</span>
        </div>
      </section>
    );
  }

  // Error or no data
  if (error || !flowData) {
    if (error === 'sign-in-required') {
      // Shouldn't happen since we checked session, but fallback
      return null;
    }
    return (
      <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-6 mb-8">
        <p className="text-stone-500 text-sm">
          {error || 'Deer Flow data is not yet available for this listing.'}
        </p>
      </section>
    );
  }

  // Flow data loaded — render map
  const tiered = mergeAndClassifyFlows(flowData.flowPrimary, flowData.flowSecondary);
  const counts = countByTier(tiered);

  return (
    <section className="rounded-2xl border border-emerald-800/60 bg-gradient-to-br from-stone-900 via-emerald-950/20 to-stone-900 overflow-hidden mb-8">
      {/* Header */}
      <div className="px-6 py-4 border-b border-emerald-900/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-900/60 border border-emerald-700/50 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-emerald-400">
                <path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <div>
              <h3 className="text-stone-100 font-semibold text-sm">Deer Flow Map</h3>
              <p className="text-stone-500 text-xs">AI-analyzed movement corridors</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {counts.green > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(45,106,79,0.3)', color: '#6FCF97' }}>
                {counts.green} green
              </span>
            )}
            {counts.blue > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(59,111,160,0.3)', color: '#7FB5E0' }}>
                {counts.blue} blue
              </span>
            )}
            {counts.black > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-stone-800 text-stone-400">
                {counts.black} black
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Map container */}
      <div
        ref={mapContainer}
        className="w-full aspect-[16/10] sm:aspect-[2/1] bg-stone-950"
      />

      {/* Legend footer */}
      <div className="px-6 py-3 border-t border-emerald-900/40 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-stone-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ backgroundColor: FLOW_TIER_COLORS.green }} />
          Green — high confidence
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ backgroundColor: FLOW_TIER_COLORS.blue }} />
          Blue — moderate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded border border-stone-600" style={{ backgroundColor: FLOW_TIER_COLORS.black }} />
          Black — speculative
        </span>
        {flowData.convergenceZones?.features?.length ? (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#c9a84c' }} />
            Convergence zone
          </span>
        ) : null}
      </div>
    </section>
  );
}
