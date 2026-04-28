import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import type { HuntingReportPayload } from '@/lib/report/build-html';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // Soft auth — capture owner if logged in, allow anonymous shares
    const session = await getServerSession(authOptions);
    const ownerUserId = session?.user ? (session.user as any).id ?? null : null;

    const body = await req.json();

    // Light validation: require address, parcelCoords, summary
    if (!body.address || typeof body.address !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: address' },
        { status: 400 }
      );
    }
    if (!body.parcelCoords || !Array.isArray(body.parcelCoords)) {
      return NextResponse.json(
        { error: 'Missing required field: parcelCoords' },
        { status: 400 }
      );
    }
    if (!body.summary || typeof body.summary !== 'object') {
      return NextResponse.json(
        { error: 'Missing required field: summary' },
        { status: 400 }
      );
    }

    // Snapshot the payload — strip any fields that shouldn't persist
    // (reportId and generated are set at render time, not at share time)
    const payload: Omit<HuntingReportPayload, 'reportId' | 'generated' | 'isFreeTier' | 'mapImageBase64' | 'origin'> = {
      address: body.address,
      lat: body.lat,
      lng: body.lng,
      acreage: body.acreage,
      county: body.county,
      state: body.state,
      prevailingWind: body.prevailingWind,
      stands: body.stands,
      summary: body.summary,
      corridors: body.corridors,
      seasonScores: body.seasonScores,
      parcelCoords: body.parcelCoords,
      terrainHeadline: body.terrainHeadline,
      terrainNarrative: body.terrainNarrative,
      terrainDriver: body.terrainDriver,
      terrainConfidence: body.terrainConfidence,
      elevRange: body.elevRange,
      isTerritory: body.isTerritory,
      territoryName: body.territoryName,
      territoryParcelCount: body.territoryParcelCount,
      territoryParcels: body.territoryParcels,
      savedPropertyId: body.savedPropertyId,
    };

    const report = await prisma.huntingReport.create({
      data: {
        payload: payload as any,
        ownerUserId,
      },
    });

    const rawOrigin = req.headers.get('origin')
      || process.env.NEXTAUTH_URL
      || '';
    const origin = rawOrigin.replace(/\/+$/, '');

    return NextResponse.json({
      reportId: report.id,
      url: `${origin}/report/${report.id}`,
    });
  } catch (err: any) {
    console.error('[report/share] Error:', err);
    return NextResponse.json(
      { error: 'Failed to save report', detail: err.message },
      { status: 500 }
    );
  }
}
