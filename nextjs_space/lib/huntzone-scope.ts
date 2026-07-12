/**
 * Hunt Zone scope helpers (Piece 4 — native per-scope flow compute + cache).
 *
 * When the draggable Hunt Zone ring (Piece 3) settles on a snapped grid center,
 * we compute flow NATIVELY for that 300-ac circle — the circle itself is handed
 * to the terrain engine as the AOI, so ridges/saddles are grounded in that scope.
 * We do NOT clip a whole-parcel computation (that reintroduces the large-territory
 * distortions flagged in Piece 1: principal-axis bearing, distant convergence).
 *
 * The result is cached keyed by (center rounded to the SAME 0.001 deg grid Piece 3
 * snaps to, radius, engine_version). Snapped revisits therefore become cache hits.
 */
import * as turf from '@turf/turf';

/**
 * Canonical cache key for a Hunt Zone scope.
 *
 * center is rounded to 0.001 deg — byte-identical to Piece 3's snapToGrid
 * (`Math.round(v * 1000) / 1000`). engineVersion is folded in so an engine bump
 * naturally busts stale hunt-zone entries (same contract as TerrainAnalysisCache).
 */
export function huntZoneScopeKey(
  center: { lat: number; lng: number },
  radiusM: number,
  engineVersion: string,
): string {
  const lat = (Math.round(center.lat * 1000) / 1000).toFixed(3);
  const lng = (Math.round(center.lng * 1000) / 1000).toFixed(3);
  const r = Math.round(radiusM);
  return `hz:${lat}_${lng}:r${r}:${engineVersion}`;
}

/**
 * Build the 300-ac scope circle used both as the drawn ring and as the native
 * compute AOI. Same primitive as the Piece 2/3 ring (steps:64, units:'meters')
 * so the compute scope coincides exactly with the ring the user sees.
 */
export function buildHuntZoneCircle(
  center: { lat: number; lng: number },
  radiusM: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  return turf.circle([center.lng, center.lat], radiusM, {
    units: 'meters',
    steps: 64,
  }) as GeoJSON.Feature<GeoJSON.Polygon>;
}
