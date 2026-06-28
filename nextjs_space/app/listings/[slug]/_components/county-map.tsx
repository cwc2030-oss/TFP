/**
 * County-level static map. OPSEC: we render the county centroid only, never
 * the parcel boundary. The marker circle is intentionally large + soft so
 * the visual emphasis is on the county, not a precise dot.
 */

import Image from 'next/image';

interface CentroidInput {
  lat: number;
  lng: number;
  precision: 'county' | 'state';
}

export default function CountyMap({
  centroid,
  county,
  state,
}: {
  centroid: CentroidInput | null;
  county: string | null;
  state: string | null;
}) {
  if (!centroid || !state) {
    return (
      <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-6 text-center text-stone-500 text-sm">
        Location: {county ? `${county} County, ` : ''}
        {state ?? 'Region withheld until inquiry'}
      </div>
    );
  }

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    // Fallback when token missing — still shows the textual label.
    return (
      <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-6">
        <p className="text-stone-300">
          {county ? `${county} County, ` : ''}
          {state}
        </p>
        <p className="text-stone-500 text-xs mt-1">
          (Map unavailable. County-level location only.)
        </p>
      </div>
    );
  }

  // Static map at zoom 7 — county-level, never parcel-level.
  // url: https://docs.mapbox.com/api/maps/static-images/
  const zoom = centroid.precision === 'county' ? 7 : 5;
  const lng = centroid.lng.toFixed(3);
  const lat = centroid.lat.toFixed(3);
  const markerSpec = `pin-l+059669(${lng},${lat})`;
  const url = `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${markerSpec}/${lng},${lat},${zoom}/640x320@2x?access_token=${token}`;
  return (
    <div className="rounded-lg overflow-hidden border border-stone-800 bg-stone-900/60">
      <div className="relative aspect-[2/1] bg-stone-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <Image
          src={url}
          alt={`Map of ${county ?? ''} County, ${state}`}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
          loading="lazy"
        />
      </div>
      <div className="px-4 py-3 border-t border-stone-800 text-stone-300 text-sm flex items-center justify-between">
        <span>
          {county ? `${county} County, ` : ''}
          {state}
        </span>
        <span className="text-stone-500 text-xs">
          {centroid.precision === 'county' ? 'County-level' : 'State-level'} only
        </span>
      </div>
    </div>
  );
}