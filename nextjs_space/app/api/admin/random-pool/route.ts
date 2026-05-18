import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { normalizeToOuterRing, validateParcelGeometry } from "@/lib/geometry-validation";
import { regridFetch } from "@/lib/regrid-client";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "cwc2030@gmail.com";

// Sampling regions per state (same as in random endpoint)
const SAMPLING_REGIONS: Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number; weight: number }[]> = {
  MO: [
    { minLat: 39.5, maxLat: 40.5, minLng: -95.5, maxLng: -93.5, weight: 3 },
    { minLat: 39.5, maxLat: 40.3, minLng: -93.5, maxLng: -92.0, weight: 2 },
    { minLat: 39.5, maxLat: 40.5, minLng: -92.0, maxLng: -91.0, weight: 2 },
    { minLat: 38.0, maxLat: 39.0, minLng: -93.5, maxLng: -91.5, weight: 3 },
    { minLat: 36.5, maxLat: 37.5, minLng: -94.5, maxLng: -93.0, weight: 2 },
    { minLat: 36.5, maxLat: 37.5, minLng: -90.5, maxLng: -89.5, weight: 1 },
  ],
  KS: [
    { minLat: 39.0, maxLat: 40.0, minLng: -96.0, maxLng: -94.7, weight: 3 },
    { minLat: 38.0, maxLat: 39.0, minLng: -96.5, maxLng: -95.0, weight: 2 },
    { minLat: 37.0, maxLat: 38.0, minLng: -95.5, maxLng: -94.7, weight: 3 },
    { minLat: 37.0, maxLat: 38.0, minLng: -98.5, maxLng: -97.0, weight: 1 },
    { minLat: 39.0, maxLat: 39.8, minLng: -98.0, maxLng: -96.5, weight: 1 },
  ],
  IA: [
    { minLat: 40.6, maxLat: 41.3, minLng: -94.0, maxLng: -92.0, weight: 3 },
    { minLat: 40.5, maxLat: 41.5, minLng: -92.0, maxLng: -91.0, weight: 3 },
    { minLat: 40.6, maxLat: 41.5, minLng: -95.5, maxLng: -94.0, weight: 2 },
    { minLat: 41.5, maxLat: 42.3, minLng: -94.0, maxLng: -92.5, weight: 1 },
  ],
  OK: [
    { minLat: 35.5, maxLat: 36.5, minLng: -95.5, maxLng: -94.5, weight: 3 },
    { minLat: 34.0, maxLat: 35.0, minLng: -95.5, maxLng: -94.5, weight: 3 },
    { minLat: 36.0, maxLat: 37.0, minLng: -97.5, maxLng: -96.0, weight: 2 },
    { minLat: 35.0, maxLat: 36.0, minLng: -96.5, maxLng: -95.0, weight: 1 },
  ],
};

function pickRandomRegion(state: string) {
  const regions = SAMPLING_REGIONS[state] || SAMPLING_REGIONS['MO'];
  const totalWeight = regions.reduce((sum, r) => sum + r.weight, 0);
  let random = Math.random() * totalWeight;
  for (const region of regions) {
    random -= region.weight;
    if (random <= 0) return region;
  }
  return regions[0];
}

function calculateCentroid(coords: number[][]): [number, number] {
  if (!coords?.length) return [0, 0];
  const sum = coords.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length];
}

function calculateBounds(coords: number[][]): [[number, number], [number, number]] {
  if (!coords?.length) return [[0, 0], [0, 0]];
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const c of coords) {
    if (c[0] < minLng) minLng = c[0];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

// GET: Pool stats
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = await prisma.randomParcelPool.groupBy({
    by: ['state', 'served'],
    _count: true,
  });

  const summary: Record<string, { available: number; served: number }> = {};
  for (const row of stats) {
    if (!summary[row.state]) summary[row.state] = { available: 0, served: 0 };
    if (row.served) {
      summary[row.state].served = row._count;
    } else {
      summary[row.state].available = row._count;
    }
  }

  return NextResponse.json({ pool: summary });
}

// POST: Fill the pool — fetches parcels from Regrid and stores them
// Body: { states?: string[], countPerState?: number, minAcres?: number, maxAcres?: number }
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Regrid API key not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const states = (body.states || ['MO', 'KS', 'IA', 'OK']) as string[];
  const countPerState = Math.min(body.countPerState || 50, 100); // cap at 100
  const minAcres = body.minAcres || 20;
  const maxAcres = body.maxAcres || 500;

  const results: Record<string, { added: number; regridCalls: number; errors: number }> = {};

  for (const state of states) {
    if (!SAMPLING_REGIONS[state]) continue;
    results[state] = { added: 0, regridCalls: 0, errors: 0 };

    // Get existing parcel IDs to avoid duplicates
    const existing = await prisma.randomParcelPool.findMany({
      where: { state },
      select: { parcelId: true },
    });
    const existingIds = new Set(existing.map(e => e.parcelId));

    let attempts = 0;
    const maxAttempts = countPerState * 4; // allow some failures

    while (results[state].added < countPerState && attempts < maxAttempts) {
      attempts++;

      try {
        const region = pickRandomRegion(state);
        const lat = region.minLat + Math.random() * (region.maxLat - region.minLat);
        const lng = region.minLng + Math.random() * (region.maxLng - region.minLng);

        const searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;
        const response = await regridFetch(searchUrl, 'parcels-random', {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        results[state].regridCalls++;

        if (!response.ok) continue;
        const data = await response.json();
        const feature = data.results?.[0];
        if (!feature) continue;

        const fields = feature.properties?.fields || {};
        const acreage = fields.ll_gisacre || fields.gisacre || fields.acres || 0;
        if (acreage < minAcres || acreage > maxAcres) continue;

        const parcelId = fields.parcelnumb || fields.parcelnumb_no_formatting || '';
        if (!parcelId || existingIds.has(parcelId)) continue;

        const geoType = feature.geometry?.type || 'Polygon';
        const rawCoords = feature.geometry?.coordinates;
        if (!rawCoords) continue;

        const validation = validateParcelGeometry(rawCoords, geoType);
        if (!validation.valid) continue;

        const normalizedCoords = normalizeToOuterRing(rawCoords, geoType);
        if (!normalizedCoords || normalizedCoords.length < 4) continue;

        const siteParts = [
          fields.address,
          fields.city || fields.situs_city,
          fields.state2 || state,
          fields.szip || fields.situs_zip,
        ].filter(Boolean);

        const plssParts = [
          fields.plss_township ? `T${fields.plss_township}` : null,
          fields.plss_range ? `R${fields.plss_range}` : null,
          fields.plss_section ? `S${fields.plss_section}` : null,
        ].filter(Boolean);

        const parcel = {
          parcelId: parcelId || 'Unknown',
          address: siteParts.length > 0 ? siteParts.join(', ') : feature.properties?.headline || 'Rural Parcel',
          county: fields.county || 'Unknown',
          state: fields.state2 || state,
          acreage: Math.round(acreage * 10) / 10,
          owner: fields.owner || 'Unknown',
          zoning: fields.zoning || 'N/A',
          coordinates: normalizedCoords,
          centroid: validation.centroid || calculateCentroid(normalizedCoords),
          bounds: validation.bounds || calculateBounds(normalizedCoords),
          geometryType: geoType === 'MultiPolygon' ? 'MultiPolygon' : 'Polygon',
          legalDescription: fields.legaldesc || fields.legal_description || undefined,
          plss: plssParts.length > 0 ? plssParts.join(' ') : undefined,
        };

        await prisma.randomParcelPool.create({
          data: {
            state: fields.state2 || state,
            parcelId,
            data: JSON.stringify(parcel),
            acreage: parcel.acreage,
            county: parcel.county,
          },
        });

        existingIds.add(parcelId);
        results[state].added++;
        console.log(`[POOL FILL] ${state}: +${parcelId} (${parcel.acreage} ac, ${parcel.county} Co) — ${results[state].added}/${countPerState}`);

      } catch (err: any) {
        results[state].errors++;
        if (err.message?.includes('429')) {
          console.warn(`[POOL FILL] Rate limited on ${state}, stopping`);
          break;
        }
      }
    }
  }

  return NextResponse.json({
    message: "Pool fill complete",
    results,
  });
}

// DELETE: Reset pool (clear served entries or all)
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const resetServed = url.searchParams.get('resetServed') === 'true';

  if (resetServed) {
    // Just mark all served entries as available again
    const updated = await prisma.randomParcelPool.updateMany({
      where: { served: true },
      data: { served: false },
    });
    return NextResponse.json({ message: `Reset ${updated.count} served entries to available` });
  } else {
    // Delete all served entries to free space
    const deleted = await prisma.randomParcelPool.deleteMany({
      where: { served: true },
    });
    return NextResponse.json({ message: `Deleted ${deleted.count} served entries` });
  }
}
