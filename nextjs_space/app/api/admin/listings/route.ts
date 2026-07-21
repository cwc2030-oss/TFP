/**
 * GET /api/admin/listings
 *
 * Admin-only moderation queue. Returns listings grouped for review:
 *   - PENDING_REVIEW  (awaiting approval before they can go public)
 *   - PUBLISHED       (currently live — so an admin can pull one down)
 *
 * Admin gate matches the rest of /api/admin/* (session.user.role === 'admin').
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const SELECT = {
  id: true,
  title: true,
  status: true,
  state: true,
  county: true,
  acres: true,
  askingPriceMin: true,
  askingPriceMax: true,
  leaseType: true,
  description: true,
  photos: true,
  createdAt: true,
  publishedAt: true,
  owner: { select: { name: true, email: true } },
} as const;

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [pending, published] = await Promise.all([
      prisma.listing.findMany({
        where: { status: 'PENDING_REVIEW' },
        orderBy: { createdAt: 'asc' },
        select: SELECT,
      }),
      prisma.listing.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        select: SELECT,
      }),
    ]);

    return NextResponse.json({ pending, published });
  } catch (error) {
    console.error('[Admin listings] error:', error);
    return NextResponse.json({ error: 'Failed to load listings' }, { status: 500 });
  }
}
