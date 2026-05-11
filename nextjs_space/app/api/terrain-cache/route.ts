export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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

    // Fetch all cached entries that are not expired
    const cached = await prisma.terrainAnalysisCache.findMany({
      where: {
        parcelId: { in: ids },
        expiresAt: { gt: new Date() },
      },
    });

    // Build a map of parcelId → parsed data
    const results: Record<string, any> = {};
    const found: string[] = [];
    const missing: string[] = [];

    for (const entry of cached) {
      try {
        results[entry.parcelId] = JSON.parse(entry.data);
        found.push(entry.parcelId);
      } catch {
        // Corrupt cache entry — treat as miss
        missing.push(entry.parcelId);
      }
    }

    // Mark IDs that weren't in cache
    for (const id of ids) {
      if (!found.includes(id)) {
        missing.push(id);
      }
    }

    return NextResponse.json({ results, found, missing });
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
        expiresAt,
      },
      update: {
        lat,
        lng,
        acreage: acreage || 0,
        data: JSON.stringify(data),
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
