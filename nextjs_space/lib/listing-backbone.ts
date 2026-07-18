/**
 * listing-backbone.ts
 *
 * Phase 3 — the honest listing verdict.
 *
 * Browse sort/filter and the listing URL slug must rank on the REAL backbone
 * verdict (the same shared determination the intel readout consults via
 * metadata.backbone), never on the retired v1 fabricated `terrainScore`.
 *
 * This module is the single source for:
 *   - deriveBackboneRank(): the sortable rank off the 3-state verdict
 *   - extractBackboneFromFlowResponse(): pure parser of a /api/terrain-flow body
 *   - parcelFeatureFromSavedProperty(): build the compute AOI from a SavedProperty
 *   - computeListingBackbone(): run the honest engine for one listing
 *
 * The verdict is computed by the existing /api/terrain-flow pipeline (the same
 * one the map/intel readout uses) — we never re-implement the gate here, we read
 * its output. Used by the one-time backfill and the publish path.
 */

export type BackboneState = 'confirmed' | 'marginal' | 'flat';

export interface ListingBackboneVerdict {
  backboneState: BackboneState;
  backboneRank: number;
  ridgeSpineCount: number;
  saddleCrossings: number;
  convergenceZoneCount: number;
}

/**
 * Sortable rank off the 3-state verdict. Higher = stronger real backbone.
 * confirmed (2) > marginal (1) > flat (0). A listing with no computed verdict
 * stores null and ranks below flat (unranked/lowest).
 */
export function deriveBackboneRank(state: BackboneState | null | undefined): number | null {
  switch (state) {
    case 'confirmed':
      return 2;
    case 'marginal':
      return 1;
    case 'flat':
      return 0;
    default:
      return null;
  }
}

/** Human label for a verdict state (used by browse filter + slug). */
export function backboneStateLabel(state: BackboneState | null | undefined): string {
  switch (state) {
    case 'confirmed':
      return 'Confirmed Backbone';
    case 'marginal':
      return 'Marginal Backbone';
    case 'flat':
      return 'Flat / Low-Relief';
    default:
      return 'Terrain Analyzed';
  }
}

/** Short slug token for the listing URL (real verdict, not a fabricated letter). */
export function backboneStateSlug(state: BackboneState | null | undefined): string | null {
  switch (state) {
    case 'confirmed':
      return 'confirmed-backbone';
    case 'marginal':
      return 'marginal-backbone';
    case 'flat':
      return 'flat-terrain';
    default:
      return null;
  }
}

/**
 * Pure parser: turn a /api/terrain-flow response body into the stored verdict.
 * Returns null when the body carries no usable backbone determination (so the
 * caller can leave the listing unranked rather than fabricate a state).
 */
export function extractBackboneFromFlowResponse(json: any): ListingBackboneVerdict | null {
  const bb = json?.metadata?.backbone;
  const state: BackboneState | undefined = bb?.state;
  if (state !== 'confirmed' && state !== 'marginal' && state !== 'flat') {
    return null;
  }
  const ridgeSpineCount = Number.isFinite(bb?.networkLines) ? Number(bb.networkLines) : 0;
  // Saddle nodes on the traced backbone come through the terrain_debug block.
  const saddleCrossings = Number.isFinite(json?.terrain_debug?.ridge_saddle_count)
    ? Number(json.terrain_debug.ridge_saddle_count)
    : 0;
  // Convergence zones: prefer the metadata stats count, fall back to the FC length.
  const convergenceZoneCount = Number.isFinite(json?.metadata?.stats?.convergence_count)
    ? Number(json.metadata.stats.convergence_count)
    : (json?.convergence_zones?.features?.length ?? 0);

  return {
    backboneState: state,
    backboneRank: deriveBackboneRank(state)!,
    // A flat/marginal verdict has no confident structure to advertise — zero the
    // counts so a listing can never show ridge/saddle structure it did not earn.
    ridgeSpineCount: state === 'flat' ? 0 : ridgeSpineCount,
    saddleCrossings: state === 'confirmed' ? saddleCrossings : 0,
    convergenceZoneCount: state === 'confirmed' ? convergenceZoneCount : 0,
  };
}

interface ParcelLike {
  geometry?: any;
  [key: string]: unknown;
}

function asParcelArray(value: unknown): ParcelLike[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is ParcelLike => !!v && typeof v === 'object');
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return asParcelArray(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

/** Normalize a parcel entry's stored geometry to a bare GeoJSON geometry. */
function toBareGeometry(g: any): any | null {
  if (!g) return null;
  // Stored as a full Feature: { type:'Feature', geometry:{...} }
  if (g.type === 'Feature' && g.geometry) return g.geometry;
  // Stored as a bare geometry already.
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return g;
  return null;
}

/**
 * Build the compute AOI Feature (Polygon/MultiPolygon) from a SavedProperty's
 * stored parcels. Merges multiple parcels into a MultiPolygon. Returns null when
 * no usable geometry is present.
 */
export function parcelFeatureFromSavedProperty(
  sp: { parcels?: unknown } | null | undefined,
): GeoJSON.Feature | null {
  const parcels = asParcelArray(sp?.parcels);
  const polys: number[][][][] = [];
  for (const p of parcels) {
    const geom = toBareGeometry(p.geometry);
    if (!geom || !geom.coordinates) continue;
    if (geom.type === 'Polygon') {
      polys.push(geom.coordinates as number[][][]);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates as number[][][][]) {
        polys.push(poly);
      }
    }
  }
  if (polys.length === 0) return null;
  const geometry: any =
    polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0] }
      : { type: 'MultiPolygon', coordinates: polys };
  return { type: 'Feature', properties: {}, geometry };
}

/**
 * Run the honest engine for one listing by calling the existing terrain-flow
 * pipeline (same determination the intel readout uses) and parsing the verdict.
 * Returns null on any failure (no geometry, network/compute error, no verdict)
 * so the caller leaves the listing unranked rather than fabricating a state.
 */
export async function computeListingBackbone(
  sp: { id?: string; parcels?: unknown } | null | undefined,
  baseUrl: string,
  opts?: { timeoutMs?: number; parcelId?: string },
): Promise<ListingBackboneVerdict | null> {
  const feature = parcelFeatureFromSavedProperty(sp);
  if (!feature) return null;

  const timeoutMs = opts?.timeoutMs ?? 70_000;
  const parcelId = opts?.parcelId ?? `backbone_${sp?.id ?? 'unknown'}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/terrain-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel: feature, parcel_id: parcelId }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return extractBackboneFromFlowResponse(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
