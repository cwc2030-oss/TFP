import { prisma } from "@/lib/db";

const CACHE_DURATION_DAYS = 30;

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
