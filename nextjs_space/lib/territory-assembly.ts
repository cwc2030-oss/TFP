/**
 * territory-assembly.ts — v4.0 Cache-Based Territory Assembly
 *
 * Instead of re-analyzing a merged polygon, this module:
 * 1. Reads per-parcel terrain data from the Supabase cache
 * 2. Merges all FeatureCollections (corridors, ridges, flows, stands, etc.)
 * 3. Computes lightweight cross-parcel corridor connection segments
 */

import type { TerrainLayers, TerrainSummary } from '@/types/terrain';
import type { FlowLine } from '@/types/flow-contract';
import { getFlowLines } from '@/lib/flow-contract';
import { TERRAIN_ENGINE_VERSION } from '@/lib/terrain-engine-version';
import { MAX_ANALYSIS_ACRES } from '@/lib/flow-flags';
import { clipFlowToAcreLimit } from '@/lib/flow-cap';
import * as turf from '@turf/turf';

// ============ Types ============

export interface CachedParcelTerrain {
  parcelId: string;
  layers: TerrainLayers;
  tieredCorridorData: TieredCorridorBundle | null;
  ridgeSpineData: RidgeSpineBundle | null;
  terrainFlowData: TerrainFlowBundle | null;
  summary: TerrainSummary | null;
  provenance: string | null;
}

export interface TieredCorridorBundle {
  corridors_primary: GeoJSON.FeatureCollection;
  corridors_possible: GeoJSON.FeatureCollection;
  corridors_exploratory: GeoJSON.FeatureCollection;
  corridors_context_primary: GeoJSON.FeatureCollection;
  corridors_context_possible: GeoJSON.FeatureCollection;
  funnels_hard: GeoJSON.FeatureCollection;
  funnels_slight: GeoJSON.FeatureCollection;
  intrusion_overlay: GeoJSON.FeatureCollection;
  metadata?: {
    local_baseline: number;
    primary_threshold: number;
    possible_threshold: number;
    exploratory_threshold: number;
    parcel_coverage_pct: number;
  };
}

export interface RidgeSpineBundle {
  ridges_primary: GeoJSON.FeatureCollection;
  ridges_secondary: GeoJSON.FeatureCollection;
  saddle_nodes: GeoJSON.FeatureCollection;
  isSynthetic: boolean;
  metadata?: {
    total_ridge_length_m: number;
    ridge_count_primary: number;
    ridge_count_secondary: number;
    saddle_count: number;
    dem_source?: string;
    backbone_confidence?: number;
    fallback_reason?: string | null;
  };
}

export interface TerrainFlowBundle {
  flow_primary: GeoJSON.FeatureCollection;
  flow_secondary: GeoJSON.FeatureCollection;
  convergence_zones: GeoJSON.FeatureCollection;
  opportunity_zones?: GeoJSON.FeatureCollection;
  isSynthetic: boolean;
  // Canonical flow contract (v5.0-scope) — additive, no behavior change
  flow_lines?: FlowLine[];
  engine_version?: string;
  empty_state?: any;
  metadata?: {
    flow_count_primary: number;
    flow_count_secondary: number;
    convergence_count: number;
    opportunity_count?: number;
    total_flow_length_m: number;
    mode?: string;
    dem_source?: string;
    fallback_reason?: string | null;
  };
}

export interface TerritoryAssemblyResult {
  layers: TerrainLayers;
  tieredCorridorData: TieredCorridorBundle;
  ridgeSpineData: RidgeSpineBundle;
  terrainFlowData: TerrainFlowBundle;
  summary: TerrainSummary;
  territoryLinks: GeoJSON.FeatureCollection;
}

interface ParcelPolygon {
  id: string;
  lat: number;
  lng: number;
  polygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
}

// ============ Merge Helpers ============

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function mergeFeatureCollections(...fcs: (GeoJSON.FeatureCollection | undefined | null)[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const fc of fcs) {
    if (fc?.features) {
      features.push(...fc.features);
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Tag every feature in a FC with its source parcelId */
function tagFeatures(fc: GeoJSON.FeatureCollection | undefined | null, parcelId: string): GeoJSON.FeatureCollection {
  if (!fc?.features?.length) return emptyFC();
  return {
    type: 'FeatureCollection',
    features: fc.features.map(f => ({
      ...f,
      properties: { ...f.properties, _sourceParcelId: parcelId },
    })),
  };
}

// ============ Core Assembly ============

/**
 * Merge per-parcel terrain data into one unified set of FeatureCollections.
 * Each feature is tagged with _sourceParcelId so it can be traced back.
 */
export function assembleTerritory(
  parcels: CachedParcelTerrain[],
  parcelPolygons: ParcelPolygon[],
): TerritoryAssemblyResult {
  console.log('[TerritoryAssembly] Assembling', parcels.length, 'parcels');

  // ---- Merge layers ----
  const mergedLayers: TerrainLayers = {
    beddingPolygons: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.layers?.beddingPolygons, p.parcelId))
    ) as any,
    funnels: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.layers?.funnels, p.parcelId))
    ) as any,
    standPoints: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.layers?.standPoints, p.parcelId))
    ) as any,
    corridors: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.layers?.corridors, p.parcelId))
    ),
  };

  // ---- Merge tiered corridors ----
  const mergedTiered: TieredCorridorBundle = {
    corridors_primary: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.tieredCorridorData?.corridors_primary, p.parcelId))
    ),
    corridors_possible: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.tieredCorridorData?.corridors_possible, p.parcelId))
    ),
    corridors_exploratory: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.tieredCorridorData?.corridors_exploratory, p.parcelId))
    ),
    corridors_context_primary: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.tieredCorridorData?.corridors_context_primary, p.parcelId))
    ),
    corridors_context_possible: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.tieredCorridorData?.corridors_context_possible, p.parcelId))
    ),
    funnels_hard: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.tieredCorridorData?.funnels_hard, p.parcelId))
    ),
    funnels_slight: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.tieredCorridorData?.funnels_slight, p.parcelId))
    ),
    intrusion_overlay: mergeFeatureCollections(
      ...parcels.map(p => tagFeatures(p.tieredCorridorData?.intrusion_overlay, p.parcelId))
    ),
    metadata: {
      local_baseline: parcels.reduce((sum, p) => sum + (p.tieredCorridorData?.metadata?.local_baseline || 0), 0) / (parcels.filter(p => p.tieredCorridorData?.metadata?.local_baseline).length || 1),
      primary_threshold: parcels.reduce((sum, p) => sum + (p.tieredCorridorData?.metadata?.primary_threshold || 0), 0) / (parcels.filter(p => p.tieredCorridorData?.metadata?.primary_threshold).length || 1),
      possible_threshold: parcels.reduce((sum, p) => sum + (p.tieredCorridorData?.metadata?.possible_threshold || 0), 0) / (parcels.filter(p => p.tieredCorridorData?.metadata?.possible_threshold).length || 1),
      exploratory_threshold: parcels.reduce((sum, p) => sum + (p.tieredCorridorData?.metadata?.exploratory_threshold || 0), 0) / (parcels.filter(p => p.tieredCorridorData?.metadata?.exploratory_threshold).length || 1),
      parcel_coverage_pct: parcels.reduce((sum, p) => sum + (p.tieredCorridorData?.metadata?.parcel_coverage_pct || 0), 0) / (parcels.filter(p => p.tieredCorridorData?.metadata?.parcel_coverage_pct).length || 1),
    },
  };

  // ---- Merge ridge spines ----
  const mergedRidgesPrimary = mergeFeatureCollections(
    ...parcels.map(p => tagFeatures(p.ridgeSpineData?.ridges_primary, p.parcelId))
  );
  const mergedRidgesSecondary = mergeFeatureCollections(
    ...parcels.map(p => tagFeatures(p.ridgeSpineData?.ridges_secondary, p.parcelId))
  );
  const mergedSaddleNodes = mergeFeatureCollections(
    ...parcels.map(p => tagFeatures(p.ridgeSpineData?.saddle_nodes, p.parcelId))
  );
  const mergedRidges: RidgeSpineBundle = {
    ridges_primary: mergedRidgesPrimary,
    ridges_secondary: mergedRidgesSecondary,
    saddle_nodes: mergedSaddleNodes,
    isSynthetic: parcels.every(p => p.ridgeSpineData?.isSynthetic !== false),
    metadata: {
      ridge_count_primary: mergedRidgesPrimary.features.length,
      ridge_count_secondary: mergedRidgesSecondary.features.length,
      saddle_count: mergedSaddleNodes.features.length,
      total_ridge_length_m: parcels.reduce((sum, p) => sum + (p.ridgeSpineData?.metadata?.total_ridge_length_m || 0), 0),
      dem_source: parcels.find(p => p.ridgeSpineData?.metadata?.dem_source)?.ridgeSpineData?.metadata?.dem_source,
      backbone_confidence: parcels.length > 0
        ? parcels.reduce((sum, p) => sum + (p.ridgeSpineData?.metadata?.backbone_confidence || 0), 0) / parcels.filter(p => p.ridgeSpineData?.metadata?.backbone_confidence).length || 0
        : 0,
    },
  };

  // ---- Merge terrain flow ----
  const mergedFlowPrimary = mergeFeatureCollections(
    ...parcels.map(p => tagFeatures(p.terrainFlowData?.flow_primary, p.parcelId))
  );
  const mergedFlowSecondary = mergeFeatureCollections(
    ...parcels.map(p => tagFeatures(p.terrainFlowData?.flow_secondary, p.parcelId))
  );
  const mergedConvergence = mergeFeatureCollections(
    ...parcels.map(p => tagFeatures(p.terrainFlowData?.convergence_zones, p.parcelId))
  );
  const mergedOpportunity = mergeFeatureCollections(
    ...parcels.map(p => tagFeatures(p.terrainFlowData?.opportunity_zones, p.parcelId))
  );

  // ---- Piece 1: 300-acre real-data cap on WHOLE-TERRITORY flow ----
  // A territory is by definition a whole-territory analysis. Beyond
  // MAX_ANALYSIS_ACRES we render flow only within a 300-ac core around the
  // territory center; the rest is a clean empty-state (no synthetic lines).
  let capFlowPrimary = mergedFlowPrimary;
  let capFlowSecondary = mergedFlowSecondary;
  let capConvergence = mergedConvergence;
  let capOpportunity = mergedOpportunity;
  let territoryEmptyState: any = null;
  let territoryAcres = 0;
  try {
    for (const pp of parcelPolygons) {
      if (pp?.polygon) territoryAcres += turf.area(pp.polygon as any) / 4046.8564224;
    }
  } catch {
    /* leave territoryAcres as computed so far */
  }
  if (territoryAcres > MAX_ANALYSIS_ACRES) {
    // Territory center = centroid of parcel polygons (fallback to lat/lng avg).
    let center = { lat: 0, lng: 0 };
    try {
      const fc = {
        type: 'FeatureCollection',
        features: parcelPolygons.filter(p => p?.polygon).map(p => p.polygon),
      } as GeoJSON.FeatureCollection;
      const c = turf.centerOfMass(fc as any);
      const coords = c?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        center = { lat: Number(coords[1]) || 0, lng: Number(coords[0]) || 0 };
      }
    } catch {
      const n = parcelPolygons.length || 1;
      center = {
        lat: parcelPolygons.reduce((s, p) => s + (p?.lat || 0), 0) / n,
        lng: parcelPolygons.reduce((s, p) => s + (p?.lng || 0), 0) / n,
      };
    }
    const clipped = clipFlowToAcreLimit(
      {
        flow_primary: mergedFlowPrimary,
        flow_secondary: mergedFlowSecondary,
        convergence_zones: mergedConvergence,
        opportunity_zones: mergedOpportunity,
      },
      center,
      MAX_ANALYSIS_ACRES,
    );
    capFlowPrimary = clipped.flow_primary as any;
    capFlowSecondary = clipped.flow_secondary as any;
    capConvergence = clipped.convergence_zones as any;
    capOpportunity = clipped.opportunity_zones as any;
    territoryEmptyState = {
      type: 'acre_cap',
      max_acres: MAX_ANALYSIS_ACRES,
      total_acres: Math.round(territoryAcres),
      message: `Territory spans ~${Math.round(territoryAcres)} acres. Flow analysis is capped at ${MAX_ANALYSIS_ACRES} acres. Spin up a Hunt Zone here to analyze the rest.`,
    };
    console.log('[TerritoryAssembly] Acre cap applied: %d ac > %d ac cap — kept %d, dropped %d flow features',
      Math.round(territoryAcres), MAX_ANALYSIS_ACRES, clipped.kept, clipped.dropped);
  }

  const mergedFlow: TerrainFlowBundle = {
    flow_primary: capFlowPrimary,
    flow_secondary: capFlowSecondary,
    convergence_zones: capConvergence,
    opportunity_zones: capOpportunity,
    isSynthetic: parcels.every(p => p.terrainFlowData?.isSynthetic !== false),
    // Canonical flow contract (v5.0-scope) — additive
    flow_lines: getFlowLines({ flow_primary: capFlowPrimary, flow_secondary: capFlowSecondary }),
    engine_version: TERRAIN_ENGINE_VERSION,
    empty_state: territoryEmptyState,
    metadata: {
      flow_count_primary: capFlowPrimary.features.length,
      flow_count_secondary: capFlowSecondary.features.length,
      convergence_count: capConvergence.features.length,
      opportunity_count: capOpportunity.features.length,
      total_flow_length_m: parcels.reduce((sum, p) => sum + (p.terrainFlowData?.metadata?.total_flow_length_m || 0), 0),
      mode: parcels.find(p => p.terrainFlowData?.metadata?.mode)?.terrainFlowData?.metadata?.mode,
      dem_source: parcels.find(p => p.terrainFlowData?.metadata?.dem_source)?.terrainFlowData?.metadata?.dem_source,
    },
  };

  // ---- Merge summaries ----
  const mergedSummary = mergeSummaries(parcels.map(p => p.summary).filter(Boolean) as TerrainSummary[]);

  // ---- Compute cross-parcel connections ----
  const territoryLinks = computeCrossParcelLinks(parcels, parcelPolygons);
  console.log('[TerritoryAssembly] Generated', territoryLinks.features.length, 'cross-parcel links');
  console.log('[TerritoryAssembly] Metadata — Ridges:', mergedRidges.metadata?.ridge_count_primary, 'primary,', mergedRidges.metadata?.ridge_count_secondary, 'secondary,', mergedRidges.metadata?.saddle_count, 'saddles | Flow:', mergedFlow.metadata?.flow_count_primary, 'primary,', mergedFlow.metadata?.flow_count_secondary, 'secondary,', mergedFlow.metadata?.convergence_count, 'convergence');

  return {
    layers: mergedLayers,
    tieredCorridorData: mergedTiered,
    ridgeSpineData: mergedRidges,
    terrainFlowData: mergedFlow,
    summary: mergedSummary,
    territoryLinks,
  };
}

// ============ Summary Merge ============

function mergeSummaries(summaries: TerrainSummary[]): TerrainSummary {
  if (summaries.length === 0) {
    return {
      totalBeddingAcres: 0,
      funnelCount: 0,
      topStandScore: 0,
      analysisAreaAcres: 0,
    } as TerrainSummary;
  }
  if (summaries.length === 1) return summaries[0];

  return {
    ...summaries[0],
    totalBeddingAcres: summaries.reduce((s, x) => s + (x.totalBeddingAcres || 0), 0),
    funnelCount: summaries.reduce((s, x) => s + (x.funnelCount || 0), 0),
    topStandScore: Math.max(...summaries.map(x => x.topStandScore || 0)),
    analysisAreaAcres: summaries.reduce((s, x) => s + (x.analysisAreaAcres || 0), 0),
  };
}

// ============ Cross-Parcel Connections ============

/** Haversine distance in meters */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Check if two parcels are adjacent (any outer ring points within 200m) */
function parcelsAreAdjacent(a: ParcelPolygon, b: ParcelPolygon): boolean {
  const ADJACENCY_THRESHOLD_M = 300;
  const ringsA = extractOuterRings(a.polygon.geometry);
  const ringsB = extractOuterRings(b.polygon.geometry);

  // Sample every 5th point for performance
  for (const ringA of ringsA) {
    for (let i = 0; i < ringA.length; i += 5) {
      for (const ringB of ringsB) {
        for (let j = 0; j < ringB.length; j += 5) {
          const d = haversineM(ringA[i][1], ringA[i][0], ringB[j][1], ringB[j][0]);
          if (d < ADJACENCY_THRESHOLD_M) return true;
        }
      }
    }
  }
  return false;
}

function extractOuterRings(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][][] {
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map(poly => poly[0]);
  }
  return [geom.coordinates[0]];
}

/** Get the best handoff point from a parcel’s corridor features nearest to another parcel */
function findBestHandoffPoint(
  corridorFC: GeoJSON.FeatureCollection | undefined | null,
  ridgesFC: GeoJSON.FeatureCollection | undefined | null,
  targetParcel: ParcelPolygon,
): [number, number] | null {
  // Collect all endpoint coordinates from corridors + ridges
  const candidates: [number, number][] = [];

  const extractEndpoints = (fc: GeoJSON.FeatureCollection | undefined | null) => {
    if (!fc?.features) return;
    for (const f of fc.features) {
      if (f.geometry.type === 'LineString') {
        const coords = f.geometry.coordinates;
        if (coords.length >= 2) {
          candidates.push(coords[0] as [number, number]);
          candidates.push(coords[coords.length - 1] as [number, number]);
        }
      }
    }
  };

  extractEndpoints(corridorFC);
  extractEndpoints(ridgesFC);

  if (candidates.length === 0) return null;

  // Find the candidate closest to the target parcel’s centroid
  let bestDist = Infinity;
  let bestPt: [number, number] | null = null;

  for (const pt of candidates) {
    const d = haversineM(pt[1], pt[0], targetParcel.lat, targetParcel.lng);
    if (d < bestDist) {
      bestDist = d;
      bestPt = pt;
    }
  }

  return bestPt;
}

/**
 * Compute cross-parcel corridor connection segments between adjacent parcels.
 * For each adjacent pair, finds the nearest corridor/ridge endpoints and
 * generates a connecting LineString.
 */
function computeCrossParcelLinks(
  parcels: CachedParcelTerrain[],
  parcelPolygons: ParcelPolygon[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < parcels.length; i++) {
    for (let j = i + 1; j < parcels.length; j++) {
      const polyA = parcelPolygons.find(p => p.id === parcels[i].parcelId);
      const polyB = parcelPolygons.find(p => p.id === parcels[j].parcelId);
      if (!polyA || !polyB) continue;

      const pairKey = [parcels[i].parcelId, parcels[j].parcelId].sort().join('|');
      if (processed.has(pairKey)) continue;
      processed.add(pairKey);

      // Check adjacency
      if (!parcelsAreAdjacent(polyA, polyB)) {
        console.log(`[TerritoryLinks] ${parcels[i].parcelId.slice(0, 8)} ↔ ${parcels[j].parcelId.slice(0, 8)}: NOT adjacent, skipping`);
        continue;
      }

      // Find handoff points
      const corridorsA = parcels[i].tieredCorridorData?.corridors_primary;
      const ridgesA = parcels[i].ridgeSpineData?.ridges_primary;
      const corridorsB = parcels[j].tieredCorridorData?.corridors_primary;
      const ridgesB = parcels[j].ridgeSpineData?.ridges_primary;

      const ptA = findBestHandoffPoint(corridorsA, ridgesA, polyB);
      const ptB = findBestHandoffPoint(corridorsB, ridgesB, polyA);

      if (ptA && ptB) {
        const dist = haversineM(ptA[1], ptA[0], ptB[1], ptB[0]);
        features.push({
          type: 'Feature',
          properties: {
            type: 'territory_link',
            from_parcel: parcels[i].parcelId,
            to_parcel: parcels[j].parcelId,
            distance_m: Math.round(dist),
          },
          geometry: {
            type: 'LineString',
            coordinates: [ptA, ptB],
          },
        });
        console.log(`[TerritoryLinks] ${parcels[i].parcelId.slice(0, 8)} ↔ ${parcels[j].parcelId.slice(0, 8)}: link at ${Math.round(dist)}m`);
      } else if (ptA || ptB) {
        // One-sided: use the point we have and the other parcel's centroid
        const from = ptA || [polyA.lng, polyA.lat] as [number, number];
        const to = ptB || [polyB.lng, polyB.lat] as [number, number];
        const dist = haversineM(from[1], from[0], to[1], to[0]);
        features.push({
          type: 'Feature',
          properties: {
            type: 'territory_link',
            from_parcel: parcels[i].parcelId,
            to_parcel: parcels[j].parcelId,
            distance_m: Math.round(dist),
            partial: true,
          },
          geometry: {
            type: 'LineString',
            coordinates: [from, to],
          },
        });
        console.log(`[TerritoryLinks] ${parcels[i].parcelId.slice(0, 8)} ↔ ${parcels[j].parcelId.slice(0, 8)}: PARTIAL link at ${Math.round(dist)}m`);
      }
    }
  }

  return { type: 'FeatureCollection', features };
}

// ============ Cache Read/Write Helpers ============

/** Fetch cached terrain data for multiple parcels from the API */
export async function fetchCachedTerrain(
  parcelIds: string[],
): Promise<{ results: Record<string, CachedParcelTerrain>; found: string[]; missing: string[] }> {
  try {
    const resp = await fetch(`/api/terrain-cache?parcelIds=${parcelIds.join(',')}`);
    if (!resp.ok) {
      console.warn('[TerrainCache] Fetch failed:', resp.status);
      return { results: {}, found: [], missing: [...parcelIds] };
    }
    const data = await resp.json();
    return data;
  } catch (err) {
    console.error('[TerrainCache] Fetch error:', err);
    return { results: {}, found: [], missing: [...parcelIds] };
  }
}

/** Write terrain data for a single parcel to the cache */
export async function writeCachedTerrain(
  parcelId: string,
  lat: number,
  lng: number,
  acreage: number,
  terrainData: CachedParcelTerrain,
): Promise<boolean> {
  try {
    const resp = await fetch('/api/terrain-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcelId,
        lat,
        lng,
        acreage,
        data: terrainData,
      }),
    });
    return resp.ok;
  } catch (err) {
    console.error('[TerrainCache] Write error:', err);
    return false;
  }
}
