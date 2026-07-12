import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/cache-purge
 * Body: { scope: 'parcel' | 'neighbor' | 'adjacent' | 'terrain' | 'all' }
 *
 * Manual cache purge (admin only). Parcel/terrain data is cached long-lived, so
 * this is the escape hatch when a location's data genuinely changed or a bad
 * entry needs to be evicted. Terrain is normally auto-busted by an engine
 * version bump; use this only for a forced clear.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const scope: string = (body.scope || '').toString();
  const valid = ['parcel', 'neighbor', 'adjacent', 'terrain', 'all'];
  if (!valid.includes(scope)) {
    return NextResponse.json(
      { error: `scope must be one of: ${valid.join(', ')}` },
      { status: 400 }
    );
  }

  const deleted: Record<string, number> = {};

  try {
    if (scope === 'parcel' || scope === 'all') {
      deleted.parcel = (await prisma.parcelCache.deleteMany({})).count;
    }
    if (scope === 'neighbor' || scope === 'all') {
      deleted.neighbor = (await prisma.neighborCache.deleteMany({})).count;
    }
    if (scope === 'adjacent' || scope === 'all') {
      deleted.adjacent = (await prisma.adjacentCache.deleteMany({})).count;
    }
    if (scope === 'terrain' || scope === 'all') {
      deleted.terrain = (await prisma.terrainAnalysisCache.deleteMany({})).count;
    }

    console.log('[CACHE-PURGE] scope=%s deleted=%o by=%s', scope, deleted, session.user.email);
    return NextResponse.json({ ok: true, scope, deleted });
  } catch (err) {
    console.error('[CACHE-PURGE] error:', err);
    return NextResponse.json({ error: 'Purge failed' }, { status: 500 });
  }
}
