/**
 * v4-fix9: Centralized Layer Visibility Registry & Controller
 *
 * Every tfp-* layer is cataloged here with its group, opacity property,
 * target opacity, and how its visibility is determined (toggle, always-on,
 * hidden, or complex). The reconcileVisibility() function restores all
 * layers to their correct state after reload/clear — one function,
 * one source of truth.
 *
 * Layer states:
 *   visible — rendered at target opacity, visibility:'visible'
 *   hidden  — visibility:'none', opacity:0
 *   complex — managed by specialized effects, skipped by reconcile
 */

import type mapboxgl from 'mapbox-gl';

// ─── Types ─────────────────────────────────────────────────────────────

export type LayerGroup =
  | 'parcel'
  | 'qaParcel'
  | 'debug'
  | 'bedding'
  | 'draws'
  | 'saddles'
  | 'corridors'
  | 'funnelsV2'
  | 'ridgeSpines'
  | 'flow'
  | 'beddingProb'
  | 'edgeIntel'
  | 'edgeBoundary'
  | 'adjacentParcels'
  | 'huntability'
  | 'stands'
  | 'huntPockets';

export type VisibilitySource =
  | { kind: 'parcel' }                         // visible when parcel data exists
  | { kind: 'always' }                         // always visible when sources exist
  | { kind: 'hidden' }                         // hidden by default (debug, QA, interaction)
  | { kind: 'toggle'; key: string }            // key into visibility state object
  | { kind: 'flowToggle'; key: string }        // key into flowVisibility state object
  | { kind: 'heatmapView'; view: string }      // pressureHeatmap toggle + pressureView match
  | { kind: 'compound'; anyOf: string[] }      // visible when ANY toggle key is true
  | { kind: 'complex' }                        // managed by specialized effects — skip
  | { kind: 'interaction' };                   // mouse hover/click layers — skip

export interface LayerEntry {
  id: string;
  group: LayerGroup;
  opacityProp: string;
  targetOpacity: number;
  source: VisibilitySource;
}

// ─── Reconcile State ───────────────────────────────────────────────────

export interface ReconcileState {
  /**
   * Flat map of all toggle keys → boolean.
   * Merge visibility.* + flowVisibility.* + { beddingProbability: showBeddingProbability }.
   */
  toggles: Record<string, boolean>;
  /** @deprecated pressureView locked to 'pressure' — kept for interface compat */
  pressureView?: string;
  /** Whether parcel data exists (controls parcel layer visibility) */
  hasParcelData: boolean;
}

// ─── Layer Registry ────────────────────────────────────────────────────
// Ordered by visual stacking (bottom → top), matching addLayer order.

export const LAYER_REGISTRY: LayerEntry[] = [
  // ── Parcel boundary (visible when parcel data exists) ──
  { id: 'tfp-parcel-glow',    group: 'parcel', opacityProp: 'line-opacity', targetOpacity: 0.35, source: { kind: 'parcel' } },
  { id: 'tfp-parcel-outline',  group: 'parcel', opacityProp: 'line-opacity', targetOpacity: 0.95, source: { kind: 'parcel' } },

  // ── QA Parcel (hidden by default — toggled by qaParcelLookupMode) ──
  { id: 'tfp-qa-parcel-fill',          group: 'qaParcel', opacityProp: 'fill-opacity', targetOpacity: 0.08, source: { kind: 'hidden' } },
  { id: 'tfp-qa-parcel-outline',       group: 'qaParcel', opacityProp: 'line-opacity', targetOpacity: 0.9,  source: { kind: 'hidden' } },
  { id: 'tfp-qa-parcel-outline-glow',  group: 'qaParcel', opacityProp: 'line-opacity', targetOpacity: 0.3,  source: { kind: 'hidden' } },

  // ── Debug layers (hidden by default) ──
  { id: 'tfp-debug-raw-outline',        group: 'debug', opacityProp: 'line-opacity', targetOpacity: 0.8, source: { kind: 'hidden' } },
  { id: 'tfp-debug-normalized-outline',  group: 'debug', opacityProp: 'line-opacity', targetOpacity: 0.8, source: { kind: 'hidden' } },
  { id: 'tfp-debug-analysis-outline',    group: 'debug', opacityProp: 'line-opacity', targetOpacity: 0.8, source: { kind: 'hidden' } },

  // ── Bedding polygon areas (toggle: beddingProbability — shared with Bedding Zones button) ──
  { id: 'tfp-bedding-fill',    group: 'bedding', opacityProp: 'fill-opacity', targetOpacity: 0.07, source: { kind: 'toggle', key: 'beddingProbability' } },
  { id: 'tfp-bedding-outline',  group: 'bedding', opacityProp: 'line-opacity', targetOpacity: 0.45,  source: { kind: 'toggle', key: 'beddingProbability' } },

  // ── Draws / funnels line layers ──
  { id: 'tfp-funnels-lines-draws',   group: 'draws', opacityProp: 'line-opacity', targetOpacity: 1.0, source: { kind: 'toggle', key: 'draws' } },
  // Legacy corridor sub-layers (always hidden)
  { id: 'tfp-funnels-lines-corridors-solid',  group: 'draws', opacityProp: 'line-opacity', targetOpacity: 0, source: { kind: 'hidden' } },
  { id: 'tfp-funnels-lines-corridors-dashed', group: 'draws', opacityProp: 'line-opacity', targetOpacity: 0, source: { kind: 'hidden' } },
  { id: 'tfp-funnels-lines-corridors',        group: 'draws', opacityProp: 'line-opacity', targetOpacity: 0, source: { kind: 'hidden' } },
  // Fallback funnel line (compound: draws || saddles || corridors)
  { id: 'tfp-funnels-lines', group: 'draws', opacityProp: 'line-opacity', targetOpacity: 0.8, source: { kind: 'compound', anyOf: ['draws', 'saddles', 'corridors'] } },

  // ── Saddle polygons (toggle: saddles) ──
  { id: 'tfp-funnels-polys-fill',    group: 'saddles', opacityProp: 'fill-opacity', targetOpacity: 0.2,  source: { kind: 'toggle', key: 'saddles' } },
  { id: 'tfp-funnels-polys-outline',  group: 'saddles', opacityProp: 'line-opacity', targetOpacity: 1.0,  source: { kind: 'toggle', key: 'saddles' } },

  // ── V2 Tiered corridors (toggle: corridors) ──
  { id: 'tfp-corridors-primary-casing',   group: 'corridors', opacityProp: 'line-opacity', targetOpacity: 0.15, source: { kind: 'toggle', key: 'corridors' } },
  { id: 'tfp-corridors-primary',          group: 'corridors', opacityProp: 'line-opacity', targetOpacity: 0.78, source: { kind: 'toggle', key: 'corridors' } },
  { id: 'tfp-corridors-possible',         group: 'corridors', opacityProp: 'line-opacity', targetOpacity: 0.42, source: { kind: 'toggle', key: 'corridors' } },
  { id: 'tfp-corridors-exploratory',      group: 'corridors', opacityProp: 'line-opacity', targetOpacity: 0.22, source: { kind: 'toggle', key: 'corridors' } },
  { id: 'tfp-corridors-context-primary',  group: 'corridors', opacityProp: 'line-opacity', targetOpacity: 0.28, source: { kind: 'toggle', key: 'corridors' } },
  { id: 'tfp-corridors-context-possible', group: 'corridors', opacityProp: 'line-opacity', targetOpacity: 0.15, source: { kind: 'toggle', key: 'corridors' } },
  { id: 'tfp-intrusion-overlay',          group: 'corridors', opacityProp: 'fill-opacity', targetOpacity: 0.3,  source: { kind: 'toggle', key: 'corridors' } },

  // ── V2 Tiered funnels (toggle: funnels) ──
  { id: 'tfp-funnels-hard-fill',     group: 'funnelsV2', opacityProp: 'fill-opacity', targetOpacity: 0.35, source: { kind: 'toggle', key: 'funnels' } },
  { id: 'tfp-funnels-hard-outline',   group: 'funnelsV2', opacityProp: 'line-opacity', targetOpacity: 0.8,  source: { kind: 'toggle', key: 'funnels' } },
  { id: 'tfp-funnels-slight-fill',    group: 'funnelsV2', opacityProp: 'fill-opacity', targetOpacity: 0.2,  source: { kind: 'toggle', key: 'funnels' } },
  { id: 'tfp-funnels-slight-outline',  group: 'funnelsV2', opacityProp: 'line-opacity', targetOpacity: 0.5,  source: { kind: 'toggle', key: 'funnels' } },

  // ── Saddle node points (toggle: ridgeSpines) ──
  { id: 'tfp-saddle-nodes',          group: 'ridgeSpines', opacityProp: 'circle-opacity',        targetOpacity: 0.8,  source: { kind: 'toggle', key: 'ridgeSpines' } },
  { id: 'tfp-saddle-nodes-outline',   group: 'ridgeSpines', opacityProp: 'circle-stroke-opacity', targetOpacity: 0.6,  source: { kind: 'toggle', key: 'ridgeSpines' } },

  // ── Heatmap views (complex: pressureHeatmap + pressureView) ──
  { id: 'tfp-pressure-heatmap', group: 'flow', opacityProp: 'heatmap-opacity', targetOpacity: 0.76, source: { kind: 'heatmapView', view: 'pressure' } },
  { id: 'tfp-movement-delta',   group: 'flow', opacityProp: 'heatmap-opacity', targetOpacity: 0.75, source: { kind: 'heatmapView', view: 'damage' } },
  { id: 'tfp-movement-post',    group: 'flow', opacityProp: 'heatmap-opacity', targetOpacity: 0.75, source: { kind: 'heatmapView', view: 'movement' } },
  { id: 'tfp-refuge-zones',     group: 'flow', opacityProp: 'heatmap-opacity', targetOpacity: 0.75, source: { kind: 'heatmapView', view: 'refuge' } },

  // ── Ridge spines (toggle: ridgeSpines) ──
  { id: 'tfp-ridges-primary-casing',   group: 'ridgeSpines', opacityProp: 'line-opacity', targetOpacity: 0.25, source: { kind: 'toggle', key: 'ridgeSpines' } },
  { id: 'tfp-ridges-primary',          group: 'ridgeSpines', opacityProp: 'line-opacity', targetOpacity: 0.85, source: { kind: 'toggle', key: 'ridgeSpines' } },
  { id: 'tfp-ridges-secondary-casing', group: 'ridgeSpines', opacityProp: 'line-opacity', targetOpacity: 0.15, source: { kind: 'toggle', key: 'ridgeSpines' } },
  { id: 'tfp-ridges-secondary',        group: 'ridgeSpines', opacityProp: 'line-opacity', targetOpacity: 0.55, source: { kind: 'toggle', key: 'ridgeSpines' } },

  // ── Flow layers (complex: pressure-mode-dependent opacities, data-driven expressions) ──
  { id: 'tfp-flow-primary-glow',        group: 'flow', opacityProp: 'line-opacity',   targetOpacity: 0.25,  source: { kind: 'flowToggle', key: 'flowPrimary' } },
  { id: 'tfp-flow-primary',             group: 'flow', opacityProp: 'line-opacity',   targetOpacity: 0.75,  source: { kind: 'complex' } },  // data-driven expression
  { id: 'tfp-flow-direction-chevrons',  group: 'flow', opacityProp: 'icon-opacity',   targetOpacity: 1.0,   source: { kind: 'flowToggle', key: 'flowPrimary' } },
  { id: 'tfp-flow-nearest-highlight',   group: 'flow', opacityProp: 'line-opacity',   targetOpacity: 0.75,  source: { kind: 'complex' } },  // depends on selectedStand
  { id: 'tfp-flow-secondary',           group: 'flow', opacityProp: 'line-opacity',   targetOpacity: 0.45,  source: { kind: 'flowToggle', key: 'flowSecondary' } },
  { id: 'tfp-flow-convergence-pulse',   group: 'flow', opacityProp: 'circle-opacity', targetOpacity: 0.15,  source: { kind: 'flowToggle', key: 'convergenceZones' } },
  { id: 'tfp-flow-convergence',         group: 'flow', opacityProp: 'circle-opacity', targetOpacity: 0.85,  source: { kind: 'flowToggle', key: 'convergenceZones' } },

  // ── Hunt pockets (toggle: stands — follows stand visibility) ──
  { id: 'tfp-hunt-pockets-fill',   group: 'huntPockets', opacityProp: 'fill-opacity', targetOpacity: 0.2, source: { kind: 'toggle', key: 'stands' } },
  { id: 'tfp-hunt-pockets-stroke', group: 'huntPockets', opacityProp: 'line-opacity', targetOpacity: 0.6, source: { kind: 'toggle', key: 'stands' } },

  // ── Stand support layers (toggle: stands) ──
  { id: 'tfp-stand-direction-main',  group: 'stands', opacityProp: 'fill-opacity',   targetOpacity: 0.16,  source: { kind: 'toggle', key: 'stands' } },
  { id: 'tfp-stand-direction-flank', group: 'stands', opacityProp: 'line-opacity',   targetOpacity: 0.3,  source: { kind: 'toggle', key: 'stands' } },
  { id: 'tfp-killzone-fill',         group: 'stands', opacityProp: 'fill-opacity',   targetOpacity: 0.22, source: { kind: 'toggle', key: 'stands' } },
  { id: 'tfp-killzone-stroke',       group: 'stands', opacityProp: 'line-opacity',   targetOpacity: 0.35, source: { kind: 'toggle', key: 'stands' } },
  { id: 'tfp-stand-tertiary-dot',    group: 'stands', opacityProp: 'circle-opacity', targetOpacity: 0.6,  source: { kind: 'toggle', key: 'stands' } },
  { id: 'tfp-stand-emphasis-glow',   group: 'stands', opacityProp: 'circle-opacity', targetOpacity: 0.45, source: { kind: 'toggle', key: 'stands' } },

  // ── Huntability engine layers (hidden by default — debug/future toggle) ──
  { id: 'tfp-huntability-favorability-heatmap',               group: 'huntability', opacityProp: 'heatmap-opacity', targetOpacity: 0.65, source: { kind: 'hidden' } },
  { id: 'tfp-huntability-corridor-zones-primary',             group: 'huntability', opacityProp: 'fill-opacity',    targetOpacity: 0.18, source: { kind: 'hidden' } },
  { id: 'tfp-huntability-corridor-zones-primary-outline',     group: 'huntability', opacityProp: 'line-opacity',    targetOpacity: 0.35, source: { kind: 'hidden' } },
  { id: 'tfp-huntability-corridor-zones-secondary',           group: 'huntability', opacityProp: 'fill-opacity',    targetOpacity: 0.10, source: { kind: 'hidden' } },
  { id: 'tfp-huntability-corridor-zones-secondary-outline',   group: 'huntability', opacityProp: 'line-opacity',    targetOpacity: 0.25, source: { kind: 'hidden' } },
  { id: 'tfp-huntability-corridors-primary',                  group: 'huntability', opacityProp: 'line-opacity',    targetOpacity: 0.55, source: { kind: 'hidden' } },
  { id: 'tfp-huntability-corridors-secondary',                group: 'huntability', opacityProp: 'line-opacity',    targetOpacity: 0.40, source: { kind: 'hidden' } },
  { id: 'tfp-huntability-convergence-glow',                   group: 'huntability', opacityProp: 'circle-opacity',  targetOpacity: 0.30, source: { kind: 'hidden' } },
  { id: 'tfp-huntability-convergence',                        group: 'huntability', opacityProp: 'circle-opacity',  targetOpacity: 0.90, source: { kind: 'hidden' } },

  // ── Bedding probability circles (disabled — zeroed stubs) ──
  { id: 'tfp-bedding-probability-glow',    group: 'beddingProb', opacityProp: 'circle-opacity', targetOpacity: 0,  source: { kind: 'toggle', key: 'beddingProbability' } },
  { id: 'tfp-bedding-probability-fill',    group: 'beddingProb', opacityProp: 'fill-opacity',   targetOpacity: 0, source: { kind: 'toggle', key: 'beddingProbability' } },
  { id: 'tfp-bedding-probability-outline',  group: 'beddingProb', opacityProp: 'line-opacity',   targetOpacity: 0,  source: { kind: 'toggle', key: 'beddingProbability' } },

  // ── Edge intelligence (always-on when TERRAIN_WORK_MODE = false) ──
  { id: 'tfp-edge-arrows-lines',          group: 'edgeIntel', opacityProp: 'line-opacity', targetOpacity: 0.5,  source: { kind: 'always' } },
  { id: 'tfp-edge-arrows-heads',          group: 'edgeIntel', opacityProp: 'fill-opacity', targetOpacity: 0.6,  source: { kind: 'always' } },
  { id: 'tfp-edge-ghost-fill',            group: 'edgeIntel', opacityProp: 'fill-opacity', targetOpacity: 0.15, source: { kind: 'always' } },
  { id: 'tfp-edge-ghost-outline',         group: 'edgeIntel', opacityProp: 'line-opacity', targetOpacity: 0.4,  source: { kind: 'always' } },
  { id: 'tfp-edge-ghost-saddles-fill',    group: 'edgeIntel', opacityProp: 'fill-opacity', targetOpacity: 0.2,  source: { kind: 'always' } },
  { id: 'tfp-edge-ghost-saddles-outline',  group: 'edgeIntel', opacityProp: 'line-opacity', targetOpacity: 0.5,  source: { kind: 'always' } },
  { id: 'tfp-edge-draw-extensions-lines',  group: 'edgeIntel', opacityProp: 'line-opacity', targetOpacity: 0.5,  source: { kind: 'always' } },
  { id: 'tfp-edge-pressure-lines',        group: 'edgeIntel', opacityProp: 'line-opacity', targetOpacity: 0.7,  source: { kind: 'always' } },

  // ── Edge boundary (context line always-on, hitbox/highlight are interaction) ──
  { id: 'tfp-edge-boundary-fill',      group: 'edgeBoundary', opacityProp: 'fill-opacity', targetOpacity: 0,    source: { kind: 'always' } },  // invisible hit area
  { id: 'tfp-edge-boundary-context',   group: 'edgeBoundary', opacityProp: 'line-opacity', targetOpacity: 0.45, source: { kind: 'always' } },
  { id: 'tfp-edge-boundary-highlight', group: 'edgeBoundary', opacityProp: 'line-opacity', targetOpacity: 0.6,  source: { kind: 'interaction' } },

  // ── Adjacent parcels (context always-on, hover is interaction) ──
  { id: 'tfp-adjacent-parcels-fill',    group: 'adjacentParcels', opacityProp: 'fill-opacity', targetOpacity: 0.08, source: { kind: 'always' } },
  { id: 'tfp-adjacent-parcels-outline',  group: 'adjacentParcels', opacityProp: 'line-opacity', targetOpacity: 0.5,  source: { kind: 'always' } },
  { id: 'tfp-adjacent-parcels-hover',   group: 'adjacentParcels', opacityProp: 'line-opacity', targetOpacity: 0.8,  source: { kind: 'interaction' } },
];

// ─── Resolve single layer visibility ───────────────────────────────────

function resolveVisibility(
  entry: LayerEntry,
  state: ReconcileState,
): boolean | null {
  const src = entry.source;
  switch (src.kind) {
    case 'parcel':      return state.hasParcelData;
    case 'always':      return true;
    case 'hidden':      return false;
    case 'toggle':      return !!state.toggles[src.key];
    case 'flowToggle':  return !!state.toggles[src.key];
    case 'heatmapView': return !!state.toggles.pressureHeatmap && 'pressure' === src.view;
    case 'compound':    return src.anyOf.some(k => !!state.toggles[k]);
    case 'complex':     return null;  // skip — handled by specialized effects
    case 'interaction': return null;  // skip — handled by mouse event handlers
  }
}

// ─── Reconcile All Layers ──────────────────────────────────────────────

/**
 * Restore every tfp-* layer to its correct visibility and opacity state.
 * Called after reload/re-analyze to undo gracefulClear's fade-out.
 *
 * Layers with source.kind === 'complex' or 'interaction' are skipped.
 * For those, bump visibilityEpoch to trigger the specialized effects.
 */
export function reconcileVisibility(
  map: mapboxgl.Map,
  state: ReconcileState,
): void {
  console.log('[INTEL-DIAG] VISIBILITY RECONCILE START');

  let visibleCount = 0;
  let hiddenCount  = 0;
  let skippedCount = 0;
  const applied: string[] = [];  // for summary log

  for (const entry of LAYER_REGISTRY) {
    // Skip layers that don't exist on the map (may not have been created yet)
    if (!map.getLayer(entry.id)) {
      skippedCount++;
      continue;
    }

    const shouldShow = resolveVisibility(entry, state);

    // null → complex/interaction, skip
    if (shouldShow === null) {
      skippedCount++;
      continue;
    }

    try {
      if (shouldShow) {
        map.setLayoutProperty(entry.id, 'visibility', 'visible');
        map.setPaintProperty(entry.id, entry.opacityProp, entry.targetOpacity);
        applied.push(`${entry.id}=visible`);
        visibleCount++;
      } else {
        map.setLayoutProperty(entry.id, 'visibility', 'none');
        // Don't force opacity to 0 for hidden layers — leave their paint state
        // intact so that toggling them back on later doesn't need to re-set it.
        hiddenCount++;
      }
    } catch {
      skippedCount++;
    }
  }

  // Concise diagnostic: one line per group of visible layers
  if (applied.length > 0) {
    console.log(`[INTEL-DIAG] VISIBILITY APPLY — ${applied.join(', ')}`);
  }
  console.log(
    `[INTEL-DIAG] VISIBILITY RECONCILE COMPLETE — visible:${visibleCount} hidden:${hiddenCount} skipped:${skippedCount}`
  );
}
