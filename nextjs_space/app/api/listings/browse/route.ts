/**
 * GET /api/listings/browse
 *
 * Public (no auth). Returns PUBLISHED listings with server-side filtering,
 * sorting, and cursor-based pagination. All responses run through
 * stripForPublic() — no OPSEC fields leak.
 *
 * Query params:
 *   state         2-letter code
 *   county        case-insensitive substring
 *   acresMin      number
 *   acresMax      number
 *   priceMin      number  (askingPriceMin >=)
 *   priceMax      number  (askingPriceMax <=)
 *   grade         letter grade — maps to minimum terrainScore
 *   leaseType     enum
 *   season        string — matches any element in seasonAvailability[]
 *   sort          newest | highScore | lowPrice | largestAcres
 *   cursor        id of last listing from previous page
 *   limit         1–48 (default 24)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { stripForPublic, gradeMinScore } from '@/lib/listings';

export const dynamic = 'force-dynamic';

const ALLOWED_SORTS = ['newest', 'highScore', 'lowPrice', 'largestAcres'] as const;
type SortKey = (typeof ALLOWED_SORTS)[number];

function orderByClause(sort: SortKey) {
  switch (sort) {
    case 'highScore':
      return [{ terrainScore: 'desc' as const }, { publishedAt: 'desc' as const }];
    case 'lowPrice':
      return [{ askingPriceMin: 'asc' as const }, { publishedAt: 'desc' as const }];
    case 'largestAcres':
      return [{ acres: 'desc' as const }, { publishedAt: 'desc' as const }];
    case 'newest':
    default:
      return [{ publishedAt: 'desc' as const }];
  }
}

const BROWSE_SELECT = {
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
  seasonAvailability: true,
  huntersMax: true,
  funnelCount: true,
  corridorCount: true,
  interceptCount: true,
  bedAcres: true,
} as const;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const stateFilter = sp.get('state')?.toUpperCase() || undefined;
  const countyFilter = sp.get('county') || undefined;
  const acresMin = Number(sp.get('acresMin')) || undefined;
  const acresMax = Number(sp.get('acresMax')) || undefined;
  const priceMin = Number(sp.get('priceMin')) || undefined;
  const priceMax = Number(sp.get('priceMax')) || undefined;
  const gradeFilter = sp.get('grade') || undefined;
  const leaseType = sp.get('leaseType') || undefined;
  const season = sp.get('season') || undefined;
  const sortRaw = sp.get('sort') || 'newest';
  const sort: SortKey = ALLOWED_SORTS.includes(sortRaw as SortKey)
    ? (sortRaw as SortKey)
    : 'newest';
  const cursor = sp.get('cursor') || undefined;
  const limitRaw = Number(sp.get('limit')) || 24;
  const limit = Math.min(Math.max(limitRaw, 1), 48);

  // Build where clause
  const where: Record<string, unknown> = { status: 'PUBLISHED' };

  if (stateFilter && /^[A-Z]{2}$/.test(stateFilter)) {
    where.state = stateFilter;
  }
  if (countyFilter) {
    where.county = { contains: countyFilter, mode: 'insensitive' };
  }
  if (acresMin != null) {
    where.acres = { ...(where.acres as object || {}), gte: acresMin };
  }
  if (acresMax != null) {
    where.acres = { ...(where.acres as object || {}), lte: acresMax };
  }
  if (priceMin != null) {
    where.askingPriceMin = { gte: priceMin };
  }
  if (priceMax != null) {
    where.askingPriceMax = { lte: priceMax };
  }
  if (gradeFilter) {
    const minScore = gradeMinScore(gradeFilter);
    if (minScore > 0) {
      where.terrainScore = { gte: minScore };
    }
  }
  if (leaseType) {
    where.leaseType = leaseType;
  }
  if (season) {
    where.seasonAvailability = { has: season };
  }

  const findArgs: Record<string, unknown> = {
    where,
    select: BROWSE_SELECT,
    orderBy: orderByClause(sort),
    take: limit + 1, // fetch one extra to detect hasMore
  };

  if (cursor) {
    findArgs.skip = 1;
    findArgs.cursor = { id: cursor };
  }

  const rows = await prisma.listing.findMany(findArgs as any);

  const hasMore = rows.length > limit;
  const listings = (hasMore ? rows.slice(0, limit) : rows).map((r: any) =>
    stripForPublic(r),
  );
  const nextCursor = hasMore ? rows[limit - 1].id : null;

  // Count total for UI (only first page, skip if cursor)
  let total: number | null = null;
  if (!cursor) {
    total = await prisma.listing.count({ where: where as any });
  }

  return NextResponse.json({ listings, hasMore, nextCursor, total });
}
