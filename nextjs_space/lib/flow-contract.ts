/**
 * Flow Contract helpers (v5.0-scope)
 * ----------------------------------
 * Single source of truth for producing and reading the canonical flow shape
 * defined in types/flow-contract.ts.
 *
 * Piece 0 (plumbing only): these helpers NORMALIZE the existing GeoJSON flow
 * data (flow_primary / flow_secondary LineString FeatureCollections) into the
 * flat canonical flow_lines[] array, and stamp scope + engine_version. They do
 * NOT change any existing flow logic, counts, or rendering.
 *
 * Consumers should read canonical flow lines via getFlowLines(source): it
 * returns source.flow_lines if already present, else derives them on the fly
 * from the legacy GeoJSON fields — so "every flow consumer can read flow_lines"
 * regardless of whether the producer stamped them yet.
 */
import { TERRAIN_ENGINE_VERSION } from '@/lib/terrain-engine-version';
import type {
  FlowLine,
  FlowPoint,
  FlowScope,
  FlowScopeMode,
  FlowTierColor,
  CanonicalFlowResponse,
} from '@/types/flow-contract';

/** Classify a 0..1 confidence into a tier color. */
export function classifyFlowTier(confidence: number): FlowTierColor {
  const c = Number.isFinite(confidence) ? confidence : 0;
  if (c >= 0.66) return 'green';
  if (c >= 0.33) return 'blue';
  return 'black';
}

/** Extract a numeric confidence from a GeoJSON flow-line properties bag. */
function readConfidence(props: any): number {
  if (!props || typeof props !== 'object') return 0;
  const raw =
    props.likelihood ??
    props.convergenceScore ??
    props.confidence ??
    0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Convert a single GeoJSON LineString feature into a canonical FlowLine.
 * Returns null when the geometry is missing/invalid.
 */
function featureToFlowLine(feature: any, fallbackId: string): FlowLine | null {
  const geom = feature?.geometry;
  if (!geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) {
    return null;
  }
  const points: FlowPoint[] = [];
  for (const coord of geom.coordinates) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({ lat, lng });
  }
  if (points.length === 0) return null;

  const props = feature.properties ?? {};
  const confidence = readConfidence(props);
  const id =
    (props.id != null ? String(props.id) : '') || fallbackId;

  return {
    id,
    points,
    tier: classifyFlowTier(confidence),
    confidence,
  };
}

/** Pull LineString features out of a GeoJSON FeatureCollection-ish value. */
function featuresOf(fc: any): any[] {
  if (!fc || typeof fc !== 'object') return [];
  const feats = (fc as any).features;
  return Array.isArray(feats) ? feats : [];
}

/**
 * Normalize legacy GeoJSON flow data into the canonical flow_lines[] array.
 * Reads flow_primary + flow_secondary LineString FeatureCollections.
 * Safe on null / partial input (returns []).
 */
export function toFlowLines(flowData: any): FlowLine[] {
  if (!flowData || typeof flowData !== 'object') return [];
  const out: FlowLine[] = [];
  let idx = 0;

  for (const feat of featuresOf(flowData.flow_primary)) {
    const line = featureToFlowLine(feat, `flow_primary_${idx}`);
    if (line) out.push(line);
    idx++;
  }
  idx = 0;
  for (const feat of featuresOf(flowData.flow_secondary)) {
    const line = featureToFlowLine(feat, `flow_secondary_${idx}`);
    if (line) out.push(line);
    idx++;
  }

  return out;
}

/** Build a canonical FlowScope object. */
export function buildFlowScope(params: {
  center: FlowPoint;
  radius_m: number;
  acres: number;
  mode?: FlowScopeMode;
}): FlowScope {
  return {
    center: params.center,
    radius_m: Number.isFinite(params.radius_m) ? params.radius_m : 0,
    acres: Number.isFinite(params.acres) ? params.acres : 0,
    mode: params.mode ?? 'parcel',
  };
}

/**
 * Stamp the canonical flow response envelope from legacy GeoJSON flow data
 * plus a computed scope. engine_version is always the current engine version.
 */
export function buildFlowContract(
  flowData: any,
  scope: FlowScope,
): CanonicalFlowResponse {
  return {
    flow_lines: toFlowLines(flowData),
    scope,
    engine_version: TERRAIN_ENGINE_VERSION,
  };
}

/**
 * Single canonical accessor for consumers.
 * Returns source.flow_lines when the producer already stamped it; otherwise
 * derives canonical flow lines from the legacy GeoJSON fields on the fly.
 */
export function getFlowLines(source: any): FlowLine[] {
  if (source && Array.isArray(source.flow_lines)) {
    return source.flow_lines as FlowLine[];
  }
  return toFlowLines(source);
}
