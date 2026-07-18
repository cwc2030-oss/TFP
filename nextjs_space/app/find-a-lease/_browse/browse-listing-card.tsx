'use client';

import Link from 'next/link';
import { gradeFromScore, listingSlug, listingTitleFallback, flowSegments } from '@/lib/listings';
import TerrainBrainCardVisual from './terrain-brain-card-visual';

interface Listing {
  id: string;
  title: string | null;
  state: string | null;
  county: string | null;
  acres: number | null;
  terrainScore: number | null;
  backboneState?: string | null;
  primaryMovement: string | null;
  leaseType: string | null;
  askingPriceMin: number | null;
  askingPriceMax: number | null;
  publishedAt: string | null;
  corridorCount?: number | null;
  funnelCount?: number | null;
  interceptCount?: number | null;
  flowIndex?: number | null;
}

function priceLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;
  if (min != null && max != null) {
    return min === max ? fmt(min) : `${fmt(min)} \u2013 ${fmt(max)}`;
  }
  return fmt((min ?? max) as number);
}

function FlowMeter({ flowIndex }: { flowIndex: number | null | undefined }) {
  const segs = flowSegments(flowIndex);
  if (segs <= 0) return null;
  return (
    <div className="flex items-center gap-1.5" aria-label={`Deer flow intensity ${segs} of 5`}>
      <span className="text-[10px] text-stone-400 font-medium uppercase tracking-wide">Flow</span>
      <div className="flex gap-[3px]">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="w-[14px] h-[6px] rounded-[2px]"
            style={{
              backgroundColor: i <= segs ? '#e0a528' : 'rgba(120,113,108,0.22)',
            }}
          />
        ))}
      </div>
    </div>
  );
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
    backboneState: listing.backboneState,
    leaseType: listing.leaseType as any,
  })}-${listing.id}`;
  const grade = gradeFromScore(listing.terrainScore);
  const price = priceLabel(listing.askingPriceMin, listing.askingPriceMax);
  // ── PHASE 1 KILL-SWITCH (Jul 17 2026): hide non-discriminating v1 fab stats
  // (corr/fun/int counts + flow meter) until the gate-real rebuild (Phase 2).
  const HIDE_FAB = true;

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
          flowIndex={listing.flowIndex}
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
        {/* Terrain Brain indicator + Flow meter */}
        {!HIDE_FAB && (listing.corridorCount != null || listing.funnelCount != null || listing.interceptCount != null) && (
          <div className="mt-3 pt-3 border-t border-stone-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-amber-400 shrink-0">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <span className="text-[11px] text-stone-400">
                  {listing.corridorCount != null && <>{listing.corridorCount} corr</>}
                  {listing.funnelCount != null && <>{listing.corridorCount != null ? ' · ' : ''}{listing.funnelCount} fun</>}
                  {listing.interceptCount != null && <>{(listing.corridorCount != null || listing.funnelCount != null) ? ' · ' : ''}{listing.interceptCount} int</>}
                </span>
              </div>
              <FlowMeter flowIndex={listing.flowIndex} />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
