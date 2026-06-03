/**
 * Scale-Adaptive Visual Hierarchy
 *
 * Adapts map visual hierarchy based on territory/parcel size (acres).
 * Small properties → markers dominant, labels always visible, flow lines thinner/dimmer
 * Large properties → flow lines dominant ("river system"), markers minimized
 *
 * Design principle: Hunters orient by markers at small scale, by flow lines at large scale.
 * Transition between modes is smooth (linear interpolation) to prevent visual jumps
 * when adding/removing parcels from a territory.
 *
 * Phase A: Controls corridor/draw/flow/stand layer sizing.
 * Phase B: Will add Green/Blue/Black tier-specific widths.
 */

export type TerritoryScaleMode = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface ScaleVisualParams {
  mode: TerritoryScaleMode;
  areaAcres: number;

  // Stand markers
  markerSize: number;              // base circle-radius multiplier (1.0 = current default)
  markerGlowSize: number;          // glow ring radius multiplier

  // Labels
  labelVisibility: 'always' | 'hover';

  // Corridor/Draw/Flow line widths (absolute px, applied to Mapbox layers)
  corridorPrimaryWidth: number;    // Primary corridor (umber solid)
  corridorPossibleWidth: number;   // Possible corridor
  drawWidth: number;               // Draw features (slate dashed)
  flowPrimaryWidth: number;        // Primary Path (smoothed, dark)

  // Opacity
  flowOpacity: number;             // Base opacity for all flow/corridor/draw lines

  // Terrain Story labels
  storyLabelFontSize: number;      // px
  storyLabelDefaultVisible: boolean; // show without hover at this scale

  // Smooth interpolation factor (0 at mode boundary, 1 at mode center)
  interpolation: number;
}

// ═══ Threshold constants ═══
const SMALL_MAX_ACRES = 200;
const LARGE_MIN_ACRES = 800;

// ═══ Per-mode visual specs (from brief spec table) ═══
interface ModeSpec {
  markerSize: number;
  markerGlowSize: number;
  corridorPrimaryWidth: number;
  corridorPossibleWidth: number;
  drawWidth: number;
  flowPrimaryWidth: number;
  flowOpacity: number;
  storyLabelFontSize: number;
}

const SMALL_SPEC: ModeSpec = {
  markerSize: 1.4,         // 40% larger than default (28/20 ≈ 1.4)
  markerGlowSize: 1.3,
  corridorPrimaryWidth: 1.5,
  corridorPossibleWidth: 1.2,
  drawWidth: 1.5,
  flowPrimaryWidth: 1.0,
  flowOpacity: 0.55,
  storyLabelFontSize: 14,
};

const MEDIUM_SPEC: ModeSpec = {
  markerSize: 1.0,         // default
  markerGlowSize: 1.0,
  corridorPrimaryWidth: 2.5,
  corridorPossibleWidth: 2.0,
  drawWidth: 2.0,
  flowPrimaryWidth: 1.5,
  flowOpacity: 0.80,
  storyLabelFontSize: 12,
};

const LARGE_SPEC: ModeSpec = {
  markerSize: 0.72,        // smaller markers (16/22 ≈ 0.72)
  markerGlowSize: 0.7,
  corridorPrimaryWidth: 3.5,
  corridorPossibleWidth: 3.0,
  drawWidth: 2.5,
  flowPrimaryWidth: 2.5,
  flowOpacity: 0.95,
  storyLabelFontSize: 10,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpSpec(a: ModeSpec, b: ModeSpec, t: number): ModeSpec {
  return {
    markerSize: lerp(a.markerSize, b.markerSize, t),
    markerGlowSize: lerp(a.markerGlowSize, b.markerGlowSize, t),
    corridorPrimaryWidth: lerp(a.corridorPrimaryWidth, b.corridorPrimaryWidth, t),
    corridorPossibleWidth: lerp(a.corridorPossibleWidth, b.corridorPossibleWidth, t),
    drawWidth: lerp(a.drawWidth, b.drawWidth, t),
    flowPrimaryWidth: lerp(a.flowPrimaryWidth, b.flowPrimaryWidth, t),
    flowOpacity: lerp(a.flowOpacity, b.flowOpacity, t),
    storyLabelFontSize: lerp(a.storyLabelFontSize, b.storyLabelFontSize, t),
  };
}

/**
 * Compute scale-adaptive visual parameters from territory area.
 *
 * Uses smooth linear interpolation across the SMALL→MEDIUM→LARGE bands
 * so adding/removing a parcel that crosses a threshold doesn't cause
 * a visual jump.
 *
 * @param areaAcres - Total territory (or single parcel) area in acres
 * @returns ScaleVisualParams with all rendering parameters
 */
export function computeScaleParams(areaAcres: number): ScaleVisualParams {
  let mode: TerritoryScaleMode;
  let spec: ModeSpec;
  let interpolation: number;

  if (areaAcres <= SMALL_MAX_ACRES) {
    mode = 'SMALL';
    // Interpolate within SMALL: 0 acres → pure SMALL, 200 → edge of MEDIUM
    const t = Math.max(0, areaAcres / SMALL_MAX_ACRES);
    spec = lerpSpec(SMALL_SPEC, SMALL_SPEC, t); // no lerp within SMALL
    interpolation = t;
  } else if (areaAcres >= LARGE_MIN_ACRES) {
    mode = 'LARGE';
    // No interpolation beyond LARGE threshold — caps at LARGE spec
    spec = LARGE_SPEC;
    interpolation = 1.0;
  } else {
    // MEDIUM: smooth transition from SMALL_SPEC → LARGE_SPEC
    mode = 'MEDIUM';
    const t = (areaAcres - SMALL_MAX_ACRES) / (LARGE_MIN_ACRES - SMALL_MAX_ACRES);
    spec = lerpSpec(SMALL_SPEC, LARGE_SPEC, t);
    interpolation = t;
  }

  return {
    mode,
    areaAcres,
    markerSize: spec.markerSize,
    markerGlowSize: spec.markerGlowSize,
    labelVisibility: mode === 'SMALL' ? 'always' : 'hover',
    corridorPrimaryWidth: spec.corridorPrimaryWidth,
    corridorPossibleWidth: spec.corridorPossibleWidth,
    drawWidth: spec.drawWidth,
    flowPrimaryWidth: spec.flowPrimaryWidth,
    flowOpacity: spec.flowOpacity,
    storyLabelFontSize: spec.storyLabelFontSize,
    storyLabelDefaultVisible: mode === 'SMALL',
    interpolation,
  };
}

/**
 * Estimate territory area in acres from a GeoJSON bbox.
 * Uses latitude-corrected rectangular approximation.
 */
export function bboxToAcres(bbox: [number, number, number, number]): number {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const latCorrectionFactor = Math.cos(midLat * Math.PI / 180);

  const widthM = (maxLng - minLng) * 111320 * latCorrectionFactor;
  const heightM = (maxLat - minLat) * 110574;

  return (widthM * heightM) / 4046.86;
}

/**
 * Compute bbox from a GeoJSON polygon or multipolygon geometry.
 */
export function geometryToBbox(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity;
  let maxLng = -Infinity, maxLat = -Infinity;

  const rings = geom.type === 'MultiPolygon'
    ? geom.coordinates.flat(2)
    : geom.coordinates.flat();

  for (const [lng, lat] of rings) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLng, minLat, maxLng, maxLat];
}
