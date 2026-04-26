/**
 * /listings — PUBLIC marketplace index.
 *
 * Server component. No auth required. Lists only PUBLISHED listings.
 * Filters and sort come from URL searchParams. We deliberately keep it
 * paginated, paged by 24 cards, with `?page=2` for older results.
 *
 * OPSEC: queries select an explicit allowlist of columns; no parcel/lat/lng
 * fields exist on the model in the first place, but the allowlist is the
 * primary defense. Cards never call into the savedProperty relation.
 */
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import Navbar from '@/components/navbar';
import ListingCard from './_components/listing-card';
import FilterBar from './_components/filter-bar';
import { gradeMinScore } from '@/lib/listings';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Hunt Lease Marketplace — Terra Firma Partners',
  description:
    'Browse certified hunt-lease listings backed by Terra Firma Partners terrain analysis. County-level locations, transparent grades, no precise coordinates.',
};

interface Props {
  searchParams: {
    state?: string;
    grade?: string;
    leaseType?: string;
    season?: string;
    acresMin?: string;
    acresMax?: string;
    priceMin?: string;
    priceMax?: string;
    sort?: string;
    page?: string;
  };
}

const PAGE_SIZE = 24;

export default async function PublicListingsIndex({ searchParams }: Props) {
  const page = Math.max(1, Number(searchParams.page ?? '1') || 1);

  const acresMin = numOrNull(searchParams.acresMin);
  const acresMax = numOrNull(searchParams.acresMax);
  const priceMin = numOrNull(searchParams.priceMin);
  const priceMax = numOrNull(searchParams.priceMax);
  const stateCode = sanitizeState(searchParams.state);
  const leaseType = sanitizeLeaseType(searchParams.leaseType);
  const season = sanitizeSeason(searchParams.season);
  const gradeMin = searchParams.grade ? gradeMinScore(searchParams.grade) : 0;

  const where: Prisma.ListingWhereInput = {
    status: 'PUBLISHED',
  };
  if (stateCode) where.state = stateCode;
  if (leaseType) where.leaseType = leaseType as any;
  if (season) where.seasonAvailability = { has: season };
  if (gradeMin > 0) where.terrainScore = { gte: gradeMin };
  if (acresMin != null || acresMax != null) {
    where.acres = {};
    if (acresMin != null) (where.acres as any).gte = acresMin;
    if (acresMax != null) (where.acres as any).lte = acresMax;
  }
  // Price overlap: a listing matches if its [askingPriceMin, askingPriceMax]
  // overlaps the requested [priceMin, priceMax] window. We model that as:
  //  listing.askingPriceMin <= requested.priceMax  AND
  //  listing.askingPriceMax >= requested.priceMin
  if (priceMax != null) where.askingPriceMin = { lte: priceMax };
  if (priceMin != null) where.askingPriceMax = { gte: priceMin };

  const orderBy: Prisma.ListingOrderByWithRelationInput[] =
    searchParams.sort === 'highScore'
      ? [{ terrainScore: 'desc' }, { publishedAt: 'desc' }]
      : searchParams.sort === 'lowPrice'
        ? [{ askingPriceMin: 'asc' }, { publishedAt: 'desc' }]
        : searchParams.sort === 'largestAcres'
          ? [{ acres: 'desc' }, { publishedAt: 'desc' }]
          : [{ publishedAt: 'desc' }];

  const [total, rows] = await Promise.all([
    prisma.listing.count({ where }),
    prisma.listing.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      // Explicit allowlist — OPSEC defense in depth.
      select: {
        id: true,
        title: true,
        state: true,
        county: true,
        acres: true,
        terrainScore: true,
        primaryMovement: true,
        leaseType: true,
        askingPriceMin: true,
        askingPriceMax: true,
        photos: true,
        publishedAt: true,
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const baseQuery = new URLSearchParams();
  if (stateCode) baseQuery.set('state', stateCode);
  if (searchParams.grade) baseQuery.set('grade', searchParams.grade);
  if (leaseType) baseQuery.set('leaseType', leaseType);
  if (season) baseQuery.set('season', season);
  if (acresMin != null) baseQuery.set('acresMin', String(acresMin));
  if (acresMax != null) baseQuery.set('acresMax', String(acresMax));
  if (priceMin != null) baseQuery.set('priceMin', String(priceMin));
  if (priceMax != null) baseQuery.set('priceMax', String(priceMax));
  if (searchParams.sort && searchParams.sort !== 'newest')
    baseQuery.set('sort', searchParams.sort);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <header className="mb-8 sm:mb-10 max-w-3xl">
          <p className="text-emerald-400 uppercase tracking-widest text-xs font-semibold">
            Marketplace
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-100 mt-2">
            Hunt-lease listings, terrain-graded.
          </h1>
          <p className="text-stone-400 mt-3 text-base sm:text-lg">
            Every property is anchored to a Terra Firma Partners hunt-report. Grades reflect bedding,
            funnels, water access, and movement — not glossy photos. County-level locations only.
          </p>
        </header>

        <FilterBar />

        <div className="flex items-center justify-between mb-4">
          <p className="text-stone-500 text-sm">
            {total === 0
              ? 'No listings match your filters.'
              : `${total.toLocaleString('en-US')} listing${total === 1 ? '' : 's'}`}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-10 sm:p-16 text-center">
            <h2 className="text-stone-100 text-xl font-semibold">Nothing here yet</h2>
            <p className="text-stone-400 mt-2 max-w-md mx-auto">
              {total === 0
                ? 'Try widening your filters — or be the first to list when properties go live.'
                : ''}
            </p>
            <Link
              href="/lease-your-land"
              className="inline-flex items-center justify-center mt-5 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-md font-medium"
            >
              List your land →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {rows.map((l) => (
              <ListingCard key={l.id} listing={l as any} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <nav className="mt-10 flex items-center justify-center gap-3 text-sm">
            {page > 1 && (
              <Link
                href={pageHref(baseQuery, page - 1)}
                className="px-3 py-1.5 rounded-md border border-stone-700 bg-stone-900 text-stone-300 hover:bg-stone-800"
              >
                ← Previous
              </Link>
            )}
            <span className="text-stone-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={pageHref(baseQuery, page + 1)}
                className="px-3 py-1.5 rounded-md border border-stone-700 bg-stone-900 text-stone-300 hover:bg-stone-800"
              >
                Next →
              </Link>
            )}
          </nav>
        )}
      </main>
    </div>
  );
}

function pageHref(base: URLSearchParams, page: number) {
  const next = new URLSearchParams(base.toString());
  if (page === 1) next.delete('page');
  else next.set('page', String(page));
  const qs = next.toString();
  return qs ? `/listings?${qs}` : '/listings';
}

function numOrNull(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
function sanitizeState(v: string | undefined): string | null {
  if (!v) return null;
  return /^[A-Z]{2}$/.test(v.toUpperCase()) ? v.toUpperCase() : null;
}
const LEASE_TYPES = ['ANNUAL', 'SEASON_FULL', 'RIFLE_ONLY', 'BOW_ONLY', 'YOUTH', 'OTHER'];
function sanitizeLeaseType(v: string | undefined): string | null {
  if (!v) return null;
  return LEASE_TYPES.includes(v) ? v : null;
}
const SEASONS = ['bow', 'rifle', 'muzzleloader', 'youth'];
function sanitizeSeason(v: string | undefined): string | null {
  if (!v) return null;
  return SEASONS.includes(v) ? v : null;
}
