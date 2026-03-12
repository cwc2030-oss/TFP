import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Rural sampling regions - avoid urban areas, focus on likely hunting land
// Each region has bounds and a weight (higher = more likely to sample)
const SAMPLING_REGIONS = {
  MO: [
    // Northwest MO - rolling hills, good deer habitat
    { minLat: 39.5, maxLat: 40.5, minLng: -95.5, maxLng: -93.5, weight: 3 },
    // North-central MO - prairie/timber mix
    { minLat: 39.5, maxLat: 40.3, minLng: -93.5, maxLng: -92.0, weight: 2 },
    // Northeast MO - river breaks, good terrain
    { minLat: 39.5, maxLat: 40.5, minLng: -92.0, maxLng: -91.0, weight: 2 },
    // Central MO - Lake of Ozarks region
    { minLat: 38.0, maxLat: 39.0, minLng: -93.5, maxLng: -91.5, weight: 3 },
    // Southwest MO - Ozark foothills
    { minLat: 36.5, maxLat: 37.5, minLng: -94.5, maxLng: -93.0, weight: 2 },
    // Southeast MO - river bottoms
    { minLat: 36.5, maxLat: 37.5, minLng: -90.5, maxLng: -89.5, weight: 1 },
  ],
  KS: [
    // Northeast KS - timber along rivers
    { minLat: 39.0, maxLat: 40.0, minLng: -96.0, maxLng: -94.7, weight: 3 },
    // East-central KS - Flint Hills edge
    { minLat: 38.0, maxLat: 39.0, minLng: -96.5, maxLng: -95.0, weight: 2 },
    // Southeast KS - cross timbers
    { minLat: 37.0, maxLat: 38.0, minLng: -95.5, maxLng: -94.7, weight: 3 },
    // South-central KS - mixed terrain
    { minLat: 37.0, maxLat: 38.0, minLng: -98.5, maxLng: -97.0, weight: 1 },
    // North-central KS - river corridors
    { minLat: 39.0, maxLat: 39.8, minLng: -98.0, maxLng: -96.5, weight: 1 },
  ],
};

// Pick a random region weighted by likelihood of good hunting parcels
function pickRandomRegion(state: 'MO' | 'KS') {
  const regions = SAMPLING_REGIONS[state];
  const totalWeight = regions.reduce((sum, r) => sum + r.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const region of regions) {
    random -= region.weight;
    if (random <= 0) return region;
  }
  return regions[0];
}

// Generate random coordinates within a region
function randomCoordInRegion(region: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  const lat = region.minLat + Math.random() * (region.maxLat - region.minLat);
  const lng = region.minLng + Math.random() * (region.maxLng - region.minLng);
  return { lat, lng };
}

// Normalize coordinates for polygon
function normalizeCoordinates(
  coords: number[][][] | number[][][][],
  geoType: string
): number[][] | null {
  if (!coords || !coords.length) return null;
  
  if (geoType === 'Polygon') {
    const ring = coords[0] as number[][];
    if (!ring?.length) return null;
    return ring;
  } else if (geoType === 'MultiPolygon') {
    const polygons = coords as number[][][][];
    let largest: number[][] | null = null;
    let maxLen = 0;
    for (const poly of polygons) {
      if (poly[0] && poly[0].length > maxLen) {
        maxLen = poly[0].length;
        largest = poly[0];
      }
    }
    return largest;
  }
  return null;
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
  const state = (searchParams.get("state")?.toUpperCase() || 'MO') as 'MO' | 'KS';
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
  
  if (!['MO', 'KS'].includes(state)) {
    return NextResponse.json(
      { found: false, error: "State must be MO or KS" },
      { status: 400 }
    );
  }

  const MAX_ATTEMPTS = 12; // Limit API calls
  let attempts = 0;
  let lastError = '';
  
  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    
    try {
      // Pick random region and coordinates
      const region = pickRandomRegion(state);
      const { lat, lng } = randomCoordInRegion(region);
      
      console.log(`[RANDOM PARCEL] Attempt ${attempts}: ${state} @ ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      
      // Fetch from Regrid
      const searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;
      
      const response = await fetch(searchUrl, {
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
      
      // Check acreage
      const acreage = fields.ll_gisacre || fields.gisacre || fields.acres || 0;
      
      if (acreage < minAcres || acreage > maxAcres) {
        lastError = `Parcel is ${acreage.toFixed(1)} acres (need ${minAcres}-${maxAcres})`;
        console.log(`[RANDOM PARCEL] Skipping: ${lastError}`);
        continue;
      }
      
      // Check if we should exclude this parcel
      const parcelId = fields.parcelnumb || fields.parcelnumb_no_formatting || '';
      if (excludeIds.includes(parcelId)) {
        lastError = `Already seen parcel ${parcelId}`;
        console.log(`[RANDOM PARCEL] Skipping: ${lastError}`);
        continue;
      }
      
      // Normalize geometry
      if (!rawCoords) {
        lastError = "No geometry available";
        continue;
      }
      
      const normalizedCoords = normalizeCoordinates(rawCoords, geoType);
      
      if (!normalizedCoords || normalizedCoords.length < 4) {
        lastError = "Invalid geometry";
        continue;
      }
      
      // Build address
      const siteParts = [
        fields.address,
        fields.city || fields.situs_city,
        fields.state2 || state,
        fields.szip || fields.situs_zip
      ].filter(Boolean);
      
      // Build PLSS string
      const plssParts = [
        fields.plss_township ? `T${fields.plss_township}` : null,
        fields.plss_range ? `R${fields.plss_range}` : null,
        fields.plss_section ? `S${fields.plss_section}` : null,
      ].filter(Boolean);
      
      console.log(`[RANDOM PARCEL] Found: ${parcelId}, ${acreage.toFixed(1)} ac, ${fields.county || 'Unknown'} County`);
      
      return NextResponse.json({
        found: true,
        attempts,
        parcel: {
          parcelId: parcelId || 'Unknown',
          address: siteParts.length > 0 ? siteParts.join(', ') : feature.properties?.headline || 'Rural Parcel',
          county: fields.county || 'Unknown',
          state: fields.state2 || state,
          acreage: Math.round(acreage * 10) / 10,
          owner: fields.owner || 'Unknown',
          zoning: fields.zoning || 'N/A',
          coordinates: normalizedCoords,
          centroid: calculateCentroid(normalizedCoords),
          bounds: calculateBounds(normalizedCoords),
          geometryType: geoType === 'MultiPolygon' ? 'MultiPolygon' : 'Polygon',
          legalDescription: fields.legaldesc || fields.legal_description || undefined,
          plss: plssParts.length > 0 ? plssParts.join(' ') : undefined,
        }
      });
      
    } catch (err: any) {
      console.error('[RANDOM PARCEL] Error:', err.message);
      lastError = err.message || 'Lookup failed';
      
      // Handle rate limiting
      if (err.message?.includes('429')) {
        return NextResponse.json(
          { found: false, error: "Rate limit reached. Please wait and try again.", attempts },
          { status: 200 }
        );
      }
    }
  }
  
  // Exhausted attempts
  return NextResponse.json(
    { 
      found: false, 
      error: `Could not find a ${minAcres}-${maxAcres} acre parcel after ${attempts} attempts. Last issue: ${lastError}`,
      attempts 
    },
    { status: 200 }
  );
}
