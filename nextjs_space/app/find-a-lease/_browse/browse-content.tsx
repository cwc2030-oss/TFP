'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import BrowseFilterBar from './browse-filter-bar';
import BrowseListingCard from './browse-listing-card';
import { Loader2 } from 'lucide-react';

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
  seasonAvailability: string[];
  huntersMax: number | null;
  funnelCount: number | null;
  bedAcres: number | null;
}

export default function BrowseContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchListings = useCallback(
    async (cursor?: string) => {
      const qs = new URLSearchParams(params?.toString() ?? '');
      if (cursor) qs.set('cursor', cursor);
      qs.set('limit', '24');

      const res = await fetch(`/api/listings/browse?${qs.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      return data as {
        listings: Listing[];
        hasMore: boolean;
        nextCursor: string | null;
        total: number | null;
      };
    },
    [params],
  );

  // Initial load / filter change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchListings().then((data) => {
      if (cancelled || !data) return;
      setListings(data.listings);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchListings]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const data = await fetchListings(nextCursor);
    if (data) {
      setListings((prev) => [...prev, ...data.listings]);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    }
    setLoadingMore(false);
  }

  function applyFilters(next: URLSearchParams) {
    startTransition(() => {
      router.push(`/find-a-lease?${next.toString()}`);
    });
  }

  return (
    <>
      <BrowseFilterBar onApply={applyFilters} />

      {/* Results count */}
      {!loading && total != null && (
        <p className="text-stone-500 text-sm mb-6">
          {total === 0
            ? 'No listings match your filters'
            : `${total} listing${total === 1 ? '' : 's'} found`}
        </p>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      )}

      {/* Empty state */}
      {!loading && listings.length === 0 && (
        <div className="text-center py-20">
          <div className="mx-auto w-16 h-16 rounded-full bg-stone-900 flex items-center justify-center mb-4">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-stone-600"
            >
              <path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
          </div>
          <h3 className="text-stone-300 text-lg font-semibold mb-2">
            No listings match yet
          </h3>
          <p className="text-stone-500 max-w-md mx-auto">
            Try broadening your filters, or check back soon — new
            terrain-certified properties are added regularly.
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && listings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((l) => (
            <BrowseListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}

      {/* Load more */}
      {!loading && hasMore && (
        <div className="mt-10 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 bg-stone-800 hover:bg-stone-700 text-stone-200 px-6 py-3 rounded-lg font-medium text-sm transition-colors disabled:opacity-60"
          >
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
            Load more listings
          </button>
        </div>
      )}
    </>
  );
}
