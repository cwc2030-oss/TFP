/**
 * listing-flow-snapshot.ts
 *
 * Builds the Deer-Flow JSON snapshot that powers the signed-in tier
 * of /listings/[slug].  Called at publish time from the publish route.
 *
 * The snapshot is a self-contained JSON blob containing:
 *   - parcelBounds: the merged polygon from SavedProperty.parcels
 *   - flowPrimary / flowSecondary / convergenceZones: from TerrainAnalysisCache
 *   - centroid: { lat, lng } for initial map view
 *
 * OPSEC: This data is NEVER rendered in public (anonymous) HTML.
 * It is stored on Listing.terrainFlowSnapshot and only served
 * from an auth-gated API endpoint.
 */
import type { SavedProperty } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getFlowLines, buildFlowScope } from '@/lib/flow-contract';
import { TERRAIN_ENGINE_VERSION } from '@/lib/terrain-engine-version';

interface ParcelLite {
  geometry?: {
    type: string;
    coordinates: any;
  };
  [key: string]: unknown;
}

function asParcelArray(value: unknown): ParcelLite[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ParcelLite => !!item && typeof item === 'object',
  );
}

/** Merge parcel geometries into a single Polygon/MultiPolygon for map bounds. */
function mergeParcelBounds(
  parcels: ParcelLite[],
): GeoJSON.Geometry | null {
  const polys: number[][][][] = [];
  for (const p of parcels) {
    const g = p.geometry;
    if (!g || !g.coordinates) continue;
    if (g.type === 'Polygon') {
      polys.push(g.coordinates as number[][][]);
    } else if (g.type === 'MultiPolygon') {
      for (const ring of g.coordinates as number[][][][]) {
        polys.push(ring);
      }
    }
  }
  if (polys.length === 0) return null;
  if (polys.length === 1) {
    return { type: 'Polygon', coordinates: polys[0] };
  }
  return { type: 'MultiPolygon', coordinates: polys };
}

/**
 * Look up TerrainAnalysisCache by proximity to the SavedProperty centroid.
 * Returns the parsed JSON data or null.
 */
async function findCachedTerrain(
  lat: number,
  lng: number,
): Promise<Record<string, any> | null> {
  // Find the closest non-expired cache entry within ~0.01 degrees (~1km)
  const tolerance = 0.01;
  const entries = await prisma.terrainAnalysisCache.findMany({
    where: {
      lat: { gte: lat - tolerance, lte: lat + tolerance },
      lng: { gte: lng - tolerance, lte: lng + tolerance },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  if (entries.length === 0) return null;

  // Pick the closest by Euclidean distance
  let best = entries[0];
  let bestDist = (best.lat - lat) ** 2 + (best.lng - lng) ** 2;
  for (let i = 1; i < entries.length; i++) {
    const d = (entries[i].lat - lat) ** 2 + (entries[i].lng - lng) ** 2;
    if (d < bestDist) {
      best = entries[i];
      bestDist = d;
    }
  }

  try {
    return JSON.parse(best.data);
  } catch {
    return null;
  }
}

/**
 * Build the self-contained flow snapshot JSON for a listing.
 * Returns stringified JSON or null if no cache data is available.
 */
export async function buildFlowSnapshot(
  sp: SavedProperty,
): Promise<string | null> {
  const parcels = asParcelArray(sp.parcels);
  const bounds = mergeParcelBounds(parcels);
  if (!bounds) {
    console.warn('[FlowSnapshot] No parcel bounds found for SavedProperty', sp.id);
    return null;
  }

  const cached = await findCachedTerrain(sp.centroidLat, sp.centroidLng);
  if (!cached) {
    console.warn('[FlowSnapshot] No terrain cache for', sp.centroidLat, sp.centroidLng);
    return null;
  }

  const tfd = cached.terrainFlowData;
  if (!tfd) {
    console.warn('[FlowSnapshot] Cache entry has no terrainFlowData');
    return null;
  }

  // Extract only flow-related data — NO stands, NO precise intel
  const snapshot = {
    v: 1,
    centroid: { lat: sp.centroidLat, lng: sp.centroidLng },
    parcelBounds: bounds,
    flowPrimary: tfd.flow_primary ?? null,
    flowSecondary: tfd.flow_secondary ?? null,
    convergenceZones: tfd.convergence_zones ?? null,
    // Metadata for display
    flowMode: tfd.metadata?.mode ?? null,
    demSource: tfd.metadata?.dem_source ?? null,
    // Canonical flow contract (v5.0-scope) — additive, no behavior change
    flowLines: getFlowLines(tfd),
    scope: buildFlowScope({
      center: { lat: sp.centroidLat, lng: sp.centroidLng },
      radius_m: Number(tfd.metadata?.buffer_m) || 0,
      acres: 0,
      mode: 'parcel',
    }),
    engineVersion: TERRAIN_ENGINE_VERSION,
  };

  return JSON.stringify(snapshot);
}
