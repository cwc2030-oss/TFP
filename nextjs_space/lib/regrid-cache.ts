import { prisma } from "@/lib/db";
import { recordCacheHitAsync } from "@/lib/cache-stats";

// Parcel geometry/ownership is effectively static, so we cache long-lived.
// Overridable via PARCEL_CACHE_TTL_DAYS; defaults to 365 days. Manual purge is
// available via the admin cache-purge endpoint.
const CACHE_DURATION_DAYS = parseInt(
  process.env.PARCEL_CACHE_TTL_DAYS || "365",
  10
);

export interface CachedParcelData {
  parcelId: string;
  owner: string;
  mailingAddress: string;
  siteAddress: string;
  acreage: number;
  sqft: number;
  zoning: string;
  useDescription: string;
  coordinates: number[][][] | number[][][][] | null; // Polygon or MultiPolygon coordinates
  geometryType?: 'Polygon' | 'MultiPolygon'; // Store original geometry type
  marketValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  taxYear: string | null;
  saleDate: string | null;
  salePrice: number | null;
  county: string;
  state: string;
  legalDescription: string | null;
  plssTownship: string | null;
  plssRange: string | null;
  plssSection: string | null;
  buildingFootprints?: string | null;
  qozStatus?: string | null;
  femaFloodZone?: string | null;
  schoolDistrict?: string | null;
}

// Round coordinates for consistent cache keys (5 decimal places = ~1m accuracy)
function roundCoord(val: number): number {
  return Math.round(val * 100000) / 100000;
}

export async function getCachedParcel(lat: number, lng: number): Promise<CachedParcelData | null> {
  try {
    const roundedLat = roundCoord(lat);
    const roundedLng = roundCoord(lng);
    
    const cached = await prisma.parcelCache.findUnique({
      where: {
        lat_lng: {
          lat: roundedLat,
          lng: roundedLng,
        },
      },
    });
    
    if (cached && cached.expiresAt > new Date()) {
      console.log(`[CACHE HIT] Parcel at ${roundedLat}, ${roundedLng}`);
      recordCacheHitAsync('parcel');
      return JSON.parse(cached.data) as CachedParcelData;
    }
    
    // Expired or not found
    if (cached) {
      console.log(`[CACHE EXPIRED] Parcel at ${roundedLat}, ${roundedLng}`);
      await prisma.parcelCache.delete({
        where: { id: cached.id },
      });
    }
    
    return null;
  } catch (error) {
    console.error("Cache lookup error:", error);
    return null;
  }
}

export async function setCachedParcel(lat: number, lng: number, data: CachedParcelData): Promise<void> {
  try {
    const roundedLat = roundCoord(lat);
    const roundedLng = roundCoord(lng);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CACHE_DURATION_DAYS);
    
    await prisma.parcelCache.upsert({
      where: {
        lat_lng: {
          lat: roundedLat,
          lng: roundedLng,
        },
      },
      update: {
        data: JSON.stringify(data),
        expiresAt,
      },
      create: {
        lat: roundedLat,
        lng: roundedLng,
        data: JSON.stringify(data),
        expiresAt,
      },
    });
    
    console.log(`[CACHE SET] Parcel at ${roundedLat}, ${roundedLng} - expires ${expiresAt.toISOString()}`);
  } catch (error) {
    console.error("Cache write error:", error);
  }
}

// ── Point-in-polygon cache fallback ──────────────────────────────────────────
// The coordinate-keyed lookup above only hits when a later click lands within
// ~1m of the exact key it was stored under. Because map-click lookups key off
// the CLICK POINT while some writers key off the parcel CENTROID (fields.lat/lon),
// repeat clicks on an already-cached parcel almost always miss and re-charge
// Regrid. This fallback checks whether the click falls INSIDE any already-cached
// parcel polygon near it, and serves that parcel from cache — only genuinely new
// ground reaches Regrid. Store-key agnostic; fixes both /api/parcels and
// /api/parcels/lookup without changing how anything is written.

// Ray-casting point-in-polygon against a single ring of [lng, lat] pairs.
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Handles Polygon (number[][][]) and MultiPolygon (number[][][][]) outer rings.
function pointInParcel(
  lng: number,
  lat: number,
  coordinates: number[][][] | number[][][][] | null,
  geometryType?: 'Polygon' | 'MultiPolygon'
): boolean {
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) return false;
  const isMulti =
    geometryType === 'MultiPolygon' ||
    (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && Array.isArray((coordinates[0][0] as any)[0]));
  try {
    if (isMulti) {
      for (const poly of coordinates as number[][][][]) {
        const outer = poly?.[0];
        if (outer && pointInRing(lng, lat, outer)) return true;
      }
      return false;
    }
    const outer = (coordinates as number[][][])[0];
    return outer ? pointInRing(lng, lat, outer) : false;
  } catch {
    return false;
  }
}

// Look up a cached parcel by checking whether (lat, lng) falls inside any cached
// parcel polygon in a small bbox around the click. Δ covers large parcels even
// when the stored key is the far-side centroid. Returns null if the click is on
// genuinely new ground (so the caller falls through to Regrid).
export async function getCachedParcelByPoint(
  lat: number,
  lng: number
): Promise<CachedParcelData | null> {
  try {
    const DELTA = 0.02; // ~2.2 km — safely spans large rural parcels + off-key centroids
    const candidates = await prisma.parcelCache.findMany({
      where: {
        lat: { gte: lat - DELTA, lte: lat + DELTA },
        lng: { gte: lng - DELTA, lte: lng + DELTA },
        expiresAt: { gt: new Date() },
      },
      take: 80,
    });
    if (candidates.length === 0) return null;

    for (const row of candidates) {
      let data: CachedParcelData;
      try {
        data = JSON.parse(row.data) as CachedParcelData;
      } catch {
        continue;
      }
      if (!data.coordinates) continue;
      if (pointInParcel(lng, lat, data.coordinates, data.geometryType)) {
        console.log(
          `[CACHE HIT · geom] Click ${roundCoord(lat)}, ${roundCoord(lng)} inside cached parcel ${data.parcelId} (${data.acreage?.toFixed?.(1) ?? '?'} ac)`
        );
        recordCacheHitAsync('parcel');
        return data;
      }
    }
    return null;
  } catch (error) {
    console.error("Point-in-polygon cache lookup error:", error);
    return null;
  }
}
