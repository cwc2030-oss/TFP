/**
 * Stand Selection Debug Payload Builder
 *
 * Produces a transparent diagnostic payload for every stand candidate,
 * showing EXACTLY what drove each score so Clark can verify the model
 * isn't over-indexing on Deer Flow / corridor proximity.
 *
 * Does NOT change scoring. Pure instrumentation.
 */

import type { StandPointProperties } from '@/types/terrain';
import type { StandInputs, StandScore } from '@/lib/scoring/stand-alignment';

// ── Haversine distance (meters) ──
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Minimum distance from a point to any vertex of a LineString feature collection */
function minDistToFC(coord: [number, number], fc?: GeoJSON.FeatureCollection | null): number {
  if (!fc?.features?.length) return Infinity;
  let minD = Infinity;
  for (const f of fc.features) {
    if (f.geometry?.type === 'LineString') {
      for (const pt of (f.geometry as GeoJSON.LineString).coordinates) {
        const d = haversineM(coord, [pt[0], pt[1]]);
        if (d < minD) minD = d;
      }
    } else if (f.geometry?.type === 'Point') {
      const d = haversineM(coord, f.geometry.coordinates as [number, number]);
      if (d < minD) minD = d;
    } else if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') {
      const coords = f.geometry.type === 'Polygon'
        ? (f.geometry as GeoJSON.Polygon).coordinates[0]
        : (f.geometry as GeoJSON.MultiPolygon).coordinates.flatMap(p => p[0]);
      for (const pt of coords) {
        const d = haversineM(coord, [pt[0], pt[1]]);
        if (d < minD) minD = d;
      }
    }
  }
  return minD;
}

/** Proximity score: 1 at 0m, decays to 0 at radiusM */
function proximityScore(distM: number, radiusM: number): number {
  if (distM >= radiusM) return 0;
  return Math.max(0, 1 - distM / radiusM);
}

/** Minimum distance from point to nearest polygon ring vertex */
function minDistToPolygonRing(coord: [number, number], ring: number[][]): number {
  let minD = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    // Project point onto segment to get true distance
    const a = ring[i];
    const b = ring[i + 1];
    // Approximate with vertex distance for speed
    const dA = haversineM(coord, [a[0], a[1]]);
    const dB = haversineM(coord, [b[0], b[1]]);
    if (dA < minD) minD = dA;
    if (dB < minD) minD = dB;
  }
  return minD;
}

// ── Types ──

export interface StandCandidateDebug {
  rank: number;
  name: string;
  coords: [number, number];
  selected: boolean;  // made it into Top 3?

  // === FINAL SCORES ===
  final_score: number;       // alignment score (0-100)
  placement_score: number;   // raster pressure score from Modal (0-1, from props.score)

  // === SUB-SCORES (all 0-1 unless noted) ===
  deer_flow_score: number;       // movement input (corridor proximity decay)
  ridge_alignment_score: number; // proximity to ridge spines (primary + secondary)
  saddle_score: number;          // proximity to saddle nodes
  bedding_edge_score: number;    // inverse of distToBeddingMeters (proximity)
  wind_score: number;            // 1 - wind_overlap (0=bad, 1=clean)
  access_score: number;          // inverse of intrusion (1 - intrusion)
  parcel_safety_score: number;   // distance from parcel boundary (further = safer)
  cover_score: number;           // cover type quality
  edge_stand_score: number;      // bonus for field/timber edge
  resilience_score: number;      // pressure-based resilience

  // === RAW DISTANCES (meters) ===
  dist_to_corridor_m: number;
  dist_to_bedding_m: number;
  dist_to_ridge_m: number;
  dist_to_saddle_m: number;
  dist_to_parcel_edge_m: number;

  // === ALIGNMENT ENGINE INPUTS ===
  alignment_inputs: StandInputs;

  // === WEIGHT BREAKDOWN (alignment engine weights × inputs) ===
  weight_breakdown: {
    wind_contribution: number;      // 0.35 × wind_fit
    movement_contribution: number;  // 0.30 × movement
    intrusion_contribution: number; // 0.20 × intrusion_fit
    time_contribution: number;      // 0.10 × time_fit
    season_contribution: number;    // 0.05 × season_fit
  };

  // === REASON LIST ===
  reasons: string[];
}

export interface StandSelectionDebug {
  timestamp: string;
  wind_direction: string;
  season: string;
  total_candidates: number;
  selected_count: number;
  rejected_count: number;

  // Per-candidate detail
  candidates: StandCandidateDebug[];

  // Rejection reasons
  rejections: { rank: number; name: string; reason: string }[];

  // Model weight summary
  model_weights: {
    wind: 0.35;
    movement_corridor: 0.30;
    intrusion_access: 0.20;
    time_fit: 0.10;
    season_fit: 0.05;
  };

  // Diagnosis flags
  diagnosis: {
    deer_flow_dominance: boolean;  // true if movement contribution is > 40% of score for top stand
    wind_driving: boolean;         // true if wind contribution is > 45% for top stand
    balanced: boolean;             // true if no single factor > 40%
    top_factor: string;            // name of highest-contributing factor
    top_factor_pct: number;        // % of score from top factor
  };
}

export function buildStandSelectionDebug(opts: {
  allScored: Array<{
    rank: number;
    name: string;
    coords: [number, number];
    props: StandPointProperties;
    inputs: StandInputs;
    alignment: StandScore;
    resilience?: { score: number };
  }>;
  selectedRanks: Set<number>;   // ranks of stands that made it into Top 3
  rejections: Array<{ rank: number; name: string; reason: string }>;
  windDirection: string;
  season: string;
  // Terrain data for additional scoring
  ridgeSpineData?: {
    ridges_primary?: GeoJSON.FeatureCollection;
    ridges_secondary?: GeoJSON.FeatureCollection;
    saddle_nodes?: GeoJSON.FeatureCollection;
  } | null;
  beddingPolygons?: GeoJSON.FeatureCollection | null;
  parcelRings?: number[][][] | null;  // outer rings of parcel geometry
}): StandSelectionDebug {
  const candidates: StandCandidateDebug[] = [];

  for (const s of opts.allScored) {
    const coord = s.coords;
    const props = s.props;
    const inputs = s.inputs;
    const alignment = s.alignment;

    // === Compute additional sub-scores ===
    const distToRidge = Math.min(
      minDistToFC(coord, opts.ridgeSpineData?.ridges_primary),
      minDistToFC(coord, opts.ridgeSpineData?.ridges_secondary)
    );
    const distToSaddle = minDistToFC(coord, opts.ridgeSpineData?.saddle_nodes);

    const distToBedding = props.distToBeddingMeters ?? Infinity;
    const distToCorridor = props.distToCorridorMeters ?? Infinity;

    // Parcel edge distance — min distance to any parcel ring vertex
    let distToParcelEdge = Infinity;
    if (opts.parcelRings?.length) {
      for (const ring of opts.parcelRings) {
        const d = minDistToPolygonRing(coord, ring);
        if (d < distToParcelEdge) distToParcelEdge = d;
      }
    }

    // Derived sub-scores (0-1)
    const ridgeAlignmentScore = proximityScore(distToRidge, 200);   // 200m influence radius
    const saddleScore = proximityScore(distToSaddle, 250);          // 250m influence radius
    const beddingEdgeScore = proximityScore(distToBedding, 150);    // 150m — edge hunters
    const windScore = Math.max(0, 1 - inputs.wind_overlap);         // invert overlap → quality
    const accessScore = Math.max(0, 1 - inputs.intrusion);          // invert intrusion → safety
    const parcelSafetyScore = Math.min(1, distToParcelEdge / 100);  // 100m = max safety
    const deerFlowScore = inputs.movement;                          // already 0-1

    // Cover type scoring
    let coverScore = 0.5;
    if (props.coverType === 'timber') coverScore = 0.8;
    else if (props.coverType === 'edge') coverScore = 0.9;
    else if (props.coverType === 'draw') coverScore = 0.7;
    else if (props.coverType === 'open') coverScore = 0.2;

    const edgeStandScore = props.isEdgeStand ? (props.edgeConfidence ?? 0.5) : 0;
    const resilienceScore = s.resilience?.score ?? (props.standResilience ?? 0);

    // === Weight breakdown (alignment engine) ===
    const windFit = windScore;  // 1 - wind_overlap
    const intrusionFit = accessScore;  // 1 - intrusion
    const windContrib = 0.35 * windFit;
    const movementContrib = 0.30 * inputs.movement;
    const intrusionContrib = 0.20 * intrusionFit;
    const timeContrib = 0.10 * inputs.time_fit;
    const seasonContrib = 0.05 * inputs.season_fit;
    const totalRaw = windContrib + movementContrib + intrusionContrib + timeContrib + seasonContrib;

    // === Reasons ===
    const reasons: string[] = [];
    if (windScore >= 0.8) reasons.push(`Clean wind setup (${(windScore * 100).toFixed(0)}%)`);
    else if (windScore < 0.5) reasons.push(`Wind conflict (${(windScore * 100).toFixed(0)}% — consider rotating)`);

    if (deerFlowScore >= 0.6) reasons.push(`Strong corridor proximity (${Math.round(distToCorridor)}m to nearest corridor)`);
    else if (deerFlowScore < 0.3) reasons.push(`Weak corridor access (${Math.round(distToCorridor)}m — distant from movement corridors)`);

    if (ridgeAlignmentScore >= 0.3) reasons.push(`Ridge-aligned (${Math.round(distToRidge)}m to nearest spine)`);
    if (saddleScore >= 0.3) reasons.push(`Near saddle crossing (${Math.round(distToSaddle)}m)`);
    if (beddingEdgeScore >= 0.4) reasons.push(`Bedding edge position (${Math.round(distToBedding)}m to bedding)`);
    if (props.isEdgeStand) reasons.push(`Field/timber edge stand (confidence ${((props.edgeConfidence ?? 0) * 100).toFixed(0)}%)`);
    if (parcelSafetyScore < 0.3) reasons.push(`Close to parcel boundary (${Math.round(distToParcelEdge)}m — access risk)`);
    if (resilienceScore >= 0.5) reasons.push(`Good pressure resilience (${(resilienceScore * 100).toFixed(0)}%)`);

    candidates.push({
      rank: s.rank,
      name: s.name,
      coords: coord,
      selected: opts.selectedRanks.has(s.rank),
      final_score: alignment.score,
      placement_score: props.score / 100,  // normalize to 0-1
      deer_flow_score: deerFlowScore,
      ridge_alignment_score: ridgeAlignmentScore,
      saddle_score: saddleScore,
      bedding_edge_score: beddingEdgeScore,
      wind_score: windScore,
      access_score: accessScore,
      parcel_safety_score: parcelSafetyScore,
      cover_score: coverScore,
      edge_stand_score: edgeStandScore,
      resilience_score: resilienceScore,
      dist_to_corridor_m: Math.round(distToCorridor),
      dist_to_bedding_m: Math.round(distToBedding),
      dist_to_ridge_m: Math.round(distToRidge === Infinity ? -1 : distToRidge),
      dist_to_saddle_m: Math.round(distToSaddle === Infinity ? -1 : distToSaddle),
      dist_to_parcel_edge_m: Math.round(distToParcelEdge === Infinity ? -1 : distToParcelEdge),
      alignment_inputs: inputs,
      weight_breakdown: {
        wind_contribution: Math.round(windContrib * 1000) / 1000,
        movement_contribution: Math.round(movementContrib * 1000) / 1000,
        intrusion_contribution: Math.round(intrusionContrib * 1000) / 1000,
        time_contribution: Math.round(timeContrib * 1000) / 1000,
        season_contribution: Math.round(seasonContrib * 1000) / 1000,
      },
      reasons,
    });
  }

  // Sort by final_score descending
  candidates.sort((a, b) => b.final_score - a.final_score);

  // === Diagnosis ===
  const topCandidate = candidates[0];
  let diagnosis = {
    deer_flow_dominance: false,
    wind_driving: false,
    balanced: true,
    top_factor: 'none',
    top_factor_pct: 0,
  };

  if (topCandidate) {
    const wb = topCandidate.weight_breakdown;
    const totalWeight = wb.wind_contribution + wb.movement_contribution +
      wb.intrusion_contribution + wb.time_contribution + wb.season_contribution;

    if (totalWeight > 0) {
      const factors: { name: string; value: number }[] = [
        { name: 'wind', value: wb.wind_contribution },
        { name: 'movement_corridor', value: wb.movement_contribution },
        { name: 'intrusion_access', value: wb.intrusion_contribution },
        { name: 'time_fit', value: wb.time_contribution },
        { name: 'season_fit', value: wb.season_contribution },
      ];
      factors.sort((a, b) => b.value - a.value);
      const topFactor = factors[0];
      const topPct = (topFactor.value / totalWeight) * 100;

      diagnosis = {
        deer_flow_dominance: topFactor.name === 'movement_corridor' && topPct > 40,
        wind_driving: topFactor.name === 'wind' && topPct > 45,
        balanced: topPct <= 40,
        top_factor: topFactor.name,
        top_factor_pct: Math.round(topPct),
      };
    }
  }

  return {
    timestamp: new Date().toISOString(),
    wind_direction: opts.windDirection,
    season: opts.season,
    total_candidates: opts.allScored.length,
    selected_count: opts.selectedRanks.size,
    rejected_count: opts.rejections.length,
    candidates,
    rejections: opts.rejections,
    model_weights: {
      wind: 0.35,
      movement_corridor: 0.30,
      intrusion_access: 0.20,
      time_fit: 0.10,
      season_fit: 0.05,
    },
    diagnosis,
  };
}
