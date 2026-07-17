/**
 * Terrain Story Generator
 * 
 * Analyzes terrain flow data to generate human-readable narratives
 * explaining the structural drivers and key opportunities on a parcel.
 * 
 * Used to help brokers and buyers quickly understand "why this land matters"
 */

import type { TerrainFlowResponse, OpportunityZoneProperties } from '@/types/terrain-flow';

// ========== TYPES ==========

export interface StructuralDriverScore {
  score: number;           // 0-1 normalized score
  label: string;           // Human-readable label
  shortLabel: string;      // 2-3 word label for badges
  description: string;     // One sentence explanation
  icon: 'bench' | 'saddle' | 'ridge' | 'convergence';
  // Phase 1 honesty guard: true when this score is NOT derived from direct
  // per-parcel DEM measurement (currently Bench & Ridge, which are blended
  // from global weight constants). The UI must mark these as estimates and
  // never present them as confident measured structure. Removed in Phase 2
  // once Bench/Ridge are driven from real per-parcel DEM grids.
  estimated?: boolean;
}

export interface StructuralDrivers {
  benchSupport: StructuralDriverScore;
  saddleInfluence: StructuralDriverScore;
  ridgeSpineSupport: StructuralDriverScore;
  convergenceDensity: StructuralDriverScore;
}

export type MovementDriver = 
  | 'ridge-to-saddle-compression'
  | 'sidehill-bench-travel'
  | 'draw-funneling'
  | 'terrain-pinch'
  | 'parallel-ridge-travel'
  | 'saddle-crossing'
  | 'bench-contour-travel'
  | 'mixed-terrain';

export interface TerrainStorySummary {
  // Core narrative elements
  primaryDriver: {
    type: MovementDriver;
    label: string;
    confidence: number;
  };
  secondaryDriver: {
    type: MovementDriver;
    label: string;
    confidence: number;
  } | null;
  keyOpportunity: {
    location: string;          // e.g., "southwest convergence zone"
    reason: string;            // e.g., "Multiple flows meet at saddle"
    score: number;
  } | null;
  
  // Structural drivers breakdown
  drivers: StructuralDrivers;
  
  // One-liner summary
  headline: string;
  
  // Extended narrative (2-3 sentences)
  narrative: string;
  
  // Confidence in the overall story
  confidence: 'high' | 'medium' | 'low';

  // Phase 1 honesty guard: true only when the parcel has real, per-parcel
  // measured relief (real DEM ridge/saddle extraction found structure).
  // When false, the ground is flat / low-relief and the UI must present the
  // story honestly (gentle terrain, estimated Bench/Ridge, no "High confidence").
  reliefMeasured: boolean;

  // THREE honest states mirrored from the shared backbone verdict
  // (metadata.backbone.state). The single field every UI surface keys off so
  // narrative, badges, funnel-count copy, and map render can never contradict:
  //   'confirmed' — real backbone, draw flow + confident copy
  //   'marginal'  — single spine in the gap band, "detected — scout it", no flow
  //   'flat'      — honest low-relief / empty
  terrainState: 'confirmed' | 'marginal' | 'flat';
}

// ========== DRIVER LABELS ==========

const MOVEMENT_DRIVER_LABELS: Record<MovementDriver, string> = {
  'ridge-to-saddle-compression': 'Ridge-to-Saddle Compression',
  'sidehill-bench-travel': 'Sidehill Bench Travel',
  'draw-funneling': 'Draw Funneling',
  'terrain-pinch': 'Terrain Pinch Point',
  'parallel-ridge-travel': 'Parallel Ridge Travel',
  'saddle-crossing': 'Saddle Crossing',
  'bench-contour-travel': 'Bench Contour Travel',
  'mixed-terrain': 'Mixed Terrain Influence',
};

// ========== STORY GENERATION ==========

/**
 * Compute structural driver scores from terrain flow data
 */
export function computeStructuralDrivers(
  flowData: TerrainFlowResponse | null,
  ridgeSpineData?: {
    ridges_primary?: GeoJSON.FeatureCollection;
    ridges_secondary?: GeoJSON.FeatureCollection;
    saddle_nodes?: GeoJSON.FeatureCollection;
    metadata?: {
      saddle_count?: number;
      ridge_count_primary?: number;
      ridge_count_secondary?: number;
      total_ridge_length_m?: number;
    };
  } | null
): StructuralDrivers {
  if (!flowData) {
    return getEmptyDrivers();
  }
  
  const { metadata, opportunity_zones, convergence_zones, flow_primary, flow_secondary } = flowData;
  
  // Extract weights used in analysis
  const weights = metadata?.weights || {};
  
  // ========== PHASE 2a: MEASURED Bench & Ridge from real per-parcel DEM ==========
  // Bench & Ridge are now derived DIRECTLY from the real ridge/saddle features
  // extracted from the per-parcel USGS 3DEP DEM (Modal ridge endpoint) — ridge
  // count, total ridge length, per-ridge prominence (ft) and per-ridge average
  // slope (deg). No global weight constant (bench_likelihood / spine_proximity)
  // is blended in, so flat ground no longer inherits a false ~0.64 Bench /
  // ~0.42 Ridge floor. When relief is measured the scores are real and marked
  // estimated:false, so the UI surfaces both rows as measured structure.
  const ridgeCountPrimary = ridgeSpineData?.metadata?.ridge_count_primary ?? 0;
  const ridgeCountSecondary = ridgeSpineData?.metadata?.ridge_count_secondary ?? 0;
  const ridgeCount = ridgeCountPrimary + ridgeCountSecondary;
  const saddleCount = ridgeSpineData?.metadata?.saddle_count ?? 0;
  const totalRidgeLengthM = ridgeSpineData?.metadata?.total_ridge_length_m ?? 0;

  // RIDGE INFLUENCE is a MEASURED relief score (count + length + prominence +
  // saddles), NOT the primary-spine COUNT shown in the panel/ScoreCard/PDF.
  // These are two different things: the count reflects how many discrete primary
  // spine polylines survived the water-body filter (often 0 on real ground),
  // while the influence reflects measured vertical relief and structure. We do
  // NOT gate the influence score on the displayed spine count — doing so zeroed
  // ridge influence on nearly every real parcel (e.g. saddle-driven terrain with
  // 0 primary spines but genuine relief). The influence therefore reflects its
  // real Phase-2a measurement and is honestly 0 only when relief is truly absent
  // (flat ground: no primary ridge AND no saddle).

  // Real, per-parcel measured relief signal (ridge/saddle extraction from DEM).
  // IMPORTANT — honest flat-terrain guard: a genuine structural parcel is
  // indicated by a PRIMARY (dominant) ridge spine or by measured saddles. On
  // flat cropland (e.g. 0–1% slope prime farmland) the DEM extraction can still
  // surface a couple of weak SECONDARY spines inside the 400m analysis buffer —
  // these are minor micro-relief, not real ridge structure. Counting them as
  // measured relief made flat ground read "Ridge ~58% / Bench ~25%", which is
  // dishonest. We therefore require at least one primary ridge OR at least one
  // saddle before treating the parcel as having measured structure. Secondary
  // spines still add magnitude once real structure is confirmed, but never
  // establish it on their own.
  const hasMeasuredRelief = ridgeCountPrimary >= 1 || saddleCount >= 1;

  // Real per-ridge DEM attributes (prominence + average flank slope).
  const allRidgeFeatures = [
    ...(ridgeSpineData?.ridges_primary?.features ?? []),
    ...(ridgeSpineData?.ridges_secondary?.features ?? []),
  ];
  const ridgesWithSlope = allRidgeFeatures.filter(
    f => (f.properties as any)?.avgSlopeDeg != null
  );
  const avgProminenceFt = allRidgeFeatures.length
    ? allRidgeFeatures.reduce(
        (s, f) => s + Math.max(0, (f.properties as any)?.prominenceFt ?? 0), 0
      ) / allRidgeFeatures.length
    : 0;
  // Bench-forming flanks: ridge segments whose measured average slope sits in
  // the shelf-favorable band (4–16°). Steep crests (>16°) rarely hold benches.
  const benchFavorableRidges = ridgesWithSlope.filter(f => {
    const s = (f.properties as any).avgSlopeDeg as number;
    return s >= 4 && s <= 16;
  }).length;

  // --- Ridge / spine support (MEASURED from real ridge extraction) ---
  //   count: how many distinct spines were extracted
  //   length: how far the measured spine network extends (≥~1km → well-developed)
  //   prominence: how much real vertical relief the spines carry (≥~60ft → strong)
  const ridgeCountComponent =
    ridgeCount >= 6 ? 0.55 :
    ridgeCount >= 4 ? 0.45 :
    ridgeCount >= 2 ? 0.32 :
    ridgeCount >= 1 ? 0.20 : 0;
  const ridgeLengthComponent = Math.min(0.25, (totalRidgeLengthM / 1000) * 0.25);
  const ridgeProminenceComponent = Math.min(0.20, (avgProminenceFt / 60) * 0.20);
  const ridgeSpineSupport = hasMeasuredRelief
    ? Math.min(1, ridgeCountComponent + ridgeLengthComponent + ridgeProminenceComponent)
    : 0; // no measured relief (flat ground: no primary ridge AND no saddle) → honest 0

  // --- Bench support (MEASURED from real ridge-flank geometry) ---
  // Benches are shelves on ridge flanks; prevalence scales with how many
  // measured ridges present shelf-favorable slopes plus the extent of flank.
  // When per-ridge slope data is unavailable, fall back to a ridge-count proxy
  // so real ridge parcels still register measured bench structure.
  const benchFlankComponent = ridgesWithSlope.length > 0
    ? (benchFavorableRidges >= 4 ? 0.55 :
       benchFavorableRidges >= 2 ? 0.38 :
       benchFavorableRidges >= 1 ? 0.22 : 0)
    : (ridgeCount >= 4 ? 0.4 : ridgeCount >= 2 ? 0.26 : ridgeCount >= 1 ? 0.15 : 0);
  const benchLengthComponent = Math.min(0.25, (totalRidgeLengthM / 1200) * 0.25);
  const benchSupport = hasMeasuredRelief
    ? Math.min(1, benchFlankComponent + benchLengthComponent)
    : 0; // no measured relief → honest 0 (flat / low-relief ground)

  // --- Saddle influence (REAL: driven by measured saddle count) ---
  const saddleWeight = weights.saddle_proximity || 0;
  const saddleInfluence = Math.min(1, (
    (saddleCount >= 5 ? 0.6 : saddleCount >= 3 ? 0.45 : saddleCount >= 1 ? 0.3 : 0) +
    saddleWeight * 1.5
  ));

  // --- Convergence density (Phase 3: real, continuous) ---
  // Reads from the real network-derived convergence zones. The old
  // (count/5)*0.5 + avg*0.5 formula snapped the number to 10% steps and clustered
  // every parcel near 70-90%. We now score continuously from real signal:
  //   - peakIntensity: the strongest real meeting point on the parcel
  //   - avgIntensity : overall meeting quality across zones
  //   - breadth      : how many real zones exist, smoothly (1 - e^(-n/2.5)),
  //                    so it grows without hard 10% jumps and never over-weights
  //                    a parcel that simply has many weak nodes.
  //
  // v6.3 (Option A) — honesty reconciliation. The flow-derived convergence_zones
  // are frequently EMPTY on real parcels: the flow-line density surface clears
  // the convergence_threshold only occasionally, and near-boundary maxima used to
  // be clipped out entirely (see filterConvergenceZonesToParcel). Yet the SAME
  // parcel visibly shows real saddle pinch points on the map (the ghost-saddle
  // silhouettes) and the narrative reads "Ridge-to-Saddle Compression" from the
  // measured saddles. A saddle IS a terrain pinch. So when the flow convergence
  // signal is empty or sparse we ALSO derive a convergence score from the real
  // measured saddle pinch nodes (ridge_extraction `saddle_nodes`, each carrying
  // its true DEM depth `ridgeDropFt`) — the identical upstream source the
  // ghost-saddle layer and `saddleInfluence` already use. The final score is the
  // MAX of the two real signals: strong flow convergence still wins, but a parcel
  // that visibly pinches at saddles can never read a false 0. Honest 0 is
  // preserved only when there are genuinely NO convergence zones AND NO saddles.

  // (1) Flow-line-derived convergence (original signal).
  const convergenceIntensities = (convergence_zones?.features ?? []).map(f => f?.properties?.intensity || 0);
  const convergenceCount = convergenceIntensities.length;
  const peakConvergence = convergenceCount > 0 ? Math.max(...convergenceIntensities) : 0;
  const avgConvergence = convergenceCount > 0
    ? convergenceIntensities.reduce((a, b) => a + b, 0) / convergenceCount
    : 0;
  const convergenceBreadth = convergenceCount > 0 ? 1 - Math.exp(-convergenceCount / 2.5) : 0;
  const flowConvergenceDensity = convergenceCount === 0 ? 0 : Math.min(1, Math.max(0, (
    peakConvergence * 0.6 +
    avgConvergence * 0.15 +
    convergenceBreadth * 0.25
  )));

  // (2) Saddle-pinch-derived convergence (the real pinch signal shown on the map
  // and used by the narrative). Each measured saddle node is a pinch point; its
  // strength is the real DEM drop (`ridgeDropFt`). Normalize per-saddle depth to a
  // 0-1 pinch intensity, then score with the SAME peak/avg/breadth shape as the
  // flow signal so the two are directly comparable. When node features are absent
  // but the measured saddle_count is real, fall back to a modest count-driven
  // signal so the driver still reflects the measured saddle total.
  //
  // v6.3 de-saturation: the depth normalizer is 60ft (was 40ft). At 40ft a single
  // ordinary 44ft pass already capped the peak term at 1.0, bunching genuinely
  // deep saddles up at 80-90% and erasing the difference between a good pinch and
  // a great one. A 60ft normalizer means only a truly major pass (>=60ft drop)
  // reads as a full-strength pinch, so the deep end now SPREADS: a ~44ft saddle
  // reads ~0.73, a ~29ft saddle ~0.48, and the score differentiates good from
  // great instead of saturating. Shallow saddles still read low-moderate and a
  // flat parcel (no saddles) is still an honest 0.
  const SADDLE_PINCH_NORMALIZER_FT = 60;
  const saddleNodeFeatures = ridgeSpineData?.saddle_nodes?.features ?? [];
  const saddlePinchIntensities = saddleNodeFeatures.map(f => {
    const dropFt = (f.properties as any)?.ridgeDropFt ?? 15;
    return Math.min(1, Math.max(0, dropFt / SADDLE_PINCH_NORMALIZER_FT));
  });
  const DEFAULT_SADDLE_PINCH = 15 / SADDLE_PINCH_NORMALIZER_FT; // 15ft default depth / 60ft normalizer = 0.25
  const saddlePinchCount = saddlePinchIntensities.length > 0
    ? saddlePinchIntensities.length
    : saddleCount;
  const peakSaddlePinch = saddlePinchIntensities.length > 0
    ? Math.max(...saddlePinchIntensities)
    : (saddleCount > 0 ? DEFAULT_SADDLE_PINCH : 0);
  const avgSaddlePinch = saddlePinchIntensities.length > 0
    ? saddlePinchIntensities.reduce((a, b) => a + b, 0) / saddlePinchIntensities.length
    : (saddleCount > 0 ? DEFAULT_SADDLE_PINCH : 0);
  const saddlePinchBreadth = saddlePinchCount > 0 ? 1 - Math.exp(-saddlePinchCount / 2.5) : 0;
  const saddlePinchDensity = saddlePinchCount === 0 ? 0 : Math.min(1, Math.max(0, (
    peakSaddlePinch * 0.6 +
    avgSaddlePinch * 0.15 +
    saddlePinchBreadth * 0.25
  )));

  // (3) Reconciled convergence: the stronger of the two real signals. Never a
  // false 0 while the map is showing real saddle pinches; honest 0 only when
  // neither flow convergence nor saddles exist on the parcel.
  const convergenceDensity = Math.max(flowConvergenceDensity, saddlePinchDensity);

  return {
    benchSupport: {
      score: benchSupport,
      label: getBenchLabel(benchSupport),
      shortLabel: 'Bench',
      description: getBenchDescription(benchSupport),
      icon: 'bench',
      estimated: false, // PHASE 2a: measured from real per-parcel DEM ridge-flank geometry
    },
    saddleInfluence: {
      score: saddleInfluence,
      label: getSaddleLabel(saddleInfluence),
      shortLabel: 'Saddle',
      description: getSaddleDescription(saddleInfluence),
      icon: 'saddle',
      estimated: false, // driven by real measured saddle count
    },
    ridgeSpineSupport: {
      score: ridgeSpineSupport,
      label: getRidgeLabel(ridgeSpineSupport),
      // Relabeled 'Ridge' → 'Ridge influence' (Option C): this is a blended
      // measured influence SCORE, not the primary-spine count shown in the panel.
      shortLabel: 'Ridge influence',
      description: getRidgeDescription(ridgeSpineSupport),
      icon: 'ridge',
      estimated: false, // PHASE 2a: measured from real per-parcel DEM ridge extraction (count/length/prominence)
    },
    convergenceDensity: {
      score: convergenceDensity,
      label: getConvergenceLabel(convergenceDensity),
      shortLabel: 'Convergence',
      description: getConvergenceDescription(convergenceDensity),
      icon: 'convergence',
      estimated: false,
    },
  };
}

/**
 * Generate the complete terrain story from flow data
 */
export function generateTerrainStory(
  flowData: TerrainFlowResponse | null,
  parcelAcreage?: number,
  parcelAddress?: string,
  ridgeSpineData?: {
    ridges_primary?: GeoJSON.FeatureCollection;
    ridges_secondary?: GeoJSON.FeatureCollection;
    saddle_nodes?: GeoJSON.FeatureCollection;
    metadata?: {
      saddle_count?: number;
      ridge_count_primary?: number;
      ridge_count_secondary?: number;
      total_ridge_length_m?: number;
    };
  } | null
): TerrainStorySummary {
  if (!flowData) {
    return getEmptyStory();
  }

  // Shared no-backbone verdict (see lib/terrain-backbone.ts): the flow engine
  // has ALREADY decided this parcel has no real terrain backbone (single spine
  // below the lone-spine prominence bar). Honor that SAME determination here so
  // the story reads honest low-relief instead of re-deriving "structure" from
  // raw saddle counts. This is the shared verdict both readings consult — the
  // story is NOT reading the flow line count; it reads the one stamped verdict.
  const backbone = (flowData.metadata as any)?.backbone;
  // THREE honest states off the ONE verdict. Prefer the explicit state field;
  // fall back to the boolean for any legacy envelope that predates it.
  const bbState: 'confirmed' | 'marginal' | 'flat' | undefined =
    backbone?.state ?? (backbone ? (backbone.hasRealBackbone === false ? 'flat' : 'confirmed') : undefined);
  if (bbState === 'marginal') {
    console.log(
      '[TerrainStory] Honoring shared MARGINAL verdict — detected-but-unconfirmed story. reason=%s',
      backbone?.reason,
    );
    return getMarginalStory(backbone?.maxProminenceFt);
  }
  if (bbState === 'flat') {
    console.log(
      '[TerrainStory] Honoring shared no-backbone verdict — low-relief story. reason=%s',
      backbone?.reason,
    );
    return getLowReliefStory();
  }

  try {
  const drivers = computeStructuralDrivers(flowData, ridgeSpineData);

  // Phase 1 + 2a honesty guard: real, per-parcel measured relief signal.
  // Structure must be established by a PRIMARY (dominant) ridge spine or by
  // measured saddles — weak secondary spines picked up in the analysis buffer
  // around flat cropland must NOT flip the parcel to "structured" (see the
  // matching guard in computeStructuralDrivers). We pass the primary-ridge
  // count into the confidence model so flat farmland with only secondary
  // micro-relief honestly reads Low / "Gentle, low-relief terrain".
  const ridgeCountPrimary = ridgeSpineData?.metadata?.ridge_count_primary ?? 0;
  const saddleCount = ridgeSpineData?.metadata?.saddle_count ?? 0;
  const reliefMeasured = ridgeCountPrimary >= 1 || saddleCount >= 1;
  
  // Determine primary and secondary movement drivers
  const { primaryDriver, secondaryDriver } = determineMovementDrivers(drivers, flowData);
  
  // Find key opportunity zone
  const keyOpportunity = findKeyOpportunity(flowData);
  
  // Generate headline (honest "gentle terrain" when no measured relief)
  const headline = generateHeadline(primaryDriver, secondaryDriver, drivers, reliefMeasured);
  
  // Generate narrative
  const narrative = generateNarrative(drivers, primaryDriver, secondaryDriver, keyOpportunity, parcelAcreage);

  // Determine confidence (gated on real measured relief, NOT the constant Bench)
  const confidence = determineConfidence(drivers, flowData, ridgeCountPrimary, saddleCount);
  
  return {
    primaryDriver,
    secondaryDriver,
    keyOpportunity,
    drivers,
    headline,
    narrative,
    confidence,
    reliefMeasured,
    terrainState: 'confirmed',
  };
  } catch (err) {
    // Analysis compute must never throw and blank the intel view. Surface the
    // real cause (full message + stack) to the console for diagnosis, then
    // degrade to an honest "analysis incomplete" story rather than crashing.
    const e = err as Error;
    console.error(
      '[TerrainStory] generateTerrainStory threw — returning empty story. ' +
      `message="${e?.message ?? String(err)}"`,
      '\nstack:', e?.stack ?? '(no stack)',
    );
    return getEmptyStory();
  }
}

// ========== HELPER FUNCTIONS ==========

function getEmptyDrivers(): StructuralDrivers {
  return {
    benchSupport: { score: 0, label: 'Not detected', shortLabel: 'Bench', description: 'No bench terrain identified', icon: 'bench', estimated: false },
    saddleInfluence: { score: 0, label: 'Not detected', shortLabel: 'Saddle', description: 'No saddle influence identified', icon: 'saddle', estimated: false },
    ridgeSpineSupport: { score: 0, label: 'Not detected', shortLabel: 'Ridge influence', description: 'No ridge structure identified', icon: 'ridge', estimated: false },
    convergenceDensity: { score: 0, label: 'Not detected', shortLabel: 'Convergence', description: 'No flow convergence detected', icon: 'convergence', estimated: false },
  };
}

function getEmptyStory(): TerrainStorySummary {
  return {
    primaryDriver: { type: 'mixed-terrain', label: 'Mixed Terrain Influence', confidence: 0.3 },
    secondaryDriver: null,
    keyOpportunity: null,
    drivers: getEmptyDrivers(),
    headline: 'Terrain analysis incomplete',
    narrative: 'Run terrain flow analysis to reveal movement patterns and opportunity zones.',
    confidence: 'low',
    reliefMeasured: false,
    terrainState: 'flat',
  };
}

// Honest MARGINAL reading. Returned when the shared backbone verdict says a
// single qualified spine sits in the gap band [54,60) ft — real relief was
// detected but it does not clear the confidence bar. Distinct from low-relief
// (nothing there) and from confirmed (draw flow): here we tell the hunter what
// IS there and to go scout it, WITHOUT drawing flow that would over-claim.
function getMarginalStory(maxProminenceFt?: number): TerrainStorySummary {
  const relief = maxProminenceFt ? `~${Math.round(maxProminenceFt)} ft of relief` : 'some relief';
  return {
    primaryDriver: { type: 'mixed-terrain', label: 'Marginal Structure', confidence: 0.45 },
    secondaryDriver: null,
    keyOpportunity: null,
    drivers: getEmptyDrivers(),
    headline: 'Marginal structure — a single spine detected, unconfirmed',
    narrative:
      `We picked up a single ridge spine carrying ${relief} on this parcel, but it sits below the ` +
      'threshold where terrain reliably funnels deer. There is something here worth a look — walk the ' +
      'spine and its ends for sign, benches, and pinch points — but treat it as a scouting lead, not a ' +
      'confirmed terrain funnel. We are not drawing movement flow until the structure earns it.',
    confidence: 'low',
    reliefMeasured: true,
    terrainState: 'marginal',
  };
}

// Honest low-relief reading. Returned when the shared backbone verdict says this
// parcel has no real terrain backbone (see lib/terrain-backbone.ts). Distinct
// from getEmptyStory ("analysis incomplete"): here analysis SUCCEEDED and the
// honest finding is that terrain does not funnel movement on this ground.
function getLowReliefStory(): TerrainStorySummary {
  return {
    primaryDriver: { type: 'mixed-terrain', label: 'Gentle Terrain', confidence: 0.3 },
    secondaryDriver: null,
    keyOpportunity: null,
    drivers: getEmptyDrivers(),
    headline: 'Gentle, low-relief terrain — limited structural funneling',
    narrative:
      'This parcel shows gentle, low-relief ground with no dominant ridge backbone driving movement. ' +
      'Deer travel here is dispersed rather than funneled by terrain — focus on food sources, cover ' +
      'edges, and sign rather than terrain pinch points.',
    confidence: 'low',
    reliefMeasured: false,
    terrainState: 'flat',
  };
}

function getBenchLabel(score: number): string {
  if (score >= 0.7) return 'Strong bench support';
  if (score >= 0.4) return 'Moderate bench influence';
  if (score > 0.1) return 'Light bench presence';
  return 'Minimal bench terrain';
}

function getBenchDescription(score: number): string {
  if (score >= 0.7) return 'Prominent benches provide preferred travel corridors along contours';
  if (score >= 0.4) return 'Some bench terrain offers sidehill travel routes';
  if (score > 0.1) return 'Limited bench features may influence movement';
  return 'Terrain lacks significant bench structure';
}

function getSaddleLabel(score: number): string {
  if (score >= 0.7) return 'Strong saddle influence';
  if (score >= 0.4) return 'Moderate saddle presence';
  if (score > 0.1) return 'Light saddle influence';
  return 'Minimal saddle terrain';
}

function getSaddleDescription(score: number): string {
  if (score >= 0.7) return 'Prominent saddles act as natural crossing points and funnels';
  if (score >= 0.4) return 'Saddle terrain concentrates movement at key points';
  if (score > 0.1) return 'Some saddle features may channel movement';
  return 'Terrain lacks significant saddle crossings';
}

function getRidgeLabel(score: number): string {
  if (score >= 0.7) return 'Strong ridge/spine structure';
  if (score >= 0.4) return 'Moderate ridge presence';
  if (score > 0.1) return 'Light ridge influence';
  return 'Minimal ridge structure';
}

function getRidgeDescription(score: number): string {
  if (score >= 0.7) return 'Well-defined ridges create travel corridors and visual barriers';
  if (score >= 0.4) return 'Ridge lines guide movement patterns along high ground';
  if (score > 0.1) return 'Some ridge features influence travel routes';
  return 'Terrain lacks dominant ridge structure';
}

function getConvergenceLabel(score: number): string {
  if (score >= 0.7) return 'High convergence density';
  if (score >= 0.4) return 'Moderate convergence';
  if (score > 0.1) return 'Light convergence';
  return 'Minimal convergence';
}

function getConvergenceDescription(score: number): string {
  if (score >= 0.7) return 'Multiple flow paths converge, creating high-value pinch points';
  if (score >= 0.4) return 'Several flows meet at strategic locations';
  if (score > 0.1) return 'Some flow convergence at isolated points';
  return 'Flow paths remain largely independent';
}

function determineMovementDrivers(
  drivers: StructuralDrivers,
  flowData: TerrainFlowResponse
): { 
  primaryDriver: TerrainStorySummary['primaryDriver']; 
  secondaryDriver: TerrainStorySummary['secondaryDriver'];
} {
  // Score each movement pattern based on driver combinations
  const patterns: { type: MovementDriver; score: number }[] = [
    {
      type: 'ridge-to-saddle-compression',
      score: drivers.ridgeSpineSupport.score * 0.5 + drivers.saddleInfluence.score * 0.5,
    },
    {
      type: 'sidehill-bench-travel',
      score: drivers.benchSupport.score * 0.8 + drivers.ridgeSpineSupport.score * 0.2,
    },
    {
      type: 'draw-funneling',
      score: drivers.convergenceDensity.score * 0.6 + (1 - drivers.ridgeSpineSupport.score) * 0.4,
    },
    {
      type: 'terrain-pinch',
      score: drivers.convergenceDensity.score * 0.5 + drivers.saddleInfluence.score * 0.5,
    },
    {
      type: 'parallel-ridge-travel',
      score: drivers.ridgeSpineSupport.score * 0.7 + (1 - drivers.saddleInfluence.score) * 0.3,
    },
    {
      type: 'saddle-crossing',
      score: drivers.saddleInfluence.score * 0.8 + drivers.convergenceDensity.score * 0.2,
    },
    {
      type: 'bench-contour-travel',
      score: drivers.benchSupport.score * 0.9 + (1 - drivers.convergenceDensity.score) * 0.1,
    },
  ];
  
  // Sort by score
  patterns.sort((a, b) => b.score - a.score);
  
  const primary = patterns[0];
  const secondary = patterns[1];
  
  return {
    primaryDriver: {
      type: primary.type,
      label: MOVEMENT_DRIVER_LABELS[primary.type],
      confidence: primary.score,
    },
    secondaryDriver: secondary.score > 0.25 ? {
      type: secondary.type,
      label: MOVEMENT_DRIVER_LABELS[secondary.type],
      confidence: secondary.score,
    } : null,
  };
}

function findKeyOpportunity(
  flowData: TerrainFlowResponse
): TerrainStorySummary['keyOpportunity'] {
  // Guard: drop malformed features (null/undefined properties or geometry)
  // so a single bad opportunity zone can't throw and blank the whole story.
  const opportunities = (flowData.opportunity_zones?.features ?? []).filter(
    (f) => f && f.properties && f.geometry && (f.geometry as any).coordinates,
  );
  
  if (opportunities.length === 0) {
    return null;
  }
  
  // Find highest-scoring opportunity
  const best = opportunities.reduce((prev, curr) => 
    ((curr.properties?.score ?? 0) > (prev.properties?.score ?? 0)) ? curr : prev
  );
  
  const props = (best.properties ?? {}) as Partial<OpportunityZoneProperties>;
  const coords = best.geometry.coordinates as [number, number];
  
  // Determine location description
  const bbox = flowData.bbox ?? [0, 0, 0, 0];
  const centerLng = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  
  let nsDir = '';
  let ewDir = '';
  
  if (coords[1] > centerLat + 0.0005) nsDir = 'north';
  else if (coords[1] < centerLat - 0.0005) nsDir = 'south';
  
  if (coords[0] > centerLng + 0.0005) ewDir = 'east';
  else if (coords[0] < centerLng - 0.0005) ewDir = 'west';
  
  const location = nsDir && ewDir 
    ? `${nsDir}${ewDir} convergence zone`
    : nsDir ? `${nsDir} convergence zone`
    : ewDir ? `${ewDir} convergence zone`
    : 'central convergence zone';
  
  // Determine reason
  let reason = 'Multiple terrain factors combine here';
  if ((props.convergenceBonus ?? 0) > 0.3 && (props.saddleBonus ?? 0) > 0.2) {
    reason = 'Multiple flows meet at saddle crossing';
  } else if ((props.benchBonus ?? 0) > 0.3) {
    reason = 'Bench terrain concentrates travel';
  } else if ((props.convergenceBonus ?? 0) > 0.3) {
    reason = 'Flow paths converge at pinch point';
  } else if ((props.saddleBonus ?? 0) > 0.2) {
    reason = 'Saddle creates natural crossing';
  } else if ((props.flowIntensity ?? 0) > 0.6) {
    reason = 'High-intensity flow corridor';
  }
  
  return {
    location,
    reason,
    score: props.score ?? 0,
  };
}

function generateHeadline(
  primary: TerrainStorySummary['primaryDriver'],
  secondary: TerrainStorySummary['secondaryDriver'],
  drivers: StructuralDrivers,
  reliefMeasured: boolean = true
): string {
  // Phase 1 honesty guard: flat / low-relief ground with NO measured ridges or
  // saddles must NOT be given a ridge-driven headline. Report it honestly.
  if (!reliefMeasured) {
    return 'Gentle, low-relief terrain — limited structural funneling';
  }

  // Get the dominant driver
  const driverScores = [
    { name: 'bench', score: drivers.benchSupport.score },
    { name: 'saddle', score: drivers.saddleInfluence.score },
    { name: 'ridge', score: drivers.ridgeSpineSupport.score },
    { name: 'convergence', score: drivers.convergenceDensity.score },
  ].sort((a, b) => b.score - a.score);
  
  const dominant = driverScores[0];
  
  if (dominant.score < 0.3) {
    return 'Gentle terrain with distributed movement patterns';
  }
  
  switch (dominant.name) {
    case 'ridge':
      return drivers.saddleInfluence.score > 0.4
        ? 'Ridge-driven terrain with saddle crossings'
        : 'Ridge-spine controlled movement corridors';
    case 'saddle':
      return drivers.convergenceDensity.score > 0.4
        ? 'Saddle-focused terrain with strong convergence'
        : 'Saddle-dominated crossing terrain';
    case 'bench':
      return drivers.ridgeSpineSupport.score > 0.4
        ? 'Bench travel along ridge structure'
        : 'Sidehill bench-controlled movement';
    case 'convergence':
      return 'High-convergence terrain with multiple pinch points';
    default:
      return 'Mixed terrain influence pattern';
  }
}

function generateNarrative(
  drivers: StructuralDrivers,
  primary: TerrainStorySummary['primaryDriver'],
  secondary: TerrainStorySummary['secondaryDriver'],
  keyOpp: TerrainStorySummary['keyOpportunity'],
  acreage?: number
): string {
  const parts: string[] = [];
  
  // First sentence: primary driver
  parts.push(`Movement on this parcel is primarily driven by ${primary.label.toLowerCase()}.`);
  
  // Second sentence: supporting features
  const strongFeatures = [
    drivers.benchSupport.score >= 0.5 ? 'bench terrain' : null,
    drivers.saddleInfluence.score >= 0.5 ? 'saddle crossings' : null,
    drivers.ridgeSpineSupport.score >= 0.5 ? 'ridge structure' : null,
    drivers.convergenceDensity.score >= 0.5 ? 'flow convergence' : null,
  ].filter(Boolean);
  
  if (strongFeatures.length >= 2) {
    parts.push(`Key structural features include ${strongFeatures.slice(0, -1).join(', ')} and ${strongFeatures.slice(-1)[0]}.`);
  } else if (secondary) {
    parts.push(`Secondary patterns show ${secondary.label.toLowerCase()}.`);
  }
  
  // Third sentence: key opportunity
  if (keyOpp) {
    parts.push(`The ${keyOpp.location} offers a prime setup location where ${keyOpp.reason.toLowerCase()}.`);
  }
  
  return parts.join(' ');
}

function determineConfidence(
  drivers: StructuralDrivers,
  flowData: TerrainFlowResponse,
  ridgeCount: number = 0,
  saddleCount: number = 0
): 'high' | 'medium' | 'low' {
  // ========== HONESTY GUARD (Phase 1 + 2a) ==========
  // Confidence must be gated on REAL, per-parcel measured relief (ridge/saddle
  // extraction from the DEM) — NOT on the constant Bench value (0.64), which
  // previously tripped `hasStrongFeature` on every parcel and forced "High
  // confidence" onto flat ground.
  //
  // Phase 2a fix: the real-DEM signal was previously read from
  // `metadata.mode === 'real_dem'`, but the flow engine only ever labels real
  // DEM flow `'terrain_driven'` — so that check was never true and pinned EVERY
  // parcel (including genuine ridge parcels) to Low. We now detect real DEM from
  // the flow's dem_source (excluding the synthetic/empty fallbacks) combined
  // with measured ridge/saddle structure, so flat ground still reads Low while
  // surveyed ridge parcels can honestly earn Medium/High.
  const flowCount = (flowData.flow_primary?.features?.length ?? 0) + (flowData.flow_secondary?.features?.length ?? 0);
  const mode = flowData.metadata?.mode;
  const demSource = String((flowData.metadata as any)?.dem_source || 'NONE').toUpperCase();
  const NON_REAL_DEM_SOURCES = ['NONE', 'PATTERN_INFERRED', 'SYNTHETIC_AXIS', 'GEOMETRY_BASED (LEGACY)'];
  const isRealDem = mode !== 'error' && !NON_REAL_DEM_SOURCES.includes(demSource);

  // Real measured structure from the DEM ridge/saddle pipeline.
  const strongMeasuredStructure = ridgeCount >= 2 || saddleCount >= 1;
  const someMeasuredStructure = ridgeCount >= 1 || saddleCount >= 1;

  // Only genuinely surveyed terrain with measured structure earns high confidence.
  if (isRealDem && strongMeasuredStructure && flowCount >= 3) {
    return 'high';
  }
  // Real DEM with some measured structure → medium.
  if (isRealDem && someMeasuredStructure) {
    return 'medium';
  }
  // Flat/low-relief ground, no measured structure, or templated fallback → low.
  return 'low';
}

// ========== EXPORT UTILITIES ==========

/**
 * Get top N drivers sorted by score
 */
export function getTopDrivers(
  drivers: StructuralDrivers,
  n: number = 4
): { key: keyof StructuralDrivers; driver: StructuralDriverScore }[] {
  const entries: { key: keyof StructuralDrivers; driver: StructuralDriverScore }[] = [
    { key: 'benchSupport', driver: drivers.benchSupport },
    { key: 'saddleInfluence', driver: drivers.saddleInfluence },
    { key: 'ridgeSpineSupport', driver: drivers.ridgeSpineSupport },
    { key: 'convergenceDensity', driver: drivers.convergenceDensity },
  ];
  
  return entries.sort((a, b) => b.driver.score - a.driver.score).slice(0, n);
}

/**
 * Get driver icon color based on score
 */
export function getDriverColor(score: number): string {
  if (score >= 0.7) return '#10b981'; // Emerald
  if (score >= 0.4) return '#f59e0b'; // Amber
  if (score > 0.1) return '#64748b'; // Slate
  return '#374151';                   // Gray
}

/**
 * Format score as percentage string
 */
export function formatDriverScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}
