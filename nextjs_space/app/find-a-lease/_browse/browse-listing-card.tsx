'use client';

import Link from 'next/link';
import { gradeFromScore, listingSlug, listingTitleFallback } from '@/lib/listings';
import TerrainBrainCardVisual from './terrain-brain-card-visual';

interface Listing {
  id: string;
  title: string | null;
  state: string | null;
  county: string | null;
  acres: number | null;
  terrainScore: number | null;
  primaryMovement: string | null;
  leaseType: string | null;
  askingPriceMin: number | null;
  askingPriceMax: number | null;
  publishedAt: string | null;
  corridorCount?: number | null;
  funnelCount?: number | null;
  interceptCount?: number | null;
}

function priceLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;
  if (min != null && max != null) {
    return min === max ? fmt(min) : `${fmt(min)} \u2013 ${fmt(max)}`;
  }
  return fmt((min ?? max) as number);
}

export default function BrowseListingCard({ listing }: { listing: Listing }) {
  const titleStr = listingTitleFallback({
    title: listing.title,
    acres: listing.acres,
    county: listing.county,
    state: listing.state,
  });
  const slug = `${listingSlug({
    state: listing.state,
    county: listing.county,
    acres: listing.acres,
    terrainScore: listing.terrainScore,
    leaseType: listing.leaseType as any,
  })}-${listing.id}`;
  const grade = gradeFromScore(listing.terrainScore);
  const price = priceLabel(listing.askingPriceMin, listing.askingPriceMax);

  return (
    <Link
      href={`/listings/${slug}`}
      className="group block rounded-xl border border-stone-800 bg-stone-900/60 hover:border-emerald-700/60 hover:shadow-lg hover:shadow-emerald-900/20 transition-all overflow-hidden"
    >
      <div className="relative aspect-[4/3]">
        <TerrainBrainCardVisual
          grade={grade}
          terrainScore={listing.terrainScore}
          corridorCount={listing.corridorCount ?? null}
          funnelCount={listing.funnelCount ?? null}
          interceptCount={listing.interceptCount ?? null}
        />
      </div>
      <div className="p-4">
        <h3 className="text-stone-100 font-semibold leading-snug line-clamp-2 group-hover:text-emerald-300 transition-colors">
          {titleStr}
        </h3>
        <p className="text-stone-500 text-sm mt-1">
          {listing.county ? `${listing.county} County, ` : ''}
          {listing.state ?? ''}
          {listing.acres != null && (
            <>
              {' \u00B7 '}
              {Math.round(listing.acres).toLocaleString('en-US')} ac
            </>
          )}
        </p>
        <div className="flex items-center justify-between mt-3">
          <span className="text-stone-300 font-medium">
            {price ?? <span className="text-stone-500 italic font-normal">Inquire for price</span>}
          </span>
          {listing.leaseType && (
            <span className="text-xs px-2 py-0.5 rounded bg-stone-800 text-stone-300 uppercase tracking-wide">
              {String(listing.leaseType).replace('_', ' ')}
            </span>
          )}
        </div>
        {/* Terrain Brain indicator */}
        {(listing.corridorCount != null || listing.funnelCount != null || listing.interceptCount != null) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-stone-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-amber-400 shrink-0">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <span className="text-[11px] text-stone-400">
              <span className="text-amber-300 font-medium">Terrain Brain</span>
              {listing.corridorCount != null && <> · {listing.corridorCount} corridor{listing.corridorCount !== 1 ? 's' : ''}</>}
              {listing.funnelCount != null && <> · {listing.funnelCount} funnel{listing.funnelCount !== 1 ? 's' : ''}</>}
              {listing.interceptCount != null && <> · {listing.interceptCount} intercept{listing.interceptCount !== 1 ? 's' : ''}</>}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
