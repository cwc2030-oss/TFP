/**
 * Flow acreage cap — clip whole-territory flow to a real-data limit.
 *
 * Piece 1: any single analysis renders flow only for the first
 * MAX_ANALYSIS_ACRES of real ridge/saddle spine data. Beyond that radius,
 * flow lines and points are dropped so the client can show a clean
 * "spin up a Hunt Zone here" empty-state.
 *
 * This operates purely on the emitted GeoJSON so it is the single safe
 * leverage point — the map renders this GeoJSON directly.
 */
import * as turf from '@turf/turf';
import { acresToRadiusMeters } from './flow-flags';

type FC = GeoJSON.FeatureCollection<any, any>;

export interface FlowCapInput {
  flow_primary?: FC | null;
  flow_secondary?: FC | null;
  convergence_zones?: FC | null;
  opportunity_zones?: FC | null;
}

export interface FlowCapResult {
  flow_primary: FC;
  flow_secondary: FC;
  convergence_zones: FC;
  opportunity_zones: FC;
  capped: boolean;
  kept: number;
  dropped: number;
}

function emptyFC(): FC {
  return { type: 'FeatureCollection', features: [] };
}

function asFC(fc: FC | null | undefined): FC {
  if (fc && fc.type === 'FeatureCollection' && Array.isArray(fc.features)) return fc;
  return emptyFC();
}

/**
 * Split a LineString/MultiLineString feature into the contiguous runs of
 * vertices that fall inside `circle`, preserving properties. Each retained
 * run needs >=2 points to remain a valid line.
 */
function clipLineFeatureToCircle(
  feature: GeoJSON.Feature<any, any>,
  circle: GeoJSON.Feature<GeoJSON.Polygon>
): GeoJSON.Feature<any, any>[] {
  const geom = feature.geometry;
  if (!geom) return [];

  const lines: number[][][] = [];
  if (geom.type === 'LineString') {
    lines.push(geom.coordinates as number[][]);
  } else if (geom.type === 'MultiLineString') {
    for (const l of geom.coordinates as number[][][]) lines.push(l);
  } else {
    // Non-line geometry: keep only if its representative point is inside.
    try {
      const pt = turf.pointOnFeature(feature as any);
      if (turf.booleanPointInPolygon(pt, circle)) return [feature];
    } catch {
      /* ignore */
    }
    return [];
  }

  const out: GeoJSON.Feature<any, any>[] = [];
  for (const coords of lines) {
    let run: number[][] = [];
    for (const c of coords) {
      const inside = turf.booleanPointInPolygon(turf.point([c[0], c[1]]), circle);
      if (inside) {
        run.push(c);
      } else {
        if (run.length >= 2) {
          out.push({
            type: 'Feature',
            properties: { ...(feature.properties || {}) },
            geometry: { type: 'LineString', coordinates: run },
          });
        }
        run = [];
      }
    }
    if (run.length >= 2) {
      out.push({
        type: 'Feature',
        properties: { ...(feature.properties || {}) },
        geometry: { type: 'LineString', coordinates: run },
      });
    }
  }
  return out;
}

function clipLineCollection(fc: FC, circle: GeoJSON.Feature<GeoJSON.Polygon>) {
  const src = asFC(fc);
  const features: GeoJSON.Feature<any, any>[] = [];
  let dropped = 0;
  for (const f of src.features) {
    const clipped = clipLineFeatureToCircle(f, circle);
    if (clipped.length === 0) dropped += 1;
    for (const c of clipped) features.push(c);
  }
  return { fc: { type: 'FeatureCollection', features } as FC, kept: features.length, dropped };
}

function clipPointCollection(fc: FC, circle: GeoJSON.Feature<GeoJSON.Polygon>) {
  const src = asFC(fc);
  const features: GeoJSON.Feature<any, any>[] = [];
  let dropped = 0;
  for (const f of src.features) {
    try {
      const pt = f.geometry && f.geometry.type === 'Point'
        ? turf.point((f.geometry as GeoJSON.Point).coordinates)
        : turf.pointOnFeature(f as any);
      if (turf.booleanPointInPolygon(pt, circle)) {
        features.push(f);
      } else {
        dropped += 1;
      }
    } catch {
      dropped += 1;
    }
  }
  return { fc: { type: 'FeatureCollection', features } as FC, kept: features.length, dropped };
}

/**
 * Clip all flow geometry to a circle of `maxAcres` centered on `center`.
 * Returns clipped collections plus kept/dropped counts.
 */
export function clipFlowToAcreLimit(
  input: FlowCapInput,
  center: { lat: number; lng: number },
  maxAcres: number
): FlowCapResult {
  const radiusM = acresToRadiusMeters(maxAcres);
  const circle = turf.circle([center.lng, center.lat], radiusM, {
    units: 'meters',
    steps: 64,
  });

  const primary = clipLineCollection(asFC(input.flow_primary), circle);
  const secondary = clipLineCollection(asFC(input.flow_secondary), circle);
  const convergence = clipPointCollection(asFC(input.convergence_zones), circle);
  const opportunity = clipPointCollection(asFC(input.opportunity_zones), circle);

  const kept =
    primary.kept + secondary.kept + convergence.kept + opportunity.kept;
  const dropped =
    primary.dropped + secondary.dropped + convergence.dropped + opportunity.dropped;

  return {
    flow_primary: primary.fc,
    flow_secondary: secondary.fc,
    convergence_zones: convergence.fc,
    opportunity_zones: opportunity.fc,
    capped: true,
    kept,
    dropped,
  };
}
