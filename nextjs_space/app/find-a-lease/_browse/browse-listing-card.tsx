'use client';

import Link from 'next/link';
import Image from 'next/image';
import { gradeFromScore, listingSlug, listingTitleFallback } from '@/lib/listings';

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
  photos: string[];
  publishedAt: string | null;
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
  const photo = listing.photos?.[0];

  return (
    <Link
      href={`/listings/${slug}`}
      className="group block rounded-xl border border-stone-800 bg-stone-900/60 hover:border-emerald-700/60 hover:shadow-lg hover:shadow-emerald-900/20 transition-all overflow-hidden"
    >
      <div className="relative aspect-[4/3] bg-stone-950">
        {photo ? (
          <Image
            src={photo}
            alt={titleStr}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-stone-700">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
              <path d="M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              <path d="M3 7l3-4h12l3 4" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </div>
        )}
        {grade !== '\u2014' && (
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border border-amber-300/80 shadow text-emerald-900 font-serif font-bold text-sm tracking-wider">
            {grade}
          </div>
        )}
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
      </div>
    </Link>
  );
}
