import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeToOuterRing, validateParcelGeometry, logGeometryDebug } from "@/lib/geometry-validation";
import { regridFetch } from "@/lib/regrid-client";

export const dynamic = "force-dynamic";

// Rural sampling regions - avoid urban areas, focus on likely hunting land
// Each region has bounds and a weight (higher = more likely to sample)
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
    // Southern IA - timber draws and CRP, great deer country
    { minLat: 40.6, maxLat: 41.3, minLng: -94.0, maxLng: -92.0, weight: 3 },
    // Southeast IA - Mississippi river bluffs
    { minLat: 40.5, maxLat: 41.5, minLng: -92.0, maxLng: -91.0, weight: 3 },
    // Southwest IA - loess hills
    { minLat: 40.6, maxLat: 41.5, minLng: -95.5, maxLng: -94.0, weight: 2 },
    // Central IA - mixed ag/timber
    { minLat: 41.5, maxLat: 42.3, minLng: -94.0, maxLng: -92.5, weight: 1 },
  ],
  OK: [
    // Northeast OK - Ozark Plateau, cross timbers
    { minLat: 35.5, maxLat: 36.5, minLng: -95.5, maxLng: -94.5, weight: 3 },
    // Southeast OK - Ouachita Mountains
    { minLat: 34.0, maxLat: 35.0, minLng: -95.5, maxLng: -94.5, weight: 3 },
    // North-central OK - mixed grassland/timber
    { minLat: 36.0, maxLat: 37.0, minLng: -97.5, maxLng: -96.0, weight: 2 },
    // East-central OK - Canadian River corridor
    { minLat: 35.0, maxLat: 36.0, minLng: -96.5, maxLng: -95.0, weight: 1 },
  ],
};

const VALID_STATES = Object.keys(SAMPLING_REGIONS);

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

function randomCoordInRegion(region: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  return {
    lat: region.minLat + Math.random() * (region.maxLat - region.minLat),
    lng: region.minLng + Math.random() * (region.maxLng - region.minLng),
  };
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = (searchParams.get("state")?.toUpperCase() || 'MO');
  const minAcres = parseFloat(searchParams.get("minAcres") || '80');
  const maxAcres = parseFloat(searchParams.get("maxAcres") || '200');
  const excludeIds = searchParams.get("excludeIds")?.split(',').filter(Boolean) || [];
  
  const apiKey = process.env.REGRID_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json(
      { found: false, error: "Regrid API not configured" },
      { status: 500 }
    );
  }
  
  if (!VALID_STATES.includes(state)) {
    return NextResponse.json(
      { found: false, error: `State must be one of: ${VALID_STATES.join(', ')}` },
      { status: 400 }
    );
  }

  // ── 1. Try to serve from the pre-cached pool (zero Regrid calls) ──
  try {
    const poolEntry = await prisma.randomParcelPool.findFirst({
      where: {
        state,
        served: false,
        acreage: { gte: minAcres, lte: maxAcres },
        parcelId: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (poolEntry) {
      // Mark as served so it's not reused
      await prisma.randomParcelPool.update({
        where: { id: poolEntry.id },
        data: { served: true },
      }).catch(console.error);

      const parcel = JSON.parse(poolEntry.data);
      console.log(`[RANDOM PARCEL] Served from pool: ${poolEntry.parcelId}, ${poolEntry.acreage} ac, ${poolEntry.county} County, ${state}`);
      return NextResponse.json({
        found: true,
        attempts: 0,
        source: 'pool',
        parcel,
      });
    }
    console.log(`[RANDOM PARCEL] Pool empty for ${state} (${minAcres}-${maxAcres} ac), falling back to live Regrid`);
  } catch (poolErr) {
    console.error('[RANDOM PARCEL] Pool lookup error (non-fatal):', poolErr);
  }

  // ── 2. Fallback: live Regrid search (same logic as before) ──
  const MAX_ATTEMPTS = 12;
  let attempts = 0;
  let lastError = '';
  
  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    
    try {
      const region = pickRandomRegion(state);
      const { lat, lng } = randomCoordInRegion(region);
      
      console.log(`[RANDOM PARCEL] Attempt ${attempts}: ${state} @ ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      
      const searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;
      
      const response = await regridFetch(searchUrl, 'parcels-random', {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        lastError = `Regrid API error: ${response.status}`;
        continue;
      }

      const data = await response.json();
      if (data.status === "error") {
        lastError = data.message || "Regrid lookup failed";
        continue;
      }
      
      const results = data.results || [];
      if (results.length === 0) {
        lastError = "No parcel at sampled location";
        continue;
      }

      const feature = results[0];
      const fields = feature.properties?.fields || {};
      const geoType = feature.geometry?.type || 'Polygon';
      const rawCoords = feature.geometry?.coordinates;
      
      const acreage = fields.ll_gisacre || fields.gisacre || fields.acres || 0;
      if (acreage < minAcres || acreage > maxAcres) {
        lastError = `Parcel is ${acreage.toFixed(1)} acres (need ${minAcres}-${maxAcres})`;
        console.log(`[RANDOM PARCEL] Skipping: ${lastError}`);
        continue;
      }
      
      const parcelId = fields.parcelnumb || fields.parcelnumb_no_formatting || '';
      if (excludeIds.includes(parcelId)) {
        lastError = `Already seen parcel ${parcelId}`;
        console.log(`[RANDOM PARCEL] Skipping: ${lastError}`);
        continue;
      }
      
      if (!rawCoords) {
        lastError = "No geometry available";
        continue;
      }
      
      logGeometryDebug(`Random parcel attempt ${attempts}`, rawCoords, geoType);
      
      const validation = validateParcelGeometry(rawCoords, geoType);
      if (!validation.valid) {
        lastError = `Invalid geometry: ${validation.errors.join(', ')}`;
        console.log(`[RANDOM PARCEL] Skipping: ${lastError}`);
        continue;
      }
      
      const normalizedCoords = normalizeToOuterRing(rawCoords, geoType);
      if (!normalizedCoords || normalizedCoords.length < 4) {
        lastError = "Invalid geometry (< 4 points)";
        continue;
      }
      
      const siteParts = [
        fields.address,
        fields.city || fields.situs_city,
        fields.state2 || state,
        fields.szip || fields.situs_zip
      ].filter(Boolean);
      
      const plssParts = [
        fields.plss_township ? `T${fields.plss_township}` : null,
        fields.plss_range ? `R${fields.plss_range}` : null,
        fields.plss_section ? `S${fields.plss_section}` : null,
      ].filter(Boolean);
      
      console.log(`[RANDOM PARCEL] Found: ${parcelId}, ${acreage.toFixed(1)} ac, ${fields.county || 'Unknown'} County`);
      
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

      // Also add to pool for future reuse (background, best-effort)
      prisma.randomParcelPool.create({
        data: {
          state: fields.state2 || state,
          parcelId: parcel.parcelId,
          data: JSON.stringify(parcel),
          acreage: parcel.acreage,
          county: parcel.county,
          served: true, // already served this one
        },
      }).catch(() => {}); // ignore dupes

      return NextResponse.json({
        found: true,
        attempts,
        source: 'live',
        parcel,
      });
      
    } catch (err: any) {
      console.error('[RANDOM PARCEL] Error:', err.message);
      lastError = err.message || 'Lookup failed';
      
      if (err.message?.includes('429')) {
        return NextResponse.json(
          { found: false, error: "Rate limit reached. Please wait and try again.", attempts },
          { status: 200 }
        );
      }
    }
  }
  
  return NextResponse.json(
    { 
      found: false, 
      error: `Could not find a ${minAcres}-${maxAcres} acre parcel after ${attempts} attempts. Last issue: ${lastError}`,
      attempts 
    },
    { status: 200 }
  );
}
