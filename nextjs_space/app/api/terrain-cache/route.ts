export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { TERRAIN_ENGINE_VERSION } from '@/lib/terrain-engine-version';
import { recordCacheHitAsync } from '@/lib/cache-stats';

const CACHE_TTL_DAYS = 7;

/**
 * GET /api/terrain-cache?parcelIds=id1,id2,id3
 * Returns cached terrain analysis for the requested parcel IDs.
 */
export async function GET(req: NextRequest) {
  try {
    const parcelIds = req.nextUrl.searchParams.get('parcelIds');
    if (!parcelIds) {
      return NextResponse.json({ error: 'parcelIds required' }, { status: 400 });
    }

    const ids = parcelIds.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No valid parcel IDs' }, { status: 400 });
    }

    // Fetch all cached entries that are not expired AND match the current
    // terrain engine version. Entries computed by an older engine version no
    // longer match -> treated as misses -> recomputed & re-cached fresh.
    const cached = await prisma.terrainAnalysisCache.findMany({
      where: {
        parcelId: { in: ids },
        expiresAt: { gt: new Date() },
        engineVersion: TERRAIN_ENGINE_VERSION,
      },
    });

    // Build a map of parcelId → parsed data
    const results: Record<string, any> = {};
    const foundSet = new Set<string>();
    const found: string[] = [];
    const missing: string[] = [];

    for (const entry of cached) {
      try {
        results[entry.parcelId] = JSON.parse(entry.data);
        found.push(entry.parcelId);
        foundSet.add(entry.parcelId);
      } catch {
        // Corrupt cache entry — will be caught as missing below
      }
    }

    // Mark IDs that weren't successfully parsed from cache
    // Use Set to avoid double-counting + deduplicate input IDs
    const missingSet = new Set<string>();
    for (const id of ids) {
      if (!foundSet.has(id) && !missingSet.has(id)) {
        missing.push(id);
        missingSet.add(id);
      }
    }

    if (found.length > 0) {
      recordCacheHitAsync('terrain', found.length);
    }

    return NextResponse.json({ results, found, missing, engineVersion: TERRAIN_ENGINE_VERSION });
  } catch (err) {
    console.error('[TerrainCache] GET error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/terrain-cache
 * Body: { parcelId, lat, lng, acreage, data }
 * Upserts cached terrain analysis for a single parcel.
 */
/**
 * DELETE /api/terrain-cache?parcelIds=id1,id2,id3
 * Deletes cached terrain analysis for the specified parcel IDs.
 * If no parcelIds provided, does nothing (safety guard).
 */
export async function DELETE(req: NextRequest) {
  try {
    const parcelIds = req.nextUrl.searchParams.get('parcelIds');
    if (!parcelIds) {
      return NextResponse.json({ error: 'parcelIds required' }, { status: 400 });
    }

    const ids = parcelIds.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No valid parcel IDs' }, { status: 400 });
    }

    const result = await prisma.terrainAnalysisCache.deleteMany({
      where: { parcelId: { in: ids } },
    });

    console.log('[TerrainCache] Deleted', result.count, 'entries for', ids.length, 'parcel IDs');
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (err) {
    console.error('[TerrainCache] DELETE error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { parcelId, lat, lng, acreage, data } = body;

    if (!parcelId || lat == null || lng == null || !data) {
      return NextResponse.json({ error: 'parcelId, lat, lng, data required' }, { status: 400 });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

    await prisma.terrainAnalysisCache.upsert({
      where: { parcelId },
      create: {
        parcelId,
        lat,
        lng,
        acreage: acreage || 0,
        data: JSON.stringify(data),
        engineVersion: TERRAIN_ENGINE_VERSION,
        expiresAt,
      },
      update: {
        lat,
        lng,
        acreage: acreage || 0,
        data: JSON.stringify(data),
        engineVersion: TERRAIN_ENGINE_VERSION,
        expiresAt,
        version: { increment: 1 },
      },
    });

    return NextResponse.json({ ok: true, parcelId });
  } catch (err) {
    console.error('[TerrainCache] POST error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
