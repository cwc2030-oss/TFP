'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense, useMemo, Component, ErrorInfo } from 'react';
import { toast, Toaster } from 'sonner';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
// NOTE: Deck.gl removed - using native Mapbox sources/layers only for stability
import { 
  Target, TreePine, Wind, Calendar, ChevronLeft, ChevronRight, 
  Compass, Info, CheckCircle, AlertTriangle, Loader2, X, MapPin,
  Mountain, Eye, EyeOff, Layers, Crosshair, Home, ExternalLink,
  Maximize2, Minimize2, RefreshCw, Check, Bug, Lock, ArrowUpRight,
  Unlock, Sparkles, Settings, Download, FileText, Grid3X3, User, Share2,
  Trash2, Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ScoreCard from '@/components/ScoreCard';
import Link from 'next/link';
import {
  scoreStandsWithExceptional,
  type StandInputs,
  type StandScore,
} from '@/lib/scoring/stand-alignment';
import { buildStandInputs, windDirectionToDeg } from '@/lib/scoring/stand-inputs';
import { getStandExplainability, renderChipsHTML, renderQualityBarsHTML, renderKeyIndicatorsHTML } from '@/lib/scoring/stand-explainability';
import { useFlowAnimation } from '@/hooks/intel/useFlowAnimation';
import { animatePaint, fadeLayerIn, fadeLayerOut, fadeToggleLayers, staggeredFadeToggle, gracefulClear, cancelAllAnimations } from '@/lib/map-animation';
import { reconcileVisibility, type ReconcileState } from '@/lib/layer-visibility';
import { SeasonPanel, SEASONS } from '@/components/intel/SeasonPanel';
import { WindCompass, WIND_DIRECTIONS } from '@/components/intel/WindCompass';
import { TerrainWorkModeNotice } from '@/components/intel/TerrainWorkModeNotice';
import { StandAlignmentPanel, type AlignedStand } from '@/components/intel/StandAlignmentPanel';
import type {
  TerrainLayers,
  TerrainSummary,
  TerrainProvenance,
  TerrainMode,
  TerrainLayerVisibility,
  StandPointProperties,
  BeddingProperties,
  FunnelProperties,
  SeasonProfile,
  WindDirection,
  TieredCorridorResponse,
  RidgeSpineResponse,
} from '@/types/terrain';
import { tierCorridorData, generateSyntheticTieredCorridors } from '@/lib/corridor-tiering';
import { fetchRidgeSpines, generateSyntheticRidgeSpines } from '@/lib/ridge-extraction';
import { fetchTerrainFlow, generateSyntheticTerrainFlow, generateLegacySyntheticFlow } from '@/lib/terrain-flow';
import { buildTerrainHeatMap, rescoreStandSites } from '@/lib/terrain-heatmap';
import { buildTerrainRaster, primeStandSitesToGeoJSON, pointInAnyWaterBody, type RasterGrid } from '@/lib/terrain-raster';
import { buildTerrainHuntability, type HuntabilityResult, type HuntabilityScore } from '@/lib/terrain-huntability';
import type { TerrainFlowResponse, TerrainFlowVisibility, FlowComparisonState, FlowSegmentScoreResponse, OpportunityZoneProperties, FlowMode } from '@/types/terrain-flow';
import FlowSegmentInspector from '@/components/terrain/flow-segment-inspector';
// OpportunityZoneTooltip removed — convergence IS opportunity
import TerrainReasonsPanel, { 
  extractStandReasons, 
  extractCorridorReasons, 
  extractConvergenceReasons,
  extractBeddingReasons,
  type TerrainReasonData 
} from '@/components/terrain/terrain-reasons-panel';
import DEMModeBadge, { DEMModeBadgeInline } from '@/components/terrain/dem-mode-badge';
import AnalysisQualityBadge, { AnalysisQualityInline } from '@/components/terrain/analysis-quality-badge';
import ParcelLookupCard, { ParcelLookupLoading, ParcelLookupError, RandomParcelPicker, type LookupParcel } from '@/components/terrain/parcel-lookup-card';
import { QAScorecard, QASessionSummary, QAAnalyticsPanel, exportSessionCSV, type QAEntry, type QARating } from '@/components/terrain/qa-scorecard';
import TerrainStoryPanel, { TerrainStoryExportLegend, StructuralDriversGrid } from '@/components/terrain/terrain-story-panel';
import TerrainLoadingBar from '@/components/terrain/terrain-loading-bar';
import { generateTerrainStory, computeStructuralDrivers, type TerrainStorySummary } from '@/lib/terrain-story';
import HuntingPotentialCard, { computeHuntingPotential, type HuntingPotentialScore } from '@/components/terrain/hunting-potential-card';
import { computeBrokerScore, type BrokerScoreResult, type BrokerScoreInput } from '@/lib/broker-scoring';
import { 
  createGeometryTrace, 
  addTraceStep, 
  createTraceStep, 
  printGeometryTrace, 
  validateForAnalysis,
  type GeometryTrace,
  type GeometryTraceStep
} from '@/lib/geometry-validation';

// ========== ERROR BOUNDARY ==========
// Module-level ref: lets the ErrorBoundary (class component) read territory state
// without prop-drilling through Suspense. Updated by a useEffect inside DeerIntelContent.
const _territoryModeGlobal = { current: false };

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class IntelErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // TERRITORY MASTER GUARD: If territory mode is active, swallow the error
    // instead of showing the full-screen "Analyzer paused" modal.
    if (_territoryModeGlobal.current) {
      console.error('[ERROR-BOUNDARY] TERRITORY GUARD — swallowing render crash during territory mode:', error?.message);
      return { hasError: false, error: null, errorInfo: null };
    }
    console.error('[ERROR-BOUNDARY] getDerivedStateFromError — showing modal. territoryMode:', _territoryModeGlobal.current, 'error:', error?.message);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ERROR-BOUNDARY] componentDidCatch — territoryMode:', _territoryModeGlobal.current, 'error:', error);
    console.error('[ERROR-BOUNDARY] Component stack:', errorInfo.componentStack);
    // TERRITORY MASTER GUARD: auto-recover if territory mode active
    if (_territoryModeGlobal.current) {
      console.error('[ERROR-BOUNDARY] TERRITORY GUARD — auto-recovering from render crash');
      this.setState({ hasError: false, error: null, errorInfo: null });
      return;
    }
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      // Double-check territory mode at render time — belt-and-suspenders
      if (_territoryModeGlobal.current) {
        console.error('[ERROR-BOUNDARY] TERRITORY GUARD (render) — suppressing modal, resetting state');
        setTimeout(() => this.setState({ hasError: false, error: null, errorInfo: null }), 0);
        return this.props.children;
      }
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-stone-900/90 border border-stone-700/50 rounded-xl p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">Analyzer paused</h1>
            <p className="text-stone-400 text-sm mb-6">
              The terrain analyzer hit a snag. Tap Retry to pick up where you left off.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                  // Force remount of child tree
                  window.location.href = window.location.href;
                }}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-lg font-medium transition-colors"
              >
                Retry
              </button>
              <Link
                href="/"
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg font-medium transition-colors"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Mapbox token
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

// V4 Step 12: Silence verbose logging in production (keep errors)
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  const noop = () => {};
  const origWarn = console.warn;
  console.log = noop;
  console.warn = (...args: any[]) => {
    // Keep genuine warnings about deprecation/security, silence routine ones
    const msg = String(args[0] || '');
    if (msg.includes('[TFP]') || msg.includes('[INTEL]') || msg.includes('[MAP]') || msg.includes('[EDGE') || msg.includes('[Backbone]') || msg.includes('[TerrainFlow]') || msg.includes('[EXPLORE]') || msg.includes('[StandResilience]') || msg.includes('[OVERLAY')) return;
    origWarn.apply(console, args);
  };
}

// Extend window for debugging
declare global {
  interface Window {
    __TFP_MAP__: mapboxgl.Map | null;
  }
}

// ========== GeoJSON VALIDATION UTILITIES ==========

// Ensure polygon rings are closed (first coord === last coord)
function closePolygonRing(coords: number[][]): number[][] {
  if (coords.length < 4) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...coords, first];
  }
  return coords;
}

// Validate and fix GeoJSON for consumption
function validateGeoJSON(geojson: GeoJSON.FeatureCollection | GeoJSON.Feature | null): GeoJSON.FeatureCollection {
  const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  
  if (!geojson) return emptyFC;
  
  // Normalize to FeatureCollection
  let fc: GeoJSON.FeatureCollection;
  if (geojson.type === 'Feature') {
    fc = { type: 'FeatureCollection', features: [geojson as GeoJSON.Feature] };
  } else if (geojson.type === 'FeatureCollection') {
    fc = geojson as GeoJSON.FeatureCollection;
  } else {
    console.warn('[TFP] Invalid GeoJSON type:', (geojson as any).type);
    return emptyFC;
  }
  
  // Validate each feature
  fc.features = fc.features.filter(f => {
    if (!f || !f.geometry) {
      console.warn('[TFP] Skipping feature with no geometry');
      return false;
    }
    return true;
  }).map(f => {
    const geom = f.geometry;
    
    // Fix polygon rings
    if (geom.type === 'Polygon') {
      const poly = geom as GeoJSON.Polygon;
      poly.coordinates = poly.coordinates.map(ring => closePolygonRing(ring));
    } else if (geom.type === 'MultiPolygon') {
      const mpoly = geom as GeoJSON.MultiPolygon;
      mpoly.coordinates = mpoly.coordinates.map(polygon => 
        polygon.map(ring => closePolygonRing(ring))
      );
    }
    
    return f;
  });
  
  return fc;
}

// Extract only features matching a geometry type
function filterByGeometryType(
  fc: GeoJSON.FeatureCollection, 
  types: string[]
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.filter(f => types.includes(f.geometry?.type || ''))
  };
}

/**
 * DEMO TRUST FILTER — not final land-cover intelligence.
 *
 * Filters bedding polygons that fall within ~120 m of any building footprint
 * visible in the Mapbox composite tiles.  Eliminates obvious false-positives
 * near houses, barns, and maintained yard areas so the map reads cleanly
 * during demos.  Fails gracefully (returns unfiltered data) if building
 * tiles are not yet loaded or the source is unavailable.
 */
function filterBeddingNearBuildings(
  beddingFC: GeoJSON.FeatureCollection,
  map: mapboxgl.Map,
  thresholdM = 120,
): GeoJSON.FeatureCollection {
  try {
    // Query building features from the Mapbox composite tileset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buildings = (map as any).querySourceFeatures('composite', { sourceLayer: 'building' }) as mapboxgl.MapboxGeoJSONFeature[];
    if (!buildings || !buildings.length) return beddingFC; // No building data loaded yet

    // Collect building centroids
    const buildingPts: [number, number][] = [];
    buildings.forEach((b: mapboxgl.MapboxGeoJSONFeature) => {
      if (!b.geometry) return;
      const coords: number[][] = [];
      if (b.geometry.type === 'Polygon') {
        coords.push(...(b.geometry as GeoJSON.Polygon).coordinates[0]);
      } else if (b.geometry.type === 'MultiPolygon') {
        (b.geometry as GeoJSON.MultiPolygon).coordinates.forEach(p => coords.push(...p[0]));
      }
      if (!coords.length) return;
      const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      buildingPts.push([cx, cy]);
    });

    if (!buildingPts.length) return beddingFC;

    const threshDeg = thresholdM / 111_320; // rough metres→degrees
    const threshSq = threshDeg * threshDeg;

    const filtered = beddingFC.features.filter(f => {
      if (!f.geometry) return false;
      // Get bedding centroid
      const allCoords: number[][] = [];
      if (f.geometry.type === 'Polygon') {
        allCoords.push(...(f.geometry as GeoJSON.Polygon).coordinates[0]);
      } else if (f.geometry.type === 'MultiPolygon') {
        (f.geometry as GeoJSON.MultiPolygon).coordinates.forEach(p => allCoords.push(...p[0]));
      } else if (f.geometry.type === 'Point') {
        allCoords.push((f.geometry as GeoJSON.Point).coordinates);
      }
      if (!allCoords.length) return true;
      const bx = allCoords.reduce((s, c) => s + c[0], 0) / allCoords.length;
      const by = allCoords.reduce((s, c) => s + c[1], 0) / allCoords.length;

      // Check proximity to any building
      for (const [px, py] of buildingPts) {
        const dx = bx - px;
        const dy = by - py;
        if (dx * dx + dy * dy < threshSq) return false; // too close → exclude
      }
      return true;
    });

    if (filtered.length < beddingFC.features.length) {
      console.log(`[BEDDING FILTER] Removed ${beddingFC.features.length - filtered.length} bedding zone(s) near buildings (${thresholdM}m threshold)`);
    }

    return { type: 'FeatureCollection', features: filtered };
  } catch (err) {
    console.warn('[BEDDING FILTER] Could not filter bedding near buildings:', err);
    return beddingFC;
  }
}

/**
 * Extract building centroid coordinates from Mapbox composite tiles.
 * Used to feed structure proximity filter into the raster engine so
 * stand candidates near barns / houses / sheds get rejected.
 */
function extractBuildingCentroids(map: mapboxgl.Map): [number, number][] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buildings = (map as any).querySourceFeatures('composite', { sourceLayer: 'building' }) as mapboxgl.MapboxGeoJSONFeature[];
    if (!buildings || !buildings.length) return [];

    const pts: [number, number][] = [];
    buildings.forEach((b: mapboxgl.MapboxGeoJSONFeature) => {
      if (!b.geometry) return;
      const coords: number[][] = [];
      if (b.geometry.type === 'Polygon') {
        coords.push(...(b.geometry as GeoJSON.Polygon).coordinates[0]);
      } else if (b.geometry.type === 'MultiPolygon') {
        (b.geometry as GeoJSON.MultiPolygon).coordinates.forEach(p => coords.push(...p[0]));
      }
      if (!coords.length) return;
      const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      pts.push([cx, cy]);
    });
    return pts;
  } catch {
    return [];
  }
}

// ============ NHD WATER BODY FETCH ============
// Queries USGS National Hydrography Dataset for water body polygons within a bounding box.
// Returns polygon coordinate arrays for ponds, lakes, and stream bodies.
// Graceful: returns [] on timeout or error — never blocks terrain analysis.
async function fetchNHDWaterBodies(
  minLat: number, maxLat: number,
  minLng: number, maxLng: number
): Promise<Array<{ coordinates: number[][][] }>> {
  try {
    const url = `https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/2/query?` +
      `geometry=${minLng},${minLat},${maxLng},${maxLat}` +
      `&geometryType=esriGeometryEnvelope` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*` +
      `&returnGeometry=true` +
      `&f=geojson`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];

    const data = await res.json();

    return (data.features || [])
      .filter((f: Record<string, unknown>) => {
        const geom = f.geometry as { type?: string } | undefined;
        return geom?.type === 'Polygon' || geom?.type === 'MultiPolygon';
      })
      .map((f: Record<string, unknown>) => {
        const geom = f.geometry as { type: string; coordinates: number[][][] | number[][][][] };
        return {
          coordinates: geom.type === 'Polygon'
            ? (geom.coordinates as number[][][])
            : (geom.coordinates as number[][][][])[0],
        };
      });
  } catch {
    console.warn('[NHD] Water body fetch failed or timed out — proceeding without water exclusion');
    return [];
  }
}

// SEASONS & WIND_DIRECTIONS now imported from components/intel/*

// ========== V2 STYLING RULES (Tiered Corridors + Funnels) ==========
// Corridors: Tiered based on relative likelihood
//   Primary: SOLID, thick (~4px), opacity 0.85 - confirmed travel routes
//   Possible: THINNER (~2.5px), opacity 0.45 - likely routes
//   Exploratory: VERY THIN (~1.5px), dashed, opacity 0.25 - potential routes
// Funnels: Compression zones
//   Hard: Tighter patch, opacity 0.30 - strong pinch points
//   Slight: Wider patch, opacity 0.18 - moderate compression
// Intrusion: High intrusion segments get hatched/faded overlay
// Context: Off-parcel continuations at reduced opacity, no interaction
// Earth tones only: rust, sienna, umber, olive, ochre

const LAYER_COLORS = {
  bedding: '#22c55e',
  beddingOutline: '#16a34a',
  funnelSaddle: '#f97316',
  funnelDraw: '#3b82f6',           // Solid blue for draws
  // Legacy corridor colors (for backwards compatibility)
  corridorHigh: '#db2777',         // High score ≥0.7: bright red-violet (pink-600)
  corridorMed: '#9333ea',          // Med score 0.4-0.7: solid purple (purple-600)
  corridorLow: '#c4b5fd',          // Low score <0.4: light lavender (DASHED only)
  // V2 Tiered corridor colors (earth tones)
  corridorPrimary: '#8B4513',      // Sienna brown - primary routes (solid, thick)
  corridorPossible: '#A0522D',     // Sienna lighter - possible routes (thinner)
  corridorExploratory: '#D2B48C',  // Tan - exploratory lanes (very thin, dashed)
  corridorContext: '#9C8267',      // Warm gray-brown - off-parcel context
  // V2 Funnel colors (earth tones)
  funnelHard: '#8B4513',           // Dark sienna - hard compression zones
  funnelSlight: '#CD853F',         // Peru/tan - slight compression zones
  // Intrusion overlay
  intrusionHigh: '#DC143C',        // Crimson tint for high intrusion areas
  // Stand Visualization v1.1 — muted blaze-orange palette (gun-season context)
  standPrimary: '#e2712a',         // #1 Today's Sit: muted blaze-orange
  standPrimaryRing: '#f09048',     // Today's Sit outer ring: warm highlight
  standSecondary: '#c45d22',       // #2 stand: deeper burnt orange
  standTertiary: '#a0522d',        // #3+ faint dot: sienna (earthy, low-key)
  standHigh: '#e2712a',            // alias for backward compat
  standGold: '#f09048',            // alias for backward compat
  standMed: '#c45d22',
  standLow: '#6b7280',
  // v3.5.1 — Selected parcel boundary (gold/amber with glow)
  parcelBoundary: '#f59e0b',       // Amber-500 — gold/amber for clear visibility
  parcelGlow: '#fbbf24',           // Amber-400 — subtle glow halo
  // v3.5.1 — Adjacent parcel context lines (cool gray, faint)
  adjacentParcel: '#94a3b8',       // Slate-400 — cool gray/blue-gray context
  // v3.5.1 — Topo/contour line overrides (muted tan/slate)
  contourIndex: '#a8a29e',         // Stone-400 — muted for 100ft intervals
  contourRegular: '#d6d3d1',       // Stone-300 — very muted for 20ft intervals
  // Edge Intelligence Layer colors
  edgeCorridorArrow: '#8B4513',    // Sienna for continuation arrows
  edgeGhostBedding: '#22c55e',     // Semi-transparent green for ghost bedding
  edgeGhostSaddle: '#f97316',      // Semi-transparent orange for ghost saddles
  edgeDrawExtension: '#3b82f6',    // Blue dashed for draw extensions
  edgePressureInbound: '#22c55e',  // Green for inbound pressure
  edgePressureOutbound: '#f59e0b', // Amber for outbound pressure
  edgeBoundaryHighlight: '#f59e0b', // Amber — matches parcel boundary for consistent edge styling
  // Travel Corridor colors (structure-first, BOLD earth tones for skeleton feel)
  ridgePrimary: '#4E342E',        // Dark coffee brown - major spines (bold, visible)
  ridgeSecondary: '#6D4C41',      // Medium brown - secondary spines (distinct from primary)
  ridgeCasing: '#EFEBE9',         // Off-white casing/halo for visibility over heat
  saddleNode: '#8D6E63',          // Warm taupe - saddle markers (subtle)
  // v3.5.1 — Animated Travel Corridor colors (teal/cyan movement palette)
  flowPrimary: '#14b8a6',         // Teal-500: primary flow lines (animated)
  flowSecondary: '#5eead4',       // Teal-300: secondary flow lines
  flowAnimated: '#2dd4bf',        // Teal-400: animated flow glow
  flowConvergenceBright: '#fbbf24', // Amber-400: brighter glow through convergence
  flowConvergence: '#f59e0b',     // Amber-500: convergence zone markers
  // v3.8.1 — Directional flow emphasis
  flowDirectionChevron: '#14b8a6', // Teal-500: directional chevrons along flow
  standEmphasisGlow: '#f09048',    // Warm orange: subtle glow bias toward top stand (matches icon family)
  // flowOpportunity removed — convergence IS opportunity (use flowConvergence instead)
  // v3.6.0 — Bedding Probability colors (muted earthy/plum tones)
  beddingProbability: '#7c3aed', // Violet-600: bedding zone fill
  beddingProbabilityGlow: '#a855f7', // Purple-500: bedding zone glow/halo
  beddingProbabilityOutline: '#6d28d9', // Violet-700: bedding zone outline
};

// ========== EDGE INTELLIGENCE UTILITIES ==========

// Calculate bearing from point A to point B (in degrees)
function calculateBearing(from: [number, number], to: [number, number]): number {
  const dLng = (to[0] - from[0]) * Math.PI / 180;
  const lat1 = from[1] * Math.PI / 180;
  const lat2 = to[1] * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Move a point in a given bearing by a distance (meters)
function movePoint(point: [number, number], bearingDeg: number, distanceMeters: number): [number, number] {
  const R = 6371000; // Earth radius in meters
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = point[1] * Math.PI / 180;
  const lng1 = point[0] * Math.PI / 180;
  const d = distanceMeters / R;
  
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );
  
  return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

// Calculate distance between two points in meters
function distanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Convert bearing degrees to compass label (N/NE/E/SE/S/SW/W/NW)
function degreesToCompass(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(normalized / 45) % 8;
  return directions[index];
}

// Find closest point on a LineString to a given point
function closestPointOnLineString(
  point: [number, number], 
  lineCoords: [number, number][]
): { point: [number, number]; dist: number; segIndex: number } {
  let minDist = Infinity;
  let closestPt: [number, number] = lineCoords[0];
  let segIdx = 0;

  for (let i = 0; i < lineCoords.length - 1; i++) {
    const a = lineCoords[i];
    const b = lineCoords[i + 1];
    
    // Project point onto line segment
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
    }
    
    const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const dist = distanceMeters(point, proj);
    
    if (dist < minDist) {
      minDist = dist;
      closestPt = proj;
      segIdx = i;
    }
  }
  
  return { point: closestPt, dist: minDist, segIndex: segIdx };
}

// Check if a point is inside a Polygon or MultiPolygon GeoJSON geometry
function pointInParcelGeometry(
  point: [number, number],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): boolean {
  if (geometry.type === 'Polygon') {
    // Check outer ring (index 0); holes (indices 1+) not checked for simplicity
    return pointInPolygon(point, geometry.coordinates[0] as number[][]);
  } else if (geometry.type === 'MultiPolygon') {
    // Point is inside if it's inside ANY polygon of the multi
    return geometry.coordinates.some(poly =>
      pointInPolygon(point, poly[0] as number[][])
    );
  }
  return false;
}

// Check if a point is inside a polygon (ray casting algorithm)
function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  let inside = false;
  const x = point[0], y = point[1];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Find the closest point on a polygon boundary to a given point
function closestPointOnPolygon(point: [number, number], polygon: number[][]): { point: [number, number]; segment: [number, number, number, number]; index: number } {
  let minDist = Infinity;
  let closestPoint: [number, number] = point;
  let closestSegment: [number, number, number, number] = [0, 0, 0, 0];
  let closestIndex = 0;
  
  for (let i = 0; i < polygon.length - 1; i++) {
    const a = polygon[i] as [number, number];
    const b = polygon[i + 1] as [number, number];
    
    // Project point onto line segment
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
    }
    
    const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const dist = distanceMeters(point, proj);
    
    if (dist < minDist) {
      minDist = dist;
      closestPoint = proj;
      closestSegment = [a[0], a[1], b[0], b[1]];
      closestIndex = i;
    }
  }
  
  return { point: closestPoint, segment: closestSegment, index: closestIndex };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARCEL-SAFE STAND ENFORCEMENT (v4-fix17)
// All Top-3 stands must be strictly inside the parcel with an interior buffer.
// ═══════════════════════════════════════════════════════════════════════════

// Interior safety margin — stands must be at least this far from parcel edge.
// 15m ≈ ~50ft, keeps stands visually inside even at high zoom levels.
const PARCEL_INSET_METERS = 15;

// Maximum distance (meters) from parcel boundary for an off-parcel candidate
// to be eligible for snap-inward repair. Beyond this → discard.
const MAX_SNAP_DISTANCE_METERS = 80;

/**
 * Compute a parcel complexity/irregularity score (0-1).
 *   0 = perfectly rectangular / simple shape
 *   1 = extremely irregular (many vertices, notches, peninsulas)
 *
 * Factors:
 *   1. Compactness ratio: area / (perimeter² / 4π) — circle=1, long narrow strip→0
 *   2. Vertex count: more vertices = more complex boundary
 *   3. Vertex density: vertices per km of perimeter — high density = jagged
 *
 * Returns 0 if geometry is missing or degenerate.
 */
function computeParcelComplexity(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined
): number {
  if (!geometry) return 0;
  const ring: number[][] =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.coordinates[0]?.[0]; // first ring of first polygon
  if (!ring || ring.length < 4) return 0;

  // Compute approximate area (shoelace) and perimeter in meters
  const DEG_TO_M_LAT = 111320;
  const midLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const DEG_TO_M_LNG = DEG_TO_M_LAT * Math.cos((midLat * Math.PI) / 180);

  let area2 = 0; // 2× signed area in m²
  let perimeter = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0] * DEG_TO_M_LNG,     y0 = ring[i][1] * DEG_TO_M_LAT;
    const x1 = ring[i + 1][0] * DEG_TO_M_LNG, y1 = ring[i + 1][1] * DEG_TO_M_LAT;
    area2 += x0 * y1 - x1 * y0;
    perimeter += Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
  }
  const areaM2 = Math.abs(area2) / 2;
  if (perimeter < 1 || areaM2 < 1) return 0;

  // Isoperimetric quotient: 1.0 = circle, ~0.78 = square, lower = more irregular
  const compactness = (4 * Math.PI * areaM2) / (perimeter * perimeter);

  // Vertex complexity — rectangles have 5 (4+closing), irregular parcels have 20-200+
  const nVerts = ring.length - 1; // exclude closing vertex
  const vertexScore = Math.min(1, Math.max(0, (nVerts - 5) / 60)); // 5→0, 65+→1

  // Vertex density — jagged boundary has high verts/km ratio
  const perimeterKm = perimeter / 1000;
  const vertDensity = nVerts / Math.max(perimeterKm, 0.01);
  const densityScore = Math.min(1, Math.max(0, (vertDensity - 8) / 40)); // 8/km→0, 48+/km→1

  // Weighted blend — compactness is the primary signal
  const raw = 0.50 * (1 - compactness) + 0.30 * vertexScore + 0.20 * densityScore;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Move a point toward a target by `meters` distance (approximate for small distances).
 * Returns a new [lng, lat] coordinate.
 */
function movePointToward(
  from: [number, number],
  toward: [number, number],
  meters: number
): [number, number] {
  const dist = distanceMeters(from, toward);
  if (dist < 0.1) return toward; // already there
  // At ~37° latitude, 1° lat ≈ 111km, 1° lng ≈ 88km
  const ratio = meters / dist;
  return [
    from[0] + (toward[0] - from[0]) * ratio,
    from[1] + (toward[1] - from[1]) * ratio,
  ];
}

/**
 * Get the polygon ring(s) from a parcel geometry for distance checks.
 * Returns an array of outer rings (one for Polygon, multiple for MultiPolygon).
 */
function getParcelRings(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][][] {
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates[0]]; // outer ring only
  } else {
    return geometry.coordinates.map(poly => poly[0]); // outer ring of each polygon
  }
}

/**
 * Compute the signed distance of a point from the parcel boundary:
 *  - positive = inside parcel, value is distance to nearest edge
 *  - negative = outside parcel, value is distance to nearest edge (negated)
 * Also returns the closest boundary point for snap operations.
 */
function signedDistanceToParcel(
  point: [number, number],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): { distance: number; closestBoundaryPoint: [number, number] } {
  const inside = pointInParcelGeometry(point, geometry);
  const rings = getParcelRings(geometry);
  
  let minDist = Infinity;
  let bestBoundaryPt: [number, number] = point;
  
  for (const ring of rings) {
    const { point: cp } = closestPointOnPolygon(point, ring);
    const d = distanceMeters(point, cp);
    if (d < minDist) {
      minDist = d;
      bestBoundaryPt = cp;
    }
  }
  
  return {
    distance: inside ? minDist : -minDist,
    closestBoundaryPoint: bestBoundaryPt,
  };
}

/**
 * Snap a stand coordinate to be safely inside the parcel with an inset buffer.
 * 
 * Returns:
 *  - { snapped: true, coords } if the point was moved inside
 *  - { snapped: false, coords: original } if already inside with buffer
 *  - null if the point is too far outside to snap
 */
function snapToParcelInterior(
  point: [number, number],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  insetMeters: number = PARCEL_INSET_METERS
): { snapped: boolean; coords: [number, number] } | null {
  const { distance, closestBoundaryPoint } = signedDistanceToParcel(point, geometry);
  
  // Already safely inside with buffer — no action needed
  if (distance >= insetMeters) {
    return { snapped: false, coords: point };
  }
  
  // Outside but within snap range — repair
  if (distance < insetMeters && distance > -MAX_SNAP_DISTANCE_METERS) {
    // Find the centroid of the polygon to determine "inward" direction
    const rings = getParcelRings(geometry);
    let cx = 0, cy = 0, count = 0;
    for (const ring of rings) {
      for (const coord of ring) {
        cx += coord[0]; cy += coord[1]; count++;
      }
    }
    cx /= count; cy /= count;
    const centroid: [number, number] = [cx, cy];
    
    // Strategy: move the closest boundary point toward centroid by insetMeters
    const insetPoint = movePointToward(closestBoundaryPoint, centroid, insetMeters + 2);
    
    // Verify the inset point is actually inside
    if (pointInParcelGeometry(insetPoint, geometry)) {
      return { snapped: true, coords: insetPoint };
    }
    
    // Fallback: move original point toward centroid until inside with buffer
    // Iterative approach for complex geometries
    for (let step = 1; step <= 10; step++) {
      const candidate = movePointToward(point, centroid, insetMeters * step);
      const candidateDist = signedDistanceToParcel(candidate, geometry);
      if (candidateDist.distance >= insetMeters) {
        return { snapped: true, coords: candidate };
      }
    }
    
    // Last resort: use centroid if nothing else works
    if (pointInParcelGeometry(centroid, geometry)) {
      return { snapped: true, coords: centroid };
    }
    
    return null; // Can't snap — discard
  }
  
  // Too far outside to snap
  return null;
}

// ========== STAND RESILIENCE SCORING (v3.8.6) ==========
// Pure scoring dimension — does NOT influence stand placement or ordering.
// Measures how robust a stand is across variable conditions.
//
// Factors:
//   Corridor Count  (~35%) — distinct flow lines within 60-100m
//   Angular Spread  (~25%) — diversity of movement-axis bearings from nearby corridors
//                             (NOTE: these are corridor-tangent bearings representing
//                              likely movement flow, NOT true approach vectors)
//   Centrality      (~20%) — distance from parcel centroid (closer = higher)
//   Re-entry Opp.   (~10%) — downstream corridor paths for post-disturbance recovery
//   Downwind Recov. (~10%) — forgiveness if wind shifts slightly (windOk breadth)

interface StandResilience {
  score: number;        // 0–100 composite
  corridorCount: number;
  corridorCountScore: number;
  angularSpread: number;     // degrees of arc covered
  angularSpreadScore: number;
  centralityDist: number;    // meters from parcel centroid
  centralityScore: number;
  reentryPaths: number;
  reentryScore: number;
  downwindDirs: number;      // count of windOk directions
  downwindScore: number;
  label: string;             // "High" | "Moderate" | "Low"
}

function computeStandResilience(
  standCoords: [number, number],
  standProps: StandPointProperties,
  corridorLines: [number, number][][],
  drawLines: [number, number][][],
  parcelCentroid: [number, number],
): StandResilience {
  // ---- 1. Corridor Count (weight 0.35) ----
  // Count distinct flow lines (corridors + draws) passing within 60–100m
  const CORRIDOR_RADIUS_INNER = 60;  // minimum proximity
  const CORRIDOR_RADIUS_OUTER = 100; // maximum proximity
  let corridorCount = 0;
  const approachBearings: number[] = [];

  for (const line of corridorLines) {
    if (line.length < 2) continue;
    const result = closestPointOnLineString(standCoords, line);
    if (result.dist <= CORRIDOR_RADIUS_OUTER) {
      corridorCount++;
      // Also capture bearing for angular spread
      const seg = line[result.segIndex];
      const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
      approachBearings.push(calculateBearing(seg, segEnd));
    }
  }
  for (const line of drawLines) {
    if (line.length < 2) continue;
    const result = closestPointOnLineString(standCoords, line);
    if (result.dist <= CORRIDOR_RADIUS_OUTER) {
      corridorCount++;
      const seg = line[result.segIndex];
      const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
      approachBearings.push(calculateBearing(seg, segEnd));
    }
  }

  // Score: 0 corridors = 0, 1 = 30, 2 = 60, 3 = 85, 4+ = 100
  const corridorCountScore = corridorCount === 0 ? 0
    : corridorCount === 1 ? 30
    : corridorCount === 2 ? 60
    : corridorCount === 3 ? 85
    : 100;

  // ---- 2. Angular Spread (weight 0.25) ----
  // Measure how many distinct 45° sectors are covered by movement-axis bearings
  // (corridor/draw tangent bearings — these indicate flow direction, not true approach)
  let angularSpread = 0;
  if (approachBearings.length > 0) {
    const sectors = new Set<number>();
    for (const b of approachBearings) {
      sectors.add(Math.floor(((b % 360) + 360) % 360 / 45));
      // Also add the reverse bearing (deer can travel both directions)
      sectors.add(Math.floor(((b + 180) % 360) / 45));
    }
    angularSpread = sectors.size * 45; // degrees of arc covered
  }
  // Score: 0° = 0, 90° = 25, 180° = 55, 270° = 80, 360° = 100
  const angularSpreadScore = Math.min(100, Math.round((angularSpread / 360) * 110));

  // ---- 3. Centrality (weight 0.20) ----
  // Distance from parcel centroid — closer = more resilient (can access more of the property)
  const centralityDist = distanceMeters(standCoords, parcelCentroid);
  // Assume typical parcel radius ~300–500m; score falls off beyond 400m
  const centralityScore = centralityDist <= 100 ? 100
    : centralityDist >= 600 ? 10
    : Math.round(100 - (centralityDist - 100) * 90 / 500);

  // ---- 4. Re-entry Opportunity (weight 0.10) ----
  // Count corridors/draws within a wider radius (150m) that are NOT the nearest one
  // These represent alternative downstream paths for deer to re-enter after disturbance
  let reentryPaths = 0;
  const REENTRY_RADIUS = 150;
  for (const line of corridorLines) {
    if (line.length < 2) continue;
    const result = closestPointOnLineString(standCoords, line);
    if (result.dist > CORRIDOR_RADIUS_INNER && result.dist <= REENTRY_RADIUS) {
      reentryPaths++;
    }
  }
  for (const line of drawLines) {
    if (line.length < 2) continue;
    const result = closestPointOnLineString(standCoords, line);
    if (result.dist > CORRIDOR_RADIUS_INNER && result.dist <= REENTRY_RADIUS) {
      reentryPaths++;
    }
  }
  // Score: 0 = 20 (still some chance), 1 = 55, 2 = 80, 3+ = 100
  const reentryScore = reentryPaths === 0 ? 20
    : reentryPaths === 1 ? 55
    : reentryPaths === 2 ? 80
    : 100;

  // ---- 5. Downwind Recovery (weight 0.10) ----
  // How many wind directions are "ok" — more = more forgiving of shifts
  const downwindDirs = standProps.windOk.length;
  // Score: 1 dir = 15, 2 = 35, 3 = 55, 4 = 75, 5+ = 90, 6+ = 100
  const downwindScore = downwindDirs <= 1 ? 15
    : downwindDirs === 2 ? 35
    : downwindDirs === 3 ? 55
    : downwindDirs === 4 ? 75
    : downwindDirs === 5 ? 90
    : 100;

  // ---- Composite ----
  const score = Math.round(
    corridorCountScore * 0.35
    + angularSpreadScore * 0.25
    + centralityScore * 0.20
    + reentryScore * 0.10
    + downwindScore * 0.10
  );

  const label = score >= 75 ? 'High' : score >= 45 ? 'Moderate' : 'Low';

  return {
    score,
    corridorCount,
    corridorCountScore,
    angularSpread,
    angularSpreadScore,
    centralityDist: Math.round(centralityDist),
    centralityScore,
    reentryPaths,
    reentryScore,
    downwindDirs,
    downwindScore,
    label,
  };
}

// ========== HUNT POCKET GEOMETRY BUILDER (v3.8.6) ==========
// Upstream-biased teardrop intercept zones. The pocket origin is shifted
// ~30% upstream along the corridor so the stand sits near the trailing
// edge of the opportunity zone (~65% density upstream, ~35% downstream).
// Lateral spread is aggressively compressed to reinforce corridor flow.
// Per-vertex corridor-axis bias stored for paint-time intensity modulation.
// 6-harmonic organic jitter eliminates any remaining polygon/ring feel.
function buildHuntPocketFeatures(
  stands: { coords: [number, number]; rank: number; props: StandPointProperties; alignment: { score: number } }[],
  funnels: GeoJSON.FeatureCollection | null | undefined,
  ridges: { ridges_primary?: GeoJSON.FeatureCollection; ridges_secondary?: GeoJSON.FeatureCollection } | null | undefined,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (!stands.length) return { type: 'FeatureCollection', features };

  const RINGS = 4;
  const BASE_RADIUS = 35;
  const MAX_RADIUS = 170;
  const SEGMENTS = 48;

  // ---- Terrain-driven (default) teardrop parameters ----
  const FWD_STRETCH = 2.8;    // longer upstream reach
  const BWD_STRETCH = 0.35;   // minimal downstream presence
  const LAT_COMPRESS = 0.45;  // tight lateral squeeze — strongly flow-aligned
  const UPSTREAM_SHIFT = 0.30; // 30% of scaled max radius

  // ---- Edge-stand (v2.1) forward-biased fan parameters ----
  // Hunter in cover, watching into field: 70% outward / 30% inward
  const EDGE_FWD_STRETCH = 2.4;     // forward reach into field
  const EDGE_BWD_STRETCH = 0.55;    // reduced but present (30% backward)
  const EDGE_LAT_FWD = 0.70;        // wider lateral spread on field side (fan-shaped)
  const EDGE_LAT_BWD = 0.30;        // tight lateral on timber side
  const EDGE_FIELD_SHIFT = 0.35;    // shift pocket center toward field (35% of radius)

  // Extract corridor/draw/ridge lines for bearing
  const corridorLines: [number, number][][] = [];
  const drawLines: [number, number][][] = [];
  if (funnels?.features) {
    for (const f of funnels.features) {
      if (f.geometry?.type !== 'LineString') continue;
      if (f.properties?.funnelType === 'corridor') {
        corridorLines.push((f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
      } else if (f.properties?.funnelType === 'draw') {
        drawLines.push((f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
      }
    }
  }
  const ridgeLines: [number, number][][] = [];
  if (ridges?.ridges_primary?.features) {
    for (const f of ridges.ridges_primary.features) {
      if (f.geometry?.type === 'LineString') {
        ridgeLines.push((f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
      }
    }
  }

  for (let sIdx = 0; sIdx < stands.length; sIdx++) {
    const stand = stands[sIdx];
    const center = stand.coords;
    const scaleFactor = sIdx === 0 ? 1.0 : 0.84;
    const opacityScale = sIdx === 0 ? 1.0 : 0.78;

    // ---- Detect edge stand ----
    const isEdge = stand.props?.isEdgeStand === true && typeof stand.props?.fieldBearing === 'number';

    // ---- Determine pocket bearing ----
    // Edge stands: use field bearing (pointing into the field)
    // Terrain stands: use corridor/draw/ridge tangent
    let stretchBearing = 315;

    if (isEdge) {
      // v2.1: Edge stand — primary bearing points INTO the field
      stretchBearing = stand.props.fieldBearing!;
    } else {
      // Terrain-driven bearing (unchanged from v3.8.6)
      let nearestCorridorDist = Infinity;
      let corridorBearing: number | null = null;
      for (const line of corridorLines) {
        if (line.length < 2) continue;
        const result = closestPointOnLineString(center, line);
        if (result.dist < nearestCorridorDist) {
          nearestCorridorDist = result.dist;
          const seg = line[result.segIndex];
          const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
          corridorBearing = calculateBearing(seg, segEnd);
        }
      }
      if (corridorBearing !== null && nearestCorridorDist < 500) {
        stretchBearing = corridorBearing;
      } else {
        let nearestDrawDist = Infinity;
        for (const line of drawLines) {
          if (line.length < 2) continue;
          const result = closestPointOnLineString(center, line);
          if (result.dist < nearestDrawDist) {
            nearestDrawDist = result.dist;
            const seg = line[result.segIndex];
            const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
            stretchBearing = calculateBearing(seg, segEnd);
          }
        }
        if (nearestDrawDist >= 500) {
          let nearestRidgeDist = Infinity;
          for (const line of ridgeLines) {
            if (line.length < 2) continue;
            const result = closestPointOnLineString(center, line);
            if (result.dist < nearestRidgeDist) {
              nearestRidgeDist = result.dist;
              const seg = line[result.segIndex];
              const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
              stretchBearing = (calculateBearing(seg, segEnd) + 90) % 360;
            }
          }
        }
      }
    }

    const bearingRad = stretchBearing * Math.PI / 180;

    // ---- Shift pocket origin ----
    // Edge stands: shift toward field so pocket projects into the open
    // Terrain stands: shift upstream (stand sits on trailing edge)
    const shiftFraction = isEdge ? EDGE_FIELD_SHIFT : UPSTREAM_SHIFT;
    const shiftDist = MAX_RADIUS * scaleFactor * shiftFraction;
    const shiftedCenter = movePoint(center, stretchBearing, shiftDist);

    // ---- Build concentric shells ----
    for (let ring = RINGS; ring >= 1; ring--) {
      const t = ring / RINGS;
      const radius = (BASE_RADIUS + (MAX_RADIUS - BASE_RADIUS) * t) * scaleFactor;
      const coords: [number, number][] = [];

      for (let i = 0; i <= SEGMENTS; i++) {
        const angle = (i / SEGMENTS) * 2 * Math.PI;
        const localX = Math.cos(angle); // +1 = forward (field/upstream), -1 = backward
        const localY = Math.sin(angle); // lateral

        let deformedX: number;
        let deformedY: number;

        if (isEdge) {
          // v2.1: Forward-weighted fan — asymmetric laterals
          // Forward half (localX > 0): wide fan reaching into field
          // Backward half (localX < 0): compressed, stays in cover
          const fwdBlend = Math.max(0, (localX + 1) / 2);  // 0 at back, 1 at front
          const axialStretch = EDGE_BWD_STRETCH + (EDGE_FWD_STRETCH - EDGE_BWD_STRETCH) * fwdBlend * fwdBlend;
          deformedX = localX * axialStretch;

          // Asymmetric lateral: wider on field side, tighter on timber side
          const latCompress = localX >= 0
            ? EDGE_LAT_FWD  // field-side: wider fan
            : EDGE_LAT_BWD; // timber-side: tight
          deformedY = localY * latCompress;
        } else {
          // Terrain-driven teardrop (unchanged)
          const fwdBlend = (localX + 1) / 2;
          const axialStretch = BWD_STRETCH + (FWD_STRETCH - BWD_STRETCH) * fwdBlend * fwdBlend;
          deformedX = localX * axialStretch;
          deformedY = localY * LAT_COMPRESS;
        }

        const mag = Math.sqrt(deformedX * deformedX + deformedY * deformedY);
        if (mag < 0.001) { coords.push(shiftedCenter); continue; }

        // Rotate to geographic bearing
        const geoX = deformedX * Math.cos(bearingRad) - deformedY * Math.sin(bearingRad);
        const geoY = deformedX * Math.sin(bearingRad) + deformedY * Math.cos(bearingRad);

        const ptBearing = (Math.atan2(geoX, geoY) * 180 / Math.PI + 360) % 360;
        const maxStretch = isEdge ? Math.max(EDGE_FWD_STRETCH, EDGE_LAT_FWD) : Math.max(FWD_STRETCH, LAT_COMPRESS);
        const ptDist = radius * mag / maxStretch;

        coords.push(movePoint(shiftedCenter, ptBearing, ptDist));
      }

      // 6-harmonic organic jitter — stronger amplitude on outer shells
      const jitterAmp = radius * (0.08 + 0.12 * t);
      const jitteredCoords = coords.map((c, i) => {
        if (i === coords.length - 1) return coords[0]; // close ring
        const noise = Math.sin(i * 2.3 + ring * 1.7) * 0.30
                    + Math.sin(i * 4.7 + ring * 2.9) * 0.22
                    + Math.sin(i * 7.9 + ring * 0.5) * 0.18
                    + Math.sin(i * 12.3 + ring * 3.3) * 0.12
                    + Math.sin(i * 17.1 + ring * 1.1) * 0.10
                    + Math.sin(i * 23.7 + ring * 4.1) * 0.06;
        const jitterBearing = (i / SEGMENTS) * 360;
        return movePoint(c, jitterBearing, noise * jitterAmp);
      });

      // Corridor-axis bias: edge stands get slightly lower bias (fan, not lane)
      const corridorBias = isEdge ? 0.75 : 0.85;

      // v-resilience: scale pocket opacity by stand resilience (0→50%, 1→100%)
      const resilienceVal = stand.props?.standResilience ?? 0;
      const resilienceFactor = 0.5 + 0.5 * resilienceVal;
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [jitteredCoords] },
        properties: {
          standRank: stand.rank,
          ring,
          ringNorm: t,
          isTopStand: stand.rank === stands[0]?.rank,
          score: stand.alignment.score,
          stretchBearing,
          opacityScale,
          corridorBias,
          resilienceFactor,
          isEdgeStand: isEdge, // v2.1: edge stand flag for styling
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

// ========== STAND MOVEMENT-AXIS WEDGE BUILDER (v1.1) ==========
// Generates a thin wedge from each stand along the corridor/draw tangent bearing,
// representing the likely movement-flow axis past the stand.
//
// IMPORTANT — Semantic clarification:
//   • The wedge uses the corridor-tangent (or draw-tangent) bearing of the nearest
//     terrain feature, i.e. the direction the corridor/draw flows past the stand.
//   • It aligns with the hunt pocket's long axis (both derive from the same bearing).
//   • It represents the most probable movement flow past the stand — NOT a true
//     approach-direction model.  We do not yet have convergence-vector data that
//     would indicate which direction deer travel along the corridor to reach this
//     stand.  A future approach-direction system would require upstream/downstream
//     convergence analysis.
//   • Treat this as "flow axis" / "movement axis" visualization only.
function buildStandDirectionFeatures(
  stands: { coords: [number, number]; rank: number; props: StandPointProperties; alignment: { score: number } }[],
  funnels: GeoJSON.FeatureCollection | null | undefined,
  ridges: { ridges_primary?: GeoJSON.FeatureCollection; ridges_secondary?: GeoJSON.FeatureCollection } | null | undefined,
  windDir?: string,
  saddleNodes?: GeoJSON.FeatureCollection | null,
  convergenceZones?: GeoJSON.FeatureCollection | null,
): { coneFC: GeoJSON.FeatureCollection; killZoneFC: GeoJSON.FeatureCollection } {
  const coneFeatures: GeoJSON.Feature[] = [];
  const killZoneFeatures: GeoJSON.Feature[] = [];
  if (!stands.length) return {
    coneFC: { type: 'FeatureCollection', features: coneFeatures },
    killZoneFC: { type: 'FeatureCollection', features: killZoneFeatures },
  };

  // Wind bearing (direction wind is blowing FROM → hunter should face downwind)
  const WIND_BEARINGS: Record<string, number> = {
    N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
  };
  const windBearing = windDir ? (WIND_BEARINGS[windDir] ?? 315) : 315;
  // Downwind bearing: the direction scent carries (opposite of wind FROM direction)
  const downwindBearing = (windBearing + 180) % 360;

  // Extract corridor/draw/ridge lines (same logic as hunt pocket)
  const corridorLines: [number, number][][] = [];
  const drawLines: [number, number][][] = [];
  if (funnels?.features) {
    for (const f of funnels.features) {
      if (f.geometry?.type !== 'LineString') continue;
      if (f.properties?.funnelType === 'corridor') {
        corridorLines.push((f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
      } else if (f.properties?.funnelType === 'draw') {
        drawLines.push((f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
      }
    }
  }
  const ridgeLines: [number, number][][] = [];
  if (ridges?.ridges_primary?.features) {
    for (const f of ridges.ridges_primary.features) {
      if (f.geometry?.type === 'LineString') {
        ridgeLines.push((f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
      }
    }
  }

  // ── Saddle + convergence point extraction for kill zone scoring ──
  const saddlePoints: [number, number][] = [];
  if (saddleNodes?.features) {
    for (const f of saddleNodes.features) {
      if (f.geometry?.type === 'Point') {
        saddlePoints.push((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      }
    }
  }
  // Also add saddle polygon centroids from funnels
  if (funnels?.features) {
    for (const f of funnels.features) {
      if (f.properties?.funnelType === 'saddle' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')) {
        const coords: number[][] = [];
        if (f.geometry.type === 'Polygon') coords.push(...(f.geometry as GeoJSON.Polygon).coordinates[0]);
        else (f.geometry as GeoJSON.MultiPolygon).coordinates.forEach(p => coords.push(...p[0]));
        if (coords.length) {
          saddlePoints.push([
            coords.reduce((s, c) => s + c[0], 0) / coords.length,
            coords.reduce((s, c) => s + c[1], 0) / coords.length,
          ]);
        }
      }
    }
  }
  const convergencePoints: [number, number][] = [];
  if (convergenceZones?.features) {
    for (const f of convergenceZones.features) {
      if (f.geometry?.type === 'Point') {
        convergencePoints.push((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      }
    }
  }

  // Helper: generate filled wedge polygon (fan arc) from center
  // Returns a closed polygon: center → arc points → center
  function buildWedgePoly(
    center: [number, number],
    bearing: number,
    halfAngle: number,
    length: number,
    offset: number,
    arcSteps: number = 12,
  ): [number, number][] {
    const origin = movePoint(center, bearing, offset);
    const coords: [number, number][] = [origin];
    for (let i = -arcSteps; i <= arcSteps; i++) {
      const angle = bearing + (halfAngle * i) / arcSteps;
      const normAngle = ((angle % 360) + 360) % 360;
      coords.push(movePoint(center, normAngle, length));
    }
    coords.push(origin); // close polygon
    return coords;
  }

  // Helper: determine semantic watch label
  function getWatchLabel(stand: typeof stands[0], nearestCorridorDist: number, nearestDrawDist: number, nearestRidgeDist: number): string {
    const isEdge = stand.props?.isEdgeStand === true;
    if (isEdge) return 'Watching: Field Edge';
    const saddleScore = (stand.props as unknown as Record<string, unknown>)?.saddleScore;
    if (typeof saddleScore === 'number' && saddleScore > 0.3) return 'Watching: Saddle Funnel';
    if (nearestDrawDist < 200) return 'Watching: Creek Crossing';
    if (nearestCorridorDist < 300) return 'Watching: Corridor';
    if (nearestRidgeDist < 300) return 'Watching: Ridge Line';
    return 'Watching: Corridor';
  }

  // ── Kill zone sub-wedge scoring ──
  // Divide cone into angular slices, score each by terrain signal density,
  // pick best contiguous pair → narrow high-probability wedge
  const KILL_ZONE_SLICES = 7;       // divide cone arc into 7 angular bins
  const KILL_ZONE_SCAN_RADIUS = 60; // metres — sample radius for terrain signals
  const CORRIDOR_WEIGHT = 0.40;
  const SADDLE_WEIGHT = 0.25;
  const CONVERGENCE_WEIGHT = 0.25;
  const EDGE_WEIGHT = 0.10;         // light edge proximity per safety constraints

  function scoreSlice(
    samplePt: [number, number],
    standIsEdge: boolean,
    fieldBearing?: number,
  ): number {
    // Corridor density: inverse distance to nearest corridor/draw line
    let corridorScore = 0;
    for (const line of [...corridorLines, ...drawLines]) {
      if (line.length < 2) continue;
      const r = closestPointOnLineString(samplePt, line);
      if (r.dist < KILL_ZONE_SCAN_RADIUS) {
        corridorScore = Math.max(corridorScore, 1 - r.dist / KILL_ZONE_SCAN_RADIUS);
      }
    }

    // Saddle alignment: inverse distance to nearest saddle
    let saddleAlignScore = 0;
    for (const sp of saddlePoints) {
      const d = distanceMeters(samplePt, sp);
      if (d < KILL_ZONE_SCAN_RADIUS) {
        saddleAlignScore = Math.max(saddleAlignScore, 1 - d / KILL_ZONE_SCAN_RADIUS);
      }
    }

    // Convergence: inverse distance to nearest convergence zone
    let convergenceScore = 0;
    for (const cp of convergencePoints) {
      const d = distanceMeters(samplePt, cp);
      if (d < KILL_ZONE_SCAN_RADIUS) {
        convergenceScore = Math.max(convergenceScore, 1 - d / KILL_ZONE_SCAN_RADIUS);
      }
    }

    // Edge proximity (light, additive only)
    let edgeScore = 0;
    if (standIsEdge && typeof fieldBearing === 'number') {
      // Score higher if sample point is in the direction of the field
      const bearingToSample = calculateBearing(samplePt, samplePt); // placeholder — actual used via slice angle
      edgeScore = 0.5; // flat mild bonus for edge stands
    }

    return (
      corridorScore * CORRIDOR_WEIGHT +
      saddleAlignScore * SADDLE_WEIGHT +
      convergenceScore * CONVERGENCE_WEIGHT +
      edgeScore * EDGE_WEIGHT
    );
  }

  for (const stand of stands) {
    const center = stand.coords;

    // ---- Detect edge stand ----
    const isEdge = stand.props?.isEdgeStand === true && typeof stand.props?.fieldBearing === 'number';

    // ---- Determine movement bearing (terrain/corridor axis) ----
    let movementBearing = 315; // fallback NW
    let nearestCorridorDist = Infinity;
    let nearestDrawDist = Infinity;
    let nearestRidgeDist = Infinity;

    if (isEdge) {
      movementBearing = stand.props.fieldBearing!;
    } else {
      let corridorBrg: number | null = null;
      for (const line of corridorLines) {
        if (line.length < 2) continue;
        const result = closestPointOnLineString(center, line);
        if (result.dist < nearestCorridorDist) {
          nearestCorridorDist = result.dist;
          const seg = line[result.segIndex];
          const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
          corridorBrg = calculateBearing(seg, segEnd);
        }
      }
      if (corridorBrg !== null && nearestCorridorDist < 500) {
        movementBearing = corridorBrg;
      } else {
        for (const line of drawLines) {
          if (line.length < 2) continue;
          const result = closestPointOnLineString(center, line);
          if (result.dist < nearestDrawDist) {
            nearestDrawDist = result.dist;
            const seg = line[result.segIndex];
            const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
            movementBearing = calculateBearing(seg, segEnd);
          }
        }
        if (nearestDrawDist >= 500) {
          for (const line of ridgeLines) {
            if (line.length < 2) continue;
            const result = closestPointOnLineString(center, line);
            if (result.dist < nearestRidgeDist) {
              nearestRidgeDist = result.dist;
              const seg = line[result.segIndex];
              const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
              movementBearing = (calculateBearing(seg, segEnd) + 90) % 360;
            }
          }
        }
      }
    }

    // ---- Composite facing: 70% movement vector + 30% wind-adjusted bearing ----
    // Wind adjustment: face crosswind/downwind for scent advantage
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const mvRad = toRad(movementBearing);
    const dwRad = toRad(downwindBearing);
    // Circular weighted average
    const sx = 0.7 * Math.sin(mvRad) + 0.3 * Math.sin(dwRad);
    const cx = 0.7 * Math.cos(mvRad) + 0.3 * Math.cos(dwRad);
    let faceBearing = ((toDeg(Math.atan2(sx, cx)) % 360) + 360) % 360;

    // Kill Zone wedge parameters
    const WEDGE_LENGTH = isEdge ? 65 : 50;         // edge: 65m, terrain: 50m
    const WEDGE_HALF_ANGLE = isEdge ? 25 : 12;     // edge: ±25° (wide), terrain: ±12° (narrow)
    const OFFSET = 10; // start 10m from center (outside the marker)

    const watchLabel = getWatchLabel(stand, nearestCorridorDist, nearestDrawDist, nearestRidgeDist);

    // Build filled wedge polygon (full cone — general visibility)
    const wedgeCoords = buildWedgePoly(center, faceBearing, WEDGE_HALF_ANGLE, WEDGE_LENGTH, OFFSET);
    coneFeatures.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [wedgeCoords] },
      properties: {
        standRank: stand.rank,
        isTopStand: stand.rank === stands[0]?.rank,
        isEdgeStand: isEdge,
        watchLabel,
        faceBearing,
      },
    });

    // ── Kill zone sub-wedge: highest-probability shot zone within the cone ──
    // Score angular slices across the cone arc, find best contiguous pair
    const sliceScores: number[] = [];
    const sliceAngles: number[] = [];
    const fullArc = WEDGE_HALF_ANGLE * 2;
    const sliceWidth = fullArc / KILL_ZONE_SLICES;
    const sampleDist = WEDGE_LENGTH * 0.6; // sample at 60% of cone length

    for (let s = 0; s < KILL_ZONE_SLICES; s++) {
      const sliceAngle = faceBearing - WEDGE_HALF_ANGLE + sliceWidth * (s + 0.5);
      const normAngle = ((sliceAngle % 360) + 360) % 360;
      sliceAngles.push(normAngle);
      const samplePt = movePoint(center, normAngle, sampleDist);
      sliceScores.push(scoreSlice(samplePt, isEdge, stand.props?.fieldBearing ?? undefined));
    }

    // Find best contiguous pair of slices (2 adjacent slices = tightest zone)
    let bestPairIdx = 0;
    let bestPairScore = -1;
    for (let i = 0; i < KILL_ZONE_SLICES - 1; i++) {
      const pairScore = sliceScores[i] + sliceScores[i + 1];
      if (pairScore > bestPairScore) {
        bestPairScore = pairScore;
        bestPairIdx = i;
      }
    }

    // Kill zone bearing = midpoint of best pair
    const kzStartAngle = faceBearing - WEDGE_HALF_ANGLE + sliceWidth * bestPairIdx;
    const kzEndAngle = faceBearing - WEDGE_HALF_ANGLE + sliceWidth * (bestPairIdx + 2);
    const kzCenterBearing = (kzStartAngle + kzEndAngle) / 2;
    const kzHalfAngle = (kzEndAngle - kzStartAngle) / 2;

    // Kill zone dimensions: tighter and slightly shorter than full cone
    const KZ_LENGTH = WEDGE_LENGTH * 0.85;
    const KZ_OFFSET = OFFSET + 2; // slightly further from stand center

    const kzCoords = buildWedgePoly(center, kzCenterBearing, kzHalfAngle, KZ_LENGTH, KZ_OFFSET, 8);

    // Confidence: best pair score normalized (0-1)
    const maxPossible = CORRIDOR_WEIGHT + SADDLE_WEIGHT + CONVERGENCE_WEIGHT + EDGE_WEIGHT; // 1.0
    const kzConfidence = Math.min(1, bestPairScore / (2 * maxPossible));

    killZoneFeatures.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [kzCoords] },
      properties: {
        standRank: stand.rank,
        isTopStand: stand.rank === stands[0]?.rank,
        isEdgeStand: isEdge,
        watchLabel,
        kzBearing: kzCenterBearing,
        kzConfidence,
        kzScore: bestPairScore,
      },
    });
  }

  return {
    coneFC: { type: 'FeatureCollection', features: coneFeatures },
    killZoneFC: { type: 'FeatureCollection', features: killZoneFeatures },
  };
}

// Generate corridor continuation arrows extending beyond parcel boundary
function generateCorridorArrows(
  corridors: GeoJSON.FeatureCollection,
  parcelCoords: number[][]
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const ARROW_LENGTH = 75; // 50-100m, using 75m
  const BOUNDARY_THRESHOLD = 30; // meters from boundary to trigger

  if (!corridors?.features?.length || !parcelCoords?.length) return { type: 'FeatureCollection', features };

  corridors.features.forEach((corridor, idx) => {
    if (corridor.geometry?.type !== 'LineString') return;
    const coords = corridor.geometry.coordinates as [number, number][];
    if (coords.length < 2) return;

    // Check both ends of the corridor
    const endpoints = [
      { point: coords[0], direction: calculateBearing(coords[1], coords[0]), isStart: true },
      { point: coords[coords.length - 1], direction: calculateBearing(coords[coords.length - 2], coords[coords.length - 1]), isStart: false }
    ];

    endpoints.forEach(({ point, direction, isStart }) => {
      const closest = closestPointOnPolygon(point, parcelCoords);
      const distToBoundary = distanceMeters(point, closest.point);
      
      // If close to boundary, create arrow extending outward
      if (distToBoundary < BOUNDARY_THRESHOLD) {
        const arrowEnd = movePoint(closest.point, direction, ARROW_LENGTH);
        
        // Create arrow line with tapered width effect (we'll use two lines)
        features.push({
          type: 'Feature',
          properties: {
            type: 'corridor_continuation',
            direction: isStart ? 'inbound' : 'outbound',
            corridorScore: corridor.properties?.corridorScore || 0.5,
            arrowIndex: idx
          },
          geometry: {
            type: 'LineString',
            coordinates: [closest.point, arrowEnd]
          }
        });

        // Create arrowhead
        const headSize = 15; // meters
        const headLeft = movePoint(arrowEnd, (direction - 150 + 360) % 360, headSize);
        const headRight = movePoint(arrowEnd, (direction + 150) % 360, headSize);
        
        features.push({
          type: 'Feature',
          properties: {
            type: 'corridor_arrow_head',
            direction: isStart ? 'inbound' : 'outbound'
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[arrowEnd, headLeft, headRight, arrowEnd]]
          }
        });
      }
    });
  });

  return { type: 'FeatureCollection', features };
}

// Generate ghost bedding silhouettes near boundaries
function generateGhostBedding(
  beddingAreas: GeoJSON.FeatureCollection,
  parcelCoords: number[][]
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const GHOST_OFFSET = 60; // meters outside boundary
  const BOUNDARY_THRESHOLD = 50; // meters from boundary to trigger ghost

  if (!beddingAreas?.features?.length || !parcelCoords?.length) return { type: 'FeatureCollection', features };

  beddingAreas.features.forEach((bedding, idx) => {
    if (!bedding.geometry || !['Polygon', 'MultiPolygon'].includes(bedding.geometry.type)) return;
    
    // Get centroid of bedding area
    let centroid: [number, number] = [0, 0];
    let count = 0;
    
    const processCoords = (coords: number[][]) => {
      coords.forEach(c => {
        centroid[0] += c[0];
        centroid[1] += c[1];
        count++;
      });
    };
    
    if (bedding.geometry.type === 'Polygon') {
      processCoords((bedding.geometry as GeoJSON.Polygon).coordinates[0]);
    } else {
      (bedding.geometry as GeoJSON.MultiPolygon).coordinates.forEach(poly => processCoords(poly[0]));
    }
    
    centroid = [centroid[0] / count, centroid[1] / count];
    
    // Check distance to boundary
    const closest = closestPointOnPolygon(centroid, parcelCoords);
    const distToBoundary = distanceMeters(centroid, closest.point);
    
    // If bedding is near boundary, create ghost outside
    if (distToBoundary < BOUNDARY_THRESHOLD) {
      // Calculate direction from centroid to boundary and extend outward
      const bearingOut = calculateBearing(centroid, closest.point);
      const ghostCenter = movePoint(closest.point, bearingOut, GHOST_OFFSET);
      
      // Create elliptical ghost shape
      const ghostPoints: [number, number][] = [];
      const radiusA = 25; // major axis meters
      const radiusB = 18; // minor axis meters
      
      for (let angle = 0; angle < 360; angle += 30) {
        const rad = angle * Math.PI / 180;
        const r = (radiusA * radiusB) / Math.sqrt(
          Math.pow(radiusB * Math.cos(rad), 2) + Math.pow(radiusA * Math.sin(rad), 2)
        );
        ghostPoints.push(movePoint(ghostCenter, (bearingOut + angle) % 360, r));
      }
      ghostPoints.push(ghostPoints[0]); // Close the ring
      
      features.push({
        type: 'Feature',
        properties: {
          type: 'ghost_bedding',
          influence: 'external',
          originalBeddingIndex: idx,
          confidence: bedding.properties?.confidence || 0.6
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ghostPoints]
        }
      });
    }
  });

  return { type: 'FeatureCollection', features };
}

// Generate pressure direction arrows based on corridor flow
function generatePressureArrows(
  corridors: GeoJSON.FeatureCollection,
  parcelCoords: number[][]
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const ARROW_LENGTH = 50;
  const BOUNDARY_THRESHOLD = 40;
  
  if (!corridors?.features?.length || !parcelCoords?.length) return { type: 'FeatureCollection', features };

  // Process each corridor to determine pressure direction
  corridors.features.forEach((corridor, idx) => {
    if (corridor.geometry?.type !== 'LineString') return;
    const coords = corridor.geometry.coordinates as [number, number][];
    if (coords.length < 2) return;

    const score = corridor.properties?.corridorScore || 0.5;
    if (score < 0.3) return; // Only show pressure for meaningful corridors

    // Determine if corridor enters or exits the parcel
    const start = coords[0];
    const end = coords[coords.length - 1];
    
    const startInParcel = pointInPolygon(start, parcelCoords);
    const endInParcel = pointInPolygon(end, parcelCoords);

    // Create pressure indicator at boundary crossing
    const checkEndpoint = (point: [number, number], isInbound: boolean, otherPoint: [number, number]) => {
      const closest = closestPointOnPolygon(point, parcelCoords);
      const distToBoundary = distanceMeters(point, closest.point);
      
      if (distToBoundary < BOUNDARY_THRESHOLD) {
        const bearingToOther = calculateBearing(point, otherPoint);
        const arrowStart = movePoint(closest.point, isInbound ? (bearingToOther + 180) % 360 : bearingToOther, ARROW_LENGTH);
        
        features.push({
          type: 'Feature',
          properties: {
            type: 'pressure_arrow',
            direction: isInbound ? 'inbound' : 'outbound',
            corridorScore: score,
            arrowIndex: idx
          },
          geometry: {
            type: 'LineString',
            coordinates: isInbound ? [arrowStart, closest.point] : [closest.point, arrowStart]
          }
        });
      }
    };

    if (!startInParcel && endInParcel) {
      // Inbound corridor
      checkEndpoint(start, true, end);
    } else if (startInParcel && !endInParcel) {
      // Outbound corridor
      checkEndpoint(end, false, start);
    }
  });

  return { type: 'FeatureCollection', features };
}

// Generate ghost saddle silhouettes extending beyond parcel boundary
function generateGhostSaddles(
  funnels: GeoJSON.FeatureCollection,
  parcelCoords: number[][]
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const GHOST_OFFSET = 50; // meters outside boundary
  const BOUNDARY_THRESHOLD = 40; // meters from boundary to trigger

  if (!funnels?.features?.length || !parcelCoords?.length) return { type: 'FeatureCollection', features };

  // Filter for saddles only (polygons with funnelType === 'saddle')
  const saddles = funnels.features.filter(
    f => f.properties?.funnelType === 'saddle' && ['Polygon', 'MultiPolygon'].includes(f.geometry?.type || '')
  );

  saddles.forEach((saddle, idx) => {
    // Get centroid of saddle
    let centroid: [number, number] = [0, 0];
    let count = 0;

    const processCoords = (coords: number[][]) => {
      coords.forEach(c => {
        centroid[0] += c[0];
        centroid[1] += c[1];
        count++;
      });
    };

    if (saddle.geometry?.type === 'Polygon') {
      processCoords((saddle.geometry as GeoJSON.Polygon).coordinates[0]);
    } else if (saddle.geometry?.type === 'MultiPolygon') {
      (saddle.geometry as GeoJSON.MultiPolygon).coordinates.forEach(poly => processCoords(poly[0]));
    }
    
    if (count === 0) return;
    centroid = [centroid[0] / count, centroid[1] / count];

    // Check distance to boundary
    const closest = closestPointOnPolygon(centroid, parcelCoords);
    const distToBoundary = distanceMeters(centroid, closest.point);

    // If saddle is near boundary, create ghost outside
    if (distToBoundary < BOUNDARY_THRESHOLD) {
      const bearingOut = calculateBearing(centroid, closest.point);
      const ghostCenter = movePoint(closest.point, bearingOut, GHOST_OFFSET);

      // Create ghost saddle shape (pinch-point style)
      const ghostPoints: [number, number][] = [];
      const width = saddle.properties?.narrowestWidthMeters || 30;
      const radiusA = Math.max(15, width / 2); // major axis
      const radiusB = Math.max(10, width / 3); // minor axis (narrower = more pinch)

      for (let angle = 0; angle < 360; angle += 30) {
        const rad = angle * Math.PI / 180;
        const r = (radiusA * radiusB) / Math.sqrt(
          Math.pow(radiusB * Math.cos(rad), 2) + Math.pow(radiusA * Math.sin(rad), 2)
        );
        ghostPoints.push(movePoint(ghostCenter, (bearingOut + angle) % 360, r));
      }
      ghostPoints.push(ghostPoints[0]); // Close the ring

      features.push({
        type: 'Feature',
        properties: {
          type: 'ghost_saddle',
          influence: 'external',
          originalIndex: idx,
          corridorScore: saddle.properties?.corridorScore || 0.5,
          narrowestWidth: saddle.properties?.narrowestWidthMeters || 30
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ghostPoints]
        }
      });
    }
  });

  return { type: 'FeatureCollection', features };
}

// Generate draw/funnel extensions beyond parcel boundary
function generateDrawExtensions(
  funnels: GeoJSON.FeatureCollection,
  parcelCoords: number[][],
  waterBodies?: Array<{ coordinates: number[][][] }>
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const EXTENSION_LENGTH = 60; // meters beyond boundary
  const BOUNDARY_THRESHOLD = 35; // meters from boundary to trigger

  if (!funnels?.features?.length || !parcelCoords?.length) return { type: 'FeatureCollection', features };

  // Filter for draws only (lines with funnelType === 'draw')
  const draws = funnels.features.filter(
    f => f.properties?.funnelType === 'draw' && f.geometry?.type === 'LineString'
  );

  draws.forEach((draw, idx) => {
    const coords = (draw.geometry as GeoJSON.LineString).coordinates as [number, number][];
    if (coords.length < 2) return;

    // Check both ends of the draw
    const endpoints = [
      { point: coords[0], direction: calculateBearing(coords[1], coords[0]), isStart: true },
      { point: coords[coords.length - 1], direction: calculateBearing(coords[coords.length - 2], coords[coords.length - 1]), isStart: false }
    ];

    endpoints.forEach(({ point, direction, isStart }) => {
      const closest = closestPointOnPolygon(point, parcelCoords);
      const distToBoundary = distanceMeters(point, closest.point);

      if (distToBoundary < BOUNDARY_THRESHOLD) {
        const extensionEnd = movePoint(closest.point, direction, EXTENSION_LENGTH);

        // Water body exclusion — skip if extension projects into water
        if (waterBodies?.length && pointInAnyWaterBody(extensionEnd[0], extensionEnd[1], waterBodies)) return;

        // Create dashed extension line
        features.push({
          type: 'Feature',
          properties: {
            type: 'draw_extension',
            direction: isStart ? 'inbound' : 'outbound',
            originalIndex: idx,
            corridorScore: draw.properties?.corridorScore || 0.4
          },
          geometry: {
            type: 'LineString',
            coordinates: [closest.point, extensionEnd]
          }
        });
      }
    });
  });

  return { type: 'FeatureCollection', features };
}

// Identify adjacent parcel boundaries for click interaction
function generateAdjacentParcelBoundary(parcelCoords: number[][]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const BUFFER_DISTANCE = 15; // meters outside boundary for clickable area
  
  if (!parcelCoords?.length) return { type: 'FeatureCollection', features };

  // Create a buffered line along each boundary segment
  for (let i = 0; i < parcelCoords.length - 1; i++) {
    const a = parcelCoords[i] as [number, number];
    const b = parcelCoords[i + 1] as [number, number];
    
    // Calculate perpendicular direction (outward)
    const bearing = calculateBearing(a, b);
    const perpBearing = (bearing + 90) % 360; // Right side = outside for counter-clockwise polygons
    
    // Create outer edge points
    const a_out = movePoint(a, perpBearing, BUFFER_DISTANCE);
    const b_out = movePoint(b, perpBearing, BUFFER_DISTANCE);
    
    // Calculate center point and segment info
    const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const segmentLength = distanceMeters(a, b);
    
    features.push({
      type: 'Feature',
      properties: {
        type: 'adjacent_boundary',
        segmentIndex: i,
        bearing: bearing,
        lengthMeters: segmentLength,
        midpoint: midpoint
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[a, b, b_out, a_out, a]]
      }
    });
  }

  return { type: 'FeatureCollection', features };
}

// Empty GeoJSON for initializing sources
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// ═══════════════════════════════════════════════════════════════════════════
// HERO PARCELS — curated demo properties that reliably showcase terrain intel
// ═══════════════════════════════════════════════════════════════════════════
interface HeroParcel {
  slug: string;
  label: string;
  tagline: string;
  lat: number;
  lng: number;
  acreage: string;
  address: string;
}
const HERO_PARCELS: HeroParcel[] = [
  {
    slug: 'pineville',
    label: 'Pineville Ridge',
    tagline: 'Deep hollows, funnel corridors',
    lat: 36.638590,
    lng: -94.345581,
    acreage: '118',
    address: '761 Schlessman Rd, Pineville, MO 64831',
  },
  {
    slug: 'pomme-de-terre',
    label: 'Pomme de Terre',
    tagline: 'Lake bluffs, bedding benches',
    lat: 37.872200,
    lng: -93.336400,
    acreage: '80',
    address: 'Pomme de Terre Lake, Hickory County, MO',
  },
  {
    slug: 'cedar-creek',
    label: 'Cedar Creek',
    tagline: 'Creek bottoms, ridge saddles',
    lat: 38.595700,
    lng: -92.285300,
    acreage: '95',
    address: 'Cedar Creek, Callaway County, MO',
  },
  {
    slug: 'mark-twain',
    label: 'Mark Twain Hollow',
    tagline: 'Steep terrain, tight funnels',
    lat: 37.422000,
    lng: -91.590000,
    acreage: '100',
    address: 'Mark Twain NF, Shannon County, MO',
  },
];

function LoadingFallback() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-gray-900">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-amber-500 animate-spin mx-auto mb-4" />
        <p className="text-white text-lg">Loading Deer Intel...</p>
      </div>
    </div>
  );
}

export default function DeerIntelPage() {
  return (
    <IntelErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <DeerIntelContent />
      </Suspense>
    </IntelErrorBoundary>
  );
}

function DeerIntelContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, update: updateSession } = useSession() || {};
  const subStatus = session?.user?.subscriptionStatus || 'free';
  const isPro = subStatus === 'pro' || subStatus === 'promax';
  const isProMax = subStatus === 'promax';
  const TERRITORY_PARCEL_CAP = isProMax ? 10 : isPro ? 5 : 1;
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null); // 'monthly' | 'annual' | null
  const [showScoreCard, setShowScoreCard] = useState(false);

  // ========== v3.9.0 — Custom Sit Pins (Pro feature) ==========
  // Context menu anchored in viewport coordinates (position: fixed)
  const [sitPinMenu, setSitPinMenu] = useState<
    | { x: number; y: number; lng: number; lat: number; gated: boolean }
    | null
  >(null);
  // Pin naming modal — open with the chosen map coordinates
  const [sitPinModal, setSitPinModal] = useState<
    | { lng: number; lat: number }
    | null
  >(null);
  const [sitPinName, setSitPinName] = useState<string>('');
  const [sitPinSaving, setSitPinSaving] = useState<boolean>(false);
  const [sitPinError, setSitPinError] = useState<string | null>(null);
  // Loaded user pins for the *current* parcel
  interface SitPin { id: string; parcel_id: string; name: string; lng: number; lat: number; created_at: string; }
  const [sitPins, setSitPins] = useState<SitPin[]>([]);
  // ========== Stand Journal (Pro feature) ==========
  // Opened by left-clicking an existing green Sit Pin marker.
  interface StandJournalEntry {
    id: string;
    user_id: string;
    sit_pin_id: string;
    entry_date: string;             // YYYY-MM-DD
    wind_direction: string | null;  // N | NE | E | SE | S | SW | W | NW
    temp_f: number | null;
    sightings: string | null;
    notes: string | null;
    created_at: string;
  }
  const [journalPin, setJournalPin] = useState<{ id: string; name: string } | null>(null);
  const [journalEntries, setJournalEntries] = useState<StandJournalEntry[]>([]);
  const [journalLoading, setJournalLoading] = useState<boolean>(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [journalFormOpen, setJournalFormOpen] = useState<boolean>(false);
  const [journalSubmitting, setJournalSubmitting] = useState<boolean>(false);
  const [journalDate, setJournalDate] = useState<string>('');
  const [journalWind, setJournalWind] = useState<string>('');
  const [journalTemp, setJournalTemp] = useState<string>('');
  const [journalSightings, setJournalSightings] = useState<string>('');
  const [journalNotes, setJournalNotes] = useState<string>('');
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // vNext: markersRef removed — stands are GeoJSON layers, no HTML markers
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  
  // v3.5.1 — Animation frame ref for corridor flow animation
  const flowAnimationRef = useRef<number | null>(null);
  const flowAnimationPhase = useRef<number>(0);

  // URL params (initial values)
  const urlLat = parseFloat(searchParams.get('lat') || '0');
  const urlLng = parseFloat(searchParams.get('lng') || '0');
  const urlAddress = searchParams.get('address') || 'Sample Property';
  const urlAcreage = searchParams.get('acreage');
  // Part 3: orderId from URL param (checkout success link) takes priority over localStorage
  const urlOrderId = searchParams.get('orderId');
  const debugMode = searchParams.get('debug') === 'true'; // Admin/debug only features
  // Demo mode: ?demo=true → always load Pineville parcel, skip parcel lookup
  const demoMode = searchParams.get('demo') === 'true';
  // Hero parcel: ?parcel=<slug> → load a curated demo parcel directly
  const heroSlug = searchParams.get('parcel');
  const heroParcel = heroSlug ? HERO_PARCELS.find(p => p.slug === heroSlug) : null;
  // Territory share URL: ?territory=true&p1lat=...&p1lng=...&p2lat=...&p2lng=...&p3lat=...&p3lng=...&name=...
  const urlTerritory = searchParams.get('territory') === 'true';
  const urlP1Lat = parseFloat(searchParams.get('p1lat') || '0');
  const urlP1Lng = parseFloat(searchParams.get('p1lng') || '0');
  const urlP2Lat = parseFloat(searchParams.get('p2lat') || '0');
  const urlP2Lng = parseFloat(searchParams.get('p2lng') || '0');
  const urlP3Lat = parseFloat(searchParams.get('p3lat') || '0');
  const urlP3Lng = parseFloat(searchParams.get('p3lng') || '0');
  const urlP4Lat = parseFloat(searchParams.get('p4lat') || '0');
  const urlP4Lng = parseFloat(searchParams.get('p4lng') || '0');
  const urlP5Lat = parseFloat(searchParams.get('p5lat') || '0');
  const urlP5Lng = parseFloat(searchParams.get('p5lng') || '0');
  const urlTerritoryName = searchParams.get('name') || 'My Territory';
  // If hero parcel is specified, use its coords; if demo mode, use Pineville; else URL
  const resolvedInitial = heroParcel
    ? { lat: heroParcel.lat, lng: heroParcel.lng, address: heroParcel.address, acreage: heroParcel.acreage }
    : demoMode
    ? { lat: 36.638590, lng: -94.345581, address: '761 Schlessman Rd, Pineville, MO 64831', acreage: '118' }
    : (urlLat !== 0 && urlLng !== 0)
    ? { lat: urlLat, lng: urlLng, address: urlAddress, acreage: urlAcreage }
    : { lat: 0, lng: 0, address: '', acreage: '0' };

  // Active coordinates — start from URL, updated by Exploration Mode clicks
  const [activeLat, setActiveLat] = useState(resolvedInitial.lat);
  const [activeLng, setActiveLng] = useState(resolvedInitial.lng);
  const [activeAddress, setActiveAddress] = useState(resolvedInitial.address);
  const [activeAcreage, setActiveAcreage] = useState(resolvedInitial.acreage);
  // Track which hero parcel is currently active (for highlighting)
  const [activeHeroSlug, setActiveHeroSlug] = useState<string | null>(heroSlug || (demoMode ? 'pineville' : null));
  
  // Derived aliases for backward compatibility throughout the file
  const lat = activeLat;
  const lng = activeLng;
  const address = activeAddress;
  const acreageParam = activeAcreage;

  // Refs that always mirror the latest active coordinates.
  // runAnalysis reads from these so setTimeout callers never capture stale closures.
  const activeLatRef = useRef(activeLat);
  const activeLngRef = useRef(activeLng);
  const activeAcreageRef = useRef(activeAcreage);
  useEffect(() => { activeLatRef.current = activeLat; }, [activeLat]);
  useEffect(() => { activeLngRef.current = activeLng; }, [activeLng]);
  useEffect(() => { activeAcreageRef.current = activeAcreage; }, [activeAcreage]);

  // Pre-fetched parcel geometry ref.  Pick Parcel / Explore flows populate this
  // BEFORE calling runAnalysis so the analyzer can skip the redundant Regrid lookup
  // and keep the gold boundary visible with no full-screen loading overlay.
  const prefetchedParcelRef = useRef<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);

  // Analysis state
  const [isLoading, setIsLoading] = useState(true);
  const [backgroundAnalysis, setBackgroundAnalysis] = useState(false);
  // 1.5-second "clean parcel view" hold: after Pick Parcel, the gold boundary
  // and fitted map are shown alone before terrain overlays / progress chip appear.
  const [parcelViewHold, setParcelViewHold] = useState(false);
  const parcelViewHoldRef = useRef(false); // sync mirror for map-painting effects
  const parcelViewHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TerrainMode>('preview');
  const [layers, setLayers] = useState<TerrainLayers | null>(null);
  const [summary, setSummary] = useState<TerrainSummary | null>(null);
  const [provenance, setProvenance] = useState<TerrainProvenance | null>(null);

  // Stall detection: tracks how long progress has been stuck
  const [analysisStalled, setAnalysisStalled] = useState(false);
  const lastProgressRef = useRef({ value: 0, time: Date.now() });

  // Demo fallback: known-good parcel for FB demo safety net
  const DEMO_FALLBACK = useRef({ lat: 36.638590, lng: -94.345581, address: '761 Schlessman Rd, Pineville, MO 64831', acreage: '118' });
  const demoFallbackAttempted = useRef(false);
  const [isDemoFallbackActive, setIsDemoFallbackActive] = useState(false);
  const [showDemoBadge, setShowDemoBadge] = useState(false);

  // Global/unhandled error state
  const [globalError, setGlobalError] = useState<{ message: string; stack?: string } | null>(null);

  // User controls
  const [season, setSeason] = useState<SeasonProfile>('rut');
  // pressureFocus/pressureView removed — locked to 'balanced'/'pressure' permanently
  // v2.2: Parcel complexity score (0-1) — drives Deer Flow expression strength.
  // Simple parcels get lighter heatmap; irregular parcels get stronger expression.
  const parcelComplexityRef = useRef<number>(0);
  const [windDirection, setWindDirection] = useState<WindDirection>('NW');
  // Refs that always mirror the latest season/wind values.
  // runAnalysis reads from these so it never captures stale closures,
  // while remaining excluded from its dep array to avoid auto-re-triggers.
  const seasonRef = useRef<SeasonProfile>(season);
  const windDirectionRef = useRef<WindDirection>(windDirection);
  useEffect(() => { seasonRef.current = season; }, [season]);
  useEffect(() => { windDirectionRef.current = windDirection; }, [windDirection]);
  const [windLastUpdated, setWindLastUpdated] = useState<Date>(() => new Date(0));
  const [windMinAgo, setWindMinAgo] = useState(0);
  const [selectedStand, setSelectedStand] = useState<number | null>(null);
  const selectedStandRef = useRef<number | null>(null);
  useEffect(() => { selectedStandRef.current = selectedStand; }, [selectedStand]);
  const [soloStandMode, setSoloStandMode] = useState(false);

  // ========== STAND COMPARE STATE (v1.2) ==========
  // Holds two stand selections for a future side-by-side comparison panel.
  // Each value is the stand's index in the alignedStands array, or null if
  // no stand is selected for that slot.  UI and wiring come in a later task.
  const [compareStandA, setCompareStandA] = useState<number | null>(null);
  const [compareStandB, setCompareStandB] = useState<number | null>(null);

  // ========== TERRAIN WORK MODE ==========
  // A terrain study tool for verifying terrain anatomy before deer interpretation layers.
  // 
  // ENABLED LAYERS (physical terrain structure):
  //   • Travel Corridor (Primary Path) - movement spine
  //   • Draws - water flow channels / drainage
  //   • Saddles - low points between ridges
  //   • Future: contour travel zones / benches
  //
  // DISABLED LAYERS (deer interpretation):
  //   • Corridors - deer movement paths
  //   • Stands - recommended stand locations
  //   • Alignment scoring - stand ranking
  //
  // Set to false once terrain structure is visually verified and ready for deer logic.
  const TERRAIN_WORK_MODE = false;
  
  const [visibility, setVisibility] = useState<TerrainLayerVisibility>({
    // Deer interpretation - HIDE in Terrain Work Mode
    bedding: !TERRAIN_WORK_MODE,   // Bedding circles = deer interpretation
    stands: true,                   // Stand markers always visible
    corridors: !TERRAIN_WORK_MODE,  // Corridor lines = deer interpretation
    // Physical terrain structure - SHOW in Terrain Work Mode
    funnels: true,    // Legacy combined key (kept for compat)
    saddles: true,    // Independent saddle visibility
    draws: true,      // Independent draw visibility
    // Always show terrain anatomy
    ridgeSpines: true,
  });
  
  // Terrain Flow visibility (separate from main visibility for cleaner control)
  const [flowVisibility, setFlowVisibility] = useState<TerrainFlowVisibility>({
    pressureHeatmap: true,  // PRIMARY: Terrain pressure heat map (the main visual)
    flowPrimary: true,      // Primary flow corridors (validates heat map)
    flowSecondary: true,    // Secondary feeder lines (terrain-justified only)
    convergenceZones: true, // Convergence zone markers (convergence IS opportunity)
  });
  
  // Derived: true when the Pressure Map master toggle is ON
  const isPressureMode = flowVisibility.pressureHeatmap === true;

  // v3.6.0 — Terrain Reasons toggle (shows explanations when clicking features)
  const [showTerrainReasons, setShowTerrainReasons] = useState(false);
  const [terrainReasonData, setTerrainReasonData] = useState<TerrainReasonData | null>(null);
  const [terrainReasonPosition, setTerrainReasonPosition] = useState<{ x: number; y: number } | null>(null);
  
  // v3.6.0 — Bedding Probability visibility toggle
  const [showBeddingProbability, setShowBeddingProbability] = useState(false);

  // UI state
  const [panelCollapsed, setPanelCollapsed] = useState(false); // Left panel open by default
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [parcelPolygon, setParcelPolygon] = useState<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);

  // v3.9.0 — Stable parcel key used to group sit pins per parcel.
  // Prefers Regrid-style parcelId; falls back to rounded lat/lng (~0.1 m precision).
  const currentParcelKey = useMemo(() => {
    const pid = (parcelPolygon?.properties as any)?.parcelId;
    if (pid && typeof pid === 'string' && pid.length > 0) return String(pid);
    if (Number.isFinite(activeLat) && Number.isFinite(activeLng) && (activeLat !== 0 || activeLng !== 0)) {
      return `ll:${activeLat.toFixed(6)},${activeLng.toFixed(6)}`;
    }
    return '';
  }, [parcelPolygon, activeLat, activeLng]);

  // ========== TERRITORY (MULTI-PARCEL) STATE ==========
  const [territoryParcels, setTerritoryParcels] = useState<TerritoryParcel[]>([]);
  const [territoryMode, setTerritoryMode] = useState<boolean>(false);
  const [territoryName, setTerritoryName] = useState<string>('My Territory');
  const territoryParcelsRef = useRef<TerritoryParcel[]>([]);
  const territoryModeRef = useRef(false);
  useEffect(() => {
    territoryModeRef.current = territoryMode;
    // Sync module-level ref so ErrorBoundary (class component) can read it
    _territoryModeGlobal.current = territoryMode;
  }, [territoryMode]);

  // ── PINEVILLE-LINK FIX ─────────────────────────────────────────────────────
  // Tracks whether the currently-active parcel was explicitly chosen by the
  // user (URL lat/lng, hero slug, demo mode, Pick Parcel click, or a territory
  // share link). When FALSE, activeLat/activeLng still hold the Pineville
  // default fallback from the top of the file and must NOT be auto-seeded into
  // the territory — otherwise the "Copy Territory Link" URL encodes Pineville
  // as parcel #1, regardless of which parcels the user actually clicked.
  const userHasExplicitParcelRef = useRef<boolean>(
    Boolean(demoMode || heroSlug || searchParams.get('lat') || urlTerritory)
  );

  // TERRITORY FIREWALL: Auto-clear any analysis error that fires while
  // territory mode is active — the user shouldn't see "Analysis Failed"
  // when they're just adding parcels to the builder.
  useEffect(() => {
    if (territoryMode && error) {
      setError(null);
      setIsLoading(false);
      setBackgroundAnalysis(false);
    }
  }, [territoryMode, error]);
  // Flag: when true, the data-painting useEffect will fade terrain layers in
  // instead of snapping them to full opacity. Set before territory analysis,
  // consumed once after new data arrives.
  const territoryFadeInPending = useRef(false);
  // RE-ALIGN FIX: Flag to fade new terrain data in smoothly after re-analysis.
  const reAlignFadeInPending = useRef(false);

  // Raster grid state — persisted so the compare card can sample nearby cells
  const [rasterGrid, setRasterGrid] = useState<RasterGrid | null>(null);

  // Parcel-Hunt File download state
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDownloadWall, setShowDownloadWall] = useState(false);
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [lastSavedPropertyId, setLastSavedPropertyId] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);

  // $19 per-parcel unlock state
  const [parcelUnlocked, setParcelUnlocked] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [showParcelPaywall, setShowParcelPaywall] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);

  // Refs for parcel access in closures (map event handlers, etc.)
  const parcelUnlockedRef = useRef(false);
  useEffect(() => { parcelUnlockedRef.current = parcelUnlocked; }, [parcelUnlocked]);
  const isProRef = useRef(false);
  useEffect(() => { isProRef.current = isPro; }, [isPro]);

  // v3.9.0 — Persist a sit pin for the current parcel (Pro-only)
  const saveSitPin = useCallback(async () => {
    if (!sitPinModal) return;
    const name = sitPinName.trim().slice(0, 20);
    if (!name) return;
    if (!currentParcelKey) {
      setSitPinError('No parcel loaded yet — please wait for analysis.');
      return;
    }
    setSitPinSaving(true);
    setSitPinError(null);
    try {
      const res = await fetch('/api/sit-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcelId: currentParcelKey,
          name,
          lng: sitPinModal.lng,
          lat: sitPinModal.lat,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setSitPinError('Please sign in to save sit pins.');
        } else if (res.status === 403) {
          setSitPinError('Pro subscription required.');
        } else {
          setSitPinError(data?.error || 'Could not save pin. Please try again.');
        }
        console.warn('[SitPin] save failed:', res.status, data);
        return;
      }
      const pin = data?.pin as SitPin | undefined;
      if (pin) {
        setSitPins((prev) => [...prev, pin]);
        console.log('[SitPin] Saved:', pin.id, pin.name);
      }
      setSitPinModal(null);
      setSitPinName('');
    } catch (err) {
      console.error('[SitPin] save error:', err);
      setSitPinError('Network error. Please try again.');
    } finally {
      setSitPinSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitPinModal, sitPinName, currentParcelKey]);

  // v3.9.0 — Keep the map's sit-pin source in sync with React state
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('tfp-user-sit-pins') as mapboxgl.GeoJSONSource | undefined;
    if (!src || typeof src.setData !== 'function') return;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: sitPins.map((p) => ({
        type: 'Feature',
        id: p.id,
        geometry: {
          type: 'Point',
          coordinates: [p.lng, p.lat],
        },
        properties: {
          id: p.id,
          name: p.name,
          parcelId: p.parcel_id,
          createdAt: p.created_at,
          kind: 'user_sit_pin', // disambiguates from AI stand points on click hit-testing
        },
      })),
    };
    try {
      src.setData(fc);
    } catch (err) {
      console.warn('[SitPin] setData failed:', err);
    }
  }, [sitPins, mapReady]);

  // v3.9.0 — Load user sit pins whenever the current parcel changes (Pro-only)
  useEffect(() => {
    if (!isPro || !currentParcelKey) {
      setSitPins([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/sit-pins?parcelId=${encodeURIComponent(currentParcelKey)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) {
          if (!cancelled) setSitPins([]);
          return;
        }
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.pins)) {
          setSitPins(data.pins as SitPin[]);
          console.log(`[SitPin] Loaded ${data.pins.length} pin(s) for parcel ${currentParcelKey}`);
        }
      } catch (err) {
        if (!cancelled) setSitPins([]);
        console.warn('[SitPin] load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isPro, currentParcelKey]);

  // ========== Stand Journal: load entries when a pin is opened ==========
  useEffect(() => {
    if (!journalPin || !isPro) {
      setJournalEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setJournalLoading(true);
      setJournalError(null);
      try {
        const res = await fetch(
          `/api/stand-journal?sitPinId=${encodeURIComponent(journalPin.id)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) {
          if (!cancelled) setJournalError('Could not load journal entries.');
          return;
        }
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.entries)) {
          setJournalEntries(data.entries as StandJournalEntry[]);
          console.log(`[StandJournal] Loaded ${data.entries.length} entries for pin ${journalPin.id}`);
        }
      } catch (err) {
        if (!cancelled) setJournalError('Network error loading journal.');
        console.warn('[StandJournal] load failed:', err);
      } finally {
        if (!cancelled) setJournalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [journalPin, isPro]);

  // ========== Stand Journal: handlers ==========
  const closeJournal = useCallback(() => {
    setJournalPin(null);
    setJournalFormOpen(false);
    setJournalEntries([]);
    setJournalDate('');
    setJournalWind('');
    setJournalTemp('');
    setJournalSightings('');
    setJournalNotes('');
    setJournalError(null);
  }, []);

  const openJournalForm = useCallback(() => {
    // Default date = today (local)
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    setJournalDate(`${yyyy}-${mm}-${dd}`);
    setJournalWind('');
    setJournalTemp('');
    setJournalSightings('');
    setJournalNotes('');
    setJournalError(null);
    setJournalFormOpen(true);
  }, []);

  const cancelJournalForm = useCallback(() => {
    setJournalFormOpen(false);
    setJournalError(null);
  }, []);

  const submitJournalEntry = useCallback(async () => {
    if (!journalPin || journalSubmitting) return;
    if (!journalDate) {
      setJournalError('Please pick a date.');
      return;
    }
    setJournalSubmitting(true);
    setJournalError(null);
    try {
      const res = await fetch('/api/stand-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sitPinId: journalPin.id,
          entryDate: journalDate,
          windDirection: journalWind || null,
          tempF: journalTemp !== '' ? Number(journalTemp) : null,
          sightings: journalSightings.trim() || null,
          notes: journalNotes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setJournalError(data?.error || 'Could not save entry.');
        return;
      }
      const entry = data?.entry as StandJournalEntry | undefined;
      if (entry) {
        // Prepend — list is already ordered DESC by entry_date
        setJournalEntries((prev) => [entry, ...prev]);
      }
      setJournalFormOpen(false);
      setJournalDate('');
      setJournalWind('');
      setJournalTemp('');
      setJournalSightings('');
      setJournalNotes('');
    } catch (err) {
      console.error('[StandJournal] submit error:', err);
      setJournalError('Network error. Please try again.');
    } finally {
      setJournalSubmitting(false);
    }
  }, [journalPin, journalDate, journalWind, journalTemp, journalSightings, journalNotes, journalSubmitting]);

  const deleteJournalEntry = useCallback(async (entryId: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this journal entry?')) return;
    try {
      const res = await fetch(`/api/stand-journal/${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error('Could not delete entry.');
        return;
      }
      setJournalEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      console.error('[StandJournal] delete error:', err);
      toast.error('Network error.');
    }
  }, []);

  // Stand stability: remember previous top-3 stands to prevent jarring jumps on re-analysis
  const previousStandsRef = useRef<AlignedStand[]>([]);

  // Bedding stability: remember previous bedding polygons to prevent shape-shifting on re-analysis
  const previousBeddingRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);

  // Saddle stability: remember previous saddle polygons and nodes to prevent jumps on re-analysis
  const previousSaddlePolysRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);
  const previousSaddleNodesRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);

  // Kill zone stability: remember previous kill zone sub-wedges to prevent jumps on re-analysis
  const previousKillZonesRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);

  // Inspect Mode state (visual indicator that flow segments are clickable)
  const [inspectModeEnabled, setInspectModeEnabled] = useState(false);
  
  // Export/Screenshot Mode state (clean map for broker demos)
  const [exportMode, setExportMode] = useState(false);

  // SHARED-TERRITORY FIX: when a territory is loaded from a shared URL
  // (?territory=true&p1lat=... etc.), we bypass the tier-based parcel cap so
  // recipients on a lower tier (e.g. Free = 1 parcel) can still view all
  // parcels the sender included. Also flips UI labels from "Territory full" /
  // "N of CAP parcels" to a shared-viewing treatment.
  const [isViewingSharedTerritory, setIsViewingSharedTerritory] = useState(false);

  // ========== EXPLORATION MODE STATE (unified parcel lookup) ==========
  const [explorationMode, setExplorationMode] = useState(false); // Enable click-to-lookup
  const [qaParcelLoading, setQaParcelLoading] = useState(false);
  const [qaParcel, setQaParcel] = useState<LookupParcel | null>(null);
  const [qaParcelError, setQaParcelError] = useState<string | null>(null);
  const [qaParcelAnalyzing, setQaParcelAnalyzing] = useState(false);
  const [qaRecentParcelIds, setQaRecentParcelIds] = useState<string[]>([]); // Track visited parcels
  const [qaSessionEntries, setQaSessionEntries] = useState<QAEntry[]>([]); // QA validation log
  const [qaShowScorecard, setQaShowScorecard] = useState(false); // Show rating UI after analysis
  const [qaShowAnalytics, setQaShowAnalytics] = useState(false); // Show analytics panel
  const [qaBrokerScore, setQaBrokerScore] = useState<BrokerScoreResult | null>(null); // Broker/terrain scoring
  // Backward compat alias — all QA mode references now route through exploration mode
  const qaParcelLookupMode = explorationMode;

  // ========== PARCEL PICK MODE (demo-friendly one-click parcel selection) ==========
  // Click any visible area on the map to look up the parcel, zoom to it, and auto-analyze.
  // Available to all users (not debug-gated). Separate from explorationMode (debug QA tool).
  const [parcelPickMode, setParcelPickMode] = useState(false);
  const [parcelPickLoading, setParcelPickLoading] = useState(false); // fetching parcel boundary

  // ========== ONBOARDING / DEMO POLISH STATE ==========
  const [showOnboarding, setShowOnboarding] = useState(demoMode && !heroSlug);

  // ========== TERRITORY (MULTI-PARCEL) STATE ==========
  interface TerritoryParcel {
    id: string;
    address: string;
    lat: number;
    lng: number;
    acreage: number;
    polygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
    owner?: string;
    county?: string;
  }

  // ========== ADJACENT PARCELS STATE ==========
  interface AdjacentParcelInfo {
    parcelId: string;
    address: string;
    owner: string;
    acreage: number;
    county: string;
    state: string;
    centroid: [number, number];
    geometry: GeoJSON.Geometry;
  }
  const [adjacentParcels, setAdjacentParcels] = useState<AdjacentParcelInfo[]>([]);
  const [adjacentParcelsLoading, setAdjacentParcelsLoading] = useState(false);
  const [showAdjacentParcels, setShowAdjacentParcels] = useState(true);
  const [selectedAdjacentParcel, setSelectedAdjacentParcel] = useState<AdjacentParcelInfo | null>(null);
  const [adjacentParcelPopupPos, setAdjacentParcelPopupPos] = useState<{ x: number; y: number } | null>(null);

  // ========== GEOMETRY DEBUG STATE ==========
  const [geometryDebugMode, setGeometryDebugMode] = useState(false); // Toggle to show 3-boundary overlay
  const [geometryTrace, setGeometryTrace] = useState<GeometryTrace | null>(null);
  const [rawRegridCoords, setRawRegridCoords] = useState<number[][] | null>(null); // Raw coords from API
  const [analysisCoords, setAnalysisCoords] = useState<number[][] | null>(null); // Coords sent to terrain flow
  const [geometryValidationError, setGeometryValidationError] = useState<string | null>(null);

  // Edge Intelligence Layer state
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockModalData, setUnlockModalData] = useState<{
    segmentBearing: number;
    edgeType: 'corridor' | 'bedding' | 'saddle' | 'draw' | 'pressure' | 'boundary';
    lngLat: [number, number];
  } | null>(null);
  const [edgeIntelData, setEdgeIntelData] = useState<{
    corridorArrows: GeoJSON.FeatureCollection;
    ghostBedding: GeoJSON.FeatureCollection;
    ghostSaddles: GeoJSON.FeatureCollection;
    drawExtensions: GeoJSON.FeatureCollection;
    pressureArrows: GeoJSON.FeatureCollection;
    adjacentBoundary: GeoJSON.FeatureCollection;
  } | null>(null);
  
  // V2 Tiered Corridor Data state
  const [tieredCorridorData, setTieredCorridorData] = useState<{
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
  } | null>(null);
  
  // Ridge Spine Data state (structure-first, DEM-only)
  const [ridgeSpineData, setRidgeSpineData] = useState<{
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
  } | null>(null);
  
  // Terrain Flow Data state (movement likelihood surface)
  const [terrainFlowData, setTerrainFlowData] = useState<{
    flow_primary: GeoJSON.FeatureCollection;
    flow_secondary: GeoJSON.FeatureCollection;
    convergence_zones: GeoJSON.FeatureCollection;
    opportunity_zones?: GeoJSON.FeatureCollection; // kept for API compat, not rendered
    isSynthetic: boolean;
    metadata?: {
      flow_count_primary: number;
      flow_count_secondary: number;
      convergence_count: number;
      opportunity_count?: number; // kept for API compat
      total_flow_length_m: number;
      mode?: string;
      dem_source?: string;
      fallback_reason?: string | null;
    };
  } | null>(null);
  const [terrainFlowLoading, setTerrainFlowLoading] = useState(false);
  
  // Terrain Flow Comparison State (before/after toggle)
  const [flowComparisonMode, setFlowComparisonMode] = useState(false);
  const [legacySyntheticData, setLegacySyntheticData] = useState<{
    flow_primary: GeoJSON.FeatureCollection;
    flow_secondary: GeoJSON.FeatureCollection;
    convergence_zones: GeoJSON.FeatureCollection;
    opportunity_zones?: GeoJSON.FeatureCollection; // kept for API compat
    metadata?: {
      flow_count_primary: number;
      flow_count_secondary: number;
      convergence_count: number;
      opportunity_count?: number;
      mode?: string;
    };
  } | null>(null);
  
  // Flow Segment Inspector State (click-to-explain)
  const [selectedFlowSegment, setSelectedFlowSegment] = useState<{
    segmentId: string;
    coordinates: [number, number][];
    tier: 'primary' | 'secondary';
  } | null>(null);
  const [flowSegmentExplain, setFlowSegmentExplain] = useState<FlowSegmentScoreResponse | null>(null);
  const [flowSegmentExplainLoading, setFlowSegmentExplainLoading] = useState(false);
  const [flowSegmentClickPosition, setFlowSegmentClickPosition] = useState<{ x: number; y: number } | null>(null);
  
  // (Opportunity tooltip removed — convergence IS opportunity)

  // Terrain Story State (structural narrative)
  const [terrainStory, setTerrainStory] = useState<TerrainStorySummary | null>(null);

  // ========== HUNTABILITY ENGINE STATE (Big Beautiful Map v1) ==========
  const [huntabilityData, setHuntabilityData] = useState<HuntabilityResult | null>(null);
  const [huntabilityLoading, setHuntabilityLoading] = useState(false);

  // ========== ALIGNMENT ENGINE STATE ==========
  // AlignedStand type now imported from components/intel/StandAlignmentPanel
  
  // Auto-suggest stand names based on position/features
  const STAND_NAME_POOL = [
    'Ridge Stand', 'Hollow Stand', 'Creek Bottom', 'Fence Line', 'Oak Flat',
    'North Point', 'South Saddle', 'East Draw', 'West Ridge', 'Center Cut',
    'Timber Edge', 'Field Corner', 'Road Stand', 'Crop Stand', 'Clover Edge'
  ];
  
  const generateStandName = (rank: number, coords: [number, number], props: StandPointProperties): string => {
    // If user assigned a name, use it
    if (props.name) return props.name;
    
    // Auto-generate based on characteristics
    const isHighElevation = props.elevation > 280;
    const isLowRisk = props.approachRisk === 'low';
    const nearCorridor = props.distToCorridorMeters < 50;
    
    // Simple deterministic naming based on rank + features
    if (nearCorridor && isLowRisk) return `Corridor ${rank === 1 ? 'Prime' : 'Point'}`;
    if (isHighElevation) return `Ridge ${rank === 1 ? 'Overlook' : 'Stand'}`;
    if (props.distToBeddingMeters < 80) return `Bedding Edge`;
    
    // Fallback to pool
    return STAND_NAME_POOL[(rank - 1) % STAND_NAME_POOL.length];
  };
  const [alignedStands, setAlignedStands] = useState<AlignedStand[]>([]);
  const [highlightedStandRank, setHighlightedStandRank] = useState<number | null>(null);
  const [exceptionalIndex, setExceptionalIndex] = useState<number | null>(null);
  const [parcelStrength, setParcelStrength] = useState<number>(0);
  const [mostAlignedHint, setMostAlignedHint] = useState<{ standRank: number; name: string } | null>(null);
  const [alignmentPanelExpanded, setAlignmentPanelExpanded] = useState(false); // Collapsed by default
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const mostAlignedDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const hintFadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ========== GLOBAL ERROR HANDLERS (v4-fix2: LOG ONLY, never trigger crash screen) ==========
  // The React Error Boundary (IntelErrorBoundary) catches render-time crashes.
  // These handlers exist ONLY for diagnostic logging of unhandled async/runtime errors.
  // They NEVER set globalError — doing so caused premature "Analyzer paused" on every
  // transient Mapbox tile error, WebGL hiccup, or generic TypeError from minified code.
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const errorMsg = event.reason instanceof Error 
        ? event.reason.message 
        : String(event.reason);
      const errorStack = event.reason instanceof Error ? event.reason.stack : undefined;
      // Diagnostic log only — visible in dev, silenced in prod by Step 12 filter
      console.error('[INTEL-DIAG] Unhandled promise rejection:', errorMsg);
      if (errorStack) console.error('[INTEL-DIAG] Stack:', errorStack);
    };

    const handleGlobalError = (event: ErrorEvent) => {
      const msg = event.message || '';
      // Diagnostic log only
      console.error('[INTEL-DIAG] Global error:', msg, 'file:', event.filename, 'line:', event.lineno);
      if (event.error?.stack) console.error('[INTEL-DIAG] Stack:', event.error.stack);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleGlobalError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleGlobalError);
    };
  }, []);

  // v4-fix: Actual WebGL check (with context-loss detection)
  const checkWebGLSupport = (): boolean => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return false;
      if (gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext) {
        return !gl.isContextLost();
      }
      return true;
    } catch (e) {
      console.warn('[MAP] WebGL support check failed:', e);
      return false;
    }
  };

  // ========== ALIGNMENT ENGINE HELPERS ==========
  
  // v1.2 wind-compass fix: read highlightedStandRank via ref so the scorer
  // callback doesn't depend on it (avoids unnecessary identity changes).
  const highlightedStandRankRef = useRef(highlightedStandRank);
  useEffect(() => { highlightedStandRankRef.current = highlightedStandRank; }, [highlightedStandRank]);

  // Compute alignment for all stands — depends ONLY on data + wind + season.
  // v1.2: removed highlightedStandRank from deps (reads via ref) and removed
  //        the prevWindDirection stability gate that could swallow compass clicks.
  const computeAlignmentScores = useCallback(() => {
    if (!layers?.standPoints?.features?.length) {
      setAlignedStands([]);
      setExceptionalIndex(null);
      setParcelStrength(0);
      return;
    }

    const stands = layers.standPoints.features;
    const windDirDeg = windDirectionToDeg(windDirection);
    
    // Use smooth adapter functions for stable, defensible inputs
    const inputs: StandInputs[] = stands.map(f => {
      const props = f.properties as StandPointProperties;
      return buildStandInputs(
        {
          distToCorridorMeters: props.distToCorridorMeters,
          approachRisk: props.approachRisk,
          windOk: props.windOk, // Used to derive preferred wind bearing
        },
        {
          windDirDeg,
          season,
        }
      );
    });

    const { scores, parcelStrength: ps, exceptionalIndex: ei } = scoreStandsWithExceptional(inputs);

    // ---- Extract corridor/draw lines for resilience scoring ----
    const resCorridorLines: [number, number][][] = [];
    const resDrawLines: [number, number][][] = [];
    if (layers?.funnels?.features) {
      for (const f of layers.funnels.features) {
        if (f.geometry?.type !== 'LineString') continue;
        if (f.properties?.funnelType === 'corridor') {
          resCorridorLines.push((f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
        } else if (f.properties?.funnelType === 'draw') {
          resDrawLines.push((f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
        }
      }
    }
    const parcelCentroid: [number, number] = [lng, lat];

    // Build all scored stands sorted by score desc
    const allScored: AlignedStand[] = stands.map((f, i) => {
      const props = f.properties as StandPointProperties;
      const coords = f.geometry.coordinates as [number, number];
      // v3.8.6: Compute resilience (scoring only — no placement impact)
      const resilience = computeStandResilience(coords, props, resCorridorLines, resDrawLines, parcelCentroid);
      return {
        rank: props.rank,
        name: generateStandName(props.rank, coords, props),
        props,
        inputs: inputs[i],
        alignment: scores[i],
        coords,
        resilience,
      };
    }).sort((a, b) => b.alignment.score - a.alignment.score || a.props.rank - b.props.rank);

    // ═══ v2.0: DIVERSITY SELECTION — prevent stand clustering ═══
    // Greedy selection: pick best, then for each subsequent pick, apply a
    // proximity penalty and terrain-similarity penalty so #2 and #3 represent
    // genuinely different hunting options rather than minor variations of #1.
    const MIN_STAND_SEPARATION_M = 150; // minimum metres between any two selected stands
    const PROXIMITY_PENALTY_FACTOR = 0.35; // score penalty per stand within penalty radius
    const TERRAIN_SIMILARITY_PENALTY = 0.12; // penalty when dominant terrain context matches
    const PENALTY_RADIUS_M = 250; // distance within which proximity penalty applies (smooth decay)
    const TARGET_COUNT = 3;

    function dominantTerrainContext(p: StandPointProperties): string {
      // Classify by TPI: positive = ridge/hilltop, near-zero = flat/bench, negative = valley/draw
      if (p.tpiLocal > 1.5) return 'ridge';
      if (p.tpiLocal < -1.5) return 'draw';
      if (p.distToBeddingMeters < 80) return 'bedding_edge';
      return 'bench';
    }

    const diverseStands: typeof allScored = [];
    const remainingPool = [...allScored];

    for (let pick = 0; pick < TARGET_COUNT && remainingPool.length > 0; pick++) {
      if (pick === 0) {
        // First pick: always the highest-scoring stand
        diverseStands.push(remainingPool.shift()!);
        continue;
      }

      // For subsequent picks, compute effective score = alignment.score - penalties
      let bestIdx = 0;
      let bestEffective = -Infinity;

      for (let i = 0; i < remainingPool.length; i++) {
        const candidate = remainingPool[i];
        let penalty = 0;

        for (const selected of diverseStands) {
          const dist = distanceMeters(candidate.coords, selected.coords);

          // Hard minimum separation
          if (dist < MIN_STAND_SEPARATION_M) {
            penalty += 100; // effectively disqualifies
            continue;
          }

          // Smooth proximity penalty within PENALTY_RADIUS_M
          if (dist < PENALTY_RADIUS_M) {
            const t = 1 - (dist - MIN_STAND_SEPARATION_M) / (PENALTY_RADIUS_M - MIN_STAND_SEPARATION_M);
            penalty += PROXIMITY_PENALTY_FACTOR * t * 100; // scale to alignment score units (0-100)
          }

          // Terrain similarity penalty
          if (dominantTerrainContext(candidate.props) === dominantTerrainContext(selected.props)) {
            penalty += TERRAIN_SIMILARITY_PENALTY * 100;
          }
        }

        const effective = candidate.alignment.score - penalty;
        if (effective > bestEffective) {
          bestEffective = effective;
          bestIdx = i;
        }
      }

      diverseStands.push(remainingPool.splice(bestIdx, 1)[0]);
    }

    // Replace allScored with diversity-selected stands + remaining pool (for fallback)
    const allScoredDiverse = [...diverseStands, ...remainingPool];
    // ═══ END DIVERSITY SELECTION ═══

    // v4-fix17: PARCEL-SAFE STAND ENFORCEMENT — all Top-3 stands must be strictly
    // inside the parcel with an interior safety buffer (PARCEL_INSET_METERS).
    // 
    // Logic order:
    //   1. Check each candidate against buffered parcel boundary
    //   2. Inside with buffer → accept as-is
    //   3. Inside but too close to edge, or outside within MAX_SNAP_DISTANCE_METERS
    //      → snap inward to nearest valid interior point
    //   4. Too far outside → discard, promote next candidate
    //
    // Off-parcel terrain still influences analysis (corridors, pressure, movement),
    // but final stand pins must be on the user's property.
    let aligned: AlignedStand[];
    if (parcelPolygon?.geometry) {
      const geom = parcelPolygon.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      aligned = [];
      const rejected: { rank: number; name: string; coords: [number, number]; reason: string }[] = [];
      const snapped: { rank: number; name: string; from: [number, number]; to: [number, number] }[] = [];
      
      for (const s of allScoredDiverse) {
        const snapResult = snapToParcelInterior(s.coords, geom);
        
        if (snapResult === null) {
          // Too far outside — discard
          rejected.push({ rank: s.rank, name: s.name, coords: s.coords, reason: 'too far outside' });
          continue;
        }
        
        if (snapResult.snapped) {
          // Coordinate was repaired — update the stand's coords
          snapped.push({ rank: s.rank, name: s.name, from: s.coords, to: snapResult.coords });
          aligned.push({ ...s, coords: snapResult.coords });
        } else {
          // Already safely inside with buffer
          aligned.push(s);
        }
      }

      // Diagnostic logging
      if (snapped.length > 0) {
        snapped.forEach(r => {
          console.error(`[STAND-DIAG] snapped stand id=${r.rank} "${r.name}" from [${r.from[0].toFixed(6)}, ${r.from[1].toFixed(6)}] → [${r.to[0].toFixed(6)}, ${r.to[1].toFixed(6)}]`);
        });
      }
      if (rejected.length > 0) {
        rejected.forEach(r => {
          console.error(`[STAND-DIAG] rejecting off-parcel stand candidate id=${r.rank} name="${r.name}" coords=[${r.coords[0].toFixed(6)}, ${r.coords[1].toFixed(6)}] reason=${r.reason}`);
        });
      }
      console.error(`[STAND-DIAG] final stand count in parcel = ${aligned.length} (snapped ${snapped.length}, rejected ${rejected.length})`);
    } else {
      // No parcel geometry available — use diversity-selected stands (fallback)
      aligned = allScoredDiverse;
      console.error('[STAND-DIAG] no parcel geometry available — using all stand candidates');
    }

    // v2.1: EDGE STAND POSITION BIAS — nudge edge stands ~10m toward the field edge
    // (keeping them inside cover but visually closer to the boundary).
    // Applied after parcel-safe enforcement so the nudge doesn't push outside.
    const EDGE_POSITION_NUDGE_M = 10; // meters toward field
    for (const s of aligned) {
      if (s.props?.isEdgeStand && typeof s.props.fieldBearing === 'number') {
        const nudged = movePoint(s.coords, s.props.fieldBearing, EDGE_POSITION_NUDGE_M);
        // Only apply if the nudged position is still inside the parcel
        if (parcelPolygon?.geometry) {
          const check = snapToParcelInterior(nudged, parcelPolygon.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
          if (check && !check.snapped) {
            // Nudged position is safely inside — apply it
            s.coords = nudged;
            console.log(`[STAND-DIAG] EDGE_STAND nudge rank=${s.rank} "${s.name}" +${EDGE_POSITION_NUDGE_M}m toward field bearing ${s.props.fieldBearing}°`);
          }
          // If nudged position would need snapping, skip the nudge (stay put)
        }
      }
    }

    // Cap to Top 3 — diversity selection already picked the best 3; parcel-safe
    // enforcement may have let extras through from the remaining pool.
    // All downstream consumers (GeoJSON layers, StandAlignmentPanel, popups, compare
    // dropdowns) expect at most 3 stands. This is the single enforcement point.
    aligned = aligned.slice(0, 3);

    // ═══ STAND STABILITY — prevent jarring jumps on re-analysis ═══
    // Compare new candidates against previously-shown stands.
    // Only replace a previous stand if:
    //   (a) new score exceeds previous by STABILITY_REPLACEMENT_THRESHOLD, OR
    //   (b) previous stand became invalid (not in current aligned set candidate pool)
    // If a new stand is within STABILITY_NEIGHBORHOOD_M of a previous stand,
    // prefer the previous coordinates (neighborhood snapping).
    const STABILITY_REPLACEMENT_THRESHOLD = 5; // points (0-100 scale)
    const STABILITY_NEIGHBORHOOD_M = 50; // meters
    const prev = previousStandsRef.current;

    if (prev.length > 0 && aligned.length > 0) {
      const stabilized: AlignedStand[] = [];
      const usedPrevIndices = new Set<number>();

      for (let slot = 0; slot < aligned.length; slot++) {
        const newStand = aligned[slot];
        // Find the closest previous stand to this new one (within neighborhood)
        let bestPrevIdx = -1;
        let bestPrevDist = Infinity;
        for (let pi = 0; pi < prev.length; pi++) {
          if (usedPrevIndices.has(pi)) continue;
          const d = distanceMeters(newStand.coords, prev[pi].coords);
          if (d < bestPrevDist) {
            bestPrevDist = d;
            bestPrevIdx = pi;
          }
        }

        if (bestPrevIdx >= 0 && bestPrevDist < STABILITY_NEIGHBORHOOD_M) {
          // New candidate is in the same neighborhood as a previous stand
          const prevStand = prev[bestPrevIdx];
          const scoreDelta = newStand.alignment.score - prevStand.alignment.score;
          usedPrevIndices.add(bestPrevIdx);

          if (scoreDelta > STABILITY_REPLACEMENT_THRESHOLD) {
            // Significant improvement — use new stand but log the shift
            console.error(`[STAND-STABILITY] slot=${slot} REPLACED: prev="${prevStand.name}" (score=${prevStand.alignment.score.toFixed(1)}) → new="${newStand.name}" (score=${newStand.alignment.score.toFixed(1)}) delta=+${scoreDelta.toFixed(1)} dist=${bestPrevDist.toFixed(0)}m`);
            stabilized.push(newStand);
          } else {
            // Score difference not significant enough — snap to previous coords for visual stability
            console.error(`[STAND-STABILITY] slot=${slot} SNAPPED: keeping prev coords for "${prevStand.name}" (prevScore=${prevStand.alignment.score.toFixed(1)}, newScore=${newStand.alignment.score.toFixed(1)}, delta=${scoreDelta.toFixed(1)}, dist=${bestPrevDist.toFixed(0)}m)`);
            // Use new scoring data but snap coords to previous position
            stabilized.push({ ...newStand, coords: prevStand.coords });
          }
        } else if (bestPrevIdx >= 0) {
          // No neighborhood match — check if this is a genuinely better stand replacing a distant previous
          const prevStand = prev[bestPrevIdx];
          const scoreDelta = newStand.alignment.score - prevStand.alignment.score;

          if (scoreDelta > STABILITY_REPLACEMENT_THRESHOLD) {
            usedPrevIndices.add(bestPrevIdx);
            console.error(`[STAND-STABILITY] slot=${slot} NEW_STAND: "${newStand.name}" (score=${newStand.alignment.score.toFixed(1)}) replaces distant "${prevStand.name}" (score=${prevStand.alignment.score.toFixed(1)}) delta=+${scoreDelta.toFixed(1)} dist=${bestPrevDist.toFixed(0)}m`);
            stabilized.push(newStand);
          } else {
            // Previous stand was better or close enough — keep previous in this slot
            usedPrevIndices.add(bestPrevIdx);
            console.error(`[STAND-STABILITY] slot=${slot} RETAINED: keeping prev "${prevStand.name}" (prevScore=${prevStand.alignment.score.toFixed(1)}) over new "${newStand.name}" (newScore=${newStand.alignment.score.toFixed(1)}, delta=${scoreDelta.toFixed(1)}, dist=${bestPrevDist.toFixed(0)}m)`);
            // Retain previous stand with updated scoring data
            stabilized.push({ ...prevStand, alignment: newStand.alignment, inputs: newStand.inputs, resilience: newStand.resilience });
          }
        } else {
          // No previous stand to compare — accept as-is (first analysis or extra slot)
          console.error(`[STAND-STABILITY] slot=${slot} INITIAL: "${newStand.name}" (score=${newStand.alignment.score.toFixed(1)}) — no previous anchor`);
          stabilized.push(newStand);
        }
      }

      aligned = stabilized;
    } else if (aligned.length > 0) {
      // First computation — log for diagnostics
      aligned.forEach((s, i) => {
        console.error(`[STAND-STABILITY] slot=${i} INITIAL: "${s.name}" (score=${s.alignment.score.toFixed(1)}) coords=[${s.coords[0].toFixed(6)}, ${s.coords[1].toFixed(6)}]`);
      });
    }
    // ═══ END STAND STABILITY ═══

    // Log stand resilience values for verification
    if (aligned.length > 0) {
      console.log('[StandResilience] Sample values:', aligned.slice(0, 3).map(s => ({
        rank: s.rank, name: s.name,
        standResilience: s.props?.standResilience?.toFixed(3) ?? 'N/A',
        corridorResilience: s.resilience?.score?.toFixed(3) ?? 'N/A',
        isEdgeStand: s.props?.isEdgeStand ?? false,
        fieldBearing: s.props?.fieldBearing ?? null,
      })));
    }

    // Update stability anchor for next re-analysis
    previousStandsRef.current = aligned;

    setAlignedStands(aligned);
    setExceptionalIndex(ei !== null ? aligned.findIndex((_, idx) => idx === ei) : null);
    setParcelStrength(ps);

    // ── Stand-state cleanup after re-scoring ──
    // If the currently-selected stand rank no longer exists in the new list,
    // clear it to avoid stale references.
    const prevSelected = selectedStandRef.current;
    if (prevSelected !== null && !aligned.find(s => s.rank === prevSelected)) {
      setSelectedStand(null);
    }
    // Solo mode is a transient UI state — reset it whenever stands are recomputed
    // so that a fresh set always starts with all stands visible.
    setSoloStandMode(false);

    // Set initial highlighted stand to top (read via ref to avoid dep)
    const currentHighlight = highlightedStandRankRef.current;
    if (currentHighlight === null && aligned.length > 0) {
      setHighlightedStandRank(aligned[0].rank);
    }

    // Check for "most aligned" hint (read highlighted via ref)
    if (currentHighlight !== null && aligned.length > 0) {
      const currentHighlighted = aligned.find(s => s.rank === currentHighlight);
      const newTop = aligned[0];
      
      if (currentHighlighted && newTop.rank !== currentHighlight) {
        const scoreDiff = newTop.alignment.score - currentHighlighted.alignment.score;
        
        if (scoreDiff >= 5) {
          if (mostAlignedDebounceRef.current) clearTimeout(mostAlignedDebounceRef.current);
          mostAlignedDebounceRef.current = setTimeout(() => {
            if (aligned[0].rank === newTop.rank && scoreDiff >= 5) {
              setMostAlignedHint({ standRank: newTop.rank, name: newTop.rank === 1 ? "Today's Sit" : newTop.rank === 2 ? 'Alternate Sit' : newTop.rank === 3 ? 'Backup Sit' : `Stand #${newTop.rank}` });
              if (hintFadeTimeoutRef.current) clearTimeout(hintFadeTimeoutRef.current);
              hintFadeTimeoutRef.current = setTimeout(() => setMostAlignedHint(null), 6000);
            }
          }, 2000);
        }
      }
    }
  }, [layers?.standPoints, windDirection, season, parcelPolygon]); // eslint-disable-line react-hooks/exhaustive-deps

  // v1.2 wind-compass fix: fire alignment scorer directly when deps change.
  // Removed the prevWindDirection stability gate — compass clicks are always 45°
  // increments which far exceed any useful jitter threshold. The old gate could
  // swallow valid clicks when React batched state updates.
  useEffect(() => {
    if (!layers?.standPoints) return;
    computeAlignmentScores();
  }, [layers?.standPoints, windDirection, season, parcelPolygon, computeAlignmentScores]);

  // ── Check parcel access when analysis completes ──
  useEffect(() => {
    if (summary && activeLat && activeLng) {
      checkParcelAccess(activeLat, activeLng);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, activeLat, activeLng]);

  // ── Handle parcel_unlocked return from Stripe checkout ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('parcel_unlocked') === 'true') {
      setParcelUnlocked(true);
      setShowParcelPaywall(false);
      toast.success('Hunt plan unlocked!');
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('parcel_unlocked');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // v3.8.4 — Keep "X min ago" out of render body; update via interval only
  useEffect(() => {
    setWindLastUpdated(new Date()); // hydration-safe: set real time client-side
  }, []);
  useEffect(() => {
    const calc = () => Math.round((Date.now() - windLastUpdated.getTime()) / 60000);
    setWindMinAgo(calc());
    const id = setInterval(() => setWindMinAgo(calc()), 30_000);
    return () => clearInterval(id);
  }, [windLastUpdated]);

  // Track user interaction for panel collapse
  const handleUserInteraction = useCallback(() => {
    if (!userHasInteracted) {
      setUserHasInteracted(true);
      // Collapse to single line after first interaction
      setTimeout(() => setAlignmentPanelExpanded(false), 500);
    }
  }, [userHasInteracted]);

  // ========== SAVE PROPERTY — derived values & handler ==========
  const totalTerritoryAcres = territoryParcels.reduce((sum, p) => sum + p.acreage, 0);
  const territoryCentroid = (() => {
    if (!territoryParcels.length) return { lat: activeLat, lng: activeLng };
    const avgLat = territoryParcels.reduce((s, p) => s + p.lat, 0) / territoryParcels.length;
    const avgLng = territoryParcels.reduce((s, p) => s + p.lng, 0) / territoryParcels.length;
    return { lat: avgLat, lng: avgLng };
  })();
  const currentScore = summary?.topStandScore ?? null;
  const currentPrimaryMovement = tieredCorridorData?.corridors_primary?.features?.[0]?.properties?.bearing
    ? String(tieredCorridorData.corridors_primary.features[0].properties.bearing)
    : null;
  const currentFunnelCount = summary?.funnelCount ?? null;
  const currentStandCount = layers?.standPoints?.features?.length ?? null;
  const currentBedAcres = summary?.totalBeddingAcres ?? null;
  const activeAcres = parseFloat(activeAcreage || '0') || 0;

  // ── Upgrade success detection ──
  // Race condition: Stripe redirects here instantly but the webhook
  // (customer.subscription.created) may not have landed yet. Poll the
  // session up to 5 times (every 2 s) until subscriptionStatus flips to 'pro'.
  useEffect(() => {
    if (searchParams.get('upgrade') !== 'success') return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    const POLL_INTERVAL = 2000;

    const pollSession = async () => {
      while (!cancelled && attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
          const updated = await updateSession?.();
          const status = (updated as any)?.user?.subscriptionStatus;
          console.log(`[UPGRADE] Poll ${attempts}/${MAX_ATTEMPTS} → status: ${status}`);
          if (status === 'pro' || status === 'promax') {
            if (!cancelled) toast.success(status === 'promax' ? 'Welcome to TerraFirma Pro Max! 🎉' : 'Welcome to TerraFirma Pro! 🎉');
            break;
          }
        } catch (err) {
          console.warn('[UPGRADE] Session refresh error:', err);
        }
        if (attempts < MAX_ATTEMPTS && !cancelled) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL));
        }
      }
      // Show a toast even if we didn't get 'pro' yet — webhook may still be in flight
      if (!cancelled && attempts >= MAX_ATTEMPTS) {
        toast.success('Welcome to TerraFirma Pro! Your access is activating…');
        // One final refresh after a longer delay
        setTimeout(() => { updateSession?.(); }, 5000);
      }
      // Clean URL without reload
      if (!cancelled) {
        const url = new URL(window.location.href);
        url.searchParams.delete('upgrade');
        window.history.replaceState({}, '', url.toString());
      }
    };

    pollSession();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Unconditional session refresh on mount ──
  // If a user upgraded in another tab/window (or simply navigated here after
  // their first ?upgrade=success visit), their client-side JWT may still carry
  // the stale 'free' subscriptionStatus. Call updateSession() once on mount so
  // the DB-backed tier is reflected immediately. Safe to call even if the tier
  // hasn't changed — the auth-options jwt callback re-reads from DB on update.
  const mountRefreshFiredRef = useRef(false);
  useEffect(() => {
    if (mountRefreshFiredRef.current) return;
    if (!session?.user) return;
    // Skip if the ?upgrade=success poller is about to run — it calls updateSession
    // 5× already and we don't want to stomp on it or double-fetch.
    if (searchParams.get('upgrade') === 'success') return;
    mountRefreshFiredRef.current = true;
    (async () => {
      try {
        const updated = await updateSession?.();
        const newStatus = (updated as any)?.user?.subscriptionStatus;
        if (newStatus && newStatus !== subStatus) {
          console.log('[SessionRefresh] Tier updated on mount:', subStatus, '→', newStatus);
        }
      } catch (err) {
        console.warn('[SessionRefresh] Error on mount:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // ── Helper: build a login callback URL that preserves current query params
  //          + an optional intent flag, so purchase/upgrade intent survives the
  //          auth redirect and can be auto-resumed after sign-in. ──
  function buildAuthRedirect(intentKey: string, intentValue: string) {
    const url = new URL(window.location.href);
    // Drop any stale intent flags so we don't double-up
    url.searchParams.delete('autoUnlock');
    url.searchParams.delete('autoUpgrade');
    url.searchParams.set(intentKey, intentValue);
    // Only the pathname + search needs to be passed as the callback
    const callback = encodeURIComponent(url.pathname + url.search);
    return `/login?callbackUrl=${callback}`;
  }

  async function handleUpgrade(plan: 'monthly' | 'annual', tier: 'pro' | 'promax' = 'pro') {
    if (!session?.user) {
      // Preserve tier + plan intent so Stripe checkout fires automatically on return
      router.push(buildAuthRedirect('autoUpgrade', `${tier}_${plan}`));
      return;
    }
    setUpgradeLoading(`${tier}_${plan}`);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        console.error('[Upgrade] API error:', res.status, data);
        toast.error(data.error || `Checkout failed (${res.status})`);
        return;
      }
      if (data.alreadySubscribed) {
        toast.success(`You already have ${data.currentTier === 'promax' ? 'Pro Max' : 'Pro'}!`);
        setShowUpgradeModal(false);
        updateSession?.();
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('[Upgrade] Missing checkout URL:', data);
        toast.error('Checkout URL missing — please try again');
      }
    } catch (e) {
      console.error('[Upgrade] Network error:', e);
      toast.error('Network error — please try again');
    } finally {
      setUpgradeLoading(null);
    }
  }

  async function handleManageSubscription() {
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      toast.error('Could not open billing portal');
    }
  }

  // ── $19 parcel unlock: check access for current parcel ──
  async function checkParcelAccess(lat?: number, lng?: number) {
    const checkLat = lat ?? activeLat;
    const checkLng = lng ?? activeLng;
    if (!checkLat || !checkLng) return;
    // Pro users always have access
    if (isPro) { setParcelUnlocked(true); return; }
    setCheckingAccess(true);
    try {
      const res = await fetch(`/api/parcels/check-access?lat=${checkLat}&lng=${checkLng}`);
      const data = await res.json();
      setParcelUnlocked(data.hasAccess === true);
    } catch {
      setParcelUnlocked(false);
    } finally {
      setCheckingAccess(false);
    }
  }

  // ── $19 parcel purchase flow ──
  async function handlePurchaseParcel() {
    if (!session?.user) {
      // Preserve parcel context (lat/lng/address) + autoUnlock intent so
      // Stripe checkout fires automatically once the user signs back in.
      router.push(buildAuthRedirect('autoUnlock', '1'));
      return;
    }
    setPurchaseLoading(true);
    try {
      const res = await fetch('/api/parcels/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: activeLat,
          lng: activeLng,
          address: activeAddress,
          acreage: activeAcres,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        console.error('[Purchase] API error:', res.status, data);
        toast.error(data.error || `Could not start checkout (${res.status})`);
        return;
      }
      if (data.alreadyPurchased) {
        setParcelUnlocked(true);
        setShowParcelPaywall(false);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('[Purchase] Missing checkout URL:', data);
        toast.error('Checkout URL missing — please try again');
      }
    } catch (e) {
      console.error('[Purchase] Network error:', e);
      toast.error('Network error — please try again');
    } finally {
      setPurchaseLoading(false);
    }
  }

  // ── Auto-resume $19 Hunt Plan checkout after sign-in ──
  // When a logged-out user clicks "Unlock $19", we redirect to /login with
  //   callbackUrl=/intel?lat=…&lng=…&address=…&autoUnlock=1
  // After sign-in they come back here. Once the session + terrain summary
  // are ready, auto-trigger the Stripe checkout so they don't have to click
  // "Unlock" a second time.
  const autoUnlockFiredRef = useRef(false);
  useEffect(() => {
    if (autoUnlockFiredRef.current) return;
    if (searchParams.get('autoUnlock') !== '1') return;
    if (!session?.user) return;
    if (!summary) return;                 // wait for terrain analysis to hydrate
    if (!activeLat || !activeLng) return; // need parcel context
    if (parcelUnlocked) return;           // already unlocked — nothing to do
    if (purchaseLoading) return;          // already in flight

    autoUnlockFiredRef.current = true;
    // Clean the flag from the URL so a refresh won't re-trigger
    const url = new URL(window.location.href);
    url.searchParams.delete('autoUnlock');
    window.history.replaceState({}, '', url.toString());

    console.log('[AutoUnlock] Resuming $19 checkout after sign-in');
    toast.info('Opening checkout…');
    handlePurchaseParcel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, summary, activeLat, activeLng, parcelUnlocked, purchaseLoading]);

  // ── Auto-resume Pro / Pro Max upgrade checkout after sign-in ──
  // Mirrors the autoUnlock flow. The intent flag carries the tier+plan.
  // Value format: "pro_annual" | "pro_monthly" | "promax_annual" | "promax_monthly".
  const autoUpgradeFiredRef = useRef(false);
  useEffect(() => {
    if (autoUpgradeFiredRef.current) return;
    const raw = searchParams.get('autoUpgrade');
    if (!raw) return;
    if (!session?.user) return;
    if (isPro) return; // already Pro — nothing to do

    const [tier, plan] = raw.split('_') as ['pro' | 'promax', 'monthly' | 'annual'];
    if ((tier !== 'pro' && tier !== 'promax') || (plan !== 'monthly' && plan !== 'annual')) return;

    autoUpgradeFiredRef.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('autoUpgrade');
    window.history.replaceState({}, '', url.toString());

    console.log('[AutoUpgrade] Resuming', tier, plan, 'checkout after sign-in');
    toast.info('Opening checkout…');
    handleUpgrade(plan, tier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isPro]);

  async function handleSaveProperty() {
    const payload = territoryMode ? {
      name: territoryName || 'My Territory',
      type: 'territory',
      parcels: territoryParcels.map(p => ({
        address: p.address,
        acres: p.acreage,
        geometry: p.polygon
      })),
      totalAcres: totalTerritoryAcres,
      centroidLat: territoryCentroid.lat,
      centroidLng: territoryCentroid.lng,
      terrainScore: currentScore,
      primaryMovement: currentPrimaryMovement,
      funnelCount: currentFunnelCount,
      standCount: currentStandCount,
      bedAcres: currentBedAcres
    } : {
      name: activeAddress || 'Saved Parcel',
      type: 'single',
      parcels: [{
        address: activeAddress,
        acres: activeAcres,
        geometry: parcelPolygon
      }],
      totalAcres: activeAcres,
      centroidLat: activeLat,
      centroidLng: activeLng,
      terrainScore: currentScore,
      primaryMovement: currentPrimaryMovement,
      funnelCount: currentFunnelCount,
      standCount: currentStandCount,
      bedAcres: currentBedAcres
    };

    const res = await fetch('/api/properties/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      setLastSavedPropertyId(data.property?.id || null);
      setShareLink(null); // Reset share link on new save
      setSaveConfirmed(true);
      setTimeout(() => setSaveConfirmed(false), 3000);
    }
  }

  async function handleShareTerritory() {
    // If we already have a share link, just copy it
    if (shareLink) {
      try {
        await navigator.clipboard.writeText(shareLink);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      } catch { /* fallback below */ }
      return;
    }

    // If not saved yet, save first then share
    let propertyId = lastSavedPropertyId;
    if (!propertyId) {
      // Trigger save first
      await handleSaveProperty();
      // Wait a tick for state to update — use a direct fetch instead
      const payload = territoryMode ? {
        name: territoryName || 'My Territory',
        type: 'territory',
        parcels: territoryParcels.map(p => ({
          address: p.address, acres: p.acreage, geometry: p.polygon
        })),
        totalAcres: totalTerritoryAcres,
        centroidLat: territoryCentroid.lat,
        centroidLng: territoryCentroid.lng,
        terrainScore: currentScore,
        primaryMovement: currentPrimaryMovement,
        funnelCount: currentFunnelCount,
        standCount: currentStandCount,
        bedAcres: currentBedAcres
      } : {
        name: activeAddress || 'Saved Parcel',
        type: 'single',
        parcels: [{ address: activeAddress, acres: activeAcres, geometry: parcelPolygon }],
        totalAcres: activeAcres,
        centroidLat: activeLat,
        centroidLng: activeLng,
        terrainScore: currentScore,
        primaryMovement: currentPrimaryMovement,
        funnelCount: currentFunnelCount,
        standCount: currentStandCount,
        bedAcres: currentBedAcres
      };
      const saveRes = await fetch('/api/properties/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!saveRes.ok) return;
      const saveData = await saveRes.json();
      propertyId = saveData.property?.id;
      if (propertyId) setLastSavedPropertyId(propertyId);
    }

    if (!propertyId) return;

    setShareLoading(true);
    try {
      const res = await fetch('/api/territory/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId })
      });
      if (res.ok) {
        const data = await res.json();
        const fullUrl = `${window.location.origin}${data.shareUrl}`;
        setShareLink(fullUrl);
        await navigator.clipboard.writeText(fullUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      }
    } catch (e) {
      console.error('Share error:', e);
    } finally {
      setShareLoading(false);
    }
  }

  // Download Parcel-Hunt File PDF
  const handleDownloadParcelHuntFile = useCallback(async () => {
    if (isDownloading) return;
    
    setIsDownloading(true);
    try {
      const top3 = alignedStands.slice(0, 3);
      const isTerritory = territoryParcelsRef.current.length > 1;
      const territoryAcreageSum = territoryParcelsRef.current.reduce((sum, p) => sum + p.acreage, 0);
      const payload = {
        address: isTerritory
          ? `${territoryName} (${territoryParcels.length} parcels)`
          : address,
        lat,
        lng,
        acreage: isTerritory
          ? territoryAcreageSum
          : (acreageParam ?? 40),
        county: parcelPolygon?.properties?.county ?? 
          address?.split(',').find((p: string) => p.toLowerCase().includes('county'))?.replace(/county/i,'').trim() ?? '',
        state: address?.match(/\b([A-Z]{2})\s+\d{5}\b/)?.[1] ?? 'MO',
        prevailingWind: windDirection,
        terrainHeadline: terrainStory?.headline ?? null,
        terrainNarrative: terrainStory?.narrative ?? null,
        terrainDriver: terrainStory?.primaryDriver?.label ?? null,
        terrainConfidence: terrainStory?.confidence ?? null,
        elevRange: Math.round((summary?.demMetrics?.elevRange ?? 0) * 3.281),
        stands: top3.map((s, i) => ({
          rank: i + 1,
          name: s.name ?? s.props?.name ?? `Stand ${i + 1}`,
          score: s.alignment?.score ?? 0,
          tier: s.alignment?.label ?? 'Field Stone',
          reasoning: s.props?.reasoning ?? '',
          approachRisk: s.props?.approachRisk ?? 'medium',
          windOk: s.props?.windOk ?? [],
          windBad: s.props?.windBad ?? [],
          distToCorridorM: s.props?.distToCorridorMeters ?? 0,
          distToBeddingM: s.props?.distToBeddingMeters ?? 0,
          elevation: s.props?.elevation ?? 0,
          resilience: s.resilience?.label ?? 'Unknown',
          resilienceScore: s.resilience?.score ?? 0,
          coords: s.coords,
        })),
        summary: {
          totalBeddingAcres: summary?.totalBeddingAcres ?? 0,
          funnelCount: summary?.funnelCount ?? 0,
          topStandScore: summary?.topStandScore ?? 0,
          analysisAreaAcres: summary?.analysisAreaAcres ?? 0,
          recommendedSeason: summary?.recommendedSeason ?? 'rut',
          elevRange: (summary?.demMetrics?.elevMax ?? 0) - (summary?.demMetrics?.elevMin ?? 0),
          elevMin: summary?.demMetrics?.elevMin ?? 0,
          elevMax: summary?.demMetrics?.elevMax ?? 0,
          slopeStd: summary?.demMetrics?.slopeStd ?? 0,
          roughness: summary?.demMetrics?.roughness ?? 0,
        },
        corridors: {
          primaryCount: tieredCorridorData?.corridors_primary?.features?.length ?? 0,
          possibleCount: tieredCorridorData?.corridors_possible?.features?.length ?? 0,
          hardFunnelCount: tieredCorridorData?.funnels_hard?.features?.length ?? 0,
          slightFunnelCount: tieredCorridorData?.funnels_slight?.features?.length ?? 0,
          parcelCoverage: tieredCorridorData?.metadata?.parcel_coverage_pct ?? 0,
        },
        seasonScores: {
          recommended: summary?.recommendedSeason ?? 'rut',
          topScore: summary?.topStandScore ?? 0,
        },
        parcelCoords: parcelPolygon?.geometry?.type === 'Polygon'
          ? (parcelPolygon.geometry as any).coordinates[0]
              .filter((_: any, i: number) => i % 3 === 0) // take every 3rd point = ~33% of coords
              .slice(0, 15) // hard cap at 15 points
          : null,
        isTerritory,
        territoryName: isTerritory ? territoryName : undefined,
        territoryParcelCount: isTerritory ? territoryParcels.length : undefined,
        territoryParcels: isTerritory ? territoryParcelsRef.current.map(p => ({
          address: p.address,
          acreage: Math.round(p.acreage),
          owner: p.owner,
          county: p.county,
        })) : undefined,
      };

      // Save terrain results to order for report generation
      // Part 3: prefer URL param orderId (from checkout success link) over localStorage
      // This eliminates the broken-tab race condition where localStorage isn't shared across tabs
      try {
        const targetOrderId = urlOrderId || localStorage.getItem('tfp_current_order_id');
        if (targetOrderId) {
          await fetch(`/api/orders/${targetOrderId}/save-terrain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              terrainPayload: payload,
            }),
          });
        }
      } catch (e) {
        // Non-critical — report still generates from current session
      }

      const response = await fetch('/api/parcel-hunt-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        toast.error('Please sign in to download reports');
        return;
      }
      if (!response.ok) throw new Error('Report generation failed');

      const ct = response.headers.get('content-type') || '';
      const buf = await response.arrayBuffer();
      const isPdf = ct.includes('application/pdf');
      const blob = new Blob([buf], { type: isPdf ? 'application/pdf' : 'text/html; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `TFP-Hunt-Report-${new Date().toISOString().slice(0,10)}.${isPdf ? 'pdf' : 'html'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('[ParcelHuntFile] Download error:', err);
      setError('Failed to download Parcel-Hunt File');
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, alignedStands, address, lat, lng, acreageParam, windDirection, summary, tieredCorridorData, parcelPolygon, terrainStory, urlOrderId, territoryName, territoryParcels]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress step text for UI
  const [progressStep, setProgressStep] = useState<string>('Initializing...');

  // ========== FULL OVERLAY RESET — clears every tfp-* GeoJSON source ==========
  // V4 Step 11b: All TFP source IDs for overlay management
  // v4-fix13: tfp-parcel is EXCLUDED — the parcel boundary must stay visible
  // during re-analysis. Only terrain overlay sources get cleared.
  const ALL_TFP_SOURCES = useRef([
    'tfp-qa-parcel',
    'tfp-debug-raw', 'tfp-debug-normalized', 'tfp-debug-analysis',
    'tfp-bedding', 'tfp-funnels-lines', 'tfp-funnels-polys',
    'tfp-corridors-primary', 'tfp-corridors-possible', 'tfp-corridors-exploratory',
    'tfp-corridors-context-primary', 'tfp-corridors-context-possible',
    'tfp-funnels-hard', 'tfp-funnels-slight', 'tfp-intrusion-overlay',
    'tfp-ridges-primary', 'tfp-ridges-secondary', 'tfp-saddle-nodes',
    'tfp-pressure-grid',
    'tfp-pressure-heatmap',
    'tfp-movement-delta',
    'tfp-movement-post',
    'tfp-refuge-zones',
    'tfp-flow-primary', 'tfp-flow-nearest-highlight', 'tfp-flow-secondary', 'tfp-flow-convergence',
    'tfp-huntability-favorability', 'tfp-huntability-corridor-zones',
    'tfp-huntability-corridors', 'tfp-huntability-convergence',
    'tfp-bedding-probability',
    'tfp-edge-arrows', 'tfp-edge-ghost', 'tfp-edge-ghost-saddles',
    'tfp-edge-draw-extensions', 'tfp-edge-pressure', 'tfp-edge-boundary',
    'tfp-stand-emphasis',
    'tfp-hunt-pockets',
    'tfp-stand-direction',
    'tfp-killzone',
    'tfp-stand-tertiary',
    'tfp-stands',
  ]);

  // ========== TERRITORY (MULTI-PARCEL) HELPERS ==========
  // Keep ref in sync with state
  useEffect(() => {
    territoryParcelsRef.current = territoryParcels;
  }, [territoryParcels]);

  const mergeParcelPolygons = useCallback((parcels: TerritoryParcel[]): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null => {
    if (parcels.length === 0) return null;
    if (parcels.length === 1) return parcels[0].polygon;

    // Collect ALL polygon coordinate sets from all parcels (handling both Polygon and MultiPolygon)
    const allCoordinates: number[][][][] = [];
    for (const p of parcels) {
      const geom = p.polygon.geometry;
      if (geom.type === 'MultiPolygon') {
        // MultiPolygon has coordinates: number[][][][] — each element is a polygon's ring set
        for (const polyCoords of geom.coordinates) {
          allCoordinates.push(polyCoords);
        }
      } else {
        // Polygon has coordinates: number[][][] — the ring set itself
        allCoordinates.push(geom.coordinates);
      }
    }

    return {
      type: 'Feature',
      properties: {
        address: parcels.map(p => p.address).join(' + '),
        acreage: parcels.reduce((sum, p) => sum + p.acreage, 0),
        isTerritory: true,
        parcelCount: parcels.length,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: allCoordinates,
      }
    };
  }, []);

  const getTerritoryBounds = useCallback((parcels: TerritoryParcel[]): [number, number, number, number] => {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const parcel of parcels) {
      const geom = parcel.polygon.geometry;
      // Collect all outer rings from both Polygon and MultiPolygon
      const outerRings: number[][][] = geom.type === 'MultiPolygon'
        ? geom.coordinates.map(poly => poly[0]) // outer ring of each sub-polygon
        : [geom.coordinates[0]]; // single outer ring
      for (const ring of outerRings) {
        if (!ring) continue;
        for (const coord of ring) {
          if (!Array.isArray(coord) || coord.length < 2) continue;
          const [lng, lat] = coord;
          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
        }
      }
    }
    return [minLng, minLat, maxLng, maxLat];
  }, []);

  const addParcelToTerritory = useCallback((parcel: TerritoryParcel, opts?: { bypassCap?: boolean }) => {
    console.error('[TERRITORY-DIAG] addParcelToTerritory called. id:', parcel.id, 'address:', parcel.address, 'acreage:', parcel.acreage);
    setTerritoryParcels(prev => {
      console.error('[TERRITORY-DIAG] setTerritoryParcels updater. prev.length:', prev.length, 'prev IDs:', prev.map(p => p.id));
      // Duplicate guard
      const exists = prev.find(p => p.id === parcel.id);
      if (exists) {
        console.error('[TERRITORY-DIAG] DUPLICATE — parcel already in territory, skipping:', parcel.id);
        return prev;
      }

      // SHARED-TERRITORY FIX: bypass the tier cap when loading a territory
      // shared via URL (?territory=true&...). Otherwise a free-tier recipient
      // would only see parcel #1 because their cap=1 silently drops 2-5.
      if (!opts?.bypassCap) {
        // Tier-based parcel cap: free=1, pro=5, promax=10
        const cap = isProMax ? 10 : isPro ? 5 : 1;
        if (prev.length >= cap) {
          console.error('[TERRITORY-DIAG] CAP REACHED —', cap, 'parcels max for tier:', subStatus);
          // Tailor the toast message to the user's situation:
          //  - Pro Max users: they've hit the absolute top tier
          //  - Pro users: upsell to Pro Max for larger territories
          //  - Free users with an unlocked parcel ($19 buyer): explain that
          //    the $19 unlock covers parcel intel, and multi-parcel territory
          //    mode is a Pro-plan feature
          //  - Pure Free users: simple upgrade prompt
          let message: string;
          if (isProMax) {
            message = 'Territory limit reached (10 parcels max on Pro Max)';
          } else if (isPro) {
            message = 'Territory limit reached (5 parcels max on Pro). Upgrade to Pro Max for 10-parcel territories.';
          } else if (parcelUnlockedRef.current) {
            message = 'Upgrade to Pro to build multi-parcel territories';
          } else {
            message = 'Upgrade to Pro for 5-parcel Territory Mode';
          }
          toast.error(message, { duration: 5000 });
          return prev;
        }
      }

      const updated = [...prev, parcel];
      territoryParcelsRef.current = updated;
      console.error('[TERRITORY-DIAG] PARCEL ADDED. new count:', updated.length);

      // Safety catch: hide adjacent parcel layers on first territory parcel add
      if (prev.length === 0) {
        const map = mapRef.current;
        if (map) {
          try {
            map.setLayoutProperty('tfp-adjacent-parcels-fill', 'visibility', 'none');
            map.setLayoutProperty('tfp-adjacent-parcels-outline', 'visibility', 'none');
          } catch { /* layers may not exist yet */ }
        }
      }

      return updated;
    });
  }, []);

  const removeParcelFromTerritory = useCallback((parcelId: string) => {
    setTerritoryParcels(prev => {
      const updated = prev.filter(p => p.id !== parcelId);
      territoryParcelsRef.current = updated;
      return updated;
    });
  }, []);

  const clearTerritory = useCallback(() => {
    setTerritoryParcels([]);
    territoryParcelsRef.current = [];
    setTerritoryMode(false);
    setTerritoryName('My Territory');
    // SHARED-TERRITORY FIX: reset the shared-view flag when territory is cleared
    setIsViewingSharedTerritory(false);

    // Restore adjacent parcel layers hidden during territory mode
    const map = mapRef.current;
    if (map) {
      try {
        map.setLayoutProperty('tfp-adjacent-parcels-fill', 'visibility', 'visible');
        map.setLayoutProperty('tfp-adjacent-parcels-outline', 'visibility', 'visible');
      } catch { /* layers may not exist yet */ }
    }
  }, []);

  const totalTerritoryAcreage = useMemo(() =>
    territoryParcels.reduce((sum, p) => sum + p.acreage, 0),
    [territoryParcels]
  );

  // Copy a shareable URL that encodes the current territory (parcels + name)
  // so another user can open the exact same territory with one click.
  // Reads from territoryParcelsRef.current as primary source so the link still
  // works after territoryMode has been toggled off (ref survives state clears).
  const copyTerritoryLink = useCallback(() => {
    const parcels = territoryParcelsRef.current.length >= 2
      ? territoryParcelsRef.current
      : territoryParcels;

    if (parcels.length < 2) return;
    const params = new URLSearchParams({
      territory: 'true',
      name: territoryName,
    });
    parcels.forEach((p, i) => {
      params.set(`p${i + 1}lat`, p.lat.toFixed(6));
      params.set(`p${i + 1}lng`, p.lng.toFixed(6));
    });
    const url = `https://terrafirma.partners/intel?${params.toString()}`;
    try {
      navigator.clipboard.writeText(url);
      toast.success(`Territory link copied! Share it to show all ${parcels.length} parcels together.`);
    } catch (e) {
      console.warn('[TERRITORY-URL] Clipboard write failed, falling back to prompt:', e);
      // Fallback for older browsers / insecure contexts
      window.prompt('Copy this territory link:', url);
    }
  }, [territoryParcels, territoryParcelsRef, territoryName]);

  const clearAllOverlaySources = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    console.error('[INTEL-DIAG] === OVERLAYS CLEARING ===');

    // vNext: Stand popup cleanup (GeoJSON layers cleared via gracefulClear below)
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }

    // v4-fix8: Signal that visibility restore is needed after new data is painted.
    // gracefulClear fades layers to opacity 0 and sets visibility:'none', but
    // nothing restores them — this flag tells the painting useEffect to trigger
    // a visibility refresh once new data arrives.
    needsVisibilityRestore.current = true;

    // v4-fix13: Preserve parcel boundary layers during clear — they don't change
    // between re-analysis runs and should stay visually stable.
    gracefulClear(map, ALL_TFP_SOURCES.current, 220, ['tfp-parcel-', 'tfp-territory-']).then(() => {
      console.error('[INTEL-DIAG] OVERLAYS CLEARED — sources wiped, layers faded');
    });
  }, []);

  // Dim existing overlay layers to reduced opacity without clearing source data.
  // Used during Re-Align so the user still sees their land instead of a black screen.
  // Layers that must NEVER have their opacity raised above 0.
  // tfp-pressure-fill was replaced by the heatmap visual and is kept in code only.
  const PERMANENTLY_HIDDEN_LAYERS = useRef(new Set(['tfp-pressure-fill']));

  const dimOverlayLayers = useCallback((targetOpacity: number = 0.4) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const style = map.getStyle();
    if (!style?.layers) return;
    const propMap: Record<string, string> = {
      line: 'line-opacity', fill: 'fill-opacity', circle: 'circle-opacity',
      heatmap: 'heatmap-opacity', symbol: 'icon-opacity',
    };
    for (const layer of style.layers) {
      if (!layer.id.startsWith('tfp-')) continue;
      if (layer.id.startsWith('tfp-parcel-') || layer.id.startsWith('tfp-territory-')) continue;
      if (layer.layout?.visibility === 'none') continue;
      if (PERMANENTLY_HIDDEN_LAYERS.current.has(layer.id)) continue;
      const prop = propMap[(layer as any).type] || 'line-opacity';
      try { animatePaint(map, layer.id, prop, targetOpacity, 400); } catch { /* noop */ }
    }
    needsVisibilityRestore.current = true;
  }, []);

  // ── Parcel-view hold: hide / reveal terrain layers ──
  // During the 1.5 s clean-parcel-view hold we set all terrain overlay layers
  // to visibility:'none' (except the parcel boundary itself).  When the hold
  // ends we restore them so overlays that were painted while the hold was active
  // appear in one smooth reveal.
  const holdHiddenLayersRef = useRef<string[]>([]);
  useEffect(() => {
    parcelViewHoldRef.current = parcelViewHold;
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (parcelViewHold) {
      // Hide all tfp- layers except parcel boundary and territory layers
      const hidden: string[] = [];
      const style = map.getStyle();
      if (style?.layers) {
        for (const layer of style.layers) {
          if (
            layer.id.startsWith('tfp-') &&
            !layer.id.startsWith('tfp-parcel-') &&
            !layer.id.startsWith('tfp-territory-')
          ) {
            try {
              map.setLayoutProperty(layer.id, 'visibility', 'none');
              hidden.push(layer.id);
            } catch { /* layer may have been removed */ }
          }
        }
      }
      holdHiddenLayersRef.current = hidden;
      // vNext: Hide stand popup during hold (GeoJSON layers handled by loop above)
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    } else {
      // Restore ALL tfp- layers (including any added during the hold)
      const style = map.getStyle();
      if (style?.layers) {
        for (const layer of style.layers) {
          if (
            layer.id.startsWith('tfp-') &&
            !layer.id.startsWith('tfp-parcel-')
          ) {
            try {
              map.setLayoutProperty(layer.id, 'visibility', 'visible');
            } catch { /* noop */ }
          }
        }
      }
      holdHiddenLayersRef.current = [];
    }

    return () => {
      if (parcelViewHoldTimerRef.current) {
        clearTimeout(parcelViewHoldTimerRef.current);
        parcelViewHoldTimerRef.current = null;
      }
    };
  }, [parcelViewHold]);

  // Fetch terrain analysis using shared client
  const analysisInFlightRef = useRef(false);
  const runAnalysis = useCallback(async () => {
    // ── DIAGNOSTIC: Log every runAnalysis entry with full context ──
    console.error('[TRIGGER-DIAG] runAnalysis() ENTERED — territoryMode:', territoryModeRef.current,
      'parcels:', territoryParcelsRef.current.length,
      'inFlight:', analysisInFlightRef.current,
      'prefetched:', !!prefetchedParcelRef.current,
      'caller:', new Error().stack?.split('\n')[2]?.trim());

    // v2.3: Prevent overlapping analysis runs — a second click while the first
    // is still in flight would reset the seeded PRNG mid-generation, corrupting
    // both runs' stand candidate sequences.
    if (analysisInFlightRef.current) {
      console.error('[TRIGGER-DIAG] runAnalysis SKIPPED — analysis already in flight');
      return;
    }

    // TERRITORY FIREWALL: When territory mode is active, runAnalysis must ONLY
    // execute if explicitly invoked by "Analyze Territory" / "Re-Align Territory"
    // which always set prefetchedParcelRef first (or have >1 territory parcels).
    // Stale mount calls, setTimeout leftovers, and demo fallbacks must be blocked.
    const isTerritoryRun = territoryParcelsRef.current.length > 1;
    if (territoryModeRef.current && !prefetchedParcelRef.current && !isTerritoryRun) {
      console.error('[TRIGGER-DIAG] runAnalysis BLOCKED — territory mode active, no prefetched parcel, not a territory run');
      return;
    }

    analysisInFlightRef.current = true;

    // Check if a caller (Pick Parcel / Explore / Analyze Territory) already
    // fetched the parcel geometry. When present we skip the redundant Regrid
    // lookup and keep the gold boundary visible — no full-screen loading overlay.
    // TERRITORY MODE: The "Analyze Territory" button merges all territory parcels
    // into a MultiPolygon and stores it in prefetchedParcelRef — we MUST use it
    // because a Regrid lookup on the centroid would return a single wrong parcel.
    const prefetchedParcel = prefetchedParcelRef.current;
    prefetchedParcelRef.current = null; // consume once

    // Only wipe overlay sources when we DON'T already have the boundary painted.
    // Territory re-aligns also skip the wipe — the merged boundary is still valid.
    // RE-ALIGN FIX: When overlay sources already exist (re-align), dim layers to
    // 0.4 opacity instead of clearing them — keeps terrain visible, no blackout.
    const isReAlign = !prefetchedParcel && !isTerritoryRun && overlaySourcesCreated.current;
    if (!prefetchedParcel && !isTerritoryRun) {
      if (isReAlign) {
        dimOverlayLayers(0.4);
        reAlignFadeInPending.current = true;
      } else {
        clearAllOverlaySources();
      }
    }

    setIsLoading(true);
    // RE-ALIGN FIX: treat re-aligns as background analysis (no fullscreen overlay)
    setBackgroundAnalysis(!!prefetchedParcel || isReAlign);
    setError(null);
    setAnalysisStalled(false);

    // When we already have a parcel boundary visible, start progress from 20 %
    // (parcel phase done) with a terrain-focused message.
    if (prefetchedParcel || isReAlign) {
      setProgress(20);
      setProgressStep('Running terrain analysis...');
    } else {
      setProgress(10);
      setProgressStep((demoMode || heroParcel) ? 'Loading demo parcel\u2026' : demoFallbackAttempted.current ? 'Loading verified demo parcel\u2026' : 'Fetching parcel boundary...');
    }
    lastProgressRef.current = { value: (prefetchedParcel || isReAlign) ? 20 : 10, time: Date.now() };
    
    // Read current season/wind AND coordinates from refs so we always get
    // the latest values even when called via stale setTimeout closures.
    const currentSeason = seasonRef.current;
    const currentWind = windDirectionRef.current;
    const currentAcreage = activeAcreageRef.current;

    // TERRITORY MODE — use centroid of all territory parcels so Re-Align
    // runs on the territory center rather than the single-parcel coords.
    const isTerritory = territoryParcelsRef.current.length > 1;
    let currentLat = activeLatRef.current;
    let currentLng = activeLngRef.current;

    if (isTerritory) {
      const [minLng, minLat, maxLng, maxLat] = getTerritoryBounds(territoryParcelsRef.current);
      currentLat = (minLat + maxLat) / 2;
      currentLng = (minLng + maxLng) / 2;
      console.error('[INTEL-DIAG] TERRITORY MODE — using centroid:', currentLat, currentLng,
        `(${territoryParcelsRef.current.length} parcels)`);
    }
    
    const startTime = Date.now();
    console.error('[INTEL-DIAG] === ANALYSIS START ===');
    console.error('[INTEL-DIAG] Coordinates:', currentLat, currentLng);
    console.error('[INTEL-DIAG] Season:', currentSeason, 'Wind:', currentWind);
    console.error('[INTEL-DIAG] demoMode:', demoMode);
    console.error('[INTEL-DIAG] prefetchedParcel:', prefetchedParcel ? 'YES' : 'NO');

    try {
      // Import shared terrain client
      const { fetchParcelGeometry, fetchTerrainAnalysis, generateSyntheticParcel } = await import('@/lib/terrain-client');
      
      let parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null = null;

      if (prefetchedParcel) {
        // Parcel already fetched by Pick Parcel / Explore / Analyze Territory
        // — use it directly, boundary is already painted, camera already fitted.
        parcel = prefetchedParcel;
        console.error('[INTEL-DIAG] Using PREFETCHED parcel, skipping Regrid lookup');
      } else if (isTerritoryRun) {
        // TERRITORY RE-ALIGN: no prefetched parcel (consumed on first run),
        // but territory parcels still exist → re-merge them into a MultiPolygon
        // instead of fetching a single wrong parcel from Regrid.
        const merged = mergeParcelPolygons(territoryParcelsRef.current);
        if (merged) {
          parcel = merged;
          setParcelPolygon(merged);
          console.error('[INTEL-DIAG] TERRITORY RE-ALIGN — re-merged', territoryParcelsRef.current.length, 'parcels');
        } else {
          console.error('[INTEL-DIAG] TERRITORY RE-ALIGN — merge failed, falling through to Regrid');
        }
      } else if (demoMode || heroParcel) {
        // Demo / hero mode: skip Regrid lookup, use cached parcel directly
        const dLat = currentLat;
        const dLng = currentLng;
        const dAcres = parseFloat(currentAcreage || '100');
        console.error('[INTEL-DIAG] DEMO/HERO MODE — skipping parcel lookup, fetching cached parcel at', dLat, dLng);
        setProgress(15);
        setProgressStep('Loading demo parcel\u2026');
        const demoFetchPromise = fetchParcelGeometry(dLat, dLng);
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000));
        parcel = await Promise.race([demoFetchPromise, timeoutPromise]);
        if (!parcel) {
          console.error('[INTEL-DIAG] DEMO/HERO MODE — cache miss, using synthetic parcel');
          parcel = generateSyntheticParcel(dLat, dLng, dAcres) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
        }
        console.error('[INTEL-DIAG] DEMO/HERO MODE — parcel ready:', parcel.geometry.type);
      } else {
        // Normal mode: fetch parcel geometry from Regrid
        setProgress(15);
        console.error('[INTEL-DIAG] Fetching parcel geometry for:', currentLat, currentLng);
        parcel = await fetchParcelGeometry(currentLat, currentLng);
        console.error('[INTEL-DIAG] Parcel fetch returned:', parcel ? 'HAS DATA' : 'NULL');
      }
      
      if (!parcel) {
        // Use synthetic fallback instead of failing
        console.error('[INTEL-DIAG] No Regrid parcel, using synthetic boundary');
        const syntheticParcel = generateSyntheticParcel(currentLat, currentLng, parseFloat(currentAcreage || '80'));
        console.error('[INTEL-DIAG] Setting parcelPolygon to SYNTHETIC parcel');
        setParcelPolygon(syntheticParcel as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
        setProgress(20);
        setProgressStep('Using estimated boundary...');
        
        // Run analysis with synthetic parcel
        const result = await fetchTerrainAnalysis(
          {
            parcel: syntheticParcel,
            seasonProfile: currentSeason,
            prevailingWinds: [currentWind],
            bufferMeters: 800,
          },
          (step, prog) => {
            setProgressStep(step);
            setProgress(20 + Math.round(prog * 0.8));
          },
          45_000
        );
        
        if (!result.success) {
          throw new Error(result.error || 'Analysis failed');
        }
        
        const data = result.data!;
        setMode(data.mode);
        setLayers(data.layers);
        setSummary(data.summary);
        setProvenance(data.provenance);
        setProgress(100);
        setProgressStep(`Complete in ${(result.durationMs / 1000).toFixed(1)}s`);
        console.error('[INTEL-DIAG] Analysis complete (synthetic):', result.durationMs, 'ms');
        return;
      }
      
      // Only update parcelPolygon if it wasn't already set by the caller
      if (!prefetchedParcel) {
        console.error('[INTEL-DIAG] Setting parcelPolygon to REAL parcel:', parcel.properties?.parcelId);
        console.error('[INTEL-DIAG] Parcel geometry type:', parcel.geometry.type);
        setParcelPolygon(parcel);
      }
      setProgress(20);
      setProgressStep('Running terrain analysis...');
      console.error('[INTEL-DIAG] Got real parcel:', parcel.properties?.parcelId);

      // Territory runs need longer timeout (multi-parcel DEM fetch + stitching)
      const analysisTimeout = isTerritoryRun ? 90_000 : 45_000;
      const result = await fetchTerrainAnalysis(
        {
          parcel,
          seasonProfile: currentSeason,
          prevailingWinds: [currentWind],
          bufferMeters: isTerritoryRun ? 1200 : 800, // wider buffer for territory
        },
        (step, prog) => {
          setProgressStep(step);
          setProgress(20 + Math.round(prog * 0.8));
        },
        analysisTimeout
      );

      const totalDuration = Date.now() - startTime;
      console.error('[INTEL-DIAG] Total analysis time:', totalDuration, 'ms');

      if (!result.success) {
        // Show the actual error, not generic message
        const errorMsg = result.status 
          ? `Error ${result.status}: ${result.error}` 
          : result.error || 'Analysis failed';
        throw new Error(errorMsg);
      }

      const data = result.data!;
      setMode(data.mode);
      setLayers(data.layers);
      setSummary(data.summary);
      setProvenance(data.provenance);
      setProgress(100);
      setProgressStep(`Complete in ${(result.durationMs / 1000).toFixed(1)}s`);
      
      console.error('[INTEL-DIAG] === ANALYSIS COMPLETE ===');

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Analysis failed';
      console.error('[INTEL] Analysis error:', errorMsg);

      // DIM OVERLAY SAFETY NET: If we dimmed layers for a re-align and analysis
      // failed, the data-painting useEffect will never fire (layers state didn't
      // update), so restore opacity here to avoid a stuck brownish overlay.
      if (reAlignFadeInPending.current) {
        reAlignFadeInPending.current = false;
        dimOverlayLayers(1.0);
        console.log('[INTEL] Restored dimmed layers after analysis error');
      }

      // DEMO SAFETY NET: if analysis fails and we haven't tried demo fallback yet, auto-switch.
      // Never fire demo fallback for territory runs — user chose specific parcels.
      // TERRITORY FIREWALL: Also block if territory mode is active (even if only 1 parcel so far)
      if (!demoFallbackAttempted.current && !isTerritoryRun && !territoryModeRef.current) {
        console.error('[INTEL-DIAG] DEMO FALLBACK — analysis failed, switching to verified demo parcel');
        demoFallbackAttempted.current = true;
        const df = DEMO_FALLBACK.current;
        // Schedule state updates after this try/catch/finally completes
        // Sync refs immediately so runAnalysis reads fresh coords
        activeLatRef.current = df.lat;
        activeLngRef.current = df.lng;
        activeAcreageRef.current = df.acreage;
        setTimeout(() => {
          setIsDemoFallbackActive(true);
          setActiveLat(df.lat);
          setActiveLng(df.lng);
          setActiveAddress(df.address);
          setActiveAcreage(df.acreage);
          setError(null);
          setIsLoading(true);
          setProgress(5);
          setProgressStep('Loading verified demo parcel\u2026');
          runAnalysis();
        }, 100);
        return;
      }

      // TERRITORY FIREWALL: In territory mode, swallow the error silently.
      // The user is just building — they'll run the real analysis via "Analyze Territory".
      if (territoryModeRef.current) {
        console.error('[INTEL] Suppressing error in territory mode:', errorMsg);
      } else {
        setError(errorMsg);
        setProgressStep('Failed');
      }
    } finally {
      analysisInFlightRef.current = false;
      setIsLoading(false);
      setBackgroundAnalysis(false);
      // Belt-and-suspenders: if reAlignFadeInPending is STILL set here
      // (e.g. demo fallback path returned early before clearing it),
      // restore overlay layers to prevent a stuck dim.
      if (reAlignFadeInPending.current) {
        reAlignFadeInPending.current = false;
        dimOverlayLayers(1.0);
        console.log('[INTEL] Finally-block restored dimmed layers (safety net)');
      }
    }
  // NOTE: season and windDirection intentionally excluded from deps.
  // Season/wind changes only affect the heatmap repaint (handled by the terrain flow painting effect),
  // NOT the full terrain analysis pipeline. This prevents data loss on season/wind toggle.
  // getTerritoryBounds is a stable useCallback([]) so it never triggers re-creation.
  }, [lat, lng, acreageParam, clearAllOverlaySources, getTerritoryBounds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ========== NATIVE MAPBOX SOURCES INITIALIZED FLAG ==========
  const overlaySourcesCreated = useRef(false);
  const hasFitToParcel = useRef(false);

  // v4-fix9: Centralized visibility lifecycle.
  // needsVisibilityRestore — set by clearAllOverlaySources, consumed by data painting useEffect.
  // visibilityEpoch — bumped after reconcile to trigger 'complex' layer effects.
  // Refs mirror current toggle state so the painting useEffect (which intentionally
  // excludes toggle state from deps) can read the latest values for reconcile.
  const needsVisibilityRestore = useRef(false);
  const [visibilityEpoch, setVisibilityEpoch] = useState(0);
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;
  const flowVisibilityRef = useRef(flowVisibility);
  flowVisibilityRef.current = flowVisibility;
  const showBeddingProbRef = useRef(showBeddingProbability);
  showBeddingProbRef.current = showBeddingProbability;

  // ========== UPDATE NATIVE MAPBOX SOURCES WHEN DATA CHANGES ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;

    try {
      // Update parcel boundary - CRITICAL: clear if null to avoid stale boundaries
      const parcelSource = map.getSource('tfp-parcel') as mapboxgl.GeoJSONSource;
      if (parcelSource) {
        if (parcelPolygon) {
          parcelSource.setData(validateGeoJSON(parcelPolygon));
          console.log('[MAP] Updated parcel boundary with', parcelPolygon.properties?.parcelId || 'parcel');
        } else {
          parcelSource.setData(EMPTY_FC);
          console.log('[MAP] Cleared parcel boundary (parcelPolygon is null)');
        }
      }

      // v3.8.3 — Clear QA parcel source when main parcel updates to prevent boundary duplication
      // The authoritative boundary is tfp-parcel (gold); QA (cyan) must never overlap it
      const qaParcelSource = map.getSource('tfp-qa-parcel') as mapboxgl.GeoJSONSource;
      if (qaParcelSource && parcelPolygon) {
        qaParcelSource.setData(EMPTY_FC);
      }

      // Update bedding polygons — filter out zones near buildings/maintained areas
      // ═══ BEDDING STABILITY — prefer previous geometry when zones overlap ═══
      const beddingSource = map.getSource('tfp-bedding') as mapboxgl.GeoJSONSource;
      if (beddingSource) {
        let beddingFC = layers?.beddingPolygons ? validateGeoJSON(layers.beddingPolygons) : EMPTY_FC;
        beddingFC = filterBeddingNearBuildings(beddingFC, map, 120);
        const polygonsOnly = filterByGeometryType(beddingFC, ['Polygon', 'MultiPolygon']);

        const prevBedding = previousBeddingRef.current;
        const BEDDING_NEIGHBORHOOD_M = 80; // metres — if new centroid is within this of prev, snap to prev geometry

        if (prevBedding.features.length > 0 && polygonsOnly.features.length > 0) {
          // Compute centroids for new and previous bedding features
          const centroid = (f: GeoJSON.Feature): [number, number] | null => {
            const coords: number[][] = [];
            if (f.geometry?.type === 'Polygon') coords.push(...(f.geometry as GeoJSON.Polygon).coordinates[0]);
            else if (f.geometry?.type === 'MultiPolygon') (f.geometry as GeoJSON.MultiPolygon).coordinates.forEach(p => coords.push(...p[0]));
            if (!coords.length) return null;
            return [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length];
          };

          const usedPrevIdxs = new Set<number>();
          const stabilizedFeatures = polygonsOnly.features.map((newFeat, ni) => {
            const newC = centroid(newFeat);
            if (!newC) return newFeat;

            // Find closest previous bedding zone
            let bestDist = Infinity;
            let bestIdx = -1;
            for (let pi = 0; pi < prevBedding.features.length; pi++) {
              if (usedPrevIdxs.has(pi)) continue;
              const prevC = centroid(prevBedding.features[pi]);
              if (!prevC) continue;
              const d = distanceMeters(newC, prevC);
              if (d < bestDist) { bestDist = d; bestIdx = pi; }
            }

            if (bestIdx >= 0 && bestDist < BEDDING_NEIGHBORHOOD_M) {
              usedPrevIdxs.add(bestIdx);
              // Snap to previous geometry — keeps shapes visually stable
              console.error(`[BEDDING-STABILITY] zone=${ni} SNAPPED: dist=${bestDist.toFixed(0)}m — keeping previous geometry`);
              return { ...prevBedding.features[bestIdx], properties: { ...prevBedding.features[bestIdx].properties, ...newFeat.properties } };
            }
            console.error(`[BEDDING-STABILITY] zone=${ni} NEW: no prev match within ${BEDDING_NEIGHBORHOOD_M}m (closest=${bestDist.toFixed(0)}m)`);
            return newFeat;
          });

          const stableFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: stabilizedFeatures };
          previousBeddingRef.current = stableFC;
          beddingSource.setData(stableFC);
        } else {
          // First analysis or no previous data — use new data as-is
          previousBeddingRef.current = polygonsOnly;
          beddingSource.setData(polygonsOnly);
        }
      }
      // ═══ END BEDDING STABILITY ═══

      // Update funnel lines (draws, corridors)
      const funnelLinesSource = map.getSource('tfp-funnels-lines') as mapboxgl.GeoJSONSource;
      if (funnelLinesSource) {
        const funnelsFC = layers?.funnels ? validateGeoJSON(layers.funnels) : EMPTY_FC;
        const lines = filterByGeometryType(funnelsFC, ['LineString', 'MultiLineString']);
        // Debug: log funnel types
        const funnelTypes = lines.features.map(f => f.properties?.funnelType);
        const typeCounts = funnelTypes.reduce((acc, t) => { acc[t || 'unknown'] = (acc[t || 'unknown'] || 0) + 1; return acc; }, {} as Record<string, number>);
        console.log('[MAP] Funnel lines by type:', typeCounts, 'total:', lines.features.length);
        funnelLinesSource.setData(lines);
      }

      // Update funnel polygons (saddles)
      // ═══ SADDLE POLYGON STABILITY — prefer previous geometry when zones overlap ═══
      const funnelPolysSource = map.getSource('tfp-funnels-polys') as mapboxgl.GeoJSONSource;
      if (funnelPolysSource) {
        const funnelsFC = layers?.funnels ? validateGeoJSON(layers.funnels) : EMPTY_FC;
        const polys = filterByGeometryType(funnelsFC, ['Polygon', 'MultiPolygon']);

        const prevSaddlePolys = previousSaddlePolysRef.current;
        const SADDLE_POLY_NEIGHBORHOOD_M = 30; // metres — snap to prev if centroid within this

        if (prevSaddlePolys.features.length > 0 && polys.features.length > 0) {
          const polyCentroid = (f: GeoJSON.Feature): [number, number] | null => {
            const coords: number[][] = [];
            if (f.geometry?.type === 'Polygon') coords.push(...(f.geometry as GeoJSON.Polygon).coordinates[0]);
            else if (f.geometry?.type === 'MultiPolygon') (f.geometry as GeoJSON.MultiPolygon).coordinates.forEach(p => coords.push(...p[0]));
            if (!coords.length) return null;
            return [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length];
          };

          const usedPrevIdxs = new Set<number>();
          const stabilizedFeatures = polys.features.map((newFeat, ni) => {
            const newC = polyCentroid(newFeat);
            if (!newC) return newFeat;

            let bestDist = Infinity;
            let bestIdx = -1;
            for (let pi = 0; pi < prevSaddlePolys.features.length; pi++) {
              if (usedPrevIdxs.has(pi)) continue;
              const prevC = polyCentroid(prevSaddlePolys.features[pi]);
              if (!prevC) continue;
              const d = distanceMeters(newC, prevC);
              if (d < bestDist) { bestDist = d; bestIdx = pi; }
            }

            if (bestIdx >= 0 && bestDist < SADDLE_POLY_NEIGHBORHOOD_M) {
              usedPrevIdxs.add(bestIdx);
              console.error(`[SADDLE-STABILITY] poly=${ni} SNAPPED: dist=${bestDist.toFixed(0)}m — keeping previous geometry`);
              return { ...prevSaddlePolys.features[bestIdx], properties: { ...prevSaddlePolys.features[bestIdx].properties, ...newFeat.properties } };
            }
            console.error(`[SADDLE-STABILITY] poly=${ni} NEW: no prev match within ${SADDLE_POLY_NEIGHBORHOOD_M}m (closest=${bestDist.toFixed(0)}m)`);
            return newFeat;
          });

          const stableSaddlePolysFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: stabilizedFeatures };
          previousSaddlePolysRef.current = stableSaddlePolysFC;
          funnelPolysSource.setData(stableSaddlePolysFC);
        } else {
          previousSaddlePolysRef.current = polys;
          funnelPolysSource.setData(polys);
        }
      }
      // ═══ END SADDLE POLYGON STABILITY ═══

      console.log('[MAP] Updated native Mapbox sources with terrain data');

      // v4-fix9: After gracefulClear fades layers to opacity 0, run the centralized
      // reconcileVisibility controller to restore every tfp-* layer to its correct
      // state based on current toggles. This replaces the manual per-group restore
      // from v4-fix8 with one unified pass.
      if (needsVisibilityRestore.current) {
        needsVisibilityRestore.current = false;

        // Build flat toggles map from refs (latest values without dep coupling)
        const vis = visibilityRef.current;
        const fv = flowVisibilityRef.current;
        const reconcileState: ReconcileState = {
          toggles: {
            bedding: vis.bedding,
            draws: vis.draws,
            saddles: vis.saddles,
            corridors: vis.corridors,
            funnels: vis.funnels,
            ridgeSpines: vis.ridgeSpines,
            stands: vis.stands,
            pressureHeatmap: fv.pressureHeatmap,
            flowPrimary: fv.flowPrimary,
            flowSecondary: fv.flowSecondary,
            convergenceZones: fv.convergenceZones,
            beddingProbability: showBeddingProbRef.current,
          },
          pressureView: 'pressure',
          hasParcelData: !!parcelPolygon,
        };

        reconcileVisibility(map, reconcileState);

        // Territory fade-in: if territory analysis just delivered new data,
        // fade layers in over 1 s instead of snapping to full opacity.
        if (territoryFadeInPending.current) {
          territoryFadeInPending.current = false;
          console.log('[TERRITORY] Fade-in pending — animating new analysis results');
          const propMapFade: Record<string, string> = {
            line: 'line-opacity', fill: 'fill-opacity',
            circle: 'circle-opacity', heatmap: 'heatmap-opacity',
            symbol: 'icon-opacity',
          };
          const fadePrefixes = ['tfp-parcel-', 'tfp-territory-', 'tfp-adjacent-'];
          const currentStyle = map.getStyle();
          if (currentStyle?.layers) {
            for (const layer of currentStyle.layers) {
              if (!layer.id.startsWith('tfp-')) continue;
              if (fadePrefixes.some(p => layer.id.startsWith(p))) continue;
              if (PERMANENTLY_HIDDEN_LAYERS.current.has(layer.id)) continue;
              const prop = propMapFade[(layer as any).type] || 'line-opacity';
              // Start at 0, animate up to reconciled target
              try {
                map.setPaintProperty(layer.id, prop, 0);
              } catch { /* ignore */ }
            }
          }
          // After a brief 400 ms pause, fade everything back in over 1 s
          setTimeout(() => {
            const postStyle = map.getStyle();
            if (postStyle?.layers) {
              for (const layer of postStyle.layers) {
                if (!layer.id.startsWith('tfp-')) continue;
                if (fadePrefixes.some(p => layer.id.startsWith(p))) continue;
                if (PERMANENTLY_HIDDEN_LAYERS.current.has(layer.id)) continue;
                const prop = propMapFade[(layer as any).type] || 'line-opacity';
                fadeLayerIn(map, layer.id, 0.8, prop, 1000);
              }
              console.log('[TERRITORY] Fade-in started: 1000ms');
            }
          }, 400);
        }

        // RE-ALIGN FIX: Smooth crossfade — new data was just painted into the
        // still-dimmed (0.4) sources. Animate layers back to full opacity.
        if (reAlignFadeInPending.current) {
          reAlignFadeInPending.current = false;
          const fadeProps: Record<string, string> = {
            line: 'line-opacity', fill: 'fill-opacity',
            circle: 'circle-opacity', heatmap: 'heatmap-opacity',
            symbol: 'icon-opacity',
          };
          const skipPrefixes = ['tfp-parcel-', 'tfp-territory-'];
          const curStyle = map.getStyle();
          if (curStyle?.layers) {
            for (const layer of curStyle.layers) {
              if (!layer.id.startsWith('tfp-')) continue;
              if (skipPrefixes.some(p => layer.id.startsWith(p))) continue;
              if (PERMANENTLY_HIDDEN_LAYERS.current.has(layer.id)) continue;
              if (layer.layout?.visibility === 'none') continue;
              const prop = fadeProps[(layer as any).type] || 'line-opacity';
              try {
                // Set to 0 first so reconcileVisibility's snap doesn't flash,
                // then animate up to full target opacity
                map.setPaintProperty(layer.id, prop, 0);
              } catch { /* noop */ }
            }
            setTimeout(() => {
              const postStyle = map.getStyle();
              if (postStyle?.layers) {
                for (const layer of postStyle.layers) {
                  if (!layer.id.startsWith('tfp-')) continue;
                  if (skipPrefixes.some(p => layer.id.startsWith(p))) continue;
                  if (PERMANENTLY_HIDDEN_LAYERS.current.has(layer.id)) continue;
                  if (layer.layout?.visibility === 'none') continue;
                  const prop = fadeProps[(layer as any).type] || 'line-opacity';
                  fadeLayerIn(map, layer.id, 0.85, prop, 800);
                }
              }
            }, 200);
          }
        }

        // Bump epoch to trigger specialized effects for 'complex' layers
        // (flow-primary with data-driven expressions, nearest-highlight, etc.)
        setVisibilityEpoch(e => e + 1);
      }
    } catch (err) {
      console.error('[MAP] Error updating sources (non-fatal):', err);
    }
  }, [layers, parcelPolygon, mapReady]);

  // ========== FIT TO PARCEL ON LOAD (IMMEDIATE ORIENTATION) ==========
  // v4-fix10: Parcel-only initial fit — sets clean first frame
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !parcelPolygon || hasFitToParcel.current) return;
    // v3.8.4-fix — guard: style must be loaded before fitBounds
    if (!map.isStyleLoaded()) {
      console.warn('[MAP] fitBounds deferred — style not yet loaded');
      return;
    }
    
    try {
      // Extract bounds from parcel geometry ONLY — no corridors, buffers, or off-parcel data
      const coords = parcelPolygon.geometry.type === 'Polygon'
        ? parcelPolygon.geometry.coordinates[0]
        : parcelPolygon.geometry.coordinates[0][0]; // First polygon of MultiPolygon
      
      if (coords && coords.length >= 3) {
        const bounds = new mapboxgl.LngLatBounds();
        coords.forEach((coord: number[]) => {
          bounds.extend([coord[0], coord[1]]);
        });
        
        console.error('[MAP-DIAG] INITIAL FIT BOUNDS:', JSON.stringify({
          sw: [bounds.getSouthWest().lng.toFixed(6), bounds.getSouthWest().lat.toFixed(6)],
          ne: [bounds.getNorthEast().lng.toFixed(6), bounds.getNorthEast().lat.toFixed(6)],
        }));
        console.error('[MAP-DIAG] PARCEL BOUNDS USED: parcelPolygon only (no corridors/buffers)');
        
        // Fit parcel to fill ~70-85% of viewport with comfortable padding
        const TARGET_MIN_ZOOM = 14.5;
        map.fitBounds(bounds, {
          padding: { top: 80, bottom: 80, left: 80, right: 80 },
          duration: 800,
          maxZoom: 17,
        });
        
        // Enforce minimum zoom after fitBounds animation completes
        const onMoveEnd = () => {
          map.off('moveend', onMoveEnd);
          const finalZoom = map.getZoom();
          console.error('[MAP-DIAG] INITIAL ZOOM LEVEL:', finalZoom.toFixed(2));
          if (finalZoom < TARGET_MIN_ZOOM) {
            console.error('[MAP-DIAG] Enforcing minimum zoom:', TARGET_MIN_ZOOM, '(was', finalZoom.toFixed(2), ')');
            map.setZoom(TARGET_MIN_ZOOM);
          }
        };
        map.once('moveend', onMoveEnd);
        
        hasFitToParcel.current = true;
        console.log('[MAP] v4-fix10: Fit to parcel bounds for immediate orientation');
      }
    } catch (err) {
      console.error('[MAP] FitBounds error (non-fatal):', err);
    }
  }, [parcelPolygon, mapReady]);

  // ========== v2.2: PARCEL COMPLEXITY — drives Deer Flow expression strength ==========
  useEffect(() => {
    const geom = parcelPolygon?.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined;
    const c = computeParcelComplexity(geom);
    parcelComplexityRef.current = c;
    if (c > 0) console.log('[DeerFlow] Parcel complexity:', c.toFixed(3), c > 0.35 ? '(irregular — stronger expression)' : '(simple — lighter expression)');
  }, [parcelPolygon]);

  // ========== v4-fix14: PARCEL-ONLY REFIT (no stand expansion) ==========
  // v4-fix10b allowed stands to expand camera bounds by 15%, which caused
  // progressive zoom-out on repeated analyzer clicks when off-parcel stands
  // were included. Fix: refit is ALWAYS parcel-only. Stands outside parcel
  // are visible if the user pans, but never force camera zoom-out.
  const hasPostAnalysisFit = useRef(false);
  const nhdWaterBodiesRef = useRef<Array<{ coordinates: number[][][] }>>([]);
  const structurePointsRef = useRef<[number, number][]>([]);

  // ========== GENERATE EDGE INTELLIGENCE DATA ==========
  useEffect(() => {
    if (!layers || !parcelPolygon) {
      setEdgeIntelData(null);
      return;
    }

    try {
      // Extract parcel coordinates
      let parcelCoords: number[][] = [];
      if (parcelPolygon.geometry.type === 'Polygon') {
        parcelCoords = parcelPolygon.geometry.coordinates[0];
      } else if (parcelPolygon.geometry.type === 'MultiPolygon') {
        // Use largest polygon
        let maxLen = 0;
        parcelPolygon.geometry.coordinates.forEach((poly) => {
          if (poly[0].length > maxLen) {
            maxLen = poly[0].length;
            parcelCoords = poly[0];
          }
        });
      }

      if (parcelCoords.length < 3) {
        console.warn('[EDGE INTEL] Insufficient parcel coordinates');
        return;
      }

      // Get corridors from funnels
      const corridorsFC: GeoJSON.FeatureCollection = layers.funnels 
        ? {
            type: 'FeatureCollection',
            features: (layers.funnels.features || []).filter(
              f => f.properties?.funnelType === 'corridor' && f.geometry?.type === 'LineString'
            )
          }
        : { type: 'FeatureCollection', features: [] };

      // Generate edge intelligence features
      const corridorArrows = generateCorridorArrows(corridorsFC, parcelCoords);
      // Demo trust filter: pre-filter bedding input so ghost silhouettes
      // also exclude zones near buildings / maintained areas.
      const rawBeddingFC = layers.beddingPolygons || { type: 'FeatureCollection', features: [] };
      const cleanBeddingFC = mapRef.current
        ? filterBeddingNearBuildings(rawBeddingFC, mapRef.current, 120)
        : rawBeddingFC;
      const ghostBedding = generateGhostBedding(cleanBeddingFC, parcelCoords);
      const funnelsFC = layers.funnels || { type: 'FeatureCollection', features: [] };
      const ghostSaddles = generateGhostSaddles(funnelsFC, parcelCoords);
      const drawExtensions = generateDrawExtensions(funnelsFC, parcelCoords, nhdWaterBodiesRef.current.length ? nhdWaterBodiesRef.current : undefined);
      const pressureArrows = generatePressureArrows(corridorsFC, parcelCoords);
      const adjacentBoundary = generateAdjacentParcelBoundary(parcelCoords);

      console.log('[EDGE INTEL] Generated:', {
        corridorArrows: corridorArrows.features.length,
        ghostBedding: ghostBedding.features.length,
        ghostSaddles: ghostSaddles.features.length,
        drawExtensions: drawExtensions.features.length,
        pressureArrows: pressureArrows.features.length,
        adjacentBoundary: adjacentBoundary.features.length
      });

      setEdgeIntelData({
        corridorArrows,
        ghostBedding,
        ghostSaddles,
        drawExtensions,
        pressureArrows,
        adjacentBoundary
      });
    } catch (err) {
      console.error('[EDGE INTEL] Generation failed:', err);
    }
  }, [layers, parcelPolygon]);

  // ========== UPDATE EDGE INTELLIGENCE MAP SOURCES ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current || !edgeIntelData) return;

    try {
      // Update corridor arrows source
      const arrowsSource = map.getSource('tfp-edge-arrows') as mapboxgl.GeoJSONSource;
      if (arrowsSource) {
        arrowsSource.setData(edgeIntelData.corridorArrows);
      }

      // Update ghost bedding source
      const ghostSource = map.getSource('tfp-edge-ghost') as mapboxgl.GeoJSONSource;
      if (ghostSource) {
        ghostSource.setData(edgeIntelData.ghostBedding);
      }

      // Update ghost saddles source
      const ghostSaddleSource = map.getSource('tfp-edge-ghost-saddles') as mapboxgl.GeoJSONSource;
      if (ghostSaddleSource) {
        ghostSaddleSource.setData(edgeIntelData.ghostSaddles);
      }

      // Update draw extensions source
      const drawExtSource = map.getSource('tfp-edge-draw-extensions') as mapboxgl.GeoJSONSource;
      if (drawExtSource) {
        drawExtSource.setData(edgeIntelData.drawExtensions);
      }

      // Update pressure arrows source
      const pressureSource = map.getSource('tfp-edge-pressure') as mapboxgl.GeoJSONSource;
      if (pressureSource) {
        pressureSource.setData(edgeIntelData.pressureArrows);
      }

      // Update adjacent boundary source
      const boundarySource = map.getSource('tfp-edge-boundary') as mapboxgl.GeoJSONSource;
      if (boundarySource) {
        boundarySource.setData(edgeIntelData.adjacentBoundary);
      }

      console.log('[MAP] Updated edge intelligence sources');
    } catch (err) {
      console.error('[MAP] Error updating edge intel sources (non-fatal):', err);
    }
  }, [edgeIntelData, mapReady]);

  // ========== COMPUTE TIERED CORRIDOR DATA ==========
  useEffect(() => {
    if (!layers || !parcelPolygon) {
      setTieredCorridorData(null);
      return;
    }

    try {
      // Extract parcel coordinates for tiering
      let parcelCoords: number[][] = [];
      if (parcelPolygon.geometry.type === 'Polygon') {
        parcelCoords = parcelPolygon.geometry.coordinates[0];
      } else if (parcelPolygon.geometry.type === 'MultiPolygon') {
        // Use largest polygon
        let maxLen = 0;
        parcelPolygon.geometry.coordinates.forEach((poly) => {
          if (poly[0].length > maxLen) {
            maxLen = poly[0].length;
            parcelCoords = poly[0];
          }
        });
      }

      if (parcelCoords.length < 3) {
        console.warn('[TIERED] Insufficient parcel coordinates');
        return;
      }

      // Extract corridors from funnels
      const corridorsFC: GeoJSON.FeatureCollection = layers.funnels 
        ? {
            type: 'FeatureCollection',
            features: (layers.funnels.features || []).filter(
              f => f.properties?.funnelType === 'corridor' && f.geometry?.type === 'LineString'
            )
          }
        : { type: 'FeatureCollection', features: [] };

      // Extract all funnels
      const funnelsFC = layers.funnels || { type: 'FeatureCollection', features: [] };

      // Compute bounding box
      const lngs = parcelCoords.map((c: number[]) => c[0]);
      const lats = parcelCoords.map((c: number[]) => c[1]);
      const bbox: [number, number, number, number] = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];

      // Apply tiering to corridor data
      const tiered = tierCorridorData(
        {
          corridors: corridorsFC,
          funnels: funnelsFC,
          bbox,
        },
        parcelCoords
      );

      // Build intrusion overlay from high-intrusion corridor segments
      const intrusionFeatures: GeoJSON.Feature[] = [];
      [tiered.corridors_primary, tiered.corridors_possible].forEach(fc => {
        fc.features.forEach(f => {
          const intrusion = (f.properties as any)?.intrusion || 0;
          if (intrusion >= 0.5) {
            intrusionFeatures.push(f);
          }
        });
      });

      console.log('[TIERED] Computed tiered corridors:', {
        primary: tiered.corridors_primary?.features?.length || 0,
        possible: tiered.corridors_possible?.features?.length || 0,
        exploratory: tiered.corridors_exploratory?.features?.length || 0,
        funnels_hard: tiered.funnels_hard?.features?.length || 0,
        funnels_slight: tiered.funnels_slight?.features?.length || 0,
        context_primary: tiered.corridors_context_primary?.features?.length || 0,
        context_possible: tiered.corridors_context_possible?.features?.length || 0,
        intrusion_overlay: intrusionFeatures.length,
      });

      setTieredCorridorData({
        corridors_primary: tiered.corridors_primary,
        corridors_possible: tiered.corridors_possible,
        corridors_exploratory: tiered.corridors_exploratory,
        corridors_context_primary: tiered.corridors_context_primary,
        corridors_context_possible: tiered.corridors_context_possible,
        funnels_hard: tiered.funnels_hard,
        funnels_slight: tiered.funnels_slight,
        intrusion_overlay: { type: 'FeatureCollection', features: intrusionFeatures },
        metadata: tiered.metadata?.tiering,
      });
    } catch (err) {
      console.error('[TIERED] Corridor tiering failed:', err);
    }
  }, [layers, parcelPolygon]);

  // ========== UPDATE TIERED CORRIDOR MAP SOURCES ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current || !tieredCorridorData) return;

    try {
      // Update primary corridors source
      const primarySource = map.getSource('tfp-corridors-primary') as mapboxgl.GeoJSONSource;
      if (primarySource) {
        primarySource.setData(tieredCorridorData.corridors_primary);
      }

      // Update possible corridors source
      const possibleSource = map.getSource('tfp-corridors-possible') as mapboxgl.GeoJSONSource;
      if (possibleSource) {
        possibleSource.setData(tieredCorridorData.corridors_possible);
      }

      // Update exploratory corridors source
      const exploratorySource = map.getSource('tfp-corridors-exploratory') as mapboxgl.GeoJSONSource;
      if (exploratorySource) {
        exploratorySource.setData(tieredCorridorData.corridors_exploratory);
      }

      // Update context corridors sources
      const contextPrimarySource = map.getSource('tfp-corridors-context-primary') as mapboxgl.GeoJSONSource;
      if (contextPrimarySource) {
        contextPrimarySource.setData(tieredCorridorData.corridors_context_primary);
      }

      const contextPossibleSource = map.getSource('tfp-corridors-context-possible') as mapboxgl.GeoJSONSource;
      if (contextPossibleSource) {
        contextPossibleSource.setData(tieredCorridorData.corridors_context_possible);
      }

      // Update hard funnels source
      const hardFunnelSource = map.getSource('tfp-funnels-hard') as mapboxgl.GeoJSONSource;
      if (hardFunnelSource) {
        hardFunnelSource.setData(tieredCorridorData.funnels_hard);
      }

      // Update slight funnels source
      const slightFunnelSource = map.getSource('tfp-funnels-slight') as mapboxgl.GeoJSONSource;
      if (slightFunnelSource) {
        slightFunnelSource.setData(tieredCorridorData.funnels_slight);
      }

      // Update intrusion overlay source
      const intrusionSource = map.getSource('tfp-intrusion-overlay') as mapboxgl.GeoJSONSource;
      if (intrusionSource) {
        intrusionSource.setData(tieredCorridorData.intrusion_overlay);
      }

      console.log('[MAP] Updated tiered corridor sources');
    } catch (err) {
      console.error('[MAP] Error updating tiered corridor sources (non-fatal):', err);
    }
  }, [tieredCorridorData, mapReady]);

  // ========== GENERATE RIDGE SPINE DATA (Structure-First, DEM-Only) ==========
  useEffect(() => {
    if (!parcelPolygon) {
      setRidgeSpineData(null);
      return;
    }

    const generateRidgeData = async () => {
      try {
        // Extract parcel ID for API call
        const parcelId = (parcelPolygon.properties as any)?.parcelId || 
                         (parcelPolygon.properties as any)?.ll_uuid || 
                         `synth-${Date.now().toString(36)}`;

        console.log('[Backbone] Generating terrain spine data for parcel:', parcelId);

        // Fetch backbone/ridge spine data (will fall back to empty if API unavailable)
        const result = await fetchRidgeSpines({
          parcel: parcelPolygon,
          parcel_id: parcelId,
          bufferMeters: 300, // Smaller buffer for ridge extraction
        });

        if (result.success && result.data) {
          const primaryCount = result.data.ridges_primary.features.length;
          const secondaryCount = result.data.ridges_secondary.features.length;
          const saddleCount = result.data.saddle_nodes.features.length;
          console.log('[Backbone] Result:', {
            primary: primaryCount,
            secondary: secondaryCount,
            saddles: saddleCount,
            total: primaryCount + secondaryCount + saddleCount,
            dem_source: result.data.metadata?.dem_source || 'unknown',
            synthetic: result.isSynthetic,
          });

          // Post-process: strip any spine coordinates that fall inside NHD water bodies
          let filteredPrimary = result.data.ridges_primary;
          let filteredSecondary = result.data.ridges_secondary;
          if (nhdWaterBodiesRef.current?.length) {
            const wb = nhdWaterBodiesRef.current;
            filteredPrimary = {
              ...filteredPrimary,
              features: filteredPrimary.features.map((feature: any) => ({
                ...feature,
                geometry: {
                  ...feature.geometry,
                  coordinates: feature.geometry.coordinates.filter(
                    ([lng, lat]: number[]) => !pointInAnyWaterBody(lng, lat, wb)
                  ),
                },
              })).filter((f: any) => f.geometry.coordinates.length >= 2),
            };
            filteredSecondary = {
              ...filteredSecondary,
              features: filteredSecondary.features.map((feature: any) => ({
                ...feature,
                geometry: {
                  ...feature.geometry,
                  coordinates: feature.geometry.coordinates.filter(
                    ([lng, lat]: number[]) => !pointInAnyWaterBody(lng, lat, wb)
                  ),
                },
              })).filter((f: any) => f.geometry.coordinates.length >= 2),
            };
          }

          setRidgeSpineData({
            ridges_primary: filteredPrimary,
            ridges_secondary: filteredSecondary,
            saddle_nodes: result.data.saddle_nodes,
            isSynthetic: result.isSynthetic,
            metadata: {
              total_ridge_length_m: result.data.metadata.total_ridge_length_m,
              ridge_count_primary: result.data.metadata.ridge_count_primary,
              ridge_count_secondary: result.data.metadata.ridge_count_secondary,
              saddle_count: result.data.metadata.saddle_count,
              dem_source: result.data.metadata.dem_source,
              backbone_confidence: result.data.metadata.backbone_confidence,
              fallback_reason: result.data.metadata.fallback_reason,
            },
          });
        } else {
          console.warn('[Backbone] Ridge spine generation failed, using empty fallback');
          // Generate synthetic as fallback
          const synthetic = generateSyntheticRidgeSpines(parcelPolygon, nhdWaterBodiesRef.current?.length ? nhdWaterBodiesRef.current : undefined);
          setRidgeSpineData({
            ridges_primary: synthetic.ridges_primary,
            ridges_secondary: synthetic.ridges_secondary,
            saddle_nodes: synthetic.saddle_nodes,
            isSynthetic: true,
            metadata: {
              total_ridge_length_m: synthetic.metadata.total_ridge_length_m,
              ridge_count_primary: synthetic.metadata.ridge_count_primary,
              ridge_count_secondary: synthetic.metadata.ridge_count_secondary,
              saddle_count: synthetic.metadata.saddle_count,
              dem_source: synthetic.metadata.dem_source,
              backbone_confidence: synthetic.metadata.backbone_confidence,
              fallback_reason: synthetic.metadata.fallback_reason,
            },
          });
        }
      } catch (err) {
        console.error('[Backbone] Error during terrain spine generation:', err);
      }
    };

    generateRidgeData();
  }, [parcelPolygon]);

  // ========== UPDATE RIDGE SPINE MAP SOURCES ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current || !ridgeSpineData) return;

    try {
      // Update primary ridges source
      const primarySource = map.getSource('tfp-ridges-primary') as mapboxgl.GeoJSONSource;
      if (primarySource) {
        primarySource.setData(ridgeSpineData.ridges_primary);
      }

      // Update secondary ridges source
      const secondarySource = map.getSource('tfp-ridges-secondary') as mapboxgl.GeoJSONSource;
      if (secondarySource) {
        secondarySource.setData(ridgeSpineData.ridges_secondary);
      }

      // Update saddle nodes source
      // ═══ SADDLE NODE STABILITY — snap new nodes to previous positions within tolerance ═══
      const saddleSource = map.getSource('tfp-saddle-nodes') as mapboxgl.GeoJSONSource;
      if (saddleSource) {
        const newNodes = ridgeSpineData.saddle_nodes;
        const prevNodes = previousSaddleNodesRef.current;
        const SADDLE_NODE_NEIGHBORHOOD_M = 25; // metres — snap to prev if within this

        if (prevNodes.features.length > 0 && newNodes.features.length > 0) {
          const pointCoord = (f: GeoJSON.Feature): [number, number] | null => {
            if (f.geometry?.type === 'Point') return (f.geometry as GeoJSON.Point).coordinates as [number, number];
            return null;
          };

          const usedPrevIdxs = new Set<number>();
          const stabilizedFeatures = newNodes.features.map((newFeat, ni) => {
            const newC = pointCoord(newFeat);
            if (!newC) return newFeat;

            let bestDist = Infinity;
            let bestIdx = -1;
            for (let pi = 0; pi < prevNodes.features.length; pi++) {
              if (usedPrevIdxs.has(pi)) continue;
              const prevC = pointCoord(prevNodes.features[pi]);
              if (!prevC) continue;
              const d = distanceMeters(newC, prevC);
              if (d < bestDist) { bestDist = d; bestIdx = pi; }
            }

            if (bestIdx >= 0 && bestDist < SADDLE_NODE_NEIGHBORHOOD_M) {
              usedPrevIdxs.add(bestIdx);
              // Keep previous coordinates, merge properties from new analysis
              console.error(`[SADDLE-STABILITY] node=${ni} SNAPPED: dist=${bestDist.toFixed(0)}m — keeping previous position`);
              return { ...prevNodes.features[bestIdx], properties: { ...prevNodes.features[bestIdx].properties, ...newFeat.properties } };
            }
            console.error(`[SADDLE-STABILITY] node=${ni} NEW: no prev match within ${SADDLE_NODE_NEIGHBORHOOD_M}m (closest=${bestDist.toFixed(0)}m)`);
            return newFeat;
          });

          const stableNodesFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: stabilizedFeatures };
          previousSaddleNodesRef.current = stableNodesFC;
          saddleSource.setData(stableNodesFC);
        } else {
          previousSaddleNodesRef.current = newNodes;
          saddleSource.setData(newNodes);
        }
      }
      // ═══ END SADDLE NODE STABILITY ═══

      console.log('[Backbone] Updated map sources');
    } catch (err) {
      console.error('[Backbone] Error updating map sources (non-fatal):', err);
    }
  }, [ridgeSpineData, mapReady]);

  // ========== HUNTABILITY ENGINE — BIG BEAUTIFUL MAP v1 ==========
  useEffect(() => {
    if (!parcelPolygon) {
      setHuntabilityData(null);
      return;
    }

    const generateHuntability = async () => {
      setHuntabilityLoading(true);
      try {
        // Extract parcel coordinates
        let parcelCoords: number[][] | undefined;
        const geom = parcelPolygon.geometry;
        if (geom.type === 'Polygon') {
          parcelCoords = (geom as GeoJSON.Polygon).coordinates[0];
        } else if (geom.type === 'MultiPolygon') {
          parcelCoords = ((geom as GeoJSON.MultiPolygon).coordinates[0] || [])[0];
        }

        if (!parcelCoords || parcelCoords.length < 3) {
          console.warn('[Huntability] Invalid parcel coordinates');
          setHuntabilityLoading(false);
          return;
        }

        console.log('[Huntability] Building huntability analysis...');

        const result = buildTerrainHuntability({
          parcelCoords,
          ridgeData: ridgeSpineData ? {
            ridges_primary: ridgeSpineData.ridges_primary,
            ridges_secondary: ridgeSpineData.ridges_secondary,
            saddle_nodes: ridgeSpineData.saddle_nodes,
          } : undefined,
          waterBodies: nhdWaterBodiesRef.current?.length ? nhdWaterBodiesRef.current : undefined,
          structurePoints: structurePointsRef.current?.length ? structurePointsRef.current : undefined,
        });

        if (result) {
          setHuntabilityData(result);
          console.log('[Huntability] Analysis complete:', {
            score: result.score.overall,
            grade: result.score.grade,
            corridors: result.metadata.corridorCount,
            convergence: result.metadata.convergenceCount,
            processingTimeMs: result.metadata.processingTimeMs,
          });
        } else {
          console.warn('[Huntability] Analysis failed');
        }
      } catch (err) {
        console.error('[Huntability] Error:', err);
      } finally {
        setHuntabilityLoading(false);
      }
    };

    // Wait for ridge spine data before generating huntability
    // (ridge data improves accuracy, but we can run without it)
    const timer = setTimeout(generateHuntability, 100);
    return () => clearTimeout(timer);
  }, [parcelPolygon, ridgeSpineData]);

  // ========== UPDATE HUNTABILITY MAP SOURCES ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current || !huntabilityData) return;

    try {
      // v3.7.0: Update corridor zone polygon source
      const corridorZoneSource = map.getSource('tfp-huntability-corridor-zones') as mapboxgl.GeoJSONSource;
      if (corridorZoneSource && huntabilityData.corridorZones) {
        corridorZoneSource.setData(huntabilityData.corridorZones);
      }

      // Update huntability corridor spine source
      const corridorSource = map.getSource('tfp-huntability-corridors') as mapboxgl.GeoJSONSource;
      if (corridorSource) {
        corridorSource.setData(huntabilityData.corridorLines);
      }

      // Update huntability convergence source
      const convergenceSource = map.getSource('tfp-huntability-convergence') as mapboxgl.GeoJSONSource;
      if (convergenceSource) {
        convergenceSource.setData(huntabilityData.convergencePoints);
      }

      // Update huntability favorability heatmap source
      const favorabilitySource = map.getSource('tfp-huntability-favorability') as mapboxgl.GeoJSONSource;
      if (favorabilitySource) {
        favorabilitySource.setData(huntabilityData.favorabilitySurface);
      }

      // v3.6.0: Update bedding probability source
      // Demo trust filter: also exclude probability dots near buildings.
      const beddingProbSource = map.getSource('tfp-bedding-probability') as mapboxgl.GeoJSONSource;
      if (beddingProbSource && huntabilityData.beddingProbabilityGeoJSON) {
        const mapInst = mapRef.current;
        const filteredBedProb = mapInst
          ? filterBeddingNearBuildings(huntabilityData.beddingProbabilityGeoJSON, mapInst, 120)
          : huntabilityData.beddingProbabilityGeoJSON;
        beddingProbSource.setData(filteredBedProb);

        // Force Mapbox to re-evaluate data-driven paint expressions against new beddingType values
        try {
          if (map.getLayer('tfp-bedding-probability-fill')) {
            map.setPaintProperty('tfp-bedding-probability-fill', 'circle-color', [
              'match', ['get', 'beddingType'],
              'sanctuary', '#1a5c2a',
              'thermal',   '#52b788',
              'staging',   '#95d5b2',
              'escape',    '#74c69d',
              '#52b788',
            ]);
            map.setPaintProperty('tfp-bedding-probability-fill', 'circle-opacity', [
              'match', ['get', 'beddingType'],
              'sanctuary', 0.20,
              'thermal',   0.14,
              'staging',   0.10,
              'escape',    0.13,
              0.14,
            ]);
            map.setPaintProperty('tfp-bedding-probability-fill', 'circle-radius', [
              'interpolate', ['linear'], ['get', 'beddingScore'],
              0.55, ['match', ['get', 'beddingType'], 'sanctuary', 12, 'staging', 8, 10],
              0.75, ['match', ['get', 'beddingType'], 'sanctuary', 18, 'staging', 12, 14],
              1.0,  ['match', ['get', 'beddingType'], 'sanctuary', 24, 'staging', 14, 20],
            ]);
            map.setPaintProperty('tfp-bedding-probability-fill', 'circle-blur', 1.2);
          }
        } catch (e) {
          console.warn('[BeddingStyle] setPaintProperty failed:', e);
        }
      }

      console.log('[Huntability] Updated map sources:', {
        corridorZones: huntabilityData.corridorZones?.features?.length || 0,
        corridorSpines: huntabilityData.corridorLines.features.length,
        convergence: huntabilityData.convergencePoints.features.length,
        favorability: huntabilityData.favorabilitySurface.features.length,
        beddingZones: huntabilityData.beddingProbabilityGeoJSON?.features?.length || 0,
      });
    } catch (err) {
      console.error('[Huntability] Error updating map sources (non-fatal):', err);
    }
  }, [huntabilityData, mapReady]);

  // ========== TERRAIN FLOW DATA GENERATION ==========
  useEffect(() => {
    if (!parcelPolygon) {
      setTerrainFlowData(null);
      setLegacySyntheticData(null);
      setTerrainStory(null);
      return;
    }

    const generateFlowData = async () => {
      setTerrainFlowLoading(true);
      try {
        const parcelId = (parcelPolygon.properties as any)?.parcelId || 
                         (parcelPolygon.properties as any)?.ll_uuid || 
                         `synth-${Date.now().toString(36)}`;

        console.log('[TerrainFlow] Generating terrain flow data for parcel:', parcelId);

        // Generate LEGACY synthetic for comparison (parcel-axis-based)
        console.log('[TerrainFlow] Generating legacy synthetic for comparison...');
        const legacySynthetic = generateLegacySyntheticFlow(parcelPolygon);
        setLegacySyntheticData({
          flow_primary: legacySynthetic.flow_primary,
          flow_secondary: legacySynthetic.flow_secondary,
          convergence_zones: legacySynthetic.convergence_zones,
          opportunity_zones: legacySynthetic.opportunity_zones,
          metadata: {
            flow_count_primary: legacySynthetic.metadata.stats.flow_count_primary,
            flow_count_secondary: legacySynthetic.metadata.stats.flow_count_secondary,
            convergence_count: legacySynthetic.metadata.stats.convergence_count,
            opportunity_count: legacySynthetic.metadata.stats.opportunity_count,
            mode: 'synthetic',
          },
        });

        // Generate TERRAIN-DRIVEN flow (the new V2 approach)
        const result = await fetchTerrainFlow({
          parcel: parcelPolygon,
          parcel_id: parcelId,
          bufferMeters: 1000, // 1km buffer for landscape context
        });

        if (result.success && result.data) {
          const primaryCount = result.data.flow_primary.features.length;
          const secondaryCount = result.data.flow_secondary.features.length;
          const convergenceCount = result.data.convergence_zones.features.length;
          
          console.log('[TerrainFlow] Result:', {
            primary: primaryCount,
            secondary: secondaryCount,
            convergence: convergenceCount,
            mode: result.data.metadata?.mode || 'unknown',
            buffer_m: result.data.metadata?.buffer_m || 1000,
            synthetic: result.isSynthetic,
          });

          setTerrainFlowData({
            flow_primary: result.data.flow_primary,
            flow_secondary: result.data.flow_secondary,
            convergence_zones: result.data.convergence_zones,
            opportunity_zones: result.data.opportunity_zones,
            isSynthetic: result.isSynthetic,
            metadata: {
              flow_count_primary: result.data.metadata.stats.flow_count_primary,
              flow_count_secondary: result.data.metadata.stats.flow_count_secondary,
              convergence_count: result.data.metadata.stats.convergence_count,
              opportunity_count: result.data.metadata.stats.opportunity_count,
              total_flow_length_m: result.data.metadata.stats.total_flow_length_m,
              mode: result.data.metadata.mode,
              dem_source: result.data.metadata.dem_source,
              fallback_reason: result.data.metadata.fallback_reason,
            },
          });
          // Generate terrain story from flow data
          const storyAcreage = qaParcel?.acreage || 
                              (parcelPolygon?.properties as any)?.ll_gisacre ||
                              (parcelPolygon?.properties as any)?.acreage ||
                              undefined;
          const storyAddress = qaParcel?.address || address || undefined;
          const story = generateTerrainStory(result.data, storyAcreage, storyAddress);
          setTerrainStory(story);
          console.log('[TerrainStory] Generated:', story.headline);
        } else {
          console.warn('[TerrainFlow] Flow generation failed, using terrain-driven fallback');
          const synthetic = generateSyntheticTerrainFlow(parcelPolygon);
          setTerrainFlowData({
            flow_primary: synthetic.flow_primary,
            flow_secondary: synthetic.flow_secondary,
            convergence_zones: synthetic.convergence_zones,
            opportunity_zones: synthetic.opportunity_zones,
            isSynthetic: true,
            metadata: {
              flow_count_primary: synthetic.metadata.stats.flow_count_primary,
              flow_count_secondary: synthetic.metadata.stats.flow_count_secondary,
              convergence_count: synthetic.metadata.stats.convergence_count,
              opportunity_count: synthetic.metadata.stats.opportunity_count,
              total_flow_length_m: synthetic.metadata.stats.total_flow_length_m,
              mode: synthetic.metadata.mode,
              dem_source: synthetic.metadata.dem_source,
              fallback_reason: synthetic.metadata.fallback_reason,
            },
          });
          // Generate terrain story from synthetic data
          const synthAcreage = qaParcel?.acreage || 
                              (parcelPolygon?.properties as any)?.ll_gisacre ||
                              (parcelPolygon?.properties as any)?.acreage ||
                              undefined;
          const synthAddress = qaParcel?.address || address || undefined;
          const syntheticStory = generateTerrainStory(synthetic, synthAcreage, synthAddress);
          setTerrainStory(syntheticStory);
          console.log('[TerrainStory] Generated (synthetic):', syntheticStory.headline);
        }
      } catch (err) {
        console.error('[TerrainFlow] Error during flow generation:', err);
      } finally {
        setTerrainFlowLoading(false);
      }
    };

    generateFlowData();
  }, [parcelPolygon]);

  // ========== COMPUTE TERRAIN RATING (BROKER SCORE) ==========
  useEffect(() => {
    if (!terrainFlowData || terrainFlowLoading) {
      setQaBrokerScore(null);
      return;
    }
    
    // Only compute when we have terrain data
    try {
      // Extract flow segments from terrain flow data
      const flowSegments: Array<{ likelihood: number; isPrimary: boolean }> = [];
      
      // Extract from primary flows
      if (terrainFlowData.flow_primary?.features) {
        terrainFlowData.flow_primary.features.forEach((feature: any) => {
          const props = feature.properties || {};
          flowSegments.push({
            likelihood: props.likelihood ?? props.score ?? 0.7,
            isPrimary: true
          });
        });
      }
      
      // Extract from secondary flows
      if (terrainFlowData.flow_secondary?.features) {
        terrainFlowData.flow_secondary.features.forEach((feature: any) => {
          const props = feature.properties || {};
          flowSegments.push({
            likelihood: props.likelihood ?? props.score ?? 0.5,
            isPrimary: false
          });
        });
      }
      
      // Get convergence zone count (convergence IS opportunity)
      const convergenceCount = terrainFlowData.convergence_zones?.features?.length || 0;
      
      // Get max intensity from convergence zones
      let maxOverlapIntensity = 0;
      if (terrainFlowData.convergence_zones?.features) {
        terrainFlowData.convergence_zones.features.forEach((feature: any) => {
          const score = feature.properties?.score ?? feature.properties?.intensity ?? 0;
          if (score > maxOverlapIntensity) maxOverlapIntensity = score;
        });
      }
      
      // Get terrain feature support from ridge spine data
      const ridgeSupport = ridgeSpineData?.metadata?.ridge_count_primary 
        ? Math.min(1, ridgeSpineData.metadata.ridge_count_primary / 5)
        : 0;
      const saddleSupport = ridgeSpineData?.metadata?.saddle_count
        ? Math.min(1, ridgeSpineData.metadata.saddle_count / 3)
        : 0;
      const benchSupport = 0.3; // Default - we don't have explicit bench detection yet
      
      // Get DEM mode
      const demMode = terrainFlowData.metadata?.mode || 
                      terrainFlowData.metadata?.dem_source || 
                      (terrainFlowData.isSynthetic ? 'synthetic' : 'unknown');
      
      // Get acreage from qaParcel or parcelPolygon
      const acreage = qaParcel?.acreage || 
                      (parcelPolygon?.properties as any)?.ll_gisacre ||
                      (parcelPolygon?.properties as any)?.acreage ||
                      null;
      
      // Compute broker score
      const input: BrokerScoreInput = {
        flowSegments,
        convergenceZoneCount: convergenceCount,
        maxOverlapIntensity,
        ridgeSupport,
        saddleSupport,
        benchSupport,
        hasDEMData: demMode.toLowerCase().includes('dem') || ridgeSupport > 0,
        demMode,
        acreage
      };
      
      const result = computeBrokerScore(input);
      setQaBrokerScore(result);
      
      console.log('[BrokerScore] Computed:', {
        score: result.brokerScore,
        class: result.brokerClass,
        components: result.components,
        inputs: { flowSegments: flowSegments.length, convergenceCount, demMode, acreage }
      });
    } catch (err) {
      console.error('[BrokerScore] Error computing broker score:', err);
      setQaBrokerScore(null);
    }
  }, [terrainFlowData, terrainFlowLoading, ridgeSpineData, qaParcel, parcelPolygon]);

  // ========== FETCH ADJACENT PARCELS ==========
  const adjacentFetchRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!parcelPolygon || !mapReady) {
      setAdjacentParcels([]);
      return;
    }

    // Calculate centroid from parcel polygon
    const geom = parcelPolygon.geometry;
    let coords: number[][] = [];
    if (geom.type === 'Polygon') {
      coords = geom.coordinates[0] as number[][];
    } else if (geom.type === 'MultiPolygon') {
      let maxLen = 0;
      for (const poly of geom.coordinates as number[][][][]) {
        if (poly[0] && poly[0].length > maxLen) {
          maxLen = poly[0].length;
          coords = poly[0];
        }
      }
    }
    if (coords.length === 0) return;

    const centroidLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const centroidLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const subjectId = (parcelPolygon.properties as Record<string, unknown>)?.parcelnumb as string || '';

    // Abort previous fetch
    if (adjacentFetchRef.current) adjacentFetchRef.current.abort();
    const controller = new AbortController();
    adjacentFetchRef.current = controller;

    setAdjacentParcelsLoading(true);
    setSelectedAdjacentParcel(null);
    setAdjacentParcelPopupPos(null);

    fetch(`/api/parcels/adjacent?lat=${centroidLat}&lng=${centroidLng}&subjectId=${encodeURIComponent(subjectId)}&radius=500`, {
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => {
        if (!controller.signal.aborted && data.success) {
          console.log('[Adjacent] Loaded', data.parcels.length, 'adjacent parcels');
          setAdjacentParcels(data.parcels);
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.warn('[Adjacent] Fetch error:', err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAdjacentParcelsLoading(false);
      });

    return () => controller.abort();
  }, [parcelPolygon, mapReady]);

  // ========== UPDATE ADJACENT PARCELS MAP SOURCE ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource('tfp-adjacent-parcels') as mapboxgl.GeoJSONSource;
    if (!source) return;

    if (!showAdjacentParcels || adjacentParcels.length === 0) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: adjacentParcels.map(p => ({
        type: 'Feature' as const,
        properties: {
          parcelId: p.parcelId,
          address: p.address,
          owner: p.owner,
          acreage: p.acreage,
          county: p.county,
          state: p.state,
        },
        geometry: p.geometry,
      })),
    };

    source.setData(fc);
    console.log('[Adjacent] Updated map source with', fc.features.length, 'parcels');
  }, [adjacentParcels, showAdjacentParcels, mapReady]);

  // ========== UPDATE TERRITORY PARCELS MAP SOURCE ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource('tfp-territory-parcels') as mapboxgl.GeoJSONSource;
    if (!source) return;

    if (territoryParcels.length === 0) {
      source.setData({ type: 'FeatureCollection', features: [] });
      try {
        map.setLayoutProperty('tfp-territory-fill', 'visibility', 'none');
        map.setLayoutProperty('tfp-territory-outline', 'visibility', 'none');
        map.setLayoutProperty('tfp-territory-glow', 'visibility', 'none');
        // Restore adjacent parcel layers when territory is cleared
        map.setLayoutProperty('tfp-adjacent-parcels-fill', 'visibility', 'visible');
        map.setLayoutProperty('tfp-adjacent-parcels-outline', 'visibility', 'visible');
      } catch { /* layers may not exist yet */ }
      console.log('[TERRITORY] Cleared territory source (0 parcels) — adjacent layers restored');
      return;
    }

    try {
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: territoryParcels.map(p => p.polygon),
      };
      console.log('[TERRITORY] Syncing territory source:', fc.features.length, 'features from', territoryParcels.length, 'parcels');
      source.setData(fc);

      // Only show territory fill/outline/glow when we have parcels.
      // gracefulClear fades ALL tfp- layers (except tfp-parcel-) to opacity 0,
      // so force them back here when parcels are present.
      try {
        // Show outline + glow only — fill stays at opacity 0 to prevent salmon wash
        map.setLayoutProperty('tfp-territory-outline', 'visibility', 'visible');
        map.setPaintProperty('tfp-territory-outline', 'line-opacity', 0.95);
        map.setLayoutProperty('tfp-territory-glow', 'visibility', 'visible');
        map.setPaintProperty('tfp-territory-glow', 'line-opacity', 0.35);
        // Hide adjacent parcel layers to prevent grey film overlay on territory parcels
        map.setLayoutProperty('tfp-adjacent-parcels-fill', 'visibility', 'none');
        map.setLayoutProperty('tfp-adjacent-parcels-outline', 'visibility', 'none');
      } catch { /* layers may not exist yet */ }

      if (territoryParcels.length >= 2) {
        const bounds = getTerritoryBounds(territoryParcels);
        map.fitBounds(
          [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
          { padding: 80, duration: 800 }
        );
      }
    } catch (err) {
      console.error('[TERRITORY] Error syncing territory source:', err);
      // Don't re-throw — territory useEffect errors should never crash the UI
    }
  }, [territoryParcels, mapReady, getTerritoryBounds]);

  // ========== AUTO-LOAD TERRITORY FROM URL PARAMS ==========
  // When ?territory=true&p1lat=..&p1lng=..&p2lat=..&p2lng=..&name=.. is in the URL,
  // fetch each parcel's geometry from Regrid, add them to the territory, and auto-run analysis.
  // Fires exactly once per mount when the map is ready.
  const territoryUrlLoadedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!urlTerritory || !mapReady) return;
    if (territoryUrlLoadedRef.current) return;
    // Require at least 2 valid (non-zero, non-NaN) parcel coord pairs before firing.
    // This prevents a stray ?territory=true with missing/zero p* params from
    // triggering a territory load that would otherwise contaminate the normal
    // single-parcel flow with demo/fallback coordinates.
    const validParcelCount = [
      { lat: urlP1Lat, lng: urlP1Lng },
      { lat: urlP2Lat, lng: urlP2Lng },
      { lat: urlP3Lat, lng: urlP3Lng },
      { lat: urlP4Lat, lng: urlP4Lng },
      { lat: urlP5Lat, lng: urlP5Lng },
    ].filter(p => p.lat !== 0 && p.lng !== 0 && !isNaN(p.lat) && !isNaN(p.lng)).length;
    if (validParcelCount < 2) {
      console.warn('[TERRITORY-URL] Skipping auto-load — need at least 2 valid parcels, got', validParcelCount);
      return;
    }
    territoryUrlLoadedRef.current = true;

    const loadTerritoryFromURL = async () => {
      console.error('[TERRITORY-URL] Loading territory from URL:', urlTerritoryName);

      // Switch into territory mode so the Builder panel is visible while loading
      setTerritoryMode(true);
      setTerritoryName(urlTerritoryName);
      // SHARED-TERRITORY FIX: flag this as a shared-view load so
      // addParcelToTerritory bypasses the tier cap and the UI labels switch
      // from "Territory full" to shared-viewing treatment.
      setIsViewingSharedTerritory(true);

      const parcelCoords = [
        { lat: urlP1Lat, lng: urlP1Lng },
        { lat: urlP2Lat, lng: urlP2Lng },
        { lat: urlP3Lat, lng: urlP3Lng },
        { lat: urlP4Lat, lng: urlP4Lng },
        { lat: urlP5Lat, lng: urlP5Lng },
      ].filter(p => p.lat !== 0 && p.lng !== 0);

      for (const coords of parcelCoords) {
        try {
          const res = await fetch(`/api/parcels/lookup?lat=${coords.lat}&lng=${coords.lng}`);
          const data = await res.json();
          if (!data || !data.found || !data.parcel) {
            console.warn('[TERRITORY-URL] No parcel found for:', coords);
            continue;
          }
          const parcel = data.parcel;

          // Build a GeoJSON Feature from the lookup (mirrors Territory Mode click handler logic)
          const geoType = parcel.geometryType || 'Polygon';
          let parcelFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
          if (geoType === 'MultiPolygon') {
            parcelFeature = {
              type: 'Feature',
              properties: { parcelId: parcel.parcelId, address: parcel.address, owner: parcel.owner, acreage: parcel.acreage },
              geometry: { type: 'MultiPolygon', coordinates: parcel.coordinates || [] },
            };
          } else {
            const rawCoords = parcel.coordinates || [];
            const ring = Array.isArray(rawCoords[0]?.[0]) ? rawCoords[0] : rawCoords;
            const ringCoords = [...ring];
            if (ringCoords.length > 0 && (ringCoords[0][0] !== ringCoords[ringCoords.length - 1][0] || ringCoords[0][1] !== ringCoords[ringCoords.length - 1][1])) {
              ringCoords.push(ringCoords[0]);
            }
            parcelFeature = {
              type: 'Feature',
              properties: { parcelId: parcel.parcelId, address: parcel.address, owner: parcel.owner, acreage: parcel.acreage },
              geometry: { type: 'Polygon', coordinates: [ringCoords] },
            };
          }

          addParcelToTerritory({
            id: parcel.parcelId || `p_${coords.lat}_${coords.lng}`,
            address: parcel.address || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
            lat: coords.lat,
            lng: coords.lng,
            acreage: parcel.acreage || 0,
            polygon: parcelFeature,
            owner: parcel.owner,
            county: parcel.county,
          }, { bypassCap: true });  // SHARED-TERRITORY FIX: bypass tier cap for URL-loaded shares
          // Small delay between adds so React state settles between loops
          await new Promise(r => setTimeout(r, 150));
        } catch (e) {
          console.warn('[TERRITORY-URL] Failed to load parcel:', coords, e);
        }
      }

      // Give React one more tick to flush all setState calls from addParcelToTerritory
      setTimeout(() => {
        const loaded = territoryParcelsRef.current;
        if (loaded.length < 2) {
          console.warn('[TERRITORY-URL] Not enough parcels loaded to build territory:', loaded.length);
          return;
        }
        const merged = mergeParcelPolygons(loaded);
        if (!merged) {
          console.warn('[TERRITORY-URL] mergeParcelPolygons returned null');
          return;
        }
        const bounds = getTerritoryBounds(loaded);
        const centerLat = (bounds[1] + bounds[3]) / 2;
        const centerLng = (bounds[0] + bounds[2]) / 2;
        const totalAcres = String(loaded.reduce((s, p) => s + p.acreage, 0));

        setParcelPolygon(merged);
        setActiveLat(centerLat);
        setActiveLng(centerLng);
        setActiveAcreage(totalAcres);
        setActiveAddress(urlTerritoryName);
        activeLatRef.current = centerLat;
        activeLngRef.current = centerLng;
        activeAcreageRef.current = totalAcres;
        prefetchedParcelRef.current = merged;
        territoryFadeInPending.current = true;
        console.error('[TERRITORY-URL] Auto-analyzing territory with', loaded.length, 'parcels');
        // Small additional delay so map camera has time to fit the territory bounds
        setTimeout(() => runAnalysis(), 200);
      }, 2000);
    };

    loadTerritoryFromURL();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, urlTerritory]);

  // ========== UPDATE TERRAIN FLOW MAP SOURCES ==========
  // v3.8.4 — debounce 300ms so rapid season/wind clicks coalesce into one setData pass
  const terrainFlowDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;

    if (terrainFlowDebounceRef.current) clearTimeout(terrainFlowDebounceRef.current);
    terrainFlowDebounceRef.current = setTimeout(async () => {
    terrainFlowDebounceRef.current = null;

    // Select data source based on comparison mode
    const flowData = flowComparisonMode && legacySyntheticData 
      ? legacySyntheticData 
      : terrainFlowData;
    
    // CRITICAL FIX: When flowData is null, clear map sources (not return early)
    // This prevents stale terrain flow from persisting across parcel changes
    const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    try {
      // Helper: filter out flow LineString features whose midpoint falls inside a water body
      const filterFlowLines = (fc: any) => {
        if (!fc?.features) return fc;
        return {
          ...fc,
          features: fc.features.filter((f: any) => {
            if (f.geometry.type !== 'LineString') return true;

            // Gate 1 — Remove any line where ANY vertex touches water
            if (nhdWaterBodiesRef.current?.length) {
              const touchesWater = f.geometry.coordinates.some(
                ([lng, lat]: number[]) =>
                  pointInAnyWaterBody(lng, lat, nhdWaterBodiesRef.current)
              );
              if (touchesWater) return false;
            }

            // Gate 2 — Remove very short lines under 100m — likely noise
            const coords = f.geometry.coordinates;
            if (coords.length >= 2) {
              const first = coords[0];
              const last = coords[coords.length - 1];
              const dLat = (last[1] - first[1]) * 111320;
              const dLng = (last[0] - first[0]) * 111320 *
                Math.cos(first[1] * Math.PI / 180);
              const lengthM = Math.sqrt(dLat * dLat + dLng * dLng);
              if (lengthM < 100) return false;
            }

            // Gate 3 — Remove low confidence lines
            const confidence =
              f.properties?.confidence ??
              f.properties?.strength ??
              f.properties?.score ??
              1;
            if (confidence < 0.25) return false;

            return true;
          })
        };
      };

      // Update primary flow source (filter lines through water bodies)
      const primarySource = map.getSource('tfp-flow-primary') as mapboxgl.GeoJSONSource;
      if (primarySource) {
        primarySource.setData(filterFlowLines(flowData?.flow_primary || emptyFC));
      }

      // Update secondary flow source (filter lines through water bodies)
      const secondarySource = map.getSource('tfp-flow-secondary') as mapboxgl.GeoJSONSource;
      if (secondarySource) {
        secondarySource.setData(filterFlowLines(flowData?.flow_secondary || emptyFC));
      }

      // Update convergence zones source (filter points inside water bodies)
      const convergenceSource = map.getSource('tfp-flow-convergence') as mapboxgl.GeoJSONSource;
      if (convergenceSource) {
        const rawConvergence = flowData?.convergence_zones || emptyFC;
        const filteredConvergence = nhdWaterBodiesRef.current?.length
          ? {
              ...rawConvergence,
              features: rawConvergence.features.filter((f: any) => {
                const [lng, lat] = f.geometry.coordinates;
                return !pointInAnyWaterBody(lng, lat, nhdWaterBodiesRef.current);
              }),
            }
          : rawConvergence;
        convergenceSource.setData(filteredConvergence);
      }

      // v3.0 RASTER-BASED PRESSURE SURFACE
      // Build a proper grid at 15m resolution, compute terrain metrics per cell,
      // apply weighted formula + Gaussian smoothing, extract local maxima for opportunity zones.
      
      // Extract parcel coordinates for raster grid generation
      let parcelCoordsForGrid: number[][] | undefined;
      if (parcelPolygon?.geometry) {
        const geom = parcelPolygon.geometry;
        if (geom.type === 'Polygon') {
          parcelCoordsForGrid = (geom as GeoJSON.Polygon).coordinates[0];
        } else if (geom.type === 'MultiPolygon') {
          parcelCoordsForGrid = ((geom as GeoJSON.MultiPolygon).coordinates[0] || [])[0];
        }
      }

      const heatmapSource = map.getSource('tfp-pressure-heatmap') as mapboxgl.GeoJSONSource;

      // Try raster-based approach if we have parcel coords
      if (parcelCoordsForGrid && parcelCoordsForGrid.length >= 3) {
        // Extract building centroids for structure proximity filter
        const structurePts = extractBuildingCentroids(map);
        structurePointsRef.current = structurePts;
        if (structurePts.length) {
          console.log(`[TerrainRaster] Passing ${structurePts.length} structure point(s) for stand filtering`);
        }

        // Fetch NHD water bodies for water exclusion (non-blocking)
        let nhdWaterBodies: Array<{ coordinates: number[][][] }> = [];
        try {
          let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
          for (const c of parcelCoordsForGrid) {
            minLng = Math.min(minLng, c[0]);
            maxLng = Math.max(maxLng, c[0]);
            minLat = Math.min(minLat, c[1]);
            maxLat = Math.max(maxLat, c[1]);
          }
          nhdWaterBodies = await fetchNHDWaterBodies(minLat, maxLat, minLng, maxLng);
          nhdWaterBodiesRef.current = nhdWaterBodies;
          if (nhdWaterBodies.length > 0) {
            console.log(`[NHD] Fetched ${nhdWaterBodies.length} water body polygon(s) for exclusion`);
          }
        } catch {
          console.warn('[NHD] Water body fetch failed — proceeding without water exclusion');
        }

        const rasterResult = buildTerrainRaster({
          parcelCoords: parcelCoordsForGrid,
          beddingPolygons: layers?.beddingPolygons || undefined,
          ridgeSpineData: ridgeSpineData || undefined,
          season,
          focusMode: 'balanced',
          structurePoints: structurePts.length ? structurePts : undefined,
          waterBodies: nhdWaterBodies.length > 0 ? nhdWaterBodies : undefined,
        });

        if (rasterResult) {
          // Persist grid for stand-compare sampling
          setRasterGrid(rasterResult.grid);

          // Update heat map from raster surface
          if (heatmapSource) {
            heatmapSource.setData(rasterResult.heatPoints);
          }

          // Update pressure polygon grid (fill layer)
          const gridSource = map.getSource('tfp-pressure-grid') as mapboxgl.GeoJSONSource;
          if (gridSource) {
            gridSource.setData(rasterResult.pressurePolygons);
          }

          // Update movement delta layer
          const deltaSource = map.getSource('tfp-movement-delta') as mapboxgl.GeoJSONSource;
          if (deltaSource) {
            deltaSource.setData(rasterResult.movementDelta);
          }

          // Update movement post layer
          const postSource = map.getSource('tfp-movement-post') as mapboxgl.GeoJSONSource;
          if (postSource) {
            postSource.setData(rasterResult.movementPost);
          }

          // Update refuge zones layer
          const refugeSource = map.getSource('tfp-refuge-zones') as mapboxgl.GeoJSONSource;
          if (refugeSource) {
            refugeSource.setData(rasterResult.refugeZones);
          }

          console.log('[TerrainRaster] Built pressure surface:', {
            grid: `${rasterResult.grid.rows}×${rasterResult.grid.cols}`,
            heatPoints: rasterResult.heatPoints.features.length,
            pressurePolygons: rasterResult.pressurePolygons.features.length,
            movementDelta: rasterResult.movementDelta.features.length,
            movementPost: rasterResult.movementPost.features.length,
            refugeZones: rasterResult.refugeZones.features.length,
            primeStandSites: rasterResult.primeStandSites.length,
          });
        } else {
          // Fallback to feature-based approach
          console.warn('[TerrainRaster] Raster build failed, falling back to feature-based');
          if (heatmapSource) {
            const heatMapData = buildTerrainHeatMap({
              beddingPolygons: layers?.beddingPolygons || undefined,
              funnels: layers?.funnels || undefined,
              ridgeSpineData: ridgeSpineData || undefined,
              parcelCoords: parcelCoordsForGrid,
              season,
              convergenceMode: 'light',
              focusMode: 'balanced',
            });
            heatmapSource.setData(heatMapData);
          }
        }
      } else {
        // No parcel coords — use legacy feature-based approach
        if (heatmapSource) {
          const heatMapData = buildTerrainHeatMap({
            beddingPolygons: layers?.beddingPolygons || undefined,
            funnels: layers?.funnels || undefined,
            ridgeSpineData: ridgeSpineData || undefined,
            parcelCoords: parcelCoordsForGrid,
            season,
            convergenceMode: 'light',
            focusMode: 'balanced',
          });
          heatmapSource.setData(heatMapData);
        }
      }

      console.log('[TerrainFlow] Updated map sources', flowData ? (flowComparisonMode ? '(LEGACY comparison)' : '(terrain-driven)') : '(CLEARED - parcel switch)');
    } catch (err) {
      console.error('[TerrainFlow] Error updating map sources (non-fatal):', err);
    }
    }, 250); // end debounce setTimeout

    return () => {
      if (terrainFlowDebounceRef.current) clearTimeout(terrainFlowDebounceRef.current);
    };
  }, [terrainFlowData, legacySyntheticData, flowComparisonMode, mapReady, layers, parcelPolygon, ridgeSpineData, season]);

  // ========== NEAREST CORRIDOR HIGHLIGHT (selected stand) ==========
  // When a stand is selected, find the primary flow segment nearest to it
  // and push that single feature into the highlight source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const highlightSource = map.getSource('tfp-flow-nearest-highlight') as mapboxgl.GeoJSONSource | undefined;
    if (!highlightSource) return;

    const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    // No stand selected → clear highlight
    if (selectedStand === null) {
      highlightSource.setData(emptyFC);
      if (map.getLayer('tfp-flow-nearest-highlight')) {
        map.setLayoutProperty('tfp-flow-nearest-highlight', 'visibility', 'none');
      }
      return;
    }

    // Find the selected stand's coords
    const stand = alignedStands.find(s => s.rank === selectedStand);
    if (!stand) { highlightSource.setData(emptyFC); return; }

    const [sLng, sLat] = stand.coords;
    const primaryFeatures = terrainFlowData?.flow_primary?.features;
    if (!primaryFeatures || primaryFeatures.length === 0) {
      highlightSource.setData(emptyFC);
      return;
    }

    // Find nearest primary segment by minimum distance from stand to any vertex
    let nearestIdx = 0;
    let nearestDist = Infinity;
    primaryFeatures.forEach((f: any, idx: number) => {
      const geom = f.geometry;
      if (!geom || geom.type !== 'LineString') return;
      const coords: number[][] = geom.coordinates;
      for (const pt of coords) {
        const dLng = (pt[0] - sLng) * 111320 * Math.cos(sLat * Math.PI / 180);
        const dLat = (pt[1] - sLat) * 111320;
        const dist = dLng * dLng + dLat * dLat; // squared is fine for comparison
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = idx;
        }
      }
    });

    // Push the nearest feature into the highlight source
    highlightSource.setData({
      type: 'FeatureCollection',
      features: [primaryFeatures[nearestIdx]],
    });

    // Show the highlight layer (only if primary flow is visible)
    if (map.getLayer('tfp-flow-nearest-highlight') && flowVisibility.flowPrimary) {
      map.setLayoutProperty('tfp-flow-nearest-highlight', 'visibility', 'visible');
    }

    // V4 Step 11b: Choreographed corridor focus when stand is selected
    // 1. Corridors dim smoothly (600ms ease) to push attention toward the highlight
    // 2. Nearest corridor highlight fades in after a 200ms delay for a deliberate reveal
    const selecting = selectedStand !== null;
    const corridorDimLayers = [
      { id: 'tfp-corridors-primary', dimOpacity: 0.25, fullOpacity: 0.78 },
      { id: 'tfp-corridors-primary-casing', dimOpacity: 0.05, fullOpacity: 0.15 },
      { id: 'tfp-corridors-possible', dimOpacity: 0.12, fullOpacity: 0.42 },
      { id: 'tfp-corridors-exploratory', dimOpacity: 0.04, fullOpacity: 0.22 },
      { id: 'tfp-corridors-context-primary', dimOpacity: 0.06, fullOpacity: 0.28 },
      { id: 'tfp-corridors-context-possible', dimOpacity: 0.03, fullOpacity: 0.15 },
    ];
    corridorDimLayers.forEach(({ id, dimOpacity, fullOpacity }) => {
      if (!map.getLayer(id)) return;
      const target = selecting ? dimOpacity : fullOpacity;
      // Slower when selecting (cinematic dim), faster when restoring
      animatePaint(map, id, 'line-opacity', target, selecting ? 600 : 400);
    });

    // Delayed highlight reveal for selected corridor
    if (selecting && map.getLayer('tfp-flow-nearest-highlight') && flowVisibility.flowPrimary) {
      setTimeout(() => {
        fadeLayerIn(map, 'tfp-flow-nearest-highlight', 0.75, 'line-opacity', 500);
      }, 200);
    }
  }, [selectedStand, alignedStands, terrainFlowData, mapReady, flowVisibility.flowPrimary]);

  // ========== UPDATE LAYER VISIBILITY ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;

    try {
      // V4 Step 11b: Smooth fade transitions with improved timing
      const FADE_IN = 420;
      const FADE_OUT = 300;

      // Bedding visibility — smooth fade
      fadeToggleLayers(map, visibility.bedding, [
        { id: 'tfp-bedding-fill', targetOpacity: 0.35, opacityProp: 'fill-opacity' },
        { id: 'tfp-bedding-outline', targetOpacity: 0.7 },
      ], FADE_IN);

      // Funnel visibility - draws layer (now independently controlled)
      fadeToggleLayers(map, visibility.draws, [
        { id: 'tfp-funnels-lines-draws', targetOpacity: 1.0 },
      ], FADE_IN);
      // Legacy corridors layers — V4 Step 10: Always hidden (V2 tiered corridors are primary visual)
      if (map.getLayer('tfp-funnels-lines-corridors-solid')) {
        map.setLayoutProperty('tfp-funnels-lines-corridors-solid', 'visibility', 'none');
      }
      if (map.getLayer('tfp-funnels-lines-corridors-dashed')) {
        map.setLayoutProperty('tfp-funnels-lines-corridors-dashed', 'visibility', 'none');
      }
      if (map.getLayer('tfp-funnels-lines-corridors')) {
        map.setLayoutProperty('tfp-funnels-lines-corridors', 'visibility', 'none');
      }
      // Fallback layer
      if (map.getLayer('tfp-funnels-lines')) {
        const funnelVisible = visibility.draws || visibility.saddles || visibility.corridors;
        map.setLayoutProperty('tfp-funnels-lines', 'visibility', funnelVisible ? 'visible' : 'none');
      }
      // Saddle polygons — smooth fade
      fadeToggleLayers(map, visibility.saddles, [
        { id: 'tfp-funnels-polys-fill', targetOpacity: 0.2, opacityProp: 'fill-opacity' },
        { id: 'tfp-funnels-polys-outline', targetOpacity: 1.0 },
      ], FADE_IN);
      
      // V4 Step 11b: Staggered corridor reveal — cascading "drawing on" effect
      staggeredFadeToggle(map, visibility.corridors, [
        { id: 'tfp-corridors-primary-casing', targetOpacity: 0.15 },
        { id: 'tfp-corridors-primary', targetOpacity: 0.78 },
        { id: 'tfp-corridors-possible', targetOpacity: 0.42 },
        { id: 'tfp-corridors-exploratory', targetOpacity: 0.22 },
        { id: 'tfp-corridors-context-primary', targetOpacity: 0.28 },
        { id: 'tfp-corridors-context-possible', targetOpacity: 0.15 },
        { id: 'tfp-intrusion-overlay', targetOpacity: 0.3, opacityProp: 'fill-opacity' },
      ], FADE_IN, 50);
      
      // V2 Tiered funnel visibility — smooth fade
      fadeToggleLayers(map, visibility.funnels, [
        { id: 'tfp-funnels-hard-fill', targetOpacity: 0.35, opacityProp: 'fill-opacity' },
        { id: 'tfp-funnels-hard-outline', targetOpacity: 0.8 },
        { id: 'tfp-funnels-slight-fill', targetOpacity: 0.2, opacityProp: 'fill-opacity' },
        { id: 'tfp-funnels-slight-outline', targetOpacity: 0.5 },
      ], FADE_IN);
      
      // V4 Step 11b: Staggered ridge spine reveal
      staggeredFadeToggle(map, visibility.ridgeSpines, [
        { id: 'tfp-ridges-primary-casing', targetOpacity: 0.25 },
        { id: 'tfp-ridges-primary', targetOpacity: 0.85 },
        { id: 'tfp-ridges-secondary-casing', targetOpacity: 0.15 },
        { id: 'tfp-ridges-secondary', targetOpacity: 0.55 },
        { id: 'tfp-saddle-nodes', targetOpacity: 0.8, opacityProp: 'circle-opacity' },
        { id: 'tfp-saddle-nodes-outline', targetOpacity: 0.6, opacityProp: 'circle-stroke-opacity' },
      ], FADE_IN, 45);
      
      // Pressure overlays disabled — fill grid and heatmap both at 0
      
      // Terrain Flow visibility — fill grid gated on master pressureHeatmap toggle
      const heatOn = flowVisibility.pressureHeatmap;

      // All heatmap layers disabled — pressure heatmap + alt views all at 0
      ['tfp-movement-delta', 'tfp-movement-post', 'tfp-refuge-zones'].forEach(id => {
        if (!map.getLayer(id)) return;
        animatePaint(map, id, 'heatmap-opacity', 0, 350);
        setTimeout(() => {
          try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); } catch {}
        }, 380);
      });

      // Flow lines (SUPPORTING EVIDENCE) — v3.5.1 animated corridors
      // V4 Step 11: Smooth fade for flow visibility
      if (map.getLayer('tfp-flow-primary')) {
        if (isPressureMode && flowVisibility.flowPrimary) {
          map.setLayoutProperty('tfp-flow-primary', 'visibility', 'visible');
        } else {
          fadeLayerOut(map, 'tfp-flow-primary', 'line-opacity', FADE_OUT);
        }
        // When Deer Flow is active, boost primary lines so the connective structure reads clearly
        map.setPaintProperty('tfp-flow-primary', 'line-width', isPressureMode ? [
          'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
          0.4, 2.5,     // Weak: slightly bolder
          0.55, 3.5,    // Moderate: clear
          0.75, 5       // Strong: bold corridor
        ] : [
          'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
          0.4, 2,
          0.55, 3,
          0.75, 4
        ]);
        if (isPressureMode && flowVisibility.flowPrimary) {
          map.setPaintProperty('tfp-flow-primary', 'line-opacity', isPressureMode ? [
            'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
            0.4, 0.65,
            0.55, 0.80,
            0.75, 0.95
          ] : [
            'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
            0.4, 0.55,
            0.55, 0.70,
            0.75, 0.85
          ]);
        }
      }
      if (map.getLayer('tfp-flow-primary-glow')) {
        if (isPressureMode && flowVisibility.flowPrimary) {
          fadeLayerIn(map, 'tfp-flow-primary-glow', isPressureMode ? 0.35 : 0.25, 'line-opacity', FADE_IN);
        } else {
          fadeLayerOut(map, 'tfp-flow-primary-glow', 'line-opacity', FADE_OUT);
        }
      }
      // Nearest corridor highlight follows primary flow visibility + stand selection
      if (map.getLayer('tfp-flow-nearest-highlight')) {
        const showHighlight = isPressureMode && flowVisibility.flowPrimary && selectedStand !== null;
        if (showHighlight) {
          fadeLayerIn(map, 'tfp-flow-nearest-highlight', 0.70, 'line-opacity', FADE_IN);
        } else {
          fadeLayerOut(map, 'tfp-flow-nearest-highlight', 'line-opacity', FADE_OUT);
        }
      }
      // v3.8.1 — Directional chevrons follow primary flow visibility
      if (map.getLayer('tfp-flow-direction-chevrons')) {
        if (isPressureMode && flowVisibility.flowPrimary) {
          map.setLayoutProperty('tfp-flow-direction-chevrons', 'visibility', 'visible');
        } else {
          map.setLayoutProperty('tfp-flow-direction-chevrons', 'visibility', 'none');
        }
      }
      if (map.getLayer('tfp-flow-secondary')) {
        const secTarget = isPressureMode ? 0.50 : 0.45;
        if (isPressureMode && flowVisibility.flowSecondary) {
          fadeLayerIn(map, 'tfp-flow-secondary', secTarget, 'line-opacity', FADE_IN);
        } else {
          fadeLayerOut(map, 'tfp-flow-secondary', 'line-opacity', FADE_OUT);
        }
        map.setPaintProperty('tfp-flow-secondary', 'line-width', isPressureMode ? [
          'interpolate', ['linear'], ['zoom'],
          10, 1.8,
          15, 2.2,
          18, 2.8,
        ] : 1.5);
      }
      // Convergence zones — smooth fade with pressure-aware opacity
      if (map.getLayer('tfp-flow-convergence')) {
        const convTarget = isPressureMode ? 0.1 : 0.85;
        if (isPressureMode && flowVisibility.convergenceZones) {
          fadeLayerIn(map, 'tfp-flow-convergence', convTarget, 'circle-opacity', FADE_IN);
        } else {
          fadeLayerOut(map, 'tfp-flow-convergence', 'circle-opacity', FADE_OUT);
        }
      }
      if (map.getLayer('tfp-flow-convergence-pulse')) {
        const pulseTarget = isPressureMode ? 0.1 : 0.15;
        if (isPressureMode && flowVisibility.convergenceZones) {
          fadeLayerIn(map, 'tfp-flow-convergence-pulse', pulseTarget, 'circle-opacity', FADE_IN);
        } else {
          fadeLayerOut(map, 'tfp-flow-convergence-pulse', 'circle-opacity', FADE_OUT);
        }
      }
      // v3.6.0: Bedding Probability visibility — smooth fade
      fadeToggleLayers(map, showBeddingProbability, [
        { id: 'tfp-bedding-probability-glow', targetOpacity: 0.4, opacityProp: 'circle-opacity' },
        { id: 'tfp-bedding-probability-fill', targetOpacity: 0.40, opacityProp: 'circle-opacity' },
        { id: 'tfp-bedding-probability-outline', targetOpacity: 0.5 },
      ], FADE_IN);
    } catch (err) {
      console.error('[MAP] Error updating visibility (non-fatal):', err);
    }
  }, [visibility, flowVisibility, showBeddingProbability, isPressureMode, mapReady, selectedStand, visibilityEpoch, huntabilityData]); // v4-fix8: visibilityEpoch forces re-run after reload; huntabilityData re-fires when bedding source populates

  // ========== PRESSURE FOCUS — DISABLED ==========
  // Pressure heatmap + fill grid permanently dark. Overrides removed.
  // useEffect kept as no-op placeholder in case we re-enable later.

  // ========== SINGLE MAPBOX MAP INSTANCE ==========
  // Track instance count for debugging double-mount issues
  const mountIdRef = useRef<string>('');
  // v4-fix: retry counter for WebGL context recovery after 3D terrain close
  const [mapCreateAttempt, setMapCreateAttempt] = useState(0);
  const mapRetryCountRef = useRef<number>(0);
  const MAX_MAP_RETRIES = 3;
  
  useEffect(() => {
    const mountId = Date.now().toString(36);
    mountIdRef.current = mountId;
    console.log('[LIFECYCLE] useEffect ENTER id=' + mountId + ' attempt=' + mapCreateAttempt + ' mapRef=' + !!mapRef.current + ' container=' + !!mapContainerRef.current);
    
    if (!mapContainerRef.current) {
      console.log('[LIFECYCLE] No container ref, skipping');
      return;
    }
    
    if (mapRef.current) {
      console.log('[LIFECYCLE] Map already exists, skipping creation');
      return;
    }

    // v4-fix2: WebGL check with retry — if context is temporarily lost (e.g. previous
    // 3D terrain just released it), wait a beat and retry rather than showing error.
    const webglOk = checkWebGLSupport();
    console.error('[MAP-DIAG] WebGL check result:', webglOk, 'attempt:', mapRetryCountRef.current, 'of', MAX_MAP_RETRIES);
    if (!webglOk) {
      if (mapRetryCountRef.current < MAX_MAP_RETRIES) {
        mapRetryCountRef.current++;
        const delay = mapRetryCountRef.current * 500; // 500ms, 1000ms, 1500ms (more generous)
        console.error('[MAP-DIAG] WebGL not ready — retry ' + mapRetryCountRef.current + '/' + MAX_MAP_RETRIES + ' in ' + delay + 'ms');
        const retryTimer = setTimeout(() => {
          if (mountIdRef.current !== mountId) return;
          setMapCreateAttempt(prev => prev + 1);
        }, delay);
        return () => clearTimeout(retryTimer);
      }
      console.error('[MAP-DIAG] FINAL FAILURE: WebGL unavailable after', MAX_MAP_RETRIES, 'retries');
      setMapError("Your browser doesn't support WebGL, which is required for terrain viewing.");
      setIsLoading(false);
      return;
    }

    // Reset retry counter on successful WebGL check
    mapRetryCountRef.current = 0;

    // Check token
    if (!MAPBOX_TOKEN) {
      setMapError("Map configuration error. Please try again later.");
      setIsLoading(false);
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const container = mapContainerRef.current;

    // v3.8.4-fix — Ensure container has non-zero dimensions before creating the map.
    // Mapbox GL caches the viewport at creation time; a 0-height container means
    // no tiles are requested and the canvas stays black forever.
    const initMap = () => {
      const rect = container.getBoundingClientRect();
      console.log('[MAP] Container dimensions at init:', rect.width, 'x', rect.height);
      if (rect.width === 0 || rect.height === 0) {
        console.warn('[MAP] Container has 0 dimensions — deferring init via rAF');
        requestAnimationFrame(() => {
          if (mountIdRef.current !== mountId) return; // unmounted
          initMap();
        });
        return;
      }
      createMap(mountId);
    };

    const createMap = (mId: string) => {
    let map: mapboxgl.Map;

    console.error('[MAP-DIAG] BEFORE new mapboxgl.Map() id=' + mId + ' center=[' + lng + ',' + lat + ']');
    try {
      map = new mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: 14,
        pitch: 0,    // Flat 2D view - no 3D terrain
        bearing: 0,  // North up
      });
      console.error('[MAP-DIAG] Map constructor SUCCESS id=' + mId);
      
      // Expose for debugging
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = map;
      }
    } catch (err) {
      console.error("[MAP-DIAG] Map constructor FAILED:", err);
      console.error("[MAP-DIAG] SUMMARY: map_create=FAILED, webgl=true, container=" + container.offsetWidth + "x" + container.offsetHeight);
      setMapError("Failed to load map. Please try refreshing the page.");
      setIsLoading(false);
      return;
    }

    // v4-fix2: WebGL context loss/restore handlers — log only, don't set mapError
    // (Mapbox handles context restoration internally; setting mapError causes false alarms)
    try {
      const mapCanvas = map.getCanvas();
      if (mapCanvas) {
        mapCanvas.addEventListener('webglcontextlost', (e: Event) => {
          e.preventDefault(); // Tell browser we'll handle recovery
          console.error('[MAP-DIAG] WebGL context LOST on analyzer map canvas');
        });
        mapCanvas.addEventListener('webglcontextrestored', () => {
          console.error('[MAP-DIAG] WebGL context RESTORED on analyzer map canvas');
          try { map.resize(); } catch (_) { /* ignore */ }
        });
      }
    } catch (canvasErr) {
      console.error('[MAP-DIAG] Could not attach WebGL context listeners:', canvasErr);
    }

    // Map error handler — log only; don't set mapError for tile/style errors
    // (those are transient and Mapbox retries them automatically)
    map.on('error', (e: any) => {
      const err = e?.error || e;
      console.error("[MAP-DIAG] map.on('error'):", err?.message, "status:", err?.status);
      // Only surface auth failures — everything else is transient
      if (err?.status === 401 || err?.status === 403) {
        setMapError("Map authentication error. Please contact support.");
      }
    });

    // v3.8.4 — Provide a 1×1 transparent placeholder for any missing sprite images
    // (e.g. "us-state-missouri-2") so Mapbox doesn't break the render pipeline
    map.on('styleimagemissing', (e: any) => {
      const id = e?.id;
      console.warn('[MAP] styleimagemissing:', id);
      if (id && !map.hasImage(id)) {
        // 1×1 transparent pixel
        map.addImage(id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
        console.log('[MAP] Registered placeholder for missing image:', id);
      }
    });

    // v3.8.4-fix — Diagnostic: log full style load lifecycle
    map.on('styledata', () => {
      console.log('[MAP DIAG] styledata event — style metadata received');
    });
    map.on('sourcedata', (e: any) => {
      if (e.isSourceLoaded && e.sourceId) {
        console.log('[MAP DIAG] sourcedata loaded:', e.sourceId);
      }
    });
    map.once('style.load', () => {
      console.error('[MAP-DIAG] style.load — forcing resize()');
      try {
        map.resize();
      } catch (resErr) {
        console.error('[MAP-DIAG] style.load resize() failed:', resErr);
      }
    });
    map.once('idle', () => {
      const canvas = map.getCanvas();
      console.error('[MAP-DIAG] idle — canvas:', canvas?.width, 'x', canvas?.height,
        'loaded:', map.loaded(), 'tilesLoaded:', map.areTilesLoaded());
    });

    // Handler for when map is fully loaded
    const onMapLoad = () => {
      console.error('[MAP-DIAG] LOAD EVENT FIRED id=' + mountId + ' loaded=' + map.loaded() + ' canvas=' + (map.getCanvas()?.width || '?') + 'x' + (map.getCanvas()?.height || '?'));
      
      // DISABLED: 3D terrain + sky - using flat 2D map only for stability
      // Guard: only call setTerrain if the method exists (Mapbox GL v2+)
      if (typeof map.setTerrain === 'function') {
        console.log('[MAP] setTerrain is available but DISABLED for stability');
      } else {
        console.log('[MAP] setTerrain not available (Mapbox GL v1 or MapLibre)');
      }
      
      // Create native Mapbox sources and layers (NO Deck.gl)
      try {
        console.log('[MAP] Creating native Mapbox sources...');
        
        // ========== v3.5.1 — SELECTED PARCEL BOUNDARY (gold/amber with glow) ==========
        // Gold/amber dashed line (~4-5px) with subtle outer glow so it clearly stands out
        if (!map.getSource('tfp-parcel')) {
          map.addSource('tfp-parcel', { type: 'geojson', data: EMPTY_FC });
          // Outer glow layer (wider, blurred, behind main line)
          map.addLayer({
            id: 'tfp-parcel-glow',
            type: 'line',
            source: 'tfp-parcel',
            paint: {
              'line-color': LAYER_COLORS.parcelGlow,
              'line-width': 10,           // Wide glow halo
              'line-opacity': 0.35,       // Subtle, not overpowering
              'line-blur': 4,             // Soft edge glow effect
            },
          });
          // Main boundary line (gold/amber dashed, prominent)
          map.addLayer({
            id: 'tfp-parcel-outline',
            type: 'line',
            source: 'tfp-parcel',
            paint: {
              'line-color': LAYER_COLORS.parcelBoundary,
              'line-width': 4.5,          // ~4-5px for clear visibility
              'line-dasharray': [5, 3],   // Dashed pattern
              'line-opacity': 0.95,       // Strong presence
            },
          });
        }
        
        // QA Parcel boundary source (for KS/MO validation workflow)
        // v3.8.3 — Default hidden; toggled visible only when qaParcelLookupMode is active
        if (!map.getSource('tfp-qa-parcel')) {
          map.addSource('tfp-qa-parcel', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-qa-parcel-fill',
            type: 'fill',
            source: 'tfp-qa-parcel',
            layout: { visibility: 'none' }, // v3.8.3 — hidden by default
            paint: {
              'fill-color': '#22d3ee', // Cyan-400
              'fill-opacity': 0.08,
            },
          });
          map.addLayer({
            id: 'tfp-qa-parcel-outline',
            type: 'line',
            source: 'tfp-qa-parcel',
            layout: { visibility: 'none' }, // v3.8.3 — hidden by default
            paint: {
              'line-color': '#06b6d4', // Cyan-500
              'line-width': 3,
              'line-opacity': 0.9,
            },
          });
          map.addLayer({
            id: 'tfp-qa-parcel-outline-glow',
            type: 'line',
            source: 'tfp-qa-parcel',
            layout: { visibility: 'none' }, // v3.8.3 — hidden by default
            paint: {
              'line-color': '#22d3ee', // Cyan-400
              'line-width': 8,
              'line-opacity': 0.25,
              'line-blur': 4,
            },
          }, 'tfp-qa-parcel-outline'); // Insert below the main outline
        }
        
        // ========== DEBUG GEOMETRY LAYERS (3-boundary overlay) ==========
        // Red: Raw Regrid geometry (before normalization)
        if (!map.getSource('tfp-debug-raw')) {
          map.addSource('tfp-debug-raw', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-debug-raw-outline',
            type: 'line',
            source: 'tfp-debug-raw',
            layout: { visibility: 'none' }, // Hidden by default
            paint: {
              'line-color': '#ef4444', // Red-500
              'line-width': 4,
              'line-opacity': 0.9,
              'line-dasharray': [2, 2],
            },
          });
        }
        // Cyan: Normalized geometry (after normalizeToOuterRing)
        if (!map.getSource('tfp-debug-normalized')) {
          map.addSource('tfp-debug-normalized', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-debug-normalized-outline',
            type: 'line',
            source: 'tfp-debug-normalized',
            layout: { visibility: 'none' }, // Hidden by default
            paint: {
              'line-color': '#06b6d4', // Cyan-500
              'line-width': 3,
              'line-opacity': 0.9,
            },
          });
        }
        // Yellow: Analysis geometry (sent to Terrain Flow)
        if (!map.getSource('tfp-debug-analysis')) {
          map.addSource('tfp-debug-analysis', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-debug-analysis-outline',
            type: 'line',
            source: 'tfp-debug-analysis',
            layout: { visibility: 'none' }, // Hidden by default
            paint: {
              'line-color': '#fbbf24', // Amber-400
              'line-width': 2,
              'line-opacity': 0.9,
            },
          });
        }
        
        // Bedding source — legacy polygon layer (replaced by tfp-bedding-probability-* circles)
        if (!map.getSource('tfp-bedding')) {
          map.addSource('tfp-bedding', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-bedding-fill',
            type: 'fill',
            source: 'tfp-bedding',
            layout: { visibility: 'none' },
            paint: {
              'fill-color': LAYER_COLORS.bedding,
              'fill-opacity': 0.25,
            },
          });
          map.addLayer({
            id: 'tfp-bedding-outline',
            type: 'line',
            source: 'tfp-bedding',
            layout: { visibility: 'none' },
            paint: {
              'line-color': LAYER_COLORS.beddingOutline,
              'line-width': 2,
            },
          });
        }
        
        // Funnel lines source (draws, corridors) - separate by funnelType for different colors
        if (!map.getSource('tfp-funnels-lines')) {
          map.addSource('tfp-funnels-lines', { type: 'geojson', data: EMPTY_FC });
          // Draws layer (blue) - Physical terrain, SHOW in Terrain Work Mode
          // v3.9.1: dasharray for extremely subtle animation (structural pathways)
          map.addLayer({
            id: 'tfp-funnels-lines-draws',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['==', ['get', 'funnelType'], 'draw'],
            layout: { visibility: 'visible' }, // Draws = terrain structure, always visible initially
            paint: {
              'line-color': LAYER_COLORS.funnelDraw,
              'line-width': 3,
              'line-dasharray': [10, 2],
            },
          });
          // Corridors layer: HIGH + MEDIUM confidence = SOLID lines
          // V4 Step 10: Hidden by default — V2 tiered corridors are the primary visual
          map.addLayer({
            id: 'tfp-funnels-lines-corridors-solid',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['all', 
              ['==', ['get', 'funnelType'], 'corridor'],
              ['>=', ['coalesce', ['get', 'corridorScore'], 0.5], 0.4]  // Med + High only
            ],
            layout: { visibility: 'none' },
            paint: {
              // Score-based color: High ≥0.7 (bright red-violet), Med 0.4-0.7 (purple)
              'line-color': [
                'case',
                ['>=', ['coalesce', ['get', 'corridorScore'], 0.5], 0.7], LAYER_COLORS.corridorHigh,
                LAYER_COLORS.corridorMed
              ],
              // Reduced line widths for visual calm
              'line-width': [
                'case',
                ['>=', ['coalesce', ['get', 'corridorScore'], 0.5], 0.7], 4.5,  // High (was 6)
                3  // Medium (was 4)
              ],
              // SOLID - no dash array
            },
          });
          
          // Corridors layer: LOW confidence = DASHED lines
          // V4 Step 10: Hidden by default — V2 tiered corridors are the primary visual
          map.addLayer({
            id: 'tfp-funnels-lines-corridors-dashed',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['all', 
              ['==', ['get', 'funnelType'], 'corridor'],
              ['<', ['coalesce', ['get', 'corridorScore'], 0.5], 0.4]  // Low only
            ],
            layout: { visibility: 'none' },
            paint: {
              'line-color': LAYER_COLORS.corridorLow,  // Light lavender
              'line-width': 2.5,  // Reduced from 3
              'line-dasharray': [3, 2],  // DASHED = low confidence only
            },
          });
          
          // Legacy layer ID for compatibility (hidden, references both solid + dashed)
          map.addLayer({
            id: 'tfp-funnels-lines-corridors',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['==', ['literal', false], true],  // Never matches, just for layer existence
            layout: { visibility: 'none' },
            paint: {
              'line-color': 'transparent',
              'line-width': 0,
            },
          });
          // Fallback for any other line type
          map.addLayer({
            id: 'tfp-funnels-lines',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['all', 
              ['!=', ['get', 'funnelType'], 'draw'],
              ['!=', ['get', 'funnelType'], 'corridor']
            ],
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.funnelDraw,
              'line-width': 3,
            },
          });
        }
        
        // Funnel polygons source (saddles)
        if (!map.getSource('tfp-funnels-polys')) {
          map.addSource('tfp-funnels-polys', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-funnels-polys-fill',
            type: 'fill',
            source: 'tfp-funnels-polys',
            paint: {
              'fill-color': LAYER_COLORS.funnelSaddle,
              'fill-opacity': 0.2,
            },
          });
          map.addLayer({
            id: 'tfp-funnels-polys-outline',
            type: 'line',
            source: 'tfp-funnels-polys',
            paint: {
              'line-color': '#EA580C',
              'line-width': 2,
            },
          });
        }
        
        // ========== V2 TIERED CORRIDOR SOURCES AND LAYERS ==========
        // ALL HIDDEN in Terrain Work Mode (deer interpretation)
        // V4 Step 10: Premium casing, zoom-responsive widths, cleaner hierarchy
        
        // Primary corridors: Top band — PREMIUM with casing glow
        if (!map.getSource('tfp-corridors-primary')) {
          map.addSource('tfp-corridors-primary', { type: 'geojson', data: EMPTY_FC });
          // Casing layer: soft diffuse glow behind primary corridor
          map.addLayer({
            id: 'tfp-corridors-primary-casing',
            type: 'line',
            source: 'tfp-corridors-primary',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorPrimary,
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 14, 10, 17, 14],
              'line-opacity': 0.15,
              'line-blur': 3,
            },
          });
          // Core line: zoom-responsive width (v3.9.1: dasharray for subtle animation)
          map.addLayer({
            id: 'tfp-corridors-primary',
            type: 'line',
            source: 'tfp-corridors-primary',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorPrimary,
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 14, 3.5, 17, 5],
              'line-opacity': 0.78,
              'line-dasharray': [8, 3],
            },
          });
        }
        
        // Possible corridors — subtle, zoom-responsive
        if (!map.getSource('tfp-corridors-possible')) {
          map.addSource('tfp-corridors-possible', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-possible',
            type: 'line',
            source: 'tfp-corridors-possible',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorPossible,
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 14, 2.5, 17, 3.5],
              'line-opacity': 0.42,
              'line-dasharray': [6, 3],
            },
          });
        }
        
        // Exploratory lanes — very faint at low zoom, visible at high zoom
        if (!map.getSource('tfp-corridors-exploratory')) {
          map.addSource('tfp-corridors-exploratory', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-exploratory',
            type: 'line',
            source: 'tfp-corridors-exploratory',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorExploratory,
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 14, 1.5, 17, 2.5],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.08, 14, 0.22, 17, 0.35],
              'line-dasharray': [4, 3],
            },
          });
        }
        
        // Context corridors (off-parcel) — Primary tier, zoom-responsive
        if (!map.getSource('tfp-corridors-context-primary')) {
          map.addSource('tfp-corridors-context-primary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-context-primary',
            type: 'line',
            source: 'tfp-corridors-context-primary',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorContext,
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 14, 2.5, 17, 3.5],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.12, 14, 0.28, 17, 0.38],
              'line-dasharray': [3, 2],
            },
          });
        }
        
        // Context corridors (off-parcel) — Possible tier, zoom-responsive
        if (!map.getSource('tfp-corridors-context-possible')) {
          map.addSource('tfp-corridors-context-possible', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-context-possible',
            type: 'line',
            source: 'tfp-corridors-context-possible',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorContext,
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 14, 1.5, 17, 2.5],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.06, 14, 0.15, 17, 0.22],
              'line-dasharray': [3, 3],
            },
          });
        }
        
        // Hard funnels: Strong compression zones - HIDE in Terrain Work Mode
        if (!map.getSource('tfp-funnels-hard')) {
          map.addSource('tfp-funnels-hard', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-funnels-hard-fill',
            type: 'fill',
            source: 'tfp-funnels-hard',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'fill-color': LAYER_COLORS.funnelHard,
              'fill-opacity': 0.20,     // Reduced from 0.30
            },
          });
          map.addLayer({
            id: 'tfp-funnels-hard-outline',
            type: 'line',
            source: 'tfp-funnels-hard',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.funnelHard,
              'line-width': 1.5,        // Reduced from 2
              'line-opacity': 0.50,     // Reduced from 0.65
            },
          });
        }
        
        // Slight funnels: Moderate compression zones - HIDE in Terrain Work Mode
        if (!map.getSource('tfp-funnels-slight')) {
          map.addSource('tfp-funnels-slight', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-funnels-slight-fill',
            type: 'fill',
            source: 'tfp-funnels-slight',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'fill-color': LAYER_COLORS.funnelSlight,
              'fill-opacity': 0.12,     // Reduced from 0.18
            },
          });
          map.addLayer({
            id: 'tfp-funnels-slight-outline',
            type: 'line',
            source: 'tfp-funnels-slight',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.funnelSlight,
              'line-width': 1.2,        // Reduced from 1.5
              'line-opacity': 0.30,     // Reduced from 0.40
              'line-dasharray': [4, 2],
            },
          });
        }
        
        // Intrusion overlay: Highlights high-intrusion corridor segments - HIDE in Terrain Work Mode
        if (!map.getSource('tfp-intrusion-overlay')) {
          map.addSource('tfp-intrusion-overlay', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-intrusion-overlay',
            type: 'line',
            source: 'tfp-intrusion-overlay',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.intrusionHigh,
              'line-width': 6,
              'line-opacity': [
                'interpolate', ['linear'], ['get', 'intrusion'],
                0.5, 0,      // Low intrusion: invisible
                0.7, 0.15,   // Medium intrusion: faint
                0.9, 0.30    // High intrusion: visible
              ],
              'line-dasharray': [1, 1],  // Hatched effect
            },
          });
        }
        
        // ========== TERRAIN SPINE DATA SOURCES (added early, layers added after heatmap) ==========
        // Sources for ridge spines - layers will be added after heatmap for proper z-order
        if (!map.getSource('tfp-ridges-primary')) {
          map.addSource('tfp-ridges-primary', { type: 'geojson', data: EMPTY_FC });
        }
        if (!map.getSource('tfp-ridges-secondary')) {
          map.addSource('tfp-ridges-secondary', { type: 'geojson', data: EMPTY_FC });
        }
        
        // Saddle nodes: Only meaningful low points (sparse, subtle)
        if (!map.getSource('tfp-saddle-nodes')) {
          map.addSource('tfp-saddle-nodes', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-saddle-nodes',
            type: 'circle',
            source: 'tfp-saddle-nodes',
            paint: {
              'circle-radius': 5,
              'circle-color': 'transparent',
              'circle-stroke-color': '#f59e0b',
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.80,
              'circle-opacity': 0,
            },
          });
          map.addLayer({
            id: 'tfp-saddle-nodes-outline',
            type: 'circle',
            source: 'tfp-saddle-nodes',
            paint: {
              'circle-radius': 7,
              'circle-color': 'transparent',
              'circle-stroke-color': '#f59e0b',
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.30,
            },
          });
        }
        
        // ========== PRESSURE POLYGON FILL GRID (HIDDEN — kept in code) ==========
        // Crisp per-cell rectangles colored by pressure score — hidden at 0 opacity.
        if (!map.getSource('tfp-pressure-grid')) {
          map.addSource('tfp-pressure-grid', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-pressure-fill',
            type: 'fill',
            source: 'tfp-pressure-grid',
            paint: {
              'fill-color': [
                'interpolate', ['linear'], ['get', 'score'],
                0.0,  '#1a1a2e',   // near-zero → dark/invisible
                0.35, '#f59e0b',   // low pressure → amber
                0.55, '#f97316',   // medium → orange
                0.75, '#ef4444',   // high → red
                1.0,  '#7f1d1d'    // peak → deep red
              ],
              'fill-opacity': 0,  // HIDDEN — heatmap is now the primary visual
              'fill-antialias': false,
            },
          });
        }

        // ========== TERRAIN PRESSURE HEAT MAP (PRIMARY VISUAL) ==========
        // Whisper-quiet organic heatmap — soft warm hint under flow lines.
        if (!map.getSource('tfp-pressure-heatmap')) {
          map.addSource('tfp-pressure-heatmap', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-pressure-heatmap',
            type: 'heatmap',
            source: 'tfp-pressure-heatmap',
            paint: {
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'score'], ['get', 'intensity'], 0.5],
                0.00, 0.0,
                0.22, 0.0,
                0.40, 0.18,
                0.58, 0.58,
                0.80, 0.90,
                1.00, 1.0,
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                10, 0.5,
                15, 0.8,
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0.00, 'rgba(0,0,0,0)',
                0.10, 'rgba(254,240,138,0.18)',
                0.20, 'rgba(250,204,21,0.30)',
                0.35, 'rgba(245,158,11,0.44)',
                0.50, 'rgba(249,115,22,0.56)',
                0.65, 'rgba(239,68,68,0.66)',
                0.80, 'rgba(220,38,38,0.76)',
                0.92, 'rgba(185,28,28,0.82)',
                1.00, 'rgba(153,27,27,0.88)',
              ],
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, 14,
                13, 22,
                15, 28,
                18, 36,
              ],
              'heatmap-opacity': 0,  // DISABLED — layer kept in code but permanently dark
            },
          });
        }
        
        // ========== MOVEMENT DELTA LAYER (post-pressure damage map) ==========
        // movement_delta = clamp(0.7 * pressure, 0, 1) — red/orange heatmap
        if (!map.getSource('tfp-movement-delta')) {
          map.addSource('tfp-movement-delta', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-movement-delta',
            type: 'heatmap',
            source: 'tfp-movement-delta',
            paint: {
              // v2.0: Steep weight — terrain-shaped movement delta
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'delta'], ['get', 'intensity'], 0],
                0.00, 0.0,
                0.30, 0.0,
                0.45, 0.10,
                0.60, 0.40,
                0.80, 0.80,
                1.00, 1.0,
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                10, 0.60,
                15, 1.1,
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0.00, 'rgba(0,0,0,0)',
                0.10, 'rgba(255,237,160,0.18)',
                0.20, 'rgba(254,215,100,0.30)',
                0.35, 'rgba(254,178,76,0.44)',
                0.50, 'rgba(251,146,60,0.56)',
                0.65, 'rgba(252,78,42,0.66)',
                0.80, 'rgba(220,38,38,0.76)',
                0.92, 'rgba(185,28,28,0.82)',
                1.00, 'rgba(153,27,27,0.88)',
              ],
              // v2.0: Tight radius
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, 14,
                13, 28,
                15, 45,
                18, 65,
              ],
              'heatmap-opacity': 0.52,
            },
            layout: {
              visibility: 'visible',
            },
          });
        }

        // ========== MOVEMENT POST LAYER (remaining movement after pressure) ==========
        // movement_post = clamp(terrain - 0.7 * pressure, 0, 1) — green/yellow heatmap
        if (!map.getSource('tfp-movement-post')) {
          map.addSource('tfp-movement-post', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-movement-post',
            type: 'heatmap',
            source: 'tfp-movement-post',
            paint: {
              // v2.0: Steep weight — terrain-shaped post-pressure movement
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'movement_post'], ['get', 'intensity'], 0],
                0.00, 0.0,
                0.30, 0.0,
                0.45, 0.10,
                0.60, 0.40,
                0.80, 0.80,
                1.00, 1.0,
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                10, 0.60,
                15, 1.1,
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0.00, 'rgba(0,0,0,0)',
                0.10, 'rgba(254,240,138,0.18)',
                0.20, 'rgba(250,204,21,0.30)',
                0.35, 'rgba(234,179,8,0.42)',
                0.50, 'rgba(163,230,53,0.54)',
                0.65, 'rgba(132,204,22,0.64)',
                0.80, 'rgba(34,197,94,0.74)',
                0.92, 'rgba(22,163,74,0.82)',
                1.00, 'rgba(21,128,61,0.88)',
              ],
              // v2.0: Tight radius
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, 14,
                13, 28,
                15, 45,
                18, 65,
              ],
              'heatmap-opacity': 0.52,
            },
            layout: {
              visibility: 'visible',
            },
          });
        }

        // ========== REFUGE ZONES LAYER (low-pressure, high-movement safe areas) ==========
        // refuge_score = movement_post * (1 - pressure) — blue/cyan heatmap
        if (!map.getSource('tfp-refuge-zones')) {
          map.addSource('tfp-refuge-zones', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-refuge-zones',
            type: 'heatmap',
            source: 'tfp-refuge-zones',
            paint: {
              // v2.0: Steep weight — terrain-shaped refuge zones
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'refuge_score'], ['get', 'intensity'], 0],
                0.00, 0.0,
                0.30, 0.0,
                0.45, 0.10,
                0.60, 0.40,
                0.80, 0.80,
                1.00, 1.0,
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                10, 0.60,
                15, 1.1,
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0.00, 'rgba(0,0,0,0)',
                0.10, 'rgba(207,250,254,0.18)',
                0.20, 'rgba(165,243,252,0.30)',
                0.35, 'rgba(34,211,238,0.42)',
                0.50, 'rgba(6,182,212,0.54)',
                0.65, 'rgba(14,165,233,0.64)',
                0.80, 'rgba(59,130,246,0.74)',
                0.92, 'rgba(37,99,235,0.82)',
                1.00, 'rgba(29,78,216,0.88)',
              ],
              // v2.0: Tight radius
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, 14,
                13, 28,
                15, 45,
                18, 65,
              ],
              'heatmap-opacity': 0.55,
            },
            layout: {
              visibility: 'visible',
            },
          });
        }

        // ========== TERRAIN SPINE LAYERS (Skeleton — ABOVE heatmap, BELOW stand sites) ==========
        // Goal: When toggled on, the structural backbone is immediately obvious
        // Layers render AFTER heatmap for proper z-order
        
        // Primary spine CASING (outer halo for visibility over imagery/heat)
        if (!map.getLayer('tfp-ridges-primary-casing')) {
          map.addLayer({
            id: 'tfp-ridges-primary-casing',
            type: 'line',
            source: 'tfp-ridges-primary',
            paint: {
              'line-color': LAYER_COLORS.ridgeCasing,
              'line-width': 8,            // Wide casing halo
              'line-opacity': 0.5,        // Semi-transparent for soft edge
              'line-blur': 1.5,           // Soft glow effect
            },
          });
        }
        // Primary spine CORE (thick, dark brown — major structural ridges)
        if (!map.getLayer('tfp-ridges-primary')) {
          map.addLayer({
            id: 'tfp-ridges-primary',
            type: 'line',
            source: 'tfp-ridges-primary',
            paint: {
              'line-color': LAYER_COLORS.ridgePrimary,
              'line-width': 4.5,          // Bold, prominent
              'line-opacity': 0.90,       // Strong presence
            },
          });
        }
        
        // Secondary spine CASING (lighter halo)
        if (!map.getLayer('tfp-ridges-secondary-casing')) {
          map.addLayer({
            id: 'tfp-ridges-secondary-casing',
            type: 'line',
            source: 'tfp-ridges-secondary',
            paint: {
              'line-color': LAYER_COLORS.ridgeCasing,
              'line-width': 5,            // Narrower than primary
              'line-opacity': 0.35,       // Subtler halo
              'line-blur': 1,
            },
          });
        }
        // Secondary spine CORE (thinner, lighter brown)
        if (!map.getLayer('tfp-ridges-secondary')) {
          map.addLayer({
            id: 'tfp-ridges-secondary',
            type: 'line',
            source: 'tfp-ridges-secondary',
            paint: {
              'line-color': LAYER_COLORS.ridgeSecondary,
              'line-width': 2.5,          // Clear but subordinate
              'line-opacity': 0.75,       // Visible, not overpowering
            },
          });
        }
        
        // ========== v3.5.1 — ANIMATED TERRAIN FLOW LAYERS (TEAL/CYAN PALETTE) ==========
        // Primary travel corridors with subtle animation to communicate movement
        // Slow, calm dash animation along corridor centerlines
        
        // Primary flow lines: animated teal/cyan movement corridors
        if (!map.getSource('tfp-flow-primary')) {
          map.addSource('tfp-flow-primary', { type: 'geojson', data: EMPTY_FC });
          
          // v3.5.1 — Animated glow layer (soft teal glow behind main line)
          map.addLayer({
            id: 'tfp-flow-primary-glow',
            type: 'line',
            source: 'tfp-flow-primary',
            paint: {
              'line-color': LAYER_COLORS.flowAnimated, // Teal-400 glow
              'line-width': [
                'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
                0.4, 6,      // Wider glow halo
                0.75, 10
              ],
              'line-opacity': 0.25,
              'line-blur': 3,
            },
          });
          
          // v3.5.1 — Main animated flow line (teal/cyan with dashes for animation)
          map.addLayer({
            id: 'tfp-flow-primary',
            type: 'line',
            source: 'tfp-flow-primary',
            paint: {
              // Teal/cyan color palette for movement feel
              'line-color': [
                'case',
                ['>=', ['coalesce', ['get', 'likelihood'], 0.5], 0.7],
                LAYER_COLORS.flowPrimary,      // Teal-500 — strong corridors
                ['>=', ['coalesce', ['get', 'likelihood'], 0.5], 0.5],
                LAYER_COLORS.flowAnimated,     // Teal-400 — moderate
                LAYER_COLORS.flowSecondary     // Teal-300 — weak
              ],
              // Bolder widths for visibility
              'line-width': [
                'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
                0.4, 2,      // Weak: visible
                0.55, 3,     // Moderate: clear
                0.75, 4      // Strong: bold corridor
              ],
              'line-opacity': [
                'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
                0.4, 0.55,
                0.55, 0.70,
                0.75, 0.85
              ],
              // Dashed pattern for animation (will be animated via dasharray-offset)
              'line-dasharray': [6, 4],
            },
          });
          
          // v3.8.1 — Directional chevron symbols along primary flow lines
          // Uses text symbols placed along lines to indicate flow direction
          map.addLayer({
            id: 'tfp-flow-direction-chevrons',
            type: 'symbol',
            source: 'tfp-flow-primary',
            layout: {
              'symbol-placement': 'line',
              // NOTE: Mapbox GL does NOT allow data expressions on `symbol-spacing`
              // (only zoom-based expressions). Using data-driven values here throws
              // a style error that crashes the entire map useEffect before it
              // reaches the sit-pin contextmenu registration block. Keep it static.
              'symbol-spacing': 110,
              'text-field': '›',
              'text-size': [
                'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
                0.4, 11,
                0.75, 16,
              ],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
              'text-rotate': 0,
              'text-keep-upright': false,
            },
            paint: {
              'text-color': LAYER_COLORS.flowDirectionChevron,
              'text-opacity': [
                'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
                0.4, 0.22,
                0.55, 0.35,
                0.75, 0.50,
              ],
              'text-halo-color': 'rgba(0,0,0,0.15)',
              'text-halo-width': 0.5,
            },
          });
        }

        // ========== NEAREST CORRIDOR HIGHLIGHT (selected stand → nearest primary segment) ==========
        // Separate source holding a single LineString: the primary segment closest to the selected stand.
        if (!map.getSource('tfp-flow-nearest-highlight')) {
          map.addSource('tfp-flow-nearest-highlight', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-flow-nearest-highlight',
            type: 'line',
            source: 'tfp-flow-nearest-highlight',
            layout: { visibility: 'none' },
            paint: {
              'line-color': '#fbbf24',          // Amber-400 — warm stand accent
              'line-width': 6,                  // Slightly wider than primary (4–5)
              'line-opacity': 0.70,
              'line-blur': 1.5,                 // Soft edge so it reads as a glow, not a new line
            },
          });
        }
        
        // Secondary flow lines: visible but clearly subordinate feeders
        if (!map.getSource('tfp-flow-secondary')) {
          map.addSource('tfp-flow-secondary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-flow-secondary',
            type: 'line',
            source: 'tfp-flow-secondary',
            paint: {
              'line-color': LAYER_COLORS.flowSecondary, // Teal-300
              'line-width': 1.5,
              'line-opacity': 0.45,
              'line-dasharray': [4, 3],
            },
          });
        }
        
        // Convergence zones: where flows overlap or pinch
        if (!map.getSource('tfp-flow-convergence')) {
          map.addSource('tfp-flow-convergence', { type: 'geojson', data: EMPTY_FC });
          // v3.8.2 — Static outer halo (precise, capped at 25px)
          map.addLayer({
            id: 'tfp-flow-convergence-pulse',
            type: 'circle',
            source: 'tfp-flow-convergence',
            paint: {
              'circle-radius': ['min', ['*', ['get', 'radiusM'], 0.3], 25],
              'circle-color': LAYER_COLORS.flowConvergence,
              'circle-opacity': 0.15,
              'circle-blur': 0.5,
            },
          });
          // Inner marker — tight focal icon (v3.8.5)
          map.addLayer({
            id: 'tfp-flow-convergence',
            type: 'circle',
            source: 'tfp-flow-convergence',
            paint: {
              'circle-radius': 8,
              'circle-blur': 0.4,
              'circle-opacity': 0.85,
              'circle-color': '#00ffcc',
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
            },
          });
        }
        
        // (Opportunity layers removed — convergence IS opportunity)

        // ========== TERRITORY HIGHLIGHT LAYER ==========
        if (!map.getSource('tfp-territory-parcels')) {
          map.addSource('tfp-territory-parcels', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });

          map.addLayer({
            id: 'tfp-territory-fill',
            type: 'fill',
            source: 'tfp-territory-parcels',
            layout: { visibility: 'none' },
            paint: {
              'fill-color': '#c9a84c',
              'fill-opacity': 0,
            }
          });

          map.addLayer({
            id: 'tfp-territory-outline',
            type: 'line',
            source: 'tfp-territory-parcels',
            layout: { visibility: 'none' },
            paint: {
              'line-color': '#f59e0b',
              'line-width': 2.5,
              'line-opacity': 0.95,
            }
          });

          // Outer glow for territory parcels (matches tfp-parcel-glow)
          map.addLayer({
            id: 'tfp-territory-glow',
            type: 'line',
            source: 'tfp-territory-parcels',
            layout: { visibility: 'none' },
            paint: {
              'line-color': '#fbbf24',
              'line-width': 5,
              'line-opacity': 0.35,
              'line-blur': 3,
            }
          });
        }

        // ========== HUNT POCKET LAYER (v3.8.6) ==========
        // Upstream-biased teardrop intercept zones with corridor-axis intensity bias.
        // Opacity = base curve × opacityScale × corridorBias for flow-reinforced fade.
        // Core reduced ~20% from v3.8.5; outer edge feathered more aggressively.
        if (!map.getSource('tfp-hunt-pockets')) {
          map.addSource('tfp-hunt-pockets', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-hunt-pockets-fill',
            type: 'fill',
            source: 'tfp-hunt-pockets',
            paint: {
              'fill-color': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                '#c49872',                        // Muted warm tan (was standPrimary #e2712a)
                '#c4a67a',                        // Muted sand (was bright amber #e8943a)
              ],
              // v3.8.6+resilience: opacity = base_curve × opacityScale × corridorBias × resilienceFactor
              // resilienceFactor ranges 0.5 (no resilience) to 1.0 (max resilience)
              'fill-opacity': [
                '*',
                ['get', 'resilienceFactor'],
                [
                  '*',
                  ['*', ['get', 'opacityScale'], ['get', 'corridorBias']],
                  [
                    'interpolate', ['exponential', 2.2], ['get', 'ringNorm'],
                    0.25, 0.11,
                    0.50, 0.05,
                    0.75, 0.015,
                    1.0,  0.004,
                  ],
                ],
              ],
            },
          });
          // v3.8.6: Inner stroke nearly invisible — just a faint warmth hint
          map.addLayer({
            id: 'tfp-hunt-pockets-stroke',
            type: 'line',
            source: 'tfp-hunt-pockets',
            filter: ['==', ['get', 'ring'], 1],
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                LAYER_COLORS.standPrimaryRing,
                '#e8943a',                        // Stand 2: brighter amber (was standSecondary #c45d22)
              ],
              'line-width': 0.6,
              'line-opacity': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                0.10,                             // Stand 1: unchanged
                0.18,                             // Stand 2: boosted from 0.10
              ],
              'line-blur': 3.0,
            },
          });
        }

        // ========== KILL ZONE WEDGE LAYER (v2.3) ==========
        // Filled fan polygon showing orientation / kill zone for top stands.
        // Composite facing: 70% movement vector + 30% wind-adjusted bearing.
        // See buildStandDirectionFeatures() for full computation notes.
        if (!map.getSource('tfp-stand-direction')) {
          map.addSource('tfp-stand-direction', { type: 'geojson', data: EMPTY_FC });
          // Filled wedge (low-opacity fan)
          map.addLayer({
            id: 'tfp-stand-direction-main',
            type: 'fill',
            source: 'tfp-stand-direction',
            paint: {
              'fill-color': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                LAYER_COLORS.standPrimaryRing,
                '#f0a050',
              ],
              'fill-opacity': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                0.14,
                0.18,
              ],
            },
          });
          // Subtle outline stroke for edge definition
          map.addLayer({
            id: 'tfp-stand-direction-flank',
            type: 'line',
            source: 'tfp-stand-direction',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                LAYER_COLORS.standPrimaryRing,
                '#f0a050',
              ],
              'line-width': 0.8,
              'line-opacity': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                0.25,
                0.35,
              ],
            },
          });
        }

        // ========== KILL ZONE SUB-WEDGE (high-probability shot zone within cone) ==========
        if (!map.getSource('tfp-killzone')) {
          map.addSource('tfp-killzone', { type: 'geojson', data: EMPTY_FC });
          // Filled sub-wedge — brighter, higher-contrast than the outer cone
          map.addLayer({
            id: 'tfp-killzone-fill',
            type: 'fill',
            source: 'tfp-killzone',
            paint: {
              'fill-color': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                '#ef4444', // red-500 for top stand
                '#f97316', // orange-500 for secondary
              ],
              'fill-opacity': [
                'interpolate', ['linear'], ['get', 'kzConfidence'],
                0, 0.10,    // low confidence → subtle
                0.5, 0.22,  // moderate → visible
                1.0, 0.32,  // high confidence → prominent
              ],
            },
          });
          // Crisp outline stroke
          map.addLayer({
            id: 'tfp-killzone-stroke',
            type: 'line',
            source: 'tfp-killzone',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                '#dc2626', // red-600
                '#ea580c', // orange-600
              ],
              'line-width': 1.2,
              'line-opacity': [
                'interpolate', ['linear'], ['get', 'kzConfidence'],
                0, 0.15,
                0.5, 0.35,
                1.0, 0.50,
              ],
              'line-dasharray': [4, 3],
            },
          });
        }

        // ========== TERTIARY STAND DOTS LAYER (v4 — disabled, replaced by vNext GeoJSON stands) ==========
        if (!map.getSource('tfp-stand-tertiary')) {
          map.addSource('tfp-stand-tertiary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-stand-tertiary-dot',
            type: 'circle',
            source: 'tfp-stand-tertiary',
            layout: { visibility: 'none' },
            paint: {
              'circle-radius': 4,
              'circle-color': LAYER_COLORS.standTertiary,
              'circle-opacity': 0,
            },
          });
        }

        // ========== vNEXT: MAP-NATIVE STAND LAYERS ==========
        // Replaces HTML markers with GeoJSON source + circle/symbol layers.
        // Stands are rendered as map features, not DOM overlays — zero positional drift.
        if (!map.getSource('tfp-stands')) {
          map.addSource('tfp-stands', { type: 'geojson', data: EMPTY_FC });

          // 1. Outer glow ring — soft radial around each stand point
          // v2.0: reduced radius & opacity for cleaner look
          map.addLayer({
            id: 'tfp-stands-glow',
            type: 'circle',
            source: 'tfp-stands',
            paint: {
              'circle-radius': [
                'match', ['get', 'rank'], 0, 14, 1, 12, 10
              ],
              'circle-color': ['get', 'color'],
              'circle-opacity': [
                'match', ['get', 'rank'], 0, 0.18, 1, 0.12, 0.08
              ],
              'circle-blur': 0.9,
            },
          });

          // 2. Main disc — solid filled circle per stand
          // v2.0: thinner stroke (~25% reduction)
          map.addLayer({
            id: 'tfp-stands-disc',
            type: 'circle',
            source: 'tfp-stands',
            paint: {
              'circle-radius': [
                'match', ['get', 'rank'], 0, 9, 1, 7.5, 6
              ],
              'circle-color': ['get', 'color'],
              'circle-opacity': 1,
              'circle-stroke-width': [
                'match', ['get', 'rank'], 0, 1.8, 1.5
              ],
              'circle-stroke-color': ['get', 'strokeColor'],
              'circle-stroke-opacity': 0.7,
            },
          });

          // 3. Inner reticle ring — scope crosshair aesthetic
          // v2.0: thinner, subtler
          map.addLayer({
            id: 'tfp-stands-reticle',
            type: 'circle',
            source: 'tfp-stands',
            paint: {
              'circle-radius': [
                'match', ['get', 'rank'], 0, 4.5, 1, 3.8, 3
              ],
              'circle-color': 'transparent',
              'circle-stroke-width': 0.7,
              'circle-stroke-color': 'rgba(255,255,255,0.3)',
              'circle-stroke-opacity': 1,
            },
          });

          // 4. Center dot — tiny white dot at stand coordinate
          map.addLayer({
            id: 'tfp-stands-center',
            type: 'circle',
            source: 'tfp-stands',
            paint: {
              'circle-radius': 1.2,
              'circle-color': 'rgba(255,255,255,0.5)',
              'circle-opacity': 1,
            },
          });

          // 5. Label — "Today's Sit", "Alternate Sit", "Backup Sit"
          // v2.0: lighter font (Medium), smaller size, thinner halo
          map.addLayer({
            id: 'tfp-stands-label',
            type: 'symbol',
            source: 'tfp-stands',
            layout: {
              'text-field': ['get', 'label'],
              'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
              'text-size': [
                'match', ['get', 'rank'], 0, 11, 1, 10, 9.5
              ],
              'text-offset': [0, 1.6],
              'text-anchor': 'top',
              'text-allow-overlap': true,
              'text-ignore-placement': true,
              'text-letter-spacing': 0.02,
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': ['get', 'color'],
              'text-halo-width': 1.2,
              'text-halo-blur': 0.5,
              'text-opacity': [
                'match', ['get', 'rank'], 0, 0.95, 0.78
              ],
            },
          });

          // 6. Rank number inside disc
          // v2.0: Medium weight, slightly smaller
          map.addLayer({
            id: 'tfp-stands-rank',
            type: 'symbol',
            source: 'tfp-stands',
            layout: {
              'text-field': ['get', 'rankLabel'],
              'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
              'text-size': [
                'match', ['get', 'rank'], 0, 12, 1, 10.5, 9.5
              ],
              'text-anchor': 'center',
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': 'rgba(0,0,0,0.2)',
              'text-halo-width': 0.6,
            },
          });
        }

        // ========== v3.8.1/v3.8.2 — TOP-STAND ATTENTION BIAS ==========
        // Subtle STATIC radial glow near the #1 wind-aligned stand ("Today's Sit")
        // v3.8.2: reduced radius, no animation — just a calm fixed tint
        if (!map.getSource('tfp-stand-emphasis')) {
          map.addSource('tfp-stand-emphasis', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-stand-emphasis-glow',
            type: 'circle',
            source: 'tfp-stand-emphasis',
            paint: {
              'circle-radius': 35,           // v3.8.5: smaller, tighter glow
              'circle-color': LAYER_COLORS.standEmphasisGlow,
              'circle-opacity': 0.05,        // v3.8.5: subtler
              'circle-blur': 0.95,
            },
          });
        }
        
        // ========== HUNTABILITY ENGINE SOURCES AND LAYERS (Big Beautiful Map v1) ==========
        
        // Huntability favorability heatmap (travel favorability surface)
        if (!map.getSource('tfp-huntability-favorability')) {
          map.addSource('tfp-huntability-favorability', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-huntability-favorability-heatmap',
            type: 'heatmap',
            source: 'tfp-huntability-favorability',
            layout: { visibility: 'none' }, // Toggle on for debug
            paint: {
              'heatmap-weight': ['get', 'favorability'],
              'heatmap-intensity': 0.6,
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(33,102,172,0)',
                0.2, 'rgba(103,169,207,0.3)',
                0.4, 'rgba(209,229,240,0.5)',
                0.6, 'rgba(253,219,199,0.6)',
                0.8, 'rgba(239,138,98,0.7)',
                1, 'rgba(178,24,43,0.85)'
              ],
              'heatmap-radius': 25,
              'heatmap-opacity': 0.65,
            },
          });
        }
        
        // v3.7.0: Huntability corridor ZONE fills (movement neighborhoods)
        if (!map.getSource('tfp-huntability-corridor-zones')) {
          map.addSource('tfp-huntability-corridor-zones', { type: 'geojson', data: EMPTY_FC });
          // Primary zone fills — subtle warm earth tones
          map.addLayer({
            id: 'tfp-huntability-corridor-zones-primary',
            type: 'fill',
            source: 'tfp-huntability-corridor-zones',
            filter: ['==', ['get', 'tier'], 'primary'],
            layout: { visibility: 'none' },
            paint: {
              'fill-color': '#7c6f5b',   // Warm earth brown
              'fill-opacity': 0.18,
            },
          });
          // Primary zone outlines
          map.addLayer({
            id: 'tfp-huntability-corridor-zones-primary-outline',
            type: 'line',
            source: 'tfp-huntability-corridor-zones',
            filter: ['==', ['get', 'tier'], 'primary'],
            layout: { visibility: 'none' },
            paint: {
              'line-color': '#7c6f5b',
              'line-width': 1.2,
              'line-opacity': 0.35,
            },
          });
          // Secondary zone fills — lighter, more transparent
          map.addLayer({
            id: 'tfp-huntability-corridor-zones-secondary',
            type: 'fill',
            source: 'tfp-huntability-corridor-zones',
            filter: ['==', ['get', 'tier'], 'secondary'],
            layout: { visibility: 'none' },
            paint: {
              'fill-color': '#a39583',    // Lighter earth tone
              'fill-opacity': 0.10,
            },
          });
          // Secondary zone outlines
          map.addLayer({
            id: 'tfp-huntability-corridor-zones-secondary-outline',
            type: 'line',
            source: 'tfp-huntability-corridor-zones',
            filter: ['==', ['get', 'tier'], 'secondary'],
            layout: { visibility: 'none' },
            paint: {
              'line-color': '#a39583',
              'line-width': 0.8,
              'line-opacity': 0.25,
              'line-dasharray': [3, 2],
            },
          });
        }

        // Huntability corridor SPINE lines (flow direction + click targets)
        if (!map.getSource('tfp-huntability-corridors')) {
          map.addSource('tfp-huntability-corridors', { type: 'geojson', data: EMPTY_FC });
          // Primary corridors: thin spine lines
          map.addLayer({
            id: 'tfp-huntability-corridors-primary',
            type: 'line',
            source: 'tfp-huntability-corridors',
            filter: ['==', ['get', 'tier'], 'primary'],
            layout: { visibility: 'none' },
            paint: {
              'line-color': '#5d5244',    // Dark earth
              'line-width': 2,
              'line-opacity': 0.55,
            },
          });
          // Secondary corridors: thinner, dashed
          map.addLayer({
            id: 'tfp-huntability-corridors-secondary',
            type: 'line',
            source: 'tfp-huntability-corridors',
            filter: ['==', ['get', 'tier'], 'secondary'],
            layout: { visibility: 'none' },
            paint: {
              'line-color': '#8b7d6b',    // Medium earth
              'line-width': 1.5,
              'line-opacity': 0.40,
              'line-dasharray': [4, 2],
            },
          });
        }
        
        // Huntability convergence nodes (where corridors meet)
        if (!map.getSource('tfp-huntability-convergence')) {
          map.addSource('tfp-huntability-convergence', { type: 'geojson', data: EMPTY_FC });
          // Outer glow
          map.addLayer({
            id: 'tfp-huntability-convergence-glow',
            type: 'circle',
            source: 'tfp-huntability-convergence',
            layout: { visibility: 'none' }, // Toggle on for debug
            paint: {
              'circle-radius': ['*', ['get', 'intensity'], 25],
              'circle-color': '#f59e0b', // Amber-500
              'circle-opacity': 0.30,
              'circle-blur': 0.8,
            },
          });
          // Inner node marker
          map.addLayer({
            id: 'tfp-huntability-convergence',
            type: 'circle',
            source: 'tfp-huntability-convergence',
            layout: { visibility: 'none' }, // Toggle on for debug
            paint: {
              'circle-radius': 8,
              'circle-color': '#f59e0b', // Amber-500
              'circle-opacity': 0.90,
              'circle-stroke-color': '#fff',
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.95,
            },
          });
        }
        
        // ========== v3.6.1: BEDDING PROBABILITY LAYER ==========
        // Muted earthy/plum tones — tighter, high-confidence pockets (not scattered circles)
        if (!map.getSource('tfp-bedding-probability')) {
          map.addSource('tfp-bedding-probability', { type: 'geojson', data: EMPTY_FC });
          // v3.7: Outer glow — ultra-soft ambient halo
          map.addLayer({
            id: 'tfp-bedding-probability-glow',
            type: 'circle',
            source: 'tfp-bedding-probability',
            layout: { visibility: 'none' },
            paint: {
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'beddingScore'],
                0.55, ['match', ['get', 'beddingType'], 'sanctuary', 22, 'staging', 14, 18],
                0.75, ['match', ['get', 'beddingType'], 'sanctuary', 30, 'staging', 18, 24],
                1.0,  ['match', ['get', 'beddingType'], 'sanctuary', 38, 'staging', 22, 30],
              ] as any,
              'circle-color': [
                'match', ['get', 'beddingType'],
                'sanctuary', '#1a5c2a',
                '#2d6a4f',
              ] as any,
              'circle-opacity': 0.06,
              'circle-blur': 1.8,
            },
          });
          // v3.7: Inner fill — softened data-driven colors by bedding type
          map.addLayer({
            id: 'tfp-bedding-probability-fill',
            type: 'circle',
            source: 'tfp-bedding-probability',
            layout: { visibility: 'none' },
            paint: {
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'beddingScore'],
                0.55, ['match', ['get', 'beddingType'], 'sanctuary', 12, 'staging', 8, 10],
                0.75, ['match', ['get', 'beddingType'], 'sanctuary', 18, 'staging', 12, 14],
                1.0,  ['match', ['get', 'beddingType'], 'sanctuary', 24, 'staging', 14, 20],
              ] as any,
              'circle-color': [
                'match', ['get', 'beddingType'],
                'sanctuary', '#1a5c2a',
                'thermal',   '#52b788',
                'staging',   '#95d5b2',
                'escape',    '#74c69d',
                '#52b788',
              ] as any,
              'circle-opacity': [
                'match', ['get', 'beddingType'],
                'sanctuary', 0.28,
                'thermal',   0.20,
                'staging',   0.15,
                'escape',    0.18,
                0.20,
              ] as any,
              'circle-blur': 1.2,
            },
          });
          // v3.7: Outline ring — disabled (hard edges removed)
          map.addLayer({
            id: 'tfp-bedding-probability-outline',
            type: 'circle',
            source: 'tfp-bedding-probability',
            layout: { visibility: 'none' },
            paint: {
              'circle-radius': 0,
              'circle-color': 'transparent',
              'circle-stroke-width': 0,
              'circle-stroke-opacity': 0,
            },
          });
        }
        
        // ========== EDGE INTELLIGENCE SOURCES AND LAYERS ==========
        // ALL HIDDEN in Terrain Work Mode (deer interpretation)
        
        // Corridor continuation arrows
        if (!map.getSource('tfp-edge-arrows')) {
          map.addSource('tfp-edge-arrows', { type: 'geojson', data: EMPTY_FC });
          // Arrow lines (faded)
          map.addLayer({
            id: 'tfp-edge-arrows-lines',
            type: 'line',
            source: 'tfp-edge-arrows',
            filter: ['==', ['get', 'type'], 'corridor_continuation'],
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.edgeCorridorArrow,
              'line-width': 4,
              'line-opacity': 0.5,
              'line-dasharray': [2, 1],
            },
          });
          // Arrow heads
          map.addLayer({
            id: 'tfp-edge-arrows-heads',
            type: 'fill',
            source: 'tfp-edge-arrows',
            filter: ['==', ['get', 'type'], 'corridor_arrow_head'],
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'fill-color': LAYER_COLORS.edgeCorridorArrow,
              'fill-opacity': 0.6,
            },
          });
        }
        
        // Ghost bedding silhouettes
        if (!map.getSource('tfp-edge-ghost')) {
          map.addSource('tfp-edge-ghost', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-edge-ghost-fill',
            type: 'fill',
            source: 'tfp-edge-ghost',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'fill-color': LAYER_COLORS.edgeGhostBedding,
              'fill-opacity': 0.15,
            },
          });
          map.addLayer({
            id: 'tfp-edge-ghost-outline',
            type: 'line',
            source: 'tfp-edge-ghost',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.edgeGhostBedding,
              'line-width': 2,
              'line-opacity': 0.4,
              'line-dasharray': [4, 2],
            },
          });
        }
        
        // Ghost saddle silhouettes (pinch points extending beyond boundary)
        if (!map.getSource('tfp-edge-ghost-saddles')) {
          map.addSource('tfp-edge-ghost-saddles', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-edge-ghost-saddles-fill',
            type: 'fill',
            source: 'tfp-edge-ghost-saddles',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'fill-color': LAYER_COLORS.edgeGhostSaddle,
              'fill-opacity': 0.2,
            },
          });
          map.addLayer({
            id: 'tfp-edge-ghost-saddles-outline',
            type: 'line',
            source: 'tfp-edge-ghost-saddles',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.edgeGhostSaddle,
              'line-width': 2,
              'line-opacity': 0.5,
              'line-dasharray': [3, 2],
            },
          });
        }
        
        // Draw extensions (drainage/terrain channels extending beyond boundary)
        if (!map.getSource('tfp-edge-draw-extensions')) {
          map.addSource('tfp-edge-draw-extensions', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-edge-draw-extensions-lines',
            type: 'line',
            source: 'tfp-edge-draw-extensions',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.edgeDrawExtension,
              'line-width': 3,
              'line-opacity': 0.5,
              'line-dasharray': [3, 2],
            },
          });
        }
        
        // Pressure direction arrows
        if (!map.getSource('tfp-edge-pressure')) {
          map.addSource('tfp-edge-pressure', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-edge-pressure-lines',
            type: 'line',
            source: 'tfp-edge-pressure',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'direction'], 'inbound'], LAYER_COLORS.edgePressureInbound,
                LAYER_COLORS.edgePressureOutbound
              ],
              'line-width': 5,
              'line-opacity': 0.7,
            },
          });
        }
        
        // ========== v3.5.1 — ADJACENT PARCEL CONTEXT LINES (cool gray, faint) ==========
        // Thin cool gray/blue-gray stroke (~1-1.5px) for neighboring ownership context
        if (!map.getSource('tfp-edge-boundary')) {
          map.addSource('tfp-edge-boundary', { type: 'geojson', data: EMPTY_FC });
          // Invisible fill for click/hover detection
          map.addLayer({
            id: 'tfp-edge-boundary-fill',
            type: 'fill',
            source: 'tfp-edge-boundary',
            paint: {
              'fill-color': LAYER_COLORS.edgeBoundaryHighlight,
              'fill-opacity': 0, // Invisible by default
            },
          });
          // v3.5.1 — Always-visible faint context lines for adjacent parcels
          map.addLayer({
            id: 'tfp-edge-boundary-context',
            type: 'line',
            source: 'tfp-edge-boundary',
            paint: {
              'line-color': LAYER_COLORS.adjacentParcel, // Cool gray/blue-gray
              'line-width': 1.25,         // Thin ~1-1.5px
              'line-opacity': 0.45,       // Faint but readable
            },
          });
          // v3.8.3 — Highlight layer: uses layout visibility toggle instead of paint
          // property animation to avoid Mapbox repaint cascades on hover
          map.addLayer({
            id: 'tfp-edge-boundary-highlight',
            type: 'line',
            source: 'tfp-edge-boundary',
            layout: { visibility: 'none' }, // v3.8.3 — hidden via layout, not paint
            paint: {
              'line-color': LAYER_COLORS.edgeBoundaryHighlight,
              'line-width': 3,       // v3.8.3 — always 3px when visible
              'line-opacity': 0.6,
            },
          });
        }
        
        console.log('[MAP] Edge intelligence sources created');

        // ========== ADJACENT PARCELS SOURCE + LAYERS ==========
        if (!map.getSource('tfp-adjacent-parcels')) {
          map.addSource('tfp-adjacent-parcels', { type: 'geojson', data: EMPTY_FC });
          // Semi-transparent fill
          map.addLayer({
            id: 'tfp-adjacent-parcels-fill',
            type: 'fill',
            source: 'tfp-adjacent-parcels',
            paint: {
              'fill-color': '#94a3b8', // slate-400
              'fill-opacity': 0.08,
            },
          });
          // Outline
          map.addLayer({
            id: 'tfp-adjacent-parcels-outline',
            type: 'line',
            source: 'tfp-adjacent-parcels',
            paint: {
              'line-color': '#94a3b8',
              'line-width': 1.5,
              'line-opacity': 0.5,
              'line-dasharray': [4, 2],
            },
          });
          // Hover highlight layer (toggled via layout visibility by mousemove handler)
          map.addLayer({
            id: 'tfp-adjacent-parcels-hover',
            type: 'line',
            source: 'tfp-adjacent-parcels',
            layout: { visibility: 'none' },
            paint: {
              'line-color': '#60a5fa', // blue-400
              'line-width': 2.5,
              'line-opacity': 0.8,
            },
          });
          console.log('[MAP] Adjacent parcels source + layers created');
        }
        
        overlaySourcesCreated.current = true;
        console.log('[MAP] Native Mapbox sources created successfully');
        
        // ========== v3.5.1 — TOPO/CONTOUR LINE RESTYLING ==========
        // Override satellite-streets-v12 built-in contour lines to be muted tan/slate
        // so they read as terrain reference and don't resemble parcel boundaries
        const contourLayers = [
          'contour-label', 'contour-line'
        ];
        contourLayers.forEach(layerId => {
          if (map.getLayer(layerId)) {
            try {
              // Mute contour lines to tan/slate, thin width (~1px)
              if (layerId === 'contour-line') {
                map.setPaintProperty(layerId, 'line-color', LAYER_COLORS.contourRegular);
                map.setPaintProperty(layerId, 'line-width', 0.8);
                map.setPaintProperty(layerId, 'line-opacity', 0.4);
              }
              if (layerId === 'contour-label') {
                map.setPaintProperty(layerId, 'text-color', LAYER_COLORS.contourIndex);
                map.setPaintProperty(layerId, 'text-opacity', 0.5);
              }
              console.log(`[MAP] Restyled contour layer: ${layerId}`);
            } catch (err) {
              console.warn(`[MAP] Could not restyle ${layerId}:`, err);
            }
          }
        });
        
        // ========== v3.5.1 — LAYER HIERARCHY / Z-ORDER ==========
        // Ensure proper visual stacking:
        // 1. Aerial imagery & hillshade (base style)
        // 2. Topo/contour lines (muted, restyled above)
        // 3. Adjacent parcel context lines
        // 4. Selected parcel boundary (gold glow + dashed line)
        // 5. Terrain structure layers (bedding, draws, saddles)
        // 6. Pressure/corridor surfaces (heatmap)
        // 7. Animated primary flow lines
        // 8. Convergence nodes
        // 9. Stand site markers (HTML, always on top)
        
        // Move layers to ensure proper ordering
        const layerOrder = [
          // Base terrain reference (lowest)
          'tfp-edge-boundary-fill',        // Invisible fill for click/hover detection
          'tfp-edge-boundary-context',     // Adjacent parcel context lines
          'tfp-edge-boundary-highlight',   // Hover highlight for adjacent parcels
          'tfp-parcel-glow',               // Selected parcel glow (below main line)
          'tfp-parcel-outline',            // Selected parcel boundary
          // Terrain structure
          'tfp-bedding-fill',
          'tfp-bedding-outline',
          'tfp-funnels-lines-draws',
          'tfp-funnels-polys-fill',
          'tfp-funnels-polys-outline',
          // Corridors & funnels (V4 Step 10: casing + core)
          'tfp-corridors-primary-casing',  // Glow casing below core
          'tfp-corridors-primary',
          'tfp-corridors-possible',
          'tfp-corridors-exploratory',
          // Pressure polygon fill grid (new primary visual)
          'tfp-pressure-fill',
          // Pressure heatmap (disabled — kept for comparison)
          'tfp-pressure-heatmap',
          // Movement delta (damage map)
          'tfp-movement-delta',
          // Movement post (remaining movement)
          'tfp-movement-post',
          // Refuge zones (low pressure + high movement)
          'tfp-refuge-zones',
          // Ridge spines
          'tfp-ridges-primary-casing',
          'tfp-ridges-primary',
          'tfp-ridges-secondary-casing',
          'tfp-ridges-secondary',
          // Hunt pockets + stand movement-axis wedges (v1.1)
          'tfp-hunt-pockets-fill',
          'tfp-hunt-pockets-stroke',
          'tfp-stand-direction-flank',   // v1.1 — flow-axis wedge flanks
          'tfp-stand-direction-main',    // v1.1 — flow-axis wedge main vector
          'tfp-stand-tertiary-dot',      // v1.1 — faint tertiary stand dots
          // Flow lines (animated) — v3.5.1
          'tfp-stand-emphasis-glow',     // v3.8.1 — soft glow bias for top stand (below flow)
          'tfp-flow-secondary',
          'tfp-flow-primary-glow',      // Animated glow below main line
          'tfp-flow-nearest-highlight', // Nearest corridor to selected stand (amber glow)
          'tfp-flow-primary',
          'tfp-flow-direction-chevrons', // v3.8.1 — directional chevrons along flow
          // Convergence (top — convergence IS opportunity)
          'tfp-flow-convergence-pulse',
          'tfp-flow-convergence',
          'tfp-huntability-convergence-glow',
          'tfp-huntability-convergence',
          // vNext: GeoJSON stand layers (highest z-index — above all terrain)
          'tfp-stands-glow',
          'tfp-stands-disc',
          'tfp-stands-reticle',
          'tfp-stands-center',
          'tfp-stands-label',
          'tfp-stands-rank',
        ];
        
        // Move layers in order (later = higher z-index)
        let prevLayerId: string | undefined;
        layerOrder.forEach(layerId => {
          if (map.getLayer(layerId)) {
            try {
              if (prevLayerId && map.getLayer(prevLayerId)) {
                // Move this layer above the previous one
                map.moveLayer(layerId);
              }
              prevLayerId = layerId;
            } catch (err) {
              // Layer ordering is best-effort
            }
          }
        });
        console.log('[MAP] v3.5.1 layer hierarchy applied');
        
        // ========== HOVER INTERACTIONS FOR FEATURE INFO ==========
        // Create a reusable popup for hover info
        const hoverPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: '300px',
          className: 'intel-hover-popup'
        });
        
        // Bedding hover
        map.on('mouseenter', 'tfp-bedding-fill', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const props = e.features[0].properties || {};
            const html = `
              <div style="padding: 8px; font-size: 13px;">
                <div style="font-weight: bold; color: #22C55E; margin-bottom: 6px;">
                  🛏️ ${(props.type || 'Bedding Area').replace(/_/g, ' ').toUpperCase()}
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  ${props.areaAcres ? `<div>Area: <b>${Number(props.areaAcres).toFixed(2)} acres</b></div>` : ''}
                  ${props.aspect ? `<div>Aspect: <b>${props.aspect}</b></div>` : ''}
                  ${props.slopeRange ? `<div>Slope: <b>${props.slopeRange}°</b></div>` : ''}
                  ${props.confidence ? `<div>Confidence: <b>${Math.round(Number(props.confidence) * 100)}%</b></div>` : ''}
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
        map.on('mouseleave', 'tfp-bedding-fill', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
        
        // Funnel lines hover (draws) - blue
        map.on('mouseenter', 'tfp-funnels-lines-draws', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const props = e.features[0].properties || {};
            const html = `
              <div style="padding: 8px; font-size: 13px;">
                <div style="font-weight: bold; color: #3B82F6; margin-bottom: 6px;">
                  💧 DRAW / DRAINAGE
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  ${props.flowAccumulation ? `<div>Flow: <b>${props.flowAccumulation}</b></div>` : ''}
                  ${props.corridorScore ? `<div>Corridor Score: <b>${Math.round(Number(props.corridorScore) * 100)}%</b></div>` : ''}
                  ${props.connectsBeddingToFood !== undefined ? `<div>Bedding→Food: <b>${props.connectsBeddingToFood ? 'Yes' : 'No'}</b></div>` : ''}
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
        map.on('mouseleave', 'tfp-funnels-lines-draws', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
        
        // Corridor lines hover (travel corridors) - helper function
        const handleCorridorHover = (e: mapboxgl.MapLayerMouseEvent) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const props = e.features[0].properties || {};
            const score = Number(props.corridorScore) || 0.5;
            const tier = score >= 0.7 ? 'HIGH CONFIDENCE' : score >= 0.4 ? 'MEDIUM' : 'LOW CONFIDENCE';
            const tierColor = score >= 0.7 ? LAYER_COLORS.corridorHigh : score >= 0.4 ? LAYER_COLORS.corridorMed : LAYER_COLORS.corridorLow;
            const lineStyle = score < 0.4 ? ' (dashed)' : ' (solid)';
            const html = `
              <div style="padding: 8px; font-size: 13px;">
                <div style="font-weight: bold; color: ${tierColor}; margin-bottom: 6px;">
                  🦌 ${tier} CORRIDOR${lineStyle}
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  <div>Confidence: <b style="color: ${tierColor}">${Math.round(score * 100)}%</b></div>
                  ${props.connectsBeddingToFood !== undefined ? `<div>Bedding→Food: <b>${props.connectsBeddingToFood ? 'Yes' : 'No'}</b></div>` : ''}
                  ${props.leastCostPath !== undefined ? `<div>Primary Path: <b>${props.leastCostPath ? 'Yes' : 'No'}</b></div>` : ''}
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        };
        const handleCorridorLeave = () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        };
        
        // Attach hover to both solid and dashed corridor layers
        map.on('mouseenter', 'tfp-funnels-lines-corridors-solid', handleCorridorHover);
        map.on('mouseleave', 'tfp-funnels-lines-corridors-solid', handleCorridorLeave);
        map.on('mouseenter', 'tfp-funnels-lines-corridors-dashed', handleCorridorHover);
        map.on('mouseleave', 'tfp-funnels-lines-corridors-dashed', handleCorridorLeave);
        
        // Funnel polygons hover (saddles)
        map.on('mouseenter', 'tfp-funnels-polys-fill', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const props = e.features[0].properties || {};
            const html = `
              <div style="padding: 8px; font-size: 13px;">
                <div style="font-weight: bold; color: #EA580C; margin-bottom: 6px;">
                  🎯 ${(props.funnelType || 'Pinch Point').toUpperCase()}
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  ${props.narrowestWidthMeters ? `<div>Narrowest: <b>${Math.round(Number(props.narrowestWidthMeters))}m</b></div>` : ''}
                  ${props.corridorScore ? `<div>Corridor Score: <b>${Math.round(Number(props.corridorScore) * 100)}%</b></div>` : ''}
                  ${props.connectsBeddingToFood !== undefined ? `<div>Bedding→Food: <b>${props.connectsBeddingToFood ? 'Yes' : 'No'}</b></div>` : ''}
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
        map.on('mouseleave', 'tfp-funnels-polys-fill', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
        
        // ========== EDGE INTELLIGENCE HOVER INTERACTIONS ==========
        
        // Corridor continuation arrows hover
        map.on('mouseenter', 'tfp-edge-arrows-lines', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const html = `
              <div style="padding: 10px; font-size: 13px; max-width: 220px;">
                <div style="font-weight: bold; color: ${LAYER_COLORS.edgeCorridorArrow}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 16px;">→</span> Travel Continues
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  This corridor extends beyond your property line.
                </div>
                <div style="margin-top: 8px; padding: 6px 10px; background: ${LAYER_COLORS.edgeCorridorArrow}20; border-radius: 6px; color: #fff; font-size: 11px; font-weight: 500;">
                  🔓 Unlock adjacent parcel to see full route
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
        map.on('mouseleave', 'tfp-edge-arrows-lines', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
        
        // Ghost bedding hover
        map.on('mouseenter', 'tfp-edge-ghost-fill', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const html = `
              <div style="padding: 10px; font-size: 13px; max-width: 220px;">
                <div style="font-weight: bold; color: ${LAYER_COLORS.edgeGhostBedding}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 16px;">🛏️</span> External Bedding Detected
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  Probable bedding area on adjacent property influencing deer movement on yours.
                </div>
                <div style="margin-top: 8px; padding: 6px 10px; background: ${LAYER_COLORS.edgeGhostBedding}20; border-radius: 6px; color: #fff; font-size: 11px; font-weight: 500;">
                  🔓 Unlock adjacent parcel for full intel
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
        map.on('mouseleave', 'tfp-edge-ghost-fill', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
        
        // Ghost saddle hover (pinch points on adjacent property)
        map.on('mouseenter', 'tfp-edge-ghost-saddles-fill', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const props = e.features[0].properties || {};
            const html = `
              <div style="padding: 10px; font-size: 13px; max-width: 220px;">
                <div style="font-weight: bold; color: ${LAYER_COLORS.edgeGhostSaddle}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 16px;">🎯</span> External Pinch Point
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  Terrain saddle continues onto adjacent property — a natural funnel for deer movement.
                  ${props.narrowestWidth ? `<div style="margin-top: 4px;">Est. width: ~${Math.round(props.narrowestWidth)}m</div>` : ''}
                </div>
                <div style="margin-top: 8px; padding: 6px 10px; background: ${LAYER_COLORS.edgeGhostSaddle}20; border-radius: 6px; color: #fff; font-size: 11px; font-weight: 500;">
                  🔓 Unlock adjacent parcel for full saddle intel
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
        map.on('mouseleave', 'tfp-edge-ghost-saddles-fill', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
        
        // Draw extension hover (drainage channels extending beyond boundary)
        map.on('mouseenter', 'tfp-edge-draw-extensions-lines', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const props = e.features[0].properties || {};
            const isInbound = props.direction === 'inbound';
            const html = `
              <div style="padding: 10px; font-size: 13px; max-width: 220px;">
                <div style="font-weight: bold; color: ${LAYER_COLORS.edgeDrawExtension}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 16px;">💧</span> Draw Continues
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  ${isInbound 
                    ? 'This terrain draw flows into your property from adjacent land — deer likely use this natural travel route.'
                    : 'This terrain draw flows from your property to adjacent land — understanding where it leads can reveal movement patterns.'
                  }
                </div>
                <div style="margin-top: 8px; padding: 6px 10px; background: ${LAYER_COLORS.edgeDrawExtension}20; border-radius: 6px; color: #fff; font-size: 11px; font-weight: 500;">
                  🔓 Unlock adjacent parcel for complete draw mapping
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
        map.on('mouseleave', 'tfp-edge-draw-extensions-lines', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
        
        // Pressure arrows hover
        map.on('mouseenter', 'tfp-edge-pressure-lines', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (e.features && e.features[0]) {
            const props = e.features[0].properties || {};
            const isInbound = props.direction === 'inbound';
            const color = isInbound ? LAYER_COLORS.edgePressureInbound : LAYER_COLORS.edgePressureOutbound;
            const html = `
              <div style="padding: 10px; font-size: 13px; max-width: 220px;">
                <div style="font-weight: bold; color: ${color}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 16px;">${isInbound ? '↘️' : '↗️'}</span> 
                  ${isInbound ? 'Inbound Pressure' : 'Outbound Pressure'}
                </div>
                <div style="color: #ccc; line-height: 1.5;">
                  ${isInbound 
                    ? 'Movement likely originates from adjacent property.' 
                    : 'Deer from your parcel likely continue to adjacent property.'
                  }
                </div>
                <div style="margin-top: 8px; padding: 6px 10px; background: ${color}20; border-radius: 6px; color: #fff; font-size: 11px; font-weight: 500;">
                  🔓 Unlock adjacent parcel for complete picture
                </div>
              </div>
            `;
            hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
        map.on('mouseleave', 'tfp-edge-pressure-lines', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
        
        // v3.8.3 — Adjacent boundary hover: uses layout visibility toggle
        // instead of setPaintProperty to avoid Mapbox repaint cascades
        map.on('mouseenter', 'tfp-edge-boundary-fill', () => {
          map.getCanvas().style.cursor = 'pointer';
          if (map.getLayer('tfp-edge-boundary-highlight')) {
            map.setLayoutProperty('tfp-edge-boundary-highlight', 'visibility', 'visible');
          }
        });
        map.on('mouseleave', 'tfp-edge-boundary-fill', () => {
          map.getCanvas().style.cursor = '';
          if (map.getLayer('tfp-edge-boundary-highlight')) {
            map.setLayoutProperty('tfp-edge-boundary-highlight', 'visibility', 'none');
          }
        });
        
        console.log('[MAP] Hover interactions registered');
        console.log('[MAP] Edge intelligence interactions registered');
        
        // ========== EDGE INTELLIGENCE CLICK HANDLERS ==========
        // These trigger the unlock modal for adjacent parcels
        
        const handleEdgeClick = (e: mapboxgl.MapLayerMouseEvent, edgeType: 'corridor' | 'bedding' | 'saddle' | 'draw' | 'pressure' | 'boundary') => {
          if (!e.features || !e.features[0]) return;
          
          const props = e.features[0].properties || {};
          const bearing = props.bearing || props.direction === 'inbound' ? 180 : 0;
          
          // Store click data and show modal
          // We'll dispatch a custom event that React can listen to
          const detail = {
            edgeType,
            lngLat: [e.lngLat.lng, e.lngLat.lat] as [number, number],
            segmentBearing: bearing
          };
          window.dispatchEvent(new CustomEvent('tfp-edge-click', { detail }));
        };
        
        // Click handlers for each edge layer
        map.on('click', 'tfp-edge-arrows-lines', (e) => handleEdgeClick(e, 'corridor'));
        map.on('click', 'tfp-edge-arrows-heads', (e) => handleEdgeClick(e, 'corridor'));
        map.on('click', 'tfp-edge-ghost-fill', (e) => handleEdgeClick(e, 'bedding'));
        map.on('click', 'tfp-edge-ghost-saddles-fill', (e) => handleEdgeClick(e, 'saddle'));
        map.on('click', 'tfp-edge-draw-extensions-lines', (e) => handleEdgeClick(e, 'draw'));
        map.on('click', 'tfp-edge-pressure-lines', (e) => handleEdgeClick(e, 'pressure'));
        map.on('click', 'tfp-edge-boundary-fill', (e) => handleEdgeClick(e, 'boundary'));
        
        console.log('[MAP] Edge intelligence click handlers registered');

        // ========== ADJACENT PARCELS CLICK + HOVER HANDLERS ==========
        map.on('click', 'tfp-adjacent-parcels-fill', (e) => {
          // TERRITORY FIREWALL: During territory mode, adjacent parcel clicks are
          // handled by the pick handler — don't dispatch the adjacent event.
          if (territoryModeRef.current) return;
          if (!e.features || !e.features[0]) return;
          const props = e.features[0].properties || {};
          const detail = {
            parcelId: props.parcelId || '',
            address: props.address || 'Unknown',
            owner: props.owner || 'Unknown',
            acreage: parseFloat(props.acreage) || 0,
            county: props.county || '',
            state: props.state || '',
            screenX: e.point.x,
            screenY: e.point.y,
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
          };
          window.dispatchEvent(new CustomEvent('tfp-adjacent-parcel-click', { detail }));
        });
        map.on('mouseenter', 'tfp-adjacent-parcels-fill', () => {
          if (territoryModeRef.current) return; // TERRITORY FIREWALL
          map.getCanvas().style.cursor = 'pointer';
          if (map.getLayer('tfp-adjacent-parcels-hover')) {
            map.setLayoutProperty('tfp-adjacent-parcels-hover', 'visibility', 'visible');
          }
        });
        map.on('mouseleave', 'tfp-adjacent-parcels-fill', () => {
          if (territoryModeRef.current) return; // TERRITORY FIREWALL
          map.getCanvas().style.cursor = '';
          if (map.getLayer('tfp-adjacent-parcels-hover')) {
            map.setLayoutProperty('tfp-adjacent-parcels-hover', 'visibility', 'none');
          }
        });

        // ========== TERRAIN FLOW CLICK HANDLERS ==========
        // Flow segment click - triggers inspector panel
        const handleFlowSegmentClick = (e: mapboxgl.MapLayerMouseEvent, tier: 'primary' | 'secondary') => {
          if (!e.features || !e.features[0]) return;
          
          const feature = e.features[0];
          const props = feature.properties || {};
          const geometry = feature.geometry as GeoJSON.LineString;
          
          if (!geometry || geometry.type !== 'LineString') return;
          
          const segmentId = props.id || `flow_${tier}_${Date.now()}`;
          const coordinates = geometry.coordinates as [number, number][];
          
          // Dispatch event for React to handle
          window.dispatchEvent(new CustomEvent('tfp-flow-segment-click', {
            detail: {
              segmentId,
              coordinates,
              tier,
              likelihood: props.likelihood || 0.5,
              screenX: e.point.x,
              screenY: e.point.y,
            }
          }));
        };
        
        // Register flow click handlers
        map.on('click', 'tfp-flow-primary', (e) => handleFlowSegmentClick(e, 'primary'));
        map.on('click', 'tfp-flow-secondary', (e) => handleFlowSegmentClick(e, 'secondary'));
        
        // v3.6.1: Bedding probability click handler (for terrain reasons)
        const handleBeddingClick = (e: mapboxgl.MapLayerMouseEvent) => {
          if (!e.features || !e.features[0]) return;
          const props = e.features[0].properties || {};
          const coords = (e.features[0].geometry as GeoJSON.Point).coordinates;
          
          window.dispatchEvent(new CustomEvent('tfp-bedding-click', {
            detail: {
              id: props.id,
              beddingScore: props.beddingScore || 0.5,
              beddingType: props.beddingType || 'thermal',
              upperSlope: props.upperSlope || 0,
              solarAspect: props.solarAspect || 0,
              ridgeDistance: props.ridgeDistance || 0,
              slopeSuitability: props.slopeSuitability || 0,
              terrainShelter: props.terrainShelter || 0,
              corridorOffset: props.corridorOffset || 0,
              humanPressure: props.humanPressure || 0,
              radiusM: props.radiusM || 35,
              lng: coords[0],
              lat: coords[1],
              screenX: e.point.x,
              screenY: e.point.y,
            }
          }));
        };
        
        map.on('click', 'tfp-bedding-probability-fill', handleBeddingClick);
        map.on('click', 'tfp-bedding-probability-glow', handleBeddingClick);
        
        // Cursor changes for clickable layers
        const flowLayers = ['tfp-flow-primary', 'tfp-flow-secondary', 'tfp-bedding-probability-fill', 'tfp-bedding-probability-glow'];
        flowLayers.forEach(layerId => {
          map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
        });
        
        console.log('[MAP] Terrain flow click handlers registered');
        
      } catch (sourceErr) {
        console.error('[MAP] Source/layer setup failed (non-fatal):', sourceErr);
        // Continue anyway - panels must render even if map overlays fail
      }
      
      // v3.8.4 — Diagnostic: log layer/source count after setup
      try {
        if (map.isStyleLoaded()) {
          const style = map.getStyle();
          console.log('[MAP DIAG] After layer setup — sources:', Object.keys(style?.sources || {}).length, 'layers:', (style?.layers || []).length);
        } else {
          console.error('[INTEL-DIAG] getStyle skipped — style not loaded yet');
        }
      } catch (_) { /* ignore */ }

      // ========== v3.9.0 — Custom Sit Pins: green pin source + layers ==========
      try {
        // Draw a teardrop pin onto an off-screen canvas, register it as a map image.
        // Green theme: emerald fill, white stroke, subtle drop-shadow via blur.
        if (!map.hasImage('tfp-sit-pin')) {
          const size = 64;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Shadow (soft)
            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetY = 2;

            // Teardrop body (classic pin outline)
            ctx.beginPath();
            const cx = size / 2;
            const topY = 6;
            const tipY = size - 3;
            const bodyR = 14;
            const bodyCY = topY + bodyR;
            ctx.moveTo(cx, tipY);
            // right curve to top
            ctx.bezierCurveTo(cx + bodyR + 4, bodyCY + 6, cx + bodyR, topY, cx, topY);
            // left curve down to tip
            ctx.bezierCurveTo(cx - bodyR, topY, cx - bodyR - 4, bodyCY + 6, cx, tipY);
            ctx.closePath();

            // Green fill (emerald gradient)
            const grad = ctx.createLinearGradient(cx, topY, cx, tipY);
            grad.addColorStop(0, '#34d399');   // emerald-400
            grad.addColorStop(1, '#047857');   // emerald-700
            ctx.fillStyle = grad;
            ctx.fill();

            // White outline
            ctx.shadowColor = 'transparent';
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();

            // Inner dot (white)
            ctx.beginPath();
            ctx.arc(cx, bodyCY, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            // Register with map (pixelRatio 2 so it stays crisp on retina at ~32px rendered)
            const imgData = ctx.getImageData(0, 0, size, size);
            map.addImage('tfp-sit-pin', imgData as unknown as ImageData, { pixelRatio: 2 });
            console.log('[SitPin] Registered tfp-sit-pin image');
          }
        }

        if (!map.getSource('tfp-user-sit-pins')) {
          map.addSource('tfp-user-sit-pins', { type: 'geojson', data: EMPTY_FC });

          // Subtle green glow underneath the pin
          map.addLayer({
            id: 'tfp-user-sit-pins-glow',
            type: 'circle',
            source: 'tfp-user-sit-pins',
            paint: {
              'circle-radius': 16,
              'circle-color': '#34d399',
              'circle-opacity': 0.18,
              'circle-blur': 0.8,
            },
          });

          // Pin icon itself (centered so the tip sits on the coordinate)
          map.addLayer({
            id: 'tfp-user-sit-pins-icon',
            type: 'symbol',
            source: 'tfp-user-sit-pins',
            layout: {
              'icon-image': 'tfp-sit-pin',
              'icon-size': 0.75,
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
          });

          // Static name label (shown always, small) — hover shows a richer popup.
          // Sized smaller than AI stand labels so it reads as "user content".
          map.addLayer({
            id: 'tfp-user-sit-pins-label',
            type: 'symbol',
            source: 'tfp-user-sit-pins',
            layout: {
              'text-field': ['get', 'name'],
              'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
              'text-size': 10,
              'text-offset': [0, 0.6],
              'text-anchor': 'top',
              'text-allow-overlap': false,
              'text-optional': true,
              'text-letter-spacing': 0.02,
            },
            paint: {
              'text-color': '#ecfdf5',       // emerald-50
              'text-halo-color': '#064e3b',  // emerald-900
              'text-halo-width': 1.2,
              'text-halo-blur': 0.3,
              'text-opacity': 0.85,
            },
          });
        }

        // Hover → richer popup with the pin's name
        const sitPinHoverPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: [0, -32],
          className: 'tfp-sit-pin-popup',
        });

        const onSitPinEnter = (e: mapboxgl.MapLayerMouseEvent) => {
          map.getCanvas().style.cursor = 'pointer';
          const f = e.features && e.features[0];
          const name = String((f?.properties as any)?.name || '');
          if (!name) return;
          const geom = f?.geometry as GeoJSON.Point | undefined;
          const coords = geom?.coordinates as [number, number] | undefined;
          if (!coords) return;
          const safeName = name.replace(/[<>&"']/g, (c) =>
            ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] || c)
          );
          const html = `
            <div style="
              font-family: system-ui, -apple-system, sans-serif;
              background: #064e3b;
              color: #ecfdf5;
              border: 1px solid #059669;
              border-radius: 6px;
              padding: 5px 10px;
              font-size: 12px;
              font-weight: 600;
              white-space: nowrap;
              box-shadow: 0 4px 14px rgba(0,0,0,0.4);
            ">📍 ${safeName}</div>`;
          sitPinHoverPopup
            .setLngLat(coords as [number, number])
            .setHTML(html)
            .addTo(map);
        };

        const onSitPinLeave = () => {
          map.getCanvas().style.cursor = '';
          sitPinHoverPopup.remove();
        };

        map.on('mouseenter', 'tfp-user-sit-pins-icon', onSitPinEnter);
        map.on('mouseleave', 'tfp-user-sit-pins-icon', onSitPinLeave);

        // Left-click an existing green Sit Pin → open Stand Journal modal.
        // Layer-specific click fires before the map-wide click handler that
        // clears the right-click context menu, so the two don't interfere.
        map.on('click', 'tfp-user-sit-pins-icon', (e: mapboxgl.MapLayerMouseEvent) => {
          const f = e.features && e.features[0];
          const id = String((f?.properties as any)?.id || '');
          const name = String((f?.properties as any)?.name || '');
          if (!id || !name) return;
          // Tier gate — Stand Journal is Pro-only
          if (!isProRef.current) {
            toast('Upgrade to Pro to access Stand Journal');
            return;
          }
          console.log('[StandJournal] Pin clicked:', id, name);
          setJournalPin({ id, name });
        });
      } catch (sitPinLayerErr) {
        console.warn('[SitPin] layer setup failed:', sitPinLayerErr);
      }

      // ========== v3.9.0 — Custom Sit Pins: right-click (desktop) + long-press (mobile) ==========
      try {
        const openSitPinMenu = (viewportX: number, viewportY: number, lng: number, lat: number) => {
          setSitPinMenu({
            x: viewportX,
            y: viewportY,
            lng,
            lat,
            gated: !isProRef.current,
          });
        };

        // Desktop: right-click
        map.on('contextmenu', (e: mapboxgl.MapMouseEvent) => {
          // Suppress the browser's native right-click menu so our custom
          // Sit Pin menu is the only thing the user sees.
          try { e.originalEvent?.preventDefault?.(); } catch (_) {}
          console.log('[SitPin] contextmenu fired', {
            isPro: isProRef.current,
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
          });
          const canvasRect = map.getCanvas().getBoundingClientRect();
          const vx = canvasRect.left + e.point.x;
          const vy = canvasRect.top + e.point.y;
          openSitPinMenu(vx, vy, e.lngLat.lng, e.lngLat.lat);
        });

        // Mobile: long-press (500ms) on the map canvas
        const canvasEl = map.getCanvas();
        let longPressTimer: ReturnType<typeof setTimeout> | null = null;
        let touchAnchor: { vx: number; vy: number; lng: number; lat: number } | null = null;
        const LONG_PRESS_MS = 500;
        const MOVE_THRESHOLD_PX = 10;

        const clearLongPress = () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
          touchAnchor = null;
        };

        const handleTouchStart = (evt: TouchEvent) => {
          if (evt.touches.length !== 1) {
            clearLongPress();
            return;
          }
          const touch = evt.touches[0];
          const rect = canvasEl.getBoundingClientRect();
          const cx = touch.clientX - rect.left;
          const cy = touch.clientY - rect.top;
          const lngLat = map.unproject([cx, cy] as [number, number]);
          touchAnchor = {
            vx: touch.clientX,
            vy: touch.clientY,
            lng: lngLat.lng,
            lat: lngLat.lat,
          };
          longPressTimer = setTimeout(() => {
            if (touchAnchor) {
              openSitPinMenu(touchAnchor.vx, touchAnchor.vy, touchAnchor.lng, touchAnchor.lat);
            }
            longPressTimer = null;
          }, LONG_PRESS_MS);
        };

        const handleTouchMove = (evt: TouchEvent) => {
          if (!touchAnchor || evt.touches.length !== 1) return;
          const touch = evt.touches[0];
          const dx = touch.clientX - touchAnchor.vx;
          const dy = touch.clientY - touchAnchor.vy;
          if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) {
            clearLongPress();
          }
        };

        canvasEl.addEventListener('touchstart', handleTouchStart, { passive: true });
        canvasEl.addEventListener('touchmove', handleTouchMove, { passive: true });
        canvasEl.addEventListener('touchend', clearLongPress, { passive: true });
        canvasEl.addEventListener('touchcancel', clearLongPress, { passive: true });

        // Dismiss the menu on map interactions
        map.on('movestart', () => setSitPinMenu(null));
        map.on('zoomstart', () => setSitPinMenu(null));
        map.on('click', () => setSitPinMenu(null));

        console.log('[SitPin] Context-menu handlers registered (right-click + long-press)');
      } catch (sitPinErr) {
        console.warn('[SitPin] Failed to register context-menu handlers:', sitPinErr);
      }

      // ALWAYS set map ready - even if source setup failed
      setMapReady(true);
      setMapError(null); // v4-fix2: clear any transient map errors on successful load
      let srcCount = '?';
      try { if (map.isStyleLoaded()) srcCount = String(Object.keys(map.getStyle()?.sources || {}).length); } catch (_) {}
      console.error('[MAP-DIAG] SUMMARY: map_ready=true, map_error=cleared, style_loaded=true, sources=' + srcCount);
      
      setTimeout(() => {
        try {
          if (map && mapRef.current === map) {
            map.resize();
            console.log('[MAP] map.resize() @100ms');
          }
        } catch (e) {
          console.warn('[MAP] resize() @100ms failed:', e);
        }
      }, 100);

    };
    
    // Register load handler
    console.log('[MAP] Registering load handler, map.loaded()=' + map.loaded());
    if (map.loaded()) {
      console.log('[MAP] Map already loaded, calling onMapLoad immediately');
      onMapLoad();
    } else {
      console.log('[MAP] Waiting for load event...');
      map.once('load', onMapLoad);
    }

    mapRef.current = map;
    console.log('[MAP] mapRef.current set, useEffect setup complete id=' + mId);
    }; // end createMap

    // Kick off dimension-aware init
    initMap();

    return () => {
      console.error('[MAP-DIAG] CLEANUP id=' + mountId + ' mapExists=' + !!mapRef.current);
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = null;
      }
      overlaySourcesCreated.current = false;
      if (flowAnimationRef.current !== null) {
        cancelAnimationFrame(flowAnimationRef.current);
        flowAnimationRef.current = null;
      }
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch (e) { console.error('[MAP-DIAG] map.remove() error:', e); }
        mapRef.current = null;
      }
      if (container && container.childNodes.length > 0) {
        container.innerHTML = '';
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapCreateAttempt]); // v4-fix: re-trigger on retry attempts after WebGL recovery
  
  // v3.9 — Flow corridor dash animation (extracted to hook)
  useFlowAnimation(mapReady, mapRef);

  // Run analysis once on mount — season/wind changes are handled by local alignment rescore
  useEffect(() => {
    // Territory cleanup: if territoryParcelsRef survived from a prior SPA navigation
    // but this load is a normal single-parcel flow (territoryMode false), wipe the
    // ref+state before runAnalysis so stale parcels can't contaminate the link.
    if (territoryParcelsRef.current.length > 0 && !territoryMode) {
      console.warn('[TERRITORY-URL] Mount: clearing stale territory parcels from ref (count:', territoryParcelsRef.current.length, ')');
      clearTerritory();
    }
    runAnalysis();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stall watchdog: detect if progress hasn't advanced for 10s → auto-fallback to demo parcel
  // TERRITORY FIREWALL: Completely disabled during territory mode — stall detection
  // only matters for single-parcel analysis, not for territory building.
  useEffect(() => {
    if (!isLoading) {
      setAnalysisStalled(false);
      lastProgressRef.current = { value: 0, time: Date.now() };
      return;
    }
    // Track progress changes
    if (progress !== lastProgressRef.current.value) {
      lastProgressRef.current = { value: progress, time: Date.now() };
      setAnalysisStalled(false);
    }
    const stallCheck = setInterval(() => {
      // TERRITORY FIREWALL: never trigger stall/fallback while user is building territory
      if (territoryModeRef.current) return;

      const elapsed = Date.now() - lastProgressRef.current.time;
      if (elapsed > 10_000 && isLoading && progress < 20) {
        console.error('[INTEL-DIAG] STALL DETECTED — progress stuck at', lastProgressRef.current.value, 'for', Math.round(elapsed / 1000), 's');
        // Auto-fallback to demo parcel if not already tried
        if (!demoFallbackAttempted.current) {
          console.error('[INTEL-DIAG] AUTO DEMO FALLBACK — stall > 10s, switching to verified demo parcel');
          demoFallbackAttempted.current = true;
          setIsDemoFallbackActive(true);
          const df = DEMO_FALLBACK.current;
          setActiveLat(df.lat);
          setActiveLng(df.lng);
          setActiveAddress(df.address);
          setActiveAcreage(df.acreage);
          setError(null);
          setProgress(5);
          setProgressStep('Switching to verified demo parcel\u2026');
          // lat/lng change triggers runAnalysis via dep array
        } else {
          setAnalysisStalled(true); // Show manual retry UI
        }
      } else if (elapsed > 25_000 && isLoading && progress < 100) {
        console.error('[INTEL-DIAG] STALL DETECTED — progress stuck at', lastProgressRef.current.value, 'for', Math.round(elapsed / 1000), 's');
        setAnalysisStalled(true);
      }
    }, 3_000);
    return () => clearInterval(stallCheck);
  }, [isLoading, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Final guard: if analysis "completed" but result is empty, auto-fallback to demo parcel
  // TERRITORY FIREWALL: Disabled during territory mode — empty results are expected
  // when user is building a territory (no analysis has run yet).
  useEffect(() => {
    if (territoryModeRef.current) return; // TERRITORY FIREWALL
    if (isLoading || error) return; // Still running or already errored — skip
    if (progress < 100) return; // Not actually complete yet

    const hasParcel = !!parcelPolygon;
    const hasLayers = !!(layers && (
      (layers.standPoints?.features?.length ?? 0) > 0 ||
      (layers.beddingPolygons?.features?.length ?? 0) > 0 ||
      (layers.funnels?.features?.length ?? 0) > 0
    ));

    if (hasParcel && hasLayers) return; // Data looks good

    console.error('[INTEL-DIAG] EMPTY RESULT GUARD — parcel:', hasParcel, 'layers:', hasLayers);

    if (!demoFallbackAttempted.current) {
      console.error('[INTEL-DIAG] EMPTY RESULT → triggering demo fallback');
      demoFallbackAttempted.current = true;
      setIsDemoFallbackActive(true);
      const df = DEMO_FALLBACK.current;
      setActiveLat(df.lat);
      setActiveLng(df.lng);
      setActiveAddress(df.address);
      setActiveAcreage(df.acreage);
      setError(null);
      setIsLoading(true);
      setProgress(5);
      setProgressStep('Loading verified demo parcel\u2026');
    }
  }, [isLoading, error, progress, parcelPolygon, layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo badge: show briefly after demo fallback completes, then auto-dismiss
  useEffect(() => {
    if (isDemoFallbackActive && !isLoading && !error) {
      setShowDemoBadge(true);
      const timer = setTimeout(() => setShowDemoBadge(false), 8_000);
      return () => clearTimeout(timer);
    }
    setShowDemoBadge(false);
  }, [isDemoFallbackActive, isLoading, error]);

  // ========== EDGE INTELLIGENCE CLICK EVENT LISTENER ==========
  useEffect(() => {
    const handleEdgeClick = (e: Event) => {
      const customEvent = e as CustomEvent<{
        edgeType: 'corridor' | 'bedding' | 'pressure' | 'boundary';
        lngLat: [number, number];
        segmentBearing: number;
      }>;
      
      console.log('[EDGE INTEL] Click event received:', customEvent.detail);
      
      setUnlockModalData({
        edgeType: customEvent.detail.edgeType,
        lngLat: customEvent.detail.lngLat,
        segmentBearing: customEvent.detail.segmentBearing
      });
      setShowUnlockModal(true);
    };
    
    window.addEventListener('tfp-edge-click', handleEdgeClick);
    return () => window.removeEventListener('tfp-edge-click', handleEdgeClick);
  }, []);

  // ========== EXPLORATION PARCEL LOOKUP HANDLERS ==========
  const handleQaParcelLookup = useCallback(async (clickLng: number, clickLat: number) => {
    if (qaParcelLoading) return;
    // TERRITORY FIREWALL: QA lookup must not fire in territory mode
    if (territoryModeRef.current) return;
    
    // Clear previous overlays and parcel before loading new one
    clearAllOverlaySources();
    setParcelPolygon(null);

    // Wipe all terrain state immediately so no stale data lingers
    setTerrainFlowData(null);
    setLayers(null);
    setTieredCorridorData(null);
    setRidgeSpineData(null);
    setEdgeIntelData(null);
    
    setQaParcelLoading(true);
    setQaParcelError(null);
    setQaParcel(null);
    setGeometryValidationError(null);
    setGeometryTrace(null);
    setRawRegridCoords(null);
    
    try {
      // Fetch with debug=true to get raw geometry info
      const response = await fetch(`/api/parcels/lookup?lat=${clickLat}&lng=${clickLng}&debug=true`);
      const data = await response.json();
      
      if (!data.found) {
        setQaParcelError(data.error || 'No parcel found at this location');
        return;
      }
      
      if (data.parcel) {
        setQaParcel(data.parcel);
        
        // ========== GEOMETRY TRACE: Step 1 - Normalized coords from API ==========
        const trace = createGeometryTrace(data.parcel.parcelId);
        const normalizedStep = createTraceStep(
          '1_API_NORMALIZED',
          data.parcel.coordinates,
          'ring'
        );
        addTraceStep(trace, normalizedStep);
        
        // Store raw coords if available in debug response
        if (data.debug?.rawCoords) {
          setRawRegridCoords(data.debug.rawCoords);
          const rawStep = createTraceStep(
            '0_REGRID_RAW',
            data.debug.rawCoords,
            data.debug.rawGeometryType || 'Polygon'
          );
          // Insert at beginning
          trace.steps.unshift(rawStep);
        } else {
          // If no raw coords, store normalized as "raw" too
          setRawRegridCoords(data.parcel.coordinates);
        }
        
        setGeometryTrace(trace);
        
        // Validate geometry for analysis
        const validation = validateForAnalysis(data.parcel.coordinates);
        if (!validation.valid) {
          setGeometryValidationError(validation.error);
          console.warn('[EXPLORE] Geometry validation failed:', validation.error);
        }
        
        // Track visited parcel (keep last 20)
        setQaRecentParcelIds(prev => {
          const updated = [data.parcel.parcelId, ...prev.filter((id: string) => id !== data.parcel.parcelId)];
          return updated.slice(0, 20);
        });
        console.log('[EXPLORE] Found:', data.parcel.parcelId, data.parcel.acreage, 'ac');
        
        // Update map to show parcel boundary
        const map = mapRef.current;
        if (map && data.parcel.coordinates) {
          // Create closed polygon for display
          const coords = [...data.parcel.coordinates];
          if (coords.length > 0 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
            coords.push(coords[0]);
          }
          
          // Update QA parcel source
          const qaSource = map.getSource('tfp-qa-parcel') as mapboxgl.GeoJSONSource;
          if (qaSource) {
            qaSource.setData({
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [coords]
              }
            });
          }
          
          // ========== DEBUG LAYERS UPDATE ==========
          if (geometryDebugMode) {
            // Update debug layer: normalized (cyan)
            const normalizedSource = map.getSource('tfp-debug-normalized') as mapboxgl.GeoJSONSource;
            if (normalizedSource) {
              normalizedSource.setData({
                type: 'Feature',
                properties: { stage: 'normalized' },
                geometry: { type: 'Polygon', coordinates: [coords] }
              });
            }
            
            // Update debug layer: raw (red) - if different from normalized
            if (data.debug?.rawCoords) {
              const rawSource = map.getSource('tfp-debug-raw') as mapboxgl.GeoJSONSource;
              if (rawSource) {
                const rawCoords = [...data.debug.rawCoords];
                if (rawCoords.length > 0 && (rawCoords[0][0] !== rawCoords[rawCoords.length-1][0] || rawCoords[0][1] !== rawCoords[rawCoords.length-1][1])) {
                  rawCoords.push(rawCoords[0]);
                }
                rawSource.setData({
                  type: 'Feature',
                  properties: { stage: 'raw' },
                  geometry: { type: 'Polygon', coordinates: [rawCoords] }
                });
              }
            }
          }
          
          // Fit bounds to parcel
          if (data.parcel.bounds) {
            map.fitBounds(data.parcel.bounds, {
              padding: 100,
              duration: 800,
              maxZoom: 16,
            });
          }
        }
        
        // Print trace to console in debug mode
        if (geometryDebugMode) {
          printGeometryTrace(trace);
        }
      }
    } catch (err) {
      console.error('[EXPLORE] Lookup error:', err);
      setQaParcelError('Failed to lookup parcel');
    } finally {
      setQaParcelLoading(false);
    }
  }, [qaParcelLoading, geometryDebugMode, clearAllOverlaySources]);

  const handleQaParcelAnalyze = useCallback(async () => {
    if (!qaParcel || qaParcelAnalyzing) return;
    // TERRITORY FIREWALL: QA analyze must not fire in territory mode
    if (territoryModeRef.current) return;

    // Wipe all visual data before running new analysis
    clearAllOverlaySources();
    setTerrainFlowData(null);
    setLayers(null);
    setTieredCorridorData(null);
    setRidgeSpineData(null);
    setEdgeIntelData(null);
    
    // Check for geometry validation error - block analysis if invalid
    if (geometryValidationError) {
      setQaParcelError(`Parcel geometry invalid for analysis: ${geometryValidationError}`);
      return;
    }
    
    setQaParcelAnalyzing(true);
    setQaShowScorecard(false); // Reset scorecard for new analysis
    console.log('[EXPLORE] Analyzing via full pipeline:', qaParcel.parcelId);
    
    try {
      // ========== GEOMETRY TRACE: Step 2 - Analysis coords ==========
      const coords = [...qaParcel.coordinates];
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
      }
      
      const analysisStep = createTraceStep(
        '2_ANALYSIS_INPUT',
        coords,
        'ring'
      );
      
      if (geometryTrace) {
        addTraceStep(geometryTrace, analysisStep);
        if (geometryDebugMode) {
          printGeometryTrace(geometryTrace);
        }
        if (geometryTrace.mismatchDetected) {
          console.error('⚠️ GEOMETRY MISMATCH DETECTED:', geometryTrace.mismatchDetails);
        }
      }
      
      // Store analysis coords for debug comparison
      setAnalysisCoords(coords);
      
      // ========== DEBUG LAYER: Analysis geometry (yellow) ==========
      const map = mapRef.current;
      if (map && geometryDebugMode) {
        const analysisSource = map.getSource('tfp-debug-analysis') as mapboxgl.GeoJSONSource;
        if (analysisSource) {
          analysisSource.setData({
            type: 'Feature',
            properties: { stage: 'analysis' },
            geometry: { type: 'Polygon', coordinates: [coords] }
          });
        }
      }
      
      // CRITICAL: Reset fit flags so the new parcel bounds fit occurs
      hasFitToParcel.current = false;
      hasPostAnalysisFit.current = false;
      console.log('[EXPLORE] Reset hasFitToParcel + hasPostAnalysisFit for new parcel orientation');
      
      // ========== UNIFIED PIPELINE: Update active coords and trigger runAnalysis ==========
      // This routes the exploration click through the SAME full analysis pipeline
      // that the initial page load uses, ensuring complete terrain state is retained.
      const qLat = qaParcel.centroid[1];
      const qLng = qaParcel.centroid[0];
      const qAddr = qaParcel.address;
      const qAcr = qaParcel.acreage.toString();
      setActiveLat(qLat);
      setActiveLng(qLng);
      setActiveAddress(qAddr);
      setActiveAcreage(qAcr);
      // Sync refs so runAnalysis reads fresh values (stale-closure fix)
      activeLatRef.current = qLat;
      activeLngRef.current = qLng;
      activeAcreageRef.current = qAcr;
      
      console.log('[EXPLORE] Updated active coords to:', qLat, qLng);
      console.log('[EXPLORE] Full analysis pipeline will trigger via lat/lng dep change');
      
      // Show scorecard after analysis completes
      setTimeout(() => setQaShowScorecard(true), 2000);

      // Pre-seed parcel geometry so runAnalysis skips duplicate fetch
      const qaFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature',
        properties: { parcelId: qaParcel.parcelId, address: qaParcel.address, owner: qaParcel.owner || '', acreage: qaParcel.acreage },
        geometry: { type: 'Polygon', coordinates: [coords] },
      };
      prefetchedParcelRef.current = qaFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

      // Trigger full analysis pipeline with new coords
      setTimeout(() => runAnalysis(), 100);
      
    } catch (err) {
      console.error('[EXPLORE] Analysis error:', err);
      setQaParcelError('Failed to analyze parcel');
    } finally {
      setQaParcelAnalyzing(false);
    }
  }, [qaParcel, qaParcelAnalyzing, geometryValidationError, geometryTrace, geometryDebugMode, runAnalysis, clearAllOverlaySources]);

  const handleQaParcelClear = useCallback(() => {
    // TERRITORY FIREWALL: never run QA clear → runAnalysis while territory mode active
    if (territoryModeRef.current) return;

    console.log('[EXPLORE] === CLEARING EXPLORE PARCEL STATE ===');
    
    setQaParcel(null);
    setQaParcelError(null);
    setQaShowScorecard(false);
    setGeometryValidationError(null);
    setGeometryTrace(null);
    setRawRegridCoords(null);
    setAnalysisCoords(null);
    
    // Restore original URL coordinates — this triggers runAnalysis to
    // reload the original parcel, preserving the full analysis pipeline
    setActiveLat(urlLat);
    setActiveLng(urlLng);
    setActiveAddress(urlAddress);
    setActiveAcreage(urlAcreage);
    // Sync refs so runAnalysis reads fresh values (stale-closure fix)
    activeLatRef.current = urlLat;
    activeLngRef.current = urlLng;
    activeAcreageRef.current = urlAcreage;
    
    // Reset fit flags for next parcel
    hasFitToParcel.current = false;
    hasPostAnalysisFit.current = false;

    // Trigger full analysis pipeline to reload original parcel
    setTimeout(() => runAnalysis(), 100);
    
    console.log('[EXPLORE] Restored to original URL coords:', urlLat, urlLng);
  }, [urlLat, urlLng, urlAddress, urlAcreage, runAnalysis]);
  
  // ========== PARCEL PICK MODE: One-click lookup + auto-analyze ==========
  // Replicates the full direct-parcel-select → analyze path in a single pass:
  //  1. lookup parcel  2. highlight boundary  3. populate parcel features/info
  //  4. fit map  5. promote into active selected-parcel state  6. run analyzer
  // ── Territory transition: fade terrain overlays out/in ──
  // When adding 2nd+ parcel in territory mode, existing single-parcel flow
  // data becomes stale. Fade it out to signal the handoff, then fade new
  // territory-wide results back in when analysis completes.
  const TERRITORY_FADE_PRESERVE = ['tfp-parcel-', 'tfp-territory-', 'tfp-adjacent-'];
  const fadeTerrainOverlays = useCallback((
    map: mapboxgl.Map,
    direction: 'out' | 'in',
    durationMs: number = 1500,
  ): Promise<void> => {
    return new Promise((resolve) => {
      const style = map.getStyle();
      if (!style?.layers) { resolve(); return; }

      const propMap: Record<string, string> = {
        line: 'line-opacity', fill: 'fill-opacity',
        circle: 'circle-opacity', heatmap: 'heatmap-opacity',
        symbol: 'icon-opacity',
      };

      let layerCount = 0;
      for (const layer of style.layers) {
        if (!layer.id.startsWith('tfp-')) continue;
        if (TERRITORY_FADE_PRESERVE.some(p => layer.id.startsWith(p))) continue;
        const prop = propMap[(layer as any).type] || 'line-opacity';
        if (direction === 'out') {
          fadeLayerOut(map, layer.id, prop, durationMs);
        } else {
          // For fade-in, read targetOpacity from current paint (reconcileVisibility
          // will have set correct values) — just animate from 0.
          fadeLayerIn(map, layer.id, 0.8, prop, durationMs);
        }
        layerCount++;
      }
      console.log(`[TERRITORY] Fade ${direction}: ${layerCount} layers over ${durationMs}ms`);
      setTimeout(resolve, durationMs + 50);
    });
  }, []);

  const handleParcelPick = useCallback(async (clickLng: number, clickLat: number) => {
    // In territory mode, only block on parcelPickLoading (not isLoading).
    // The initial single-parcel analysis may still be running (isLoading=true),
    // but that should NOT prevent adding parcels to the territory builder.
    if (parcelPickLoading) return;
    if (!territoryModeRef.current && isLoading) return;

    // ── TERRITORY MODE — add parcel only, no analysis ──
    if (territoryModeRef.current) {
      console.error('[TERRITORY-DIAG] handleParcelPick TERRITORY path entered. parcels:', territoryParcelsRef.current.length, 'isLoading:', isLoading, 'parcelPickLoading:', parcelPickLoading);
      setParcelPickLoading(true);

      const attemptTerritoryLookup = async (attempt: number): Promise<void> => {
        console.error('[TERRITORY-DIAG] attemptTerritoryLookup attempt', attempt, 'at', clickLat.toFixed(5), clickLng.toFixed(5));
        const lookupUrl = `/api/parcels/lookup?lat=${clickLat}&lng=${clickLng}&debug=true`;
        const resp = await fetch(lookupUrl);
        // ── REGRID DIAGNOSTICS ──────────────────────────────────────────────
        // Always capture response body as text first so we can log it even on
        // non-JSON / error responses. Then attempt JSON parse.
        const responseText = await resp.text();
        let data: any = null;
        try {
          data = JSON.parse(responseText);
        } catch (parseErr) {
          console.error('[TERRITORY-REGRID-DIAG] Non-JSON response body', {
            attempt,
            clickLat,
            clickLng,
            httpStatus: resp.status,
            httpStatusText: resp.statusText,
            rawBody: responseText.slice(0, 2000),
            parseError: (parseErr as Error).message,
          });
          throw new Error(`Regrid lookup returned non-JSON (HTTP ${resp.status})`);
        }

        if (!resp.ok) {
          console.error('[TERRITORY-REGRID-DIAG] HTTP error from lookup endpoint', {
            attempt,
            clickLat,
            clickLng,
            httpStatus: resp.status,
            httpStatusText: resp.statusText,
            responseBody: data,
            errorMessage: data?.error,
          });
          throw new Error(`HTTP ${resp.status}${data?.error ? ' — ' + data.error : ''}`);
        }

        if (!data.found || !data.parcel) {
          // Full diagnostic dump — covers OK coverage gap, outside-region gate,
          // Regrid "No parcel found", invalid geometry, rate-limit, etc.
          console.error('[TERRITORY-REGRID-DIAG] Lookup returned no parcel', {
            attempt,
            clickLat,
            clickLng,
            url: lookupUrl,
            httpStatus: resp.status,
            found: data?.found,
            errorCode: data?.error,
            cached: data?.cached,
            fullResponseBody: data,
            debugInfo: data?.debug ?? null,
          });

          // ── USER-FACING TOAST ──
          // Distinguish the three common failure modes so the user knows what
          // to try next. All three appear silently today in Territory Mode.
          const errMsg: string = data?.error || '';
          if (/outside.*coverage/i.test(errMsg) || /outside KS\/MO/i.test(errMsg) || /outside.*region/i.test(errMsg)) {
            // App-side region gate — user clicked outside supported states.
            toast.error('That location is outside our current parcel coverage area. Supported states: KS, MO, OK, AR, NE, IA, Texas panhandle, and eastern CO.', { duration: 7000 });
          } else if (/rate limit/i.test(errMsg)) {
            toast.error('Parcel lookup is temporarily rate-limited. Please wait a few seconds and try again.', { duration: 6000 });
          } else {
            // Generic "no parcel returned" — Regrid coverage gap, click on road/water, etc.
            toast.error('No parcel boundary found here — Regrid coverage may be limited in this county. Try clicking further into the field interior.', { duration: 7000 });
          }
          return;
        }
        const parcel = data.parcel;
        if ((parcel?.acreage || 0) < 5) {
          console.error('[TERRITORY-DIAG] Skipping tiny parcel under 5 acres:', parcel?.acreage);
          return;
        }

        // Build a proper GeoJSON Feature handling BOTH Polygon and MultiPolygon
        const geoType = parcel.geometryType || 'Polygon';
        let parcelFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

        if (geoType === 'MultiPolygon') {
          // coordinates is number[][][][] — use as-is
          parcelFeature = {
            type: 'Feature',
            properties: { parcelId: parcel.parcelId, address: parcel.address, owner: parcel.owner, acreage: parcel.acreage },
            geometry: { type: 'MultiPolygon', coordinates: parcel.coordinates || [] },
          };
          console.error('[TERRITORY-DIAG] MultiPolygon parcel:', parcel.parcelId, 'rings:', (parcel.coordinates || []).length);
        } else {
          // coordinates is number[][][] — extract first ring and ensure closure
          const rawCoords = parcel.coordinates || [];
          const ring = Array.isArray(rawCoords[0]?.[0]) ? rawCoords[0] : rawCoords;
          const coords = [...ring];
          if (coords.length > 0 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
            coords.push(coords[0]);
          }
          parcelFeature = {
            type: 'Feature',
            properties: { parcelId: parcel.parcelId, address: parcel.address, owner: parcel.owner, acreage: parcel.acreage },
            geometry: { type: 'Polygon', coordinates: [coords] },
          };
        }
        addParcelToTerritory({
          id: parcel.parcelId || `p_${Date.now()}`,
          address: parcel.siteAddress || parcel.address || `Parcel at ${clickLat.toFixed(4)}, ${clickLng.toFixed(4)}`,
          lat: clickLat,
          lng: clickLng,
          acreage: parcel.acreage || 0,
          polygon: parcelFeature,
          owner: parcel.owner,
          county: parcel.county,
        });
      };

      try {
        await attemptTerritoryLookup(1);
      } catch (err) {
        console.warn('[PICK] Territory lookup attempt 1 failed:', err);
        toast.info('Loading parcel — retrying…');
        try {
          await new Promise(r => setTimeout(r, 3000));
          await attemptTerritoryLookup(2);
        } catch (retryErr) {
          console.error('[PICK] Territory add failed after retry:', retryErr);
          toast.error('Could not load parcel. Please try again.');
        }
      }
      setParcelPickLoading(false);
      return;
    }
    
    console.log('[PICK] Picking parcel at:', clickLat.toFixed(6), clickLng.toFixed(6));
    setParcelPickLoading(true);
    
    // Clear previous state — clean slate for new parcel
    if (!territoryMode) {
      clearAllOverlaySources();
      setParcelPolygon(null);
      setTerrainFlowData(null);
      setLayers(null);
      setTieredCorridorData(null);
      setRidgeSpineData(null);
      setEdgeIntelData(null);
      setAlignedStands([]);
      previousStandsRef.current = []; // Reset stand stability anchor on parcel change
      previousBeddingRef.current = EMPTY_FC; // Reset bedding stability anchor on parcel change
      previousSaddlePolysRef.current = EMPTY_FC; // Reset saddle polygon stability anchor on parcel change
      previousSaddleNodesRef.current = EMPTY_FC; // Reset saddle node stability anchor on parcel change
      previousKillZonesRef.current = EMPTY_FC; // Reset kill zone stability anchor on parcel change
      setParcelUnlocked(false);
      setLastSavedPropertyId(null);
      setSelectedStand(null);
      setHuntabilityData(null);
      // vNext: Clear stand GeoJSON + popup
      if (mapRef.current?.getSource('tfp-stands')) {
        (mapRef.current.getSource('tfp-stands') as mapboxgl.GeoJSONSource).setData(EMPTY_FC);
      }
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    }
    
    try {
      const fetchParcelWithRetry = async (): Promise<any> => {
        const resp = await fetch(`/api/parcels/lookup?lat=${clickLat}&lng=${clickLng}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      };

      let data: any;
      try {
        data = await fetchParcelWithRetry();
      } catch (firstErr) {
        console.warn('[PICK] Lookup attempt 1 failed:', firstErr);
        toast.info('Loading parcel — retrying…');
        await new Promise(r => setTimeout(r, 3000));
        data = await fetchParcelWithRetry();
      }
      
      if (!data.found || !data.parcel) {
        console.warn('[PICK] No parcel found at click location');
        setParcelPickLoading(false);
        return;
      }
      
      const parcel = data.parcel;
      console.log('[PICK] Found parcel:', parcel.parcelId, parcel.address, parcel.acreage, 'ac');
      
      // ── 1. Build the real parcel polygon feature and promote it immediately ──
      // This is the SAME state that runAnalysis → fetchParcelGeometry would set,
      // but we already have the geometry from the lookup — skip the duplicate fetch.
      const coords = [...(parcel.coordinates || [])];
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
      }
      
      const parcelFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature',
        properties: {
          parcelId: parcel.parcelId,
          address: parcel.address,
          owner: parcel.owner,
          acreage: parcel.acreage,
        },
        geometry: { type: 'Polygon', coordinates: [coords] },
      };
      
      // ── TERRITORY MODE INTERCEPT ──
      // In territory mode, add/remove the clicked parcel and bail out
      // before promoting it as the single active parcel.
      if (territoryMode) {
        const parcelId = parcel.parcelId || `parcel_${Math.round(clickLat * 10000)}_${Math.round(clickLng * 10000)}`;

        const existingParcel = territoryParcelsRef.current.find(p => p.id === parcelId);
        if (existingParcel) {
          removeParcelFromTerritory(parcelId);
        } else {
          // When adding the 2nd+ parcel, stale single-parcel flow is visible —
          // fade it out over 1.5 s so the user reads the handoff visually.
          if (territoryParcelsRef.current.length >= 1 && mapRef.current) {
            fadeTerrainOverlays(mapRef.current, 'out', 1500);
            // NOTE: we don't await — the fade runs in the background while
            // the territory source updates and gold boundaries repaint.
          }
          const parcelFeatureForTerritory: TerritoryParcel = {
            id: parcelId,
            address: parcel.address || `Parcel at ${clickLat.toFixed(4)}, ${clickLng.toFixed(4)}`,
            lat: clickLat,
            lng: clickLng,
            acreage: parcel.acreage || 0,
            polygon: parcelFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
          };
          addParcelToTerritory(parcelFeatureForTerritory);
        }
        setParcelPickLoading(false);
        return;
      }

      // Set parcelPolygon state (triggers painting useEffect on next render)
      setParcelPolygon(parcelFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
      console.log('[PICK] Set parcelPolygon from lookup data:', parcel.parcelId);
      
      // ── 1b. IMPERATIVE PAINT: show gold boundary immediately ──
      // React state won't propagate until the next render cycle, but we want
      // the gold boundary visible NOW — before camera animation or analysis.
      const map = mapRef.current;
      if (map) {
        const parcelSrc = map.getSource('tfp-parcel') as mapboxgl.GeoJSONSource | undefined;
        if (parcelSrc) {
          parcelSrc.setData(parcelFeature);
          // Ensure parcel layers are visible (gracefulClear may have faded them)
          try { map.setLayoutProperty('tfp-parcel-outline', 'visibility', 'visible'); } catch {}
          try { map.setLayoutProperty('tfp-parcel-glow', 'visibility', 'visible'); } catch {}
          try { map.setPaintProperty('tfp-parcel-outline', 'line-opacity', 0.95); } catch {}
          try { map.setPaintProperty('tfp-parcel-glow', 'line-opacity', 0.35); } catch {}
          console.log('[PICK] Imperative paint: gold boundary visible immediately');
        }
      }
      
      // ── 2. Fit camera to parcel ──
      if (map && parcel.bounds) {
        map.fitBounds(parcel.bounds, {
          padding: 80,
          duration: 800,
          maxZoom: 17,
        });
      }
      
      // ── 3. Reset camera fit flags for the new parcel ──
      hasFitToParcel.current = false;
      hasPostAnalysisFit.current = false;
      
      // ── 4. Promote looked-up parcel into active selected-parcel state ──
      // Update BOTH state AND refs synchronously so runAnalysis reads fresh values.
      const newLat = parcel.centroid[1];
      const newLng = parcel.centroid[0];
      const newAddress = parcel.address || `Parcel ${parcel.parcelId}`;
      const newAcreage = parcel.acreage.toString();
      
      setActiveLat(newLat);
      setActiveLng(newLng);
      setActiveAddress(newAddress);
      setActiveAcreage(newAcreage);
      
      // Synchronously update refs — runAnalysis reads from these, not state
      activeLatRef.current = newLat;
      activeLngRef.current = newLng;
      activeAcreageRef.current = newAcreage;
      // PINEVILLE-LINK FIX: user just clicked a real parcel — future Territory seed is safe
      userHasExplicitParcelRef.current = true;
      
      // ── 5. Exit pick mode (single-parcel only — territory keeps picking) ──
      if (!territoryMode) {
        setParcelPickMode(false);
      }
      setParcelPickLoading(false);
      
      // ── 6. (DISABLED) Clean parcel view hold ──
      // The 1.5 s hold is temporarily disabled for stability.
      // To re-enable: uncomment the setParcelViewHold(true) block below.
      // if (parcelViewHoldTimerRef.current) clearTimeout(parcelViewHoldTimerRef.current);
      // setParcelViewHold(true);
      // parcelViewHoldRef.current = true;
      // parcelViewHoldTimerRef.current = setTimeout(() => {
      //   setParcelViewHold(false);
      //   parcelViewHoldRef.current = false;
      //   parcelViewHoldTimerRef.current = null;
      // }, 1500);

      // ── 7. Trigger full terrain analysis against the new parcel ──
      // runAnalysis reads coords from refs (activeLatRef / activeLngRef) which
      // we just updated synchronously above, so no stale-closure issue.
      // Pre-seed the parcel geometry so runAnalysis skips the duplicate fetch
      // and keeps the gold boundary visible (no full-screen overlay).
      prefetchedParcelRef.current = parcelFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
      setTimeout(() => runAnalysis(), 100);
      
    } catch (err) {
      console.error('[PICK] Lookup error:', err);
      setParcelPickLoading(false);
    }
  }, [parcelPickLoading, isLoading, clearAllOverlaySources, runAnalysis, territoryMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══ HERO PARCEL LOADER — one-click curated parcel switch ═══
  const heroLoadingRef = useRef(false);
  const loadHeroParcel = useCallback(async (hero: HeroParcel) => {
    if (heroLoadingRef.current || isLoading) return;
    // TERRITORY FIREWALL: hero loading must not nuke territory state
    if (territoryModeRef.current) return;

    heroLoadingRef.current = true;
    setActiveHeroSlug(hero.slug);
    // PINEVILLE-LINK FIX: user explicitly picked a curated parcel — safe to seed later
    userHasExplicitParcelRef.current = true;

    // Clear previous state
    clearAllOverlaySources();
    setParcelPolygon(null);
    setTerrainFlowData(null);
    setLayers(null);
    setTieredCorridorData(null);
    setRidgeSpineData(null);
    setEdgeIntelData(null);
    setAlignedStands([]);
    previousStandsRef.current = []; // Reset stand stability anchor on parcel change
    previousBeddingRef.current = EMPTY_FC; // Reset bedding stability anchor on parcel change
    previousSaddlePolysRef.current = EMPTY_FC; // Reset saddle polygon stability anchor on parcel change
    previousSaddleNodesRef.current = EMPTY_FC; // Reset saddle node stability anchor on parcel change
    previousKillZonesRef.current = EMPTY_FC; // Reset kill zone stability anchor on parcel change
    setParcelUnlocked(false);
    setLastSavedPropertyId(null);
    setSelectedStand(null);
    setHuntabilityData(null);
    // vNext: Clear stand GeoJSON + popup
    if (mapRef.current?.getSource('tfp-stands')) {
      (mapRef.current.getSource('tfp-stands') as mapboxgl.GeoJSONSource).setData(EMPTY_FC);
    }
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    
    // Update active coords (state + refs synchronously)
    setActiveLat(hero.lat);
    setActiveLng(hero.lng);
    setActiveAddress(hero.address);
    setActiveAcreage(hero.acreage);
    activeLatRef.current = hero.lat;
    activeLngRef.current = hero.lng;
    activeAcreageRef.current = hero.acreage;
    
    // Reset camera fit flags
    hasFitToParcel.current = false;
    hasPostAnalysisFit.current = false;
    
    // Reset fallback state
    demoFallbackAttempted.current = false;
    setIsDemoFallbackActive(false);
    prefetchedParcelRef.current = null;
    
    // Fly camera to the new location
    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: [hero.lng, hero.lat], zoom: 14, duration: 800 });
    }
    
    // Trigger analysis
    setIsLoading(true);
    setProgress(5);
    setProgressStep('Loading ' + hero.label + '\u2026');
    heroLoadingRef.current = false;
    setTimeout(() => runAnalysis(), 200);
  }, [isLoading, clearAllOverlaySources, runAnalysis]);

  // Register map click handler for parcel pick mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !parcelPickMode) return;
    
    // Change cursor — crosshair when under cap, default when full
    if (territoryMode && territoryParcels.length >= TERRITORY_PARCEL_CAP) {
      map.getCanvas().style.cursor = 'default';
    } else {
      map.getCanvas().style.cursor = 'crosshair';
    }
    
    const handlePickClick = (e: mapboxgl.MapMouseEvent) => {
      // Don't intercept clicks on existing stand markers or terrain features
      const features = map.queryRenderedFeatures(e.point, {
        layers: [
          'tfp-flow-primary', 'tfp-flow-secondary',
        ].filter(l => map.getLayer(l))
      });
      if (features && features.length > 0) return;
      
      handleParcelPick(e.lngLat.lng, e.lngLat.lat);
    };
    
    map.on('click', handlePickClick);
    console.log('[PICK] Click handler registered');
    
    return () => {
      map.off('click', handlePickClick);
      map.getCanvas().style.cursor = '';
      console.log('[PICK] Click handler removed');
    };
  }, [mapReady, parcelPickMode, handleParcelPick, territoryMode, territoryParcels.length]);

  // ========== TERRITORY MODE: CROSSHAIR CURSOR LOCK ==========
  // When territory mode is active, force crosshair on the map canvas using CSS !important
  // so that mouseenter/mouseleave handlers on terrain layers cannot override it to 'pointer'.
  // Also disable pointer events on fill layers that intercept clicks before the pick handler.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!territoryMode) return; // Only active during territory mode

    const canvas = map.getCanvas();

    // Inject a <style> tag with !important to override all inline cursor changes
    const styleId = 'tfp-territory-cursor-lock';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      .mapboxgl-canvas-container.mapboxgl-interactive,
      .mapboxgl-canvas-container.mapboxgl-interactive canvas {
        cursor: crosshair !important;
      }
    `;

    // Also force inline as immediate feedback
    canvas.style.cursor = 'crosshair';

    // Disable pointer events on fill layers that intercept territory picks.
    // Hide them so Mapbox won't fire mouseenter/click events on them.
    const interactiveFillLayers = [
      'tfp-adjacent-parcels-fill',
      'tfp-adjacent-parcels-hover',
      'tfp-territory-fill',
    ];
    interactiveFillLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, 'visibility', 'none');
        } catch { /* layer may not exist */ }
      }
    });

    console.error('[TERRITORY-DIAG] Cursor lock + layer visibility block APPLIED');

    return () => {
      // Remove cursor lock
      const el = document.getElementById(styleId);
      if (el) el.remove();
      canvas.style.cursor = '';

      // Restore visibility on fill layers — adjacent parcels stay hidden
      // (managed by territory mode toggle), territory-fill is only shown during analysis
      // So we don't blindly restore to 'visible' — leave them as territory mode manages them.

      console.error('[TERRITORY-DIAG] Cursor lock + layer visibility block REMOVED');
    };
  }, [mapReady, territoryMode]);

  // Toggle debug layer visibility when geometryDebugMode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    
    const visibility = geometryDebugMode ? 'visible' : 'none';
    
    if (map.getLayer('tfp-debug-raw-outline')) {
      map.setLayoutProperty('tfp-debug-raw-outline', 'visibility', visibility);
    }
    if (map.getLayer('tfp-debug-normalized-outline')) {
      map.setLayoutProperty('tfp-debug-normalized-outline', 'visibility', visibility);
    }
    if (map.getLayer('tfp-debug-analysis-outline')) {
      map.setLayoutProperty('tfp-debug-analysis-outline', 'visibility', visibility);
    }
    
    // When debug mode turns on, re-populate layers if we have data
    if (geometryDebugMode && qaParcel) {
      const coords = [...qaParcel.coordinates];
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
      }
      
      // Normalized (cyan)
      const normalizedSource = map.getSource('tfp-debug-normalized') as mapboxgl.GeoJSONSource;
      if (normalizedSource) {
        normalizedSource.setData({
          type: 'Feature',
          properties: { stage: 'normalized' },
          geometry: { type: 'Polygon', coordinates: [coords] }
        });
      }
      
      // Raw (red) - if we have it
      if (rawRegridCoords) {
        const rawCoords = [...rawRegridCoords];
        if (rawCoords.length > 0 && (rawCoords[0][0] !== rawCoords[rawCoords.length-1][0] || rawCoords[0][1] !== rawCoords[rawCoords.length-1][1])) {
          rawCoords.push(rawCoords[0]);
        }
        const rawSource = map.getSource('tfp-debug-raw') as mapboxgl.GeoJSONSource;
        if (rawSource) {
          rawSource.setData({
            type: 'Feature',
            properties: { stage: 'raw' },
            geometry: { type: 'Polygon', coordinates: [rawCoords] }
          });
        }
      }
      
      // Analysis (yellow) - if we have it
      if (analysisCoords) {
        const analysisSource = map.getSource('tfp-debug-analysis') as mapboxgl.GeoJSONSource;
        if (analysisSource) {
          analysisSource.setData({
            type: 'Feature',
            properties: { stage: 'analysis' },
            geometry: { type: 'Polygon', coordinates: [analysisCoords] }
          });
        }
      }
    }
  }, [geometryDebugMode, mapReady, qaParcel, rawRegridCoords, analysisCoords]);

  // v3.8.3 — Toggle QA parcel layer visibility when exploration mode changes
  // Prevents stale cyan outlines from overlapping the gold parcel boundary
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const qaVis = qaParcelLookupMode ? 'visible' : 'none';
    const QA_LAYERS = ['tfp-qa-parcel-fill', 'tfp-qa-parcel-outline', 'tfp-qa-parcel-outline-glow'];
    for (const layerId of QA_LAYERS) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', qaVis);
      }
    }

    // When turning QA mode OFF, also clear the source data to prevent carryover
    if (!qaParcelLookupMode) {
      const qaSource = map.getSource('tfp-qa-parcel') as mapboxgl.GeoJSONSource;
      if (qaSource) qaSource.setData(EMPTY_FC);
      console.log('[v3.8.3] Explore parcel layers hidden + source cleared');
    } else {
      console.log('[v3.8.3] Explore parcel layers made visible');
    }
  }, [qaParcelLookupMode, mapReady]);

  const handleQaParcelCopyInfo = useCallback(() => {
    if (!qaParcel) return;
    
    const info = [
      `Address: ${qaParcel.address}`,
      `Parcel ID: ${qaParcel.parcelId}`,
      `County: ${qaParcel.county}, ${qaParcel.state}`,
      `Acreage: ${qaParcel.acreage.toFixed(2)} ac`,
      `Owner: ${qaParcel.owner}`,
      `Zoning: ${qaParcel.zoning}`,
      qaParcel.plss ? `PLSS: ${qaParcel.plss}` : '',
      `Center: ${qaParcel.centroid[1].toFixed(6)}, ${qaParcel.centroid[0].toFixed(6)}`,
    ].filter(Boolean).join('\n');
    
    navigator.clipboard.writeText(info);
  }, [qaParcel]);

  // QA Scorecard handlers
  const handleQaRatingSubmit = useCallback((entry: QAEntry) => {
    setQaSessionEntries(prev => [...prev, entry]);
    console.log('[EXPLORE] Rating submitted:', entry.rating, entry.parcelId);
  }, []);

  const handleQaScorecardSkip = useCallback(() => {
    setQaShowScorecard(false);
  }, []);

  const handleQaSessionClear = useCallback(() => {
    if (window.confirm('Clear all QA session data? This cannot be undone.')) {
      setQaSessionEntries([]);
    }
  }, []);

  const handleQaSessionExport = useCallback(() => {
    exportSessionCSV(qaSessionEntries);
  }, [qaSessionEntries]);

  // Handler for random parcel picker
  const handleRandomParcelFound = useCallback((parcel: LookupParcel) => {
    setQaParcel(parcel);
    setQaParcelError(null);
    
    // Track visited parcel (keep last 20)
    setQaRecentParcelIds(prev => {
      const updated = [parcel.parcelId, ...prev.filter(id => id !== parcel.parcelId)];
      return updated.slice(0, 20);
    });
    
    console.log('[RANDOM PARCEL] Selected:', parcel.parcelId, parcel.acreage, 'ac,', parcel.county, parcel.state);
    
    // Update map to show parcel boundary
    const map = mapRef.current;
    if (map && parcel.coordinates) {
      // Create closed polygon for display
      const coords = [...parcel.coordinates];
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
      }
      
      // Update QA parcel source
      const qaSource = map.getSource('tfp-qa-parcel') as mapboxgl.GeoJSONSource;
      if (qaSource) {
        qaSource.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [coords]
          }
        });
      }
      
      // Fit bounds to parcel
      if (parcel.bounds) {
        map.fitBounds(parcel.bounds, {
          padding: 100,
          duration: 800,
          maxZoom: 16,
        });
      }
    }
  }, []);

  // Register map click handler for QA parcel lookup
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !qaParcelLookupMode) return;
    
    const handleMapClick = (e: mapboxgl.MapMouseEvent) => {
      // Don't trigger if clicking on existing features
      const features = map.queryRenderedFeatures(e.point, {
        layers: [
          'tfp-flow-primary', 'tfp-flow-secondary',
          'tfp-bedding-fill', 'tfp-funnels-lines-draws', 'tfp-funnels-polys-fill'
        ].filter(l => map.getLayer(l))
      });
      
      if (features && features.length > 0) return; // Let existing handlers take over
      
      handleQaParcelLookup(e.lngLat.lng, e.lngLat.lat);
    };
    
    map.on('click', handleMapClick);
    console.log('[EXPLORE] Click handler registered');
    
    return () => {
      map.off('click', handleMapClick);
      console.log('[EXPLORE] Click handler removed');
    };
  }, [mapReady, qaParcelLookupMode, handleQaParcelLookup]);

  // Keyboard handler for Esc to clear QA parcel or exit pick mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // v3.9.0 — Esc closes the sit pin context menu first (highest priority UI)
        if (sitPinMenu) {
          setSitPinMenu(null);
          return;
        }
        if (parcelPickMode) {
          // In territory mode, Esc exits both territory + pick mode
          if (territoryMode) {
            setTerritoryMode(false);
            // Only hide territory layers if no parcels were added yet.
            // If parcels exist (analysis was run or pending), keep them visible.
            if (territoryParcelsRef.current.length === 0 && mapRef.current) {
              try {
                mapRef.current.setLayoutProperty('tfp-territory-fill', 'visibility', 'none');
                mapRef.current.setLayoutProperty('tfp-territory-outline', 'visibility', 'none');
                mapRef.current.setLayoutProperty('tfp-territory-glow', 'visibility', 'none');
              } catch(e) {}
            }
          }
          setParcelPickMode(false);
        } else if (qaParcel) {
          handleQaParcelClear();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [qaParcel, handleQaParcelClear, parcelPickMode, territoryMode, sitPinMenu]);

  // ========== TERRAIN FLOW CLICK EVENT LISTENERS ==========
  useEffect(() => {
    // Flow segment click handler
    const handleFlowSegmentClick = async (e: Event) => {
      const customEvent = e as CustomEvent<{
        segmentId: string;
        coordinates: [number, number][];
        tier: 'primary' | 'secondary';
        likelihood: number;
        screenX: number;
        screenY: number;
      }>;
      
      const { segmentId, coordinates, tier, screenX, screenY } = customEvent.detail;
      console.log('[FLOW SEGMENT] Click event received:', { segmentId, tier, pointCount: coordinates.length });
      
      // Set position and selected segment
      setFlowSegmentClickPosition({ x: screenX, y: screenY });
      setSelectedFlowSegment({ segmentId, coordinates, tier });
      setFlowSegmentExplainLoading(true);
      setFlowSegmentExplain(null);
      
      // Fetch explanation from API
      try {
        const response = await fetch('/api/terrain-flow/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segmentId, coordinates }),
        });
        
        if (response.ok) {
          const data = await response.json();
          setFlowSegmentExplain(data);
          console.log('[FLOW SEGMENT] Explanation received:', data);
        } else {
          console.warn('[FLOW SEGMENT] Failed to fetch explanation');
        }
      } catch (err) {
        console.error('[FLOW SEGMENT] Error fetching explanation:', err);
      } finally {
        setFlowSegmentExplainLoading(false);
      }
    };
    
    window.addEventListener('tfp-flow-segment-click', handleFlowSegmentClick);
    
    // Adjacent parcel click handler — clear terrain features from current parcel first
    const handleAdjacentParcelClick = (e: Event) => {
      // In territory mode, adjacent parcel clicks are handled by the pick handler
      // which adds parcels to the territory — don't interfere by clearing overlays.
      if (territoryModeRef.current) return;

      const detail = (e as CustomEvent).detail;
      clearAllOverlaySources();
      // Null out React state so useEffects don't repaint stale saddles/draws/ridges
      setLayers(null);
      setTerrainFlowData(null);
      setRidgeSpineData(null);
      setLegacySyntheticData(null);
      setTieredCorridorData(null);
      setEdgeIntelData(null);
      setTerrainStory(null);
      setTerrainFlowLoading(false);
      setHuntabilityData(null);
      setSelectedAdjacentParcel({
        parcelId: detail.parcelId,
        address: detail.address,
        owner: detail.owner,
        acreage: detail.acreage,
        county: detail.county,
        state: detail.state,
        centroid: [detail.lng, detail.lat],
        geometry: { type: 'Point', coordinates: [detail.lng, detail.lat] }, // placeholder
      });
      setAdjacentParcelPopupPos({ x: detail.screenX, y: detail.screenY });
    };
    window.addEventListener('tfp-adjacent-parcel-click', handleAdjacentParcelClick);
    
    return () => {
      window.removeEventListener('tfp-flow-segment-click', handleFlowSegmentClick);
      window.removeEventListener('tfp-adjacent-parcel-click', handleAdjacentParcelClick);
    };
  }, [clearAllOverlaySources]);

  // ========== v3.6.0: TERRAIN REASONS EVENT LISTENER ==========
  // When showTerrainReasons is ON, clicking features shows terrain factor explanations
  useEffect(() => {
    if (!showTerrainReasons) {
      // Clear any open panel when toggle is turned off
      setTerrainReasonData(null);
      setTerrainReasonPosition(null);
      return;
    }
    
    // Handle corridor clicks for terrain reasons
    const handleCorridorReasons = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Corridors don't have detailed breakdown in current implementation
      // We'll create a simple summary based on likelihood
      const reasons = extractCorridorReasons(
        {
          likelihood: detail.likelihood,
          bench_likelihood: detail.likelihood * 0.6,
          slope_preference: detail.likelihood * 0.5,
          saddle_proximity: detail.likelihood * 0.3,
          terrain_convergence: detail.likelihood * 0.4,
          spine_proximity: detail.likelihood * 0.5,
        },
        { lng: 0, lat: 0 }
      );
      setTerrainReasonData(reasons);
      setTerrainReasonPosition({ x: detail.screenX, y: detail.screenY });
    };
    
    // Handle bedding zone clicks for terrain reasons
    const handleBeddingReasons = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const reasons = extractBeddingReasons(
        {
          score: detail.beddingScore,
          beddingScore: detail.beddingScore,
          beddingType: detail.beddingType,
          upperSlope: detail.upperSlope,
          solarAspect: detail.solarAspect,
          ridgeDistance: detail.ridgeDistance,
          slopeSuitability: detail.slopeSuitability,
          terrainShelter: detail.terrainShelter,
          corridorOffset: detail.corridorOffset,
          humanPressure: detail.humanPressure,
        },
        { lng: detail.lng, lat: detail.lat }
      );
      setTerrainReasonData(reasons);
      setTerrainReasonPosition({ x: detail.screenX, y: detail.screenY });
    };
    
    window.addEventListener('tfp-flow-segment-click', handleCorridorReasons);
    window.addEventListener('tfp-bedding-click', handleBeddingReasons);
    
    return () => {
      window.removeEventListener('tfp-flow-segment-click', handleCorridorReasons);
      window.removeEventListener('tfp-bedding-click', handleBeddingReasons);
    };
  }, [showTerrainReasons]);

  // ========== vNext: GeoJSON STAND LAYERS + DIRECTION WEDGES (map-native) ==========
  // Populates the tfp-stands GeoJSON source with point features for top 3 stands.
  // Also populates emphasis glow, hunt pockets, direction wedges (unchanged).
  const STAND_LAYER_IDS = [
    'tfp-stands-glow', 'tfp-stands-disc', 'tfp-stands-reticle',
    'tfp-stands-center', 'tfp-stands-label', 'tfp-stands-rank',
  ] as const;

  useEffect(() => {
    if (!mapReady || !alignedStands.length) return;

    const timer = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;

      // ── PAYWALL GATE: hide all stand / pocket / direction layers for non-purchased users ──
      const canShowStands = parcelUnlockedRef.current || isProRef.current;
      if (!canShowStands) {
        // Clear all stand-related GeoJSON sources so nothing renders on the map
        const clearSources = ['tfp-stands', 'tfp-stand-emphasis', 'tfp-hunt-pockets', 'tfp-stand-direction', 'tfp-killzone', 'tfp-stand-tertiary'];
        clearSources.forEach(src => {
          if (map.getSource(src)) {
            try { (map.getSource(src) as mapboxgl.GeoJSONSource).setData(EMPTY_FC); } catch {}
          }
        });
        // Hide all stand layers + support layers
        const allStandLayers = [...STAND_LAYER_IDS, 'tfp-stand-emphasis-glow', 'tfp-hunt-pockets-fill', 'tfp-hunt-pockets-stroke', 'tfp-stand-direction-main', 'tfp-stand-direction-flank', 'tfp-killzone-fill', 'tfp-killzone-stroke'];
        allStandLayers.forEach(id => {
          if (map.getLayer(id)) {
            try { map.setLayoutProperty(id, 'visibility', 'none'); } catch {}
          }
        });
        return;
      }

      // ── Populate tfp-stands GeoJSON source ──
      const SIT_LABELS = ["Today's Sit", 'Alternate Sit', 'Backup Sit'];
      const standsToShow = alignedStands.slice(0, Math.min(alignedStands.length, 3));
      const features = standsToShow.map((stand, idx) => {
        const isTop = idx === 0;
        const isSec = idx === 1;
        const fillColor = isTop ? LAYER_COLORS.standPrimary : isSec ? LAYER_COLORS.standSecondary : LAYER_COLORS.standTertiary;
        const strokeColor = isTop ? LAYER_COLORS.standPrimaryRing : isSec ? LAYER_COLORS.standSecondary : LAYER_COLORS.standTertiary;
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: stand.coords },
          properties: {
            rank: idx,
            label: SIT_LABELS[idx] || `Sit #${idx + 1}`,
            rankLabel: idx === 0 ? '★' : String(idx + 1),
            color: fillColor,
            strokeColor,
            score: stand.alignment.score,
            standIdx: idx,
          },
        };
      });
      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      if (map.getSource('tfp-stands')) {
        (map.getSource('tfp-stands') as mapboxgl.GeoJSONSource).setData(fc);
      }

      // Top-stand emphasis glow
      if (map.getSource('tfp-stand-emphasis')) {
        const top = alignedStands[0];
        (map.getSource('tfp-stand-emphasis') as mapboxgl.GeoJSONSource).setData(
          top ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: top.coords }, properties: {} }] } : EMPTY_FC
        );
      }

      // Hunt pocket halos for top 2 stands
      if (map.getSource('tfp-hunt-pockets')) {
        const topStands = alignedStands.slice(0, 2);
        const pocketFC = buildHuntPocketFeatures(topStands, layers?.funnels, ridgeSpineData);
        (map.getSource('tfp-hunt-pockets') as mapboxgl.GeoJSONSource).setData(pocketFC);
      }

      // v1.1: Movement-axis wedges + kill zone sub-wedges for top 2 stands
      if (map.getSource('tfp-stand-direction')) {
        const topStands = alignedStands.slice(0, 2);
        const { coneFC, killZoneFC } = buildStandDirectionFeatures(
          topStands,
          layers?.funnels,
          ridgeSpineData,
          windDirectionRef.current,
          ridgeSpineData?.saddle_nodes ?? null,
          terrainFlowData?.convergence_zones ?? null,
        );
        (map.getSource('tfp-stand-direction') as mapboxgl.GeoJSONSource).setData(coneFC);
        // Kill zone sub-wedge with stability
        if (map.getSource('tfp-killzone')) {
          const prevKZ = previousKillZonesRef.current;
          const KILLZONE_NEIGHBORHOOD_M = 20; // metres — snap to prev if centroid within this

          if (prevKZ.features.length > 0 && killZoneFC.features.length > 0) {
            const kzCentroid = (f: GeoJSON.Feature): [number, number] | null => {
              if (f.geometry?.type !== 'Polygon') return null;
              const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
              if (!ring?.length) return null;
              return [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
            };
            const usedPrevIdxs = new Set<number>();
            const stableFeatures = killZoneFC.features.map((newFeat, ni) => {
              const newC = kzCentroid(newFeat);
              if (!newC) return newFeat;
              let bestDist = Infinity;
              let bestIdx = -1;
              for (let pi = 0; pi < prevKZ.features.length; pi++) {
                if (usedPrevIdxs.has(pi)) continue;
                const prevC = kzCentroid(prevKZ.features[pi]);
                if (!prevC) continue;
                const d = distanceMeters(newC, prevC);
                if (d < bestDist) { bestDist = d; bestIdx = pi; }
              }
              if (bestIdx >= 0 && bestDist < KILLZONE_NEIGHBORHOOD_M) {
                usedPrevIdxs.add(bestIdx);
                console.error(`[KILLZONE-STABILITY] kz=${ni} SNAPPED: dist=${bestDist.toFixed(0)}m — keeping previous geometry`);
                return { ...prevKZ.features[bestIdx], properties: { ...prevKZ.features[bestIdx].properties, ...newFeat.properties } };
              }
              console.error(`[KILLZONE-STABILITY] kz=${ni} NEW: no prev match within ${KILLZONE_NEIGHBORHOOD_M}m (closest=${bestDist.toFixed(0)}m)`);
              return newFeat;
            });
            const stableKZFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: stableFeatures };
            previousKillZonesRef.current = stableKZFC;
            (map.getSource('tfp-killzone') as mapboxgl.GeoJSONSource).setData(stableKZFC);
          } else {
            previousKillZonesRef.current = killZoneFC;
            (map.getSource('tfp-killzone') as mapboxgl.GeoJSONSource).setData(killZoneFC);
          }
        }
      }

      // Clear tertiary dots — only top 3 shown as GeoJSON layers now
      if (map.getSource('tfp-stand-tertiary')) {
        (map.getSource('tfp-stand-tertiary') as mapboxgl.GeoJSONSource).setData(EMPTY_FC);
      }

      // vNext: Make stand layers visible (they may have been hidden by gracefulClear)
      STAND_LAYER_IDS.forEach(id => {
        if (map.getLayer(id)) {
          try { map.setLayoutProperty(id, 'visibility', 'visible'); } catch {}
        }
      });

      // Ensure direction wedge + emphasis layers are visible and at correct opacity
      // after gracefulClear may have faded them to 0.
      // NOTE: Hunt pocket layers are NOT in this list — their fill-opacity uses a
      // data-driven expression (resilienceFactor × opacityScale × corridorBias × ringNorm).
      // Setting a scalar value here would clobber that expression and cause opacity jitter.
      const supportLayers: { id: string; prop: string; opacity: number }[] = [
        { id: 'tfp-stand-direction-main', prop: 'fill-opacity', opacity: 0.16 },
        { id: 'tfp-stand-direction-flank', prop: 'line-opacity', opacity: 0.3 },
        { id: 'tfp-stand-emphasis-glow', prop: 'circle-opacity', opacity: 0.45 },
      ];
      supportLayers.forEach(({ id, prop, opacity }) => {
        if (map.getLayer(id)) {
          try {
            map.setLayoutProperty(id, 'visibility', 'visible');
            map.setPaintProperty(id, prop, opacity);
          } catch {}
        }
      });
      // Kill zone layers use data-driven opacity expressions — only toggle visibility, don't clobber expressions
      ['tfp-killzone-fill', 'tfp-killzone-stroke'].forEach(id => {
        if (map.getLayer(id)) {
          try { map.setLayoutProperty(id, 'visibility', 'visible'); } catch {}
        }
      });
      // Hunt pockets: restore visibility + re-apply data-driven paint expressions
      // (gracefulClear may have faded opacity to 0 via scalar setPaintProperty)
      if (map.getLayer('tfp-hunt-pockets-fill')) {
        try {
          map.setLayoutProperty('tfp-hunt-pockets-fill', 'visibility', 'visible');
          map.setPaintProperty('tfp-hunt-pockets-fill', 'fill-opacity', [
            '*',
            ['get', 'resilienceFactor'],
            [
              '*',
              ['*', ['get', 'opacityScale'], ['get', 'corridorBias']],
              [
                'interpolate', ['exponential', 2.2], ['get', 'ringNorm'],
                0.25, 0.11,
                0.50, 0.05,
                0.75, 0.015,
                1.0,  0.004,
              ],
            ],
          ]);
        } catch {}
      }
      if (map.getLayer('tfp-hunt-pockets-stroke')) {
        try {
          map.setLayoutProperty('tfp-hunt-pockets-stroke', 'visibility', 'visible');
          // Stroke opacity uses a simple case expression, restore it
          map.setPaintProperty('tfp-hunt-pockets-stroke', 'line-opacity', [
            'case',
            ['==', ['get', 'isTopStand'], true],
            0.10,
            0.18,
          ]);
        } catch {}
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [alignedStands, mapReady, layers?.funnels, ridgeSpineData, terrainFlowData, parcelUnlocked, isPro]); // eslint-disable-line

  // vNext: Stand visibility toggle — uses map layer visibility instead of HTML opacity.
  // Solo mode uses a GeoJSON filter expression instead of per-marker DOM manipulation.
  // PHASE 2 FIX: Single source of truth for stand visibility. If style isn't loaded yet,
  // schedule a retry via style.load listener so the toggle is never silently dropped.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // PAYWALL GATE: force stands hidden when parcel not purchased
    const canShowStands = parcelUnlockedRef.current || isProRef.current;
    const globalShow = canShowStands && visibility.stands;

    const applyVisibility = () => {
      // Toggle stand GeoJSON layers — deterministic, immediate
      const vis = globalShow ? 'visible' : 'none';
      STAND_LAYER_IDS.forEach(id => {
        if (map.getLayer(id)) {
          try { map.setLayoutProperty(id, 'visibility', vis); } catch {}
        }
      });

      // Solo mode: apply per-stand filter on the disc/label/rank layers
      if (globalShow && soloStandMode && selectedStand !== null) {
        const matchIdx = alignedStands.findIndex(s => s.rank === selectedStand);
        if (matchIdx >= 0) {
          const soloFilter: any = ['==', ['get', 'standIdx'], matchIdx];
          STAND_LAYER_IDS.forEach(id => {
            if (map.getLayer(id)) {
              try { map.setFilter(id, soloFilter); } catch {}
            }
          });
        }
      } else {
        STAND_LAYER_IDS.forEach(id => {
          if (map.getLayer(id)) {
            try { map.setFilter(id, null); } catch {}
          }
        });
      }

      // Staggered supporting layer reveal: glow → wedges → dots
      // When solo mode is active, hide supporting layers (they cover all stands)
      const showLayers = globalShow && !soloStandMode;
      staggeredFadeToggle(map, showLayers, [
        { id: 'tfp-stand-emphasis-glow', targetOpacity: 0.45, opacityProp: 'circle-opacity' },
        { id: 'tfp-stand-direction-main', targetOpacity: 0.16, opacityProp: 'fill-opacity' },
        { id: 'tfp-stand-direction-flank', targetOpacity: 0.3, opacityProp: 'line-opacity' },
        { id: 'tfp-stand-tertiary-dot', targetOpacity: 0.6, opacityProp: 'circle-opacity' },
      ], 400, 60);

      // PHASE 3 FIX: Hunt pocket + kill zone layers use layout visibility toggle instead of
      // opacity animation. This preserves data-driven opacity expressions.
      const pocketVis = showLayers ? 'visible' : 'none';
      ['tfp-hunt-pockets-fill', 'tfp-hunt-pockets-stroke', 'tfp-killzone-fill', 'tfp-killzone-stroke'].forEach(id => {
        if (map.getLayer(id)) {
          try { map.setLayoutProperty(id, 'visibility', pocketVis); } catch {}
        }
      });

      // Nearest corridor highlight follows stand visibility + selection
      const showHighlight = globalShow && selectedStand !== null;
      if (showHighlight) {
        fadeLayerIn(map, 'tfp-flow-nearest-highlight', 0.75, 'line-opacity', 450);
      } else {
        fadeLayerOut(map, 'tfp-flow-nearest-highlight', 'line-opacity', 300);
      }
    };

    // If style is loaded, apply immediately; otherwise queue for style.load
    if (map.isStyleLoaded?.()) {
      applyVisibility();
    } else {
      const onStyleLoad = () => { applyVisibility(); };
      map.once('style.load', onStyleLoad);
      return () => { map.off('style.load', onStyleLoad); };
    }
  }, [visibility.stands, selectedStand, soloStandMode, alignedStands, mapReady, parcelUnlocked, isPro]);

  // vNext: Cleanup — clear GeoJSON source + popup (no HTML markers to remove)
  const cleanupMarkers = () => {
    if (mapRef.current?.getSource('tfp-stands')) {
      (mapRef.current.getSource('tfp-stands') as mapboxgl.GeoJSONSource).setData(EMPTY_FC);
    }
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
  };

  // ========== vNext: MAP-NATIVE STAND CLICK / HOVER HANDLERS ==========
  // Replaces HTML marker onclick/onmouseenter with Mapbox layer event handlers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
      // PAYWALL GATE: if parcel not purchased, show paywall modal instead
      if (!parcelUnlockedRef.current && !isProRef.current) {
        setShowParcelPaywall(true);
        return;
      }
      const feat = e.features?.[0];
      if (!feat?.properties) return;
      const idx = feat.properties.standIdx as number;
      const stand = alignedStands[idx];
      if (!stand) return;

      setSelectedStand(stand.rank);
      map.flyTo({
        center: stand.coords,
        zoom: Math.max(map.getZoom(), 15.5),
        duration: 1200,
        essential: true,
        padding: { top: 80, bottom: 40, left: 40, right: 40 },
      });
      setTimeout(() => {
        showStandPopup(stand.coords, stand.props, stand.resilience, stand);
      }, 400);
    };

    const onMouseEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onMouseLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', 'tfp-stands-disc', onClick);
    map.on('mouseenter', 'tfp-stands-disc', onMouseEnter);
    map.on('mouseleave', 'tfp-stands-disc', onMouseLeave);

    return () => {
      map.off('click', 'tfp-stands-disc', onClick);
      map.off('mouseenter', 'tfp-stands-disc', onMouseEnter);
      map.off('mouseleave', 'tfp-stands-disc', onMouseLeave);
    };
  }, [mapReady, alignedStands]); // eslint-disable-line


  const showStandPopup = (coords: [number, number], props: StandPointProperties, resilience?: StandResilience, standData?: AlignedStand) => {
    const map = mapRef.current;
    if (!map) return;

    if (popupRef.current) popupRef.current.remove();

    // ========== COMPUTE FACE DIRECTION ==========
    // v1 rule: corridor -> funnel/saddle -> parcel centroid fallback
    let faceBearing: number | null = null;

    // 1) Try corridors from layers.funnels
    if (layers?.funnels?.features?.length) {
      const corridors = layers.funnels.features.filter(
        f => f.properties?.funnelType === 'corridor' && f.geometry?.type === 'LineString'
      );
      
      if (corridors.length > 0) {
        let nearestDist = Infinity;
        let nearestPt: [number, number] | null = null;
        
        for (const c of corridors) {
          const lineCoords = (c.geometry as GeoJSON.LineString).coordinates as [number, number][];
          if (lineCoords.length >= 2) {
            const result = closestPointOnLineString(coords, lineCoords);
            if (result.dist < nearestDist) {
              nearestDist = result.dist;
              nearestPt = result.point;
            }
          }
        }
        
        if (nearestPt) {
          faceBearing = calculateBearing(coords, nearestPt);
        }
      }
    }

    // 2) Fallback: funnel/saddle hotspots (draws or saddles)
    if (faceBearing === null && layers?.funnels?.features?.length) {
      const hotspots = layers.funnels.features.filter(
        f => f.properties?.funnelType && f.properties.funnelType !== 'corridor'
      );
      
      if (hotspots.length > 0) {
        let nearestDist = Infinity;
        let nearestPt: [number, number] | null = null;
        
        for (const h of hotspots) {
          let centroid: [number, number];
          const geom = h.geometry as GeoJSON.Geometry;
          if (geom.type === 'Point') {
            centroid = geom.coordinates as [number, number];
          } else if (geom.type === 'LineString') {
            const lc = geom.coordinates as [number, number][];
            centroid = [lc.reduce((s, c) => s + c[0], 0) / lc.length, lc.reduce((s, c) => s + c[1], 0) / lc.length];
          } else if (geom.type === 'Polygon') {
            const pc = (geom.coordinates as [number, number][][])[0];
            centroid = [pc.reduce((s, c) => s + c[0], 0) / pc.length, pc.reduce((s, c) => s + c[1], 0) / pc.length];
          } else {
            continue;
          }
          
          const dist = distanceMeters(coords, centroid);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestPt = centroid;
          }
        }
        
        if (nearestPt) {
          faceBearing = calculateBearing(coords, nearestPt);
        }
      }
    }

    // 3) Final fallback: parcel centroid
    if (faceBearing === null) {
      const parcelCentroid: [number, number] = [lng, lat];
      faceBearing = calculateBearing(coords, parcelCentroid);
    }

    const faceCompass = degreesToCompass(faceBearing);
    const faceDeg = Math.round(faceBearing);

    // Sit labels for top 3
    const SIT_LABELS_POPUP = ["Today's Sit", 'Alternate Sit', 'Backup Sit'] as const;
    const isTodaysSit = props.rank === 1;
    const sitIdx = props.rank - 1; // 0-based
    const popupBadgeColor = isTodaysSit ? `linear-gradient(135deg, ${LAYER_COLORS.standPrimary}, ${LAYER_COLORS.standPrimaryRing})` : 
      sitIdx === 1 ? '#3b82f6' : '#6b7280';
    const popupBadgeLabel = sitIdx < 3 ? (isTodaysSit ? `★ ${SIT_LABELS_POPUP[0]}` : `#${props.rank} ${SIT_LABELS_POPUP[sitIdx]}`) : `Stand #${props.rank}`;
    const badgeTextColor = isTodaysSit ? '#1a1a1a' : 'white';

    // Explainability data (if stand data available)
    const explain = standData ? getStandExplainability(standData.inputs, props, standData.alignment, resilience) : null;
    const popupChipsHTML = explain ? renderChipsHTML(explain.chips) : '';
    const popupIndicatorsHTML = explain ? renderKeyIndicatorsHTML(explain.keyIndicators) : '';
    const popupBarsHTML = explain ? renderQualityBarsHTML(explain.qualityBars) : '';
    const popupExplanation = explain ? explain.selectionExplanation : '';
    
    const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '340px', offset: 12, className: 'intel-popup' })
      .setLngLat(coords)
      .setHTML(`
        <div style="max-height: 380px; overflow: auto; padding: 10px 12px; font-size: 12px; line-height: 1.25; font-family: system-ui, sans-serif;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="
              background: ${popupBadgeColor};
              color: ${badgeTextColor};
              font-weight: 600;
              padding: 4px 10px;
              border-radius: 12px;
              font-size: 11px;
              ${isTodaysSit ? 'box-shadow: 0 0 8px rgba(251, 191, 36, 0.4);' : ''}
            ">${popupBadgeLabel}</span>
            <span style="font-weight: 700; font-size: 16px;">${props.score}<span style="font-size: 11px; color: #6b7280;">/100</span></span>
          </div>

          ${popupExplanation ? `
          <p style="margin: 4px 0 8px; font-size: 10px; color: #9ca3af; line-height: 1.4;">
            ${popupExplanation}
          </p>
          ` : ''}

          ${popupIndicatorsHTML ? popupIndicatorsHTML : ''}

          ${popupChipsHTML ? `
          <div style="display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 8px;">
            ${popupChipsHTML}
          </div>
          ` : ''}

          ${popupBarsHTML ? `
          <div style="margin-bottom: 8px; padding: 6px 8px; background: rgba(255,255,255,0.03); border-radius: 6px;">
            ${popupBarsHTML}
          </div>
          ` : ''}
          
          <div style="margin-bottom: 8px; font-size: 11px; color: #1f2937;">
            <span style="font-weight: 600;">Face:</span> ${faceCompass} (${faceDeg}°)
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
            <div style="background: #dcfce7; padding: 5px 7px; border-radius: 4px;">
              <span style="color: #166534; font-size: 9px; display: block;">✓ Good Wind</span>
              <span style="font-weight: 600; font-size: 11px;">${props.windOk.join(', ')}</span>
            </div>
            <div style="background: #fee2e2; padding: 5px 7px; border-radius: 4px;">
              <span style="color: #991b1b; font-size: 9px; display: block;">✗ Avoid</span>
              <span style="font-weight: 600; font-size: 11px;">${props.windBad.join(', ')}</span>
            </div>
          </div>
          
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="
              padding: 3px 7px;
              border-radius: 4px;
              font-weight: 500;
              font-size: 10px;
              background: ${props.approachRisk === 'low' ? '#dcfce7' : props.approachRisk === 'medium' ? '#fef3c7' : '#fee2e2'};
              color: ${props.approachRisk === 'low' ? '#166534' : props.approachRisk === 'medium' ? '#92400e' : '#991b1b'};
            ">
              ${props.approachRisk.toUpperCase()} risk approach
            </span>
            <span style="color: #6b7280; font-size: 10px;">Elev: ${Math.round(props.elevation)}m</span>
          </div>
          
          <div style="margin-top: 8px; display: flex; align-items: center; gap: 6px;">
            <button
              id="copy-coords-btn"
              style="
                padding: 4px 8px;
                background: #374151;
                border: none;
                border-radius: 4px;
                color: white;
                font-size: 10px;
                cursor: pointer;
              "
              onclick="
                navigator.clipboard.writeText('${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}');
                this.innerHTML = '✓';
                setTimeout(() => { this.innerHTML = '📋'; }, 1500);
              "
            >📋</button>
            <span style="color: #6b7280; font-size: 10px; font-family: monospace;">${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}</span>
          </div>
        </div>
      `)
      .addTo(map);


    popupRef.current = popup;
  };

  // V4 Step 11b: Smooth re-center with cinematic easing
  // v4-fix14: Re-center fits to parcel bounds (not a fixed zoom level) so
  // the camera returns to the same parcel-dominant framing as the initial fit.
  const flyToCenter = () => {
    const map = mapRef.current;
    if (!map) return;

    if (parcelPolygon) {
      try {
        const coords = parcelPolygon.geometry.type === 'Polygon'
          ? parcelPolygon.geometry.coordinates[0]
          : parcelPolygon.geometry.coordinates[0][0];
        if (coords && coords.length >= 3) {
          const bounds = new mapboxgl.LngLatBounds();
          coords.forEach((c: number[]) => bounds.extend([c[0], c[1]]));
          map.fitBounds(bounds, {
            padding: { top: 80, bottom: 80, left: 80, right: 80 },
            duration: 1400,
            maxZoom: 17,
          });
          // Enforce minimum zoom
          map.once('moveend', () => {
            if (map.getZoom() < 14.5) map.setZoom(14.5);
          });
          return;
        }
      } catch { /* fall through to simple flyTo */ }
    }

    // Fallback: fly to center point
    map.flyTo({
      center: [lng, lat],
      zoom: 15,
      duration: 1400,
      essential: true,
    });
  };

  // ========== GLOBAL ERROR PANEL — v4-fix: graceful recovery, no "reboot" language ==========
  // TERRITORY FIREWALL: In territory mode, suppress the full-screen error panel.
  // Instead, auto-clear the error and show a gentle toast so the builder stays usable.
  // NOTE: We can't call setState during render, so we schedule it for the next tick.
  if (globalError && territoryMode) {
    console.error('[TRIGGER-DIAG] globalError SUPPRESSED in territory mode:', globalError?.message);
    setTimeout(() => {
      setGlobalError(null);
      setError(null);
      setIsLoading(false);
      setBackgroundAnalysis(false);
      toast.info('Parcel added — hit Analyze Territory to run the full report.');
    }, 0);
    // Don't return the full-screen error panel — fall through to normal render
  }
  if (globalError && !territoryMode) {
    // 502 / cold-start errors should NEVER show the full-screen "Analyzer paused" modal.
    // Instead, auto-dismiss and show a gentle retry toast.
    const errMsg = globalError?.message || '';
    const is502Error = errMsg.includes('502') || errMsg.includes('warming up') ||
      errMsg.includes('<!DOCTYPE') || errMsg.includes('<html');
    if (is502Error) {
      setTimeout(() => {
        setGlobalError(null);
        setError(null);
        setIsLoading(false);
        setBackgroundAnalysis(false);
        toast.info('Terrain servers warming up — retrying automatically...', { duration: 5000 });
      }, 0);
    } else {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-stone-900/90 border border-stone-700/50 rounded-xl p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Analyzer paused</h1>
          <p className="text-stone-400 text-sm mb-6">
            The terrain analyzer hit a snag. Let&apos;s get you back on track.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                // v4-fix: Try to recover without full reload first
                setGlobalError(null);
                setError(null);
                setMapError(null);
                setMapReady(false);
                // Clean up any stale map reference
                if (mapRef.current) {
                  try { mapRef.current.remove(); } catch (_) { /* ignore */ }
                  mapRef.current = null;
                }
                // Clear container for fresh start
                if (mapContainerRef.current) {
                  mapContainerRef.current.innerHTML = '';
                }
                overlaySourcesCreated.current = false;
                // Trigger map re-creation
                mapRetryCountRef.current = 0;
                setMapCreateAttempt(prev => prev + 1);
              }}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-lg font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
              Retry
            </button>
            <Link
              href="/"
              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg font-medium transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  } // end else (non-502 globalError)
  } // end if (globalError && !territoryMode)

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-900 relative">
      <Toaster position="top-center" richColors />

      {/* ═══ HUNT PLAN BANNER — top of viewport ═══ */}
      {!isPro && summary && !isLoading && (
        <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-center py-1.5 bg-gradient-to-r from-amber-600/90 to-orange-600/90 backdrop-blur-sm pointer-events-auto" style={{ paddingLeft: '60px', paddingRight: '60px' }}>
          <p className="text-white text-[11px] font-medium tracking-wide">
            ⚡ Unlock Your Full Hunt Plan — <strong>$19</strong> per parcel · No subscription required
          </p>
        </div>
      )}

      {/* ═══ FLOATING CTA — bottom-right over map ═══ */}
      {!isPro && !parcelUnlocked && summary && !isLoading && !showParcelPaywall && !territoryMode && (
        <button
          onClick={() => setShowParcelPaywall(true)}
          className="absolute z-40 flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm px-5 py-3 rounded-full shadow-xl shadow-amber-900/40 transition-all hover:scale-105"
          style={{ bottom: '24px', left: '50%', transform: 'translateX(-50%)' }}
        >
          {alignedStands.length > 0
            ? `🎯 ${alignedStands.length} Stands Found — Unlock $19`
            : '🎯 Get My Hunt Plan — $19'}
        </button>
      )}

      {/* Map Container — double-div pattern: outer div owns layout (absolute inset-0),
           inner div is the Mapbox target. Mapbox overrides position to 'relative' on its
           container, which breaks inset-0 sizing. By giving the inner div explicit 100%
           width/height it fills the outer regardless of Mapbox's override. */}
      <div className="absolute inset-0 z-0" style={{ overflow: 'hidden' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
      </div>

      {/* Build stamp — admin-only via ?debug=true */}

      {/* v3.8.2 — Compact map-level busy indicator for async operations */}
      {(flowSegmentExplainLoading || qaParcelAnalyzing) && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="flex items-center gap-2 bg-black/75 backdrop-blur-sm text-white/90 px-4 py-2 rounded-full shadow-lg text-xs font-medium">
            <svg className="animate-spin h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>{flowSegmentExplainLoading ? 'Analyzing flow segment…' : 'Analyzing parcel…'}</span>
          </div>
        </div>
      )}

      {/* ========== TERRITORY BUILDER PANEL ========== */}
      {territoryMode && (
        <div style={{
          position: 'absolute',
          top: 60,
          left: 16,
          zIndex: 20,
          background: '#0d1f17',
          border: '1px solid #c9a84c',
          borderRadius: 12,
          padding: 16,
          width: 260,
          maxHeight: 400,
          overflowY: 'auto',
        }}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontSize:11,letterSpacing:2,color:'#c9a84c',textTransform:'uppercase'}}>
              Territory Builder
            </div>
            <button
              onClick={clearTerritory}
              style={{fontSize:11,color:'#888',background:'none',border:'none',cursor:'pointer'}}
            >
              Clear all
            </button>
          </div>

          <input
            value={territoryName}
            onChange={e => setTerritoryName(e.target.value)}
            placeholder="Name your territory..."
            style={{
              width: '100%',
              padding: '8px 10px',
              background: '#1a3a2a',
              border: '1px solid #2d6a4f',
              borderRadius: 6,
              color: 'white',
              fontSize: 13,
              marginBottom: 12,
              boxSizing: 'border-box',
            }}
          />

          {territoryParcels.length === 0 ? (
            <div style={{fontSize:12,color:'#555',textAlign:'center',padding:'16px 0'}}>
              Click any parcel on the map to add it to your territory
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:12}}>
              {territoryParcels.map((p, i) => (
                <div key={p.id} style={{
                  display:'flex',
                  alignItems:'center',
                  justifyContent:'space-between',
                  background:'#1a3a2a',
                  borderRadius:6,
                  padding:'8px 10px',
                }}>
                  <div>
                    <div style={{fontSize:12,color:'#c9a84c',fontWeight:'bold'}}>
                      Parcel {i + 1}
                    </div>
                    <div style={{fontSize:11,color:'#aaa',marginTop:2}}>
                      {p.address.split(',')[0]} — {Math.round(p.acreage)} ac
                    </div>
                  </div>
                  <button
                    onClick={() => removeParcelFromTerritory(p.id)}
                    style={{fontSize:11,color:'#666',background:'none',border:'none',cursor:'pointer'}}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {territoryParcels.length > 0 && (
            <>
              <div style={{
                display:'flex',
                justifyContent:'space-between',
                fontSize:11,
                color:'#666',
                marginBottom:12,
                paddingTop:8,
                borderTop:'1px solid #1a3a2a',
              }}>
                <span>
                  {isViewingSharedTerritory
                    ? `Viewing shared territory — ${territoryParcels.length} parcels`
                    : `${territoryParcels.length} of ${TERRITORY_PARCEL_CAP} parcels selected`}
                </span>
                {/* SHARED-TERRITORY FIX: don't show "Territory full" for shared views —
                    the cap was bypassed, so the message would be misleading. */}
                {isViewingSharedTerritory ? (
                  <span style={{color:'#52b788',fontWeight:'bold'}}>
                    {Math.round(totalTerritoryAcreage)} total acres
                  </span>
                ) : territoryParcels.length >= TERRITORY_PARCEL_CAP ? (
                  <span style={{color:'#f59e0b',fontWeight:600,fontSize:12}}>✓ Territory full</span>
                ) : (
                  <span style={{color:'#52b788',fontWeight:'bold'}}>
                    {Math.round(totalTerritoryAcreage)} total acres
                  </span>
                )}
              </div>

              <button
                onClick={() => {
                  const merged = mergeParcelPolygons(territoryParcels);
                  if (!merged) return;
                  const bounds = getTerritoryBounds(territoryParcels);
                  const centerLat = (bounds[1] + bounds[3]) / 2;
                  const centerLng = (bounds[0] + bounds[2]) / 2;
                  const totalAcres = String(totalTerritoryAcreage);
                  setParcelPolygon(merged);
                  setActiveLat(centerLat);
                  setActiveLng(centerLng);
                  setActiveAcreage(totalAcres);
                  setActiveAddress(territoryName);
                  activeLatRef.current = centerLat;
                  activeLngRef.current = centerLng;
                  activeAcreageRef.current = totalAcres;
                  // Pass the merged MultiPolygon as prefetched parcel so
                  // runAnalysis() skips the Regrid re-fetch (which would
                  // return a single wrong parcel at the center point) and
                  // uses the full territory geometry for terrain analysis.
                  // This also prevents clearAllOverlaySources() from firing
                  // and keeps backgroundAnalysis=true (no full-screen overlay).
                  prefetchedParcelRef.current = merged;
                  // Signal the data-painting useEffect to fade new results in
                  // instead of snapping them to full opacity.
                  territoryFadeInPending.current = true;
                  setTimeout(() => runAnalysis(), 100);
                  // Disable further parcel picks while analysis runs,
                  // but keep territoryMode=true so the Builder panel stays visible.
                  setParcelPickMode(false);
                }}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  background: summary ? 'transparent' : '#c9a84c',
                  color: summary ? '#c9a84c' : '#1a3a2a',
                  border: summary ? '1.5px solid #c9a84c' : 'none',
                  borderRadius: 8,
                  fontSize: summary ? 13 : 14,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  letterSpacing: 1,
                }}
              >
                {summary ? '⟳ Re-Align Territory' : 'Analyze Territory'}
              </button>

              {/* Copy Territory Link — shareable URL that rebuilds this territory with one click.
                  Checks both state AND ref so the button stays visible after territoryMode toggles off. */}
              {(territoryParcels.length >= 2 || territoryParcelsRef.current.length >= 2) && (
                isPro ? (
                  <button
                    onClick={copyTerritoryLink}
                    style={{
                      width: '100%',
                      padding: '10px 0',
                      background: '#1a3a2a',
                      color: '#52b788',
                      border: '1px solid #2d6a4f',
                      borderRadius: 8,
                      fontSize: 12,
                      cursor: 'pointer',
                      marginTop: 8,
                      letterSpacing: 1,
                    }}
                  >
                    Copy Territory Link
                  </button>
                ) : (
                  <button
                    onClick={() => setShowDownloadWall(true)}
                    style={{
                      width: '100%',
                      padding: '10px 0',
                      background: '#1a3a2a',
                      color: '#666',
                      border: '1px solid #2d6a4f',
                      borderRadius: 8,
                      fontSize: 12,
                      cursor: 'pointer',
                      marginTop: 8,
                      letterSpacing: 1,
                    }}
                  >
                    🔒 Copy Territory Link
                  </button>
                )
              )}

              {/* Open Territory in onX Hunt */}
              <button
                onClick={() => {
                  const bounds = getTerritoryBounds(territoryParcels);
                  const centerLat = (bounds[1] + bounds[3]) / 2;
                  const centerLng = (bounds[0] + bounds[2]) / 2;
                  const zoom = 14; // slightly wider for multi-parcel
                  const url = `https://app.onxmaps.com/hunt/map/${zoom}/${centerLat}/${centerLng}`;
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: '10px 0',
                  background: '#FF6B00',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/onx-icon.png" alt="" style={{ height: 16, width: 16, borderRadius: 2 }} />
                Open Territory in onX
              </button>

              {/* Share Territory Score — Pro only, after analysis */}
              {territoryMode && summary && isPro && (
                <button
                  onClick={() => setShowScoreCard(true)}
                  className="flex items-center gap-2 w-full px-4 py-2
                             rounded-lg mt-2 font-semibold text-sm
                             bg-amber-600 hover:bg-amber-500
                             text-white transition-colors duration-200"
                >
                  📤 Share Territory Score
                </button>
              )}
              {territoryMode && summary && !isPro && (
                <button
                  onClick={() => setShowDownloadWall(true)}
                  className="flex items-center gap-2 w-full px-4 py-2
                             rounded-lg mt-2 font-semibold text-sm
                             bg-stone-700 hover:bg-stone-600
                             text-stone-400 transition-colors duration-200"
                >
                  🔒 Share Territory Score
                </button>
              )}

              {/* Save Territory — Pro only */}
              {session?.user && isPro ? (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleSaveProperty}
                    className="flex items-center gap-2 flex-1 px-4 py-2 rounded-lg
                               bg-green-700 hover:bg-green-600 text-white font-semibold
                               transition-colors duration-200"
                  >
                    {saveConfirmed ? '✅ Saved!' : '⭐ Save Territory'}
                  </button>
                  <button
                    onClick={handleShareTerritory}
                    disabled={shareLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg
                               bg-blue-700 hover:bg-blue-600 text-white font-semibold
                               transition-colors duration-200 disabled:opacity-50"
                    title="Save & get shareable link"
                  >
                    {shareLoading ? '…' : shareCopied ? '✅ Copied!' : '🔗 Share'}
                  </button>
                </div>
              ) : session?.user && !isPro ? (
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="flex items-center gap-2 w-full px-4 py-2 rounded-lg
                             bg-amber-600 hover:bg-amber-500 text-white font-semibold
                             transition-colors duration-200 mt-2"
                >
                  ⭐ Upgrade to Pro to Save & Share
                </button>
              ) : (
                <button
                  onClick={() => router.push('/login?callbackUrl=%2Fintel')}
                  className="flex items-center gap-2 w-full px-4 py-2 rounded-lg
                             bg-green-900 hover:bg-green-800 text-white font-semibold
                             transition-colors duration-200 mt-2"
                >
                  ⭐ Save Territory — Sign In
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
        <div className="flex items-center justify-between px-4 py-3 pointer-events-auto">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/80 hover:text-white transition-colors">
              <Home className="h-5 w-5" />
            </Link>
            {session?.user && (
              <Link href="/properties" className="text-white/50 hover:text-white text-[10px] font-medium transition-colors px-2 py-1 rounded border border-white/10 hover:border-white/20">
                My Parcels
              </Link>
            )}
            <div className="h-6 w-px bg-white/30" />
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-red-500" />
              <span className="font-bold text-white text-lg">Deer Intel</span>
            </div>
          </div>

          {/* Data Quality Indicator — clean, non-technical */}
          <div className={`
            px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2
            ${mode === 'real' 
              ? 'bg-green-500/20 text-green-300 border border-green-500/40' 
              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}
          `}>
            {mode === 'real' ? (
              <><CheckCircle className="h-4 w-4" />Verified Terrain</>
            ) : (
              <><Info className="h-4 w-4" />Preview</>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Adjacent Parcels Toggle */}
            {adjacentParcels.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className={`${showAdjacentParcels 
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40' 
                  : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
                onClick={() => {
                  setShowAdjacentParcels(!showAdjacentParcels);
                  if (showAdjacentParcels) {
                    setSelectedAdjacentParcel(null);
                    setAdjacentParcelPopupPos(null);
                  }
                }}
                title={`${showAdjacentParcels ? 'Hide' : 'Show'} ${adjacentParcels.length} adjacent parcels`}
              >
                <Grid3X3 className="h-4 w-4 mr-1" />
                {adjacentParcelsLoading ? 'Loading…' : `${adjacentParcels.length} Neighbors`}
              </Button>
            )}
            {/* Exploration Mode Toggle — admin/debug only */}
            {debugMode && (
              <Button
                size="sm"
                variant="ghost"
                className={`${explorationMode 
                  ? 'bg-cyan-600/30 text-cyan-400 border border-cyan-500/50' 
                  : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
                onClick={() => {
                  setExplorationMode(!explorationMode);
                  if (explorationMode) {
                    handleQaParcelClear();
                  }
                }}
                title="Explore Mode - Click anywhere in KS/MO to analyze parcels"
              >
                <Layers className="h-4 w-4 mr-1" />
                {explorationMode ? 'Explore ON' : 'Explore'}
              </Button>
            )}
            {/* Geometry Debug Toggle — admin/debug only */}
            {debugMode && qaParcelLookupMode && (
              <Button
                size="sm"
                variant="ghost"
                className={`${geometryDebugMode 
                  ? 'bg-red-600/30 text-red-400 border border-red-500/50' 
                  : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
                onClick={() => setGeometryDebugMode(!geometryDebugMode)}
                title="Show 3-boundary debug overlay"
              >
                <Bug className="h-4 w-4 mr-1" />
                {geometryDebugMode ? 'Debug ON' : 'Debug'}
              </Button>
            )}
            {/* Territory Builder toggle */}
            <Button
              size="sm"
              variant="ghost"
              className={`${territoryMode 
                ? (parcelPickLoading
                    ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
                    : 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/40')
                : 'text-white/80 hover:text-white hover:bg-white/10'
              }`}
              onClick={() => {
                if (territoryMode) {
                  // If parcels have been added, don't allow toggle-off — user must use Clear button
                  if (territoryParcelsRef.current.length > 0) return;
                  // Exiting territory mode (no parcels) — deactivate both
                  setTerritoryMode(false);
                  setParcelPickMode(false);
                  if (mapRef.current) {
                    try {
                      mapRef.current.setLayoutProperty('tfp-territory-fill', 'visibility', 'none');
                      mapRef.current.setLayoutProperty('tfp-territory-outline', 'visibility', 'none');
                      mapRef.current.setLayoutProperty('tfp-territory-glow', 'visibility', 'none');
                    } catch(e) {}
                  }
                } else if (!isPro) {
                  // Not Pro — show upgrade modal
                  setShowUpgradeModal(true);
                } else {
                  // Entering territory mode — auto-activate pick + seed with current parcel
                  setTerritoryMode(true);
                  setParcelPickMode(true);
                  setTerritoryName('My Territory');
                  setActiveHeroSlug(null);

                  // Auto-add the currently analyzed parcel as the first territory member
                  // so the user doesn't have to re-click it.
                  // PINEVILLE-LINK FIX: only seed when the user has explicitly chosen a
                  // parcel (URL lat/lng, hero slug, demo, Pick Parcel). When the user
                  // arrives at /intel with no params, activeLat/activeLng still equals
                  // the Pineville fallback default (36.638590, -94.345581) — seeding
                  // that contaminates the share URL with Pineville as parcel #1.
                  const currentPoly = parcelPolygon;
                  const canSeed = userHasExplicitParcelRef.current;
                  if (canSeed && currentPoly && activeLat && activeLng) {
                    const seedParcel: TerritoryParcel = {
                      id: currentPoly.properties?.parcelId || `p_${Date.now()}`,
                      address: activeAddress || `Parcel at ${activeLat.toFixed(4)}, ${activeLng.toFixed(4)}`,
                      lat: activeLat,
                      lng: activeLng,
                      acreage: parseFloat(activeAcreage || '0'),
                      polygon: currentPoly,
                      owner: currentPoly.properties?.owner,
                      county: currentPoly.properties?.county,
                    };
                    setTerritoryParcels([seedParcel]);
                    territoryParcelsRef.current = [seedParcel];
                  } else {
                    setTerritoryParcels([]);
                    territoryParcelsRef.current = [];
                    toast.info('Click any parcel on the map to add it to your territory.', { duration: 5000 });
                  }
                }
              }}
              title={isPro ? `Territory Builder — up to ${TERRITORY_PARCEL_CAP} parcels` : "Upgrade to Pro for Territory Builder"}
            >
              <Layers className="h-4 w-4 mr-1" />
              {territoryMode
                ? (parcelPickLoading
                    ? 'Loading…'
                    /* SHARED-TERRITORY FIX: show plain count for shared views since
                       the cap was bypassed and "N/1" would misrepresent the state. */
                    : isViewingSharedTerritory
                      ? `Territory (${territoryParcels.length})`
                      : `Territory (${territoryParcels.length}/${TERRITORY_PARCEL_CAP})`)
                : 'Territory'}
              {!isPro && !territoryMode && <span className="ml-1 text-[9px] bg-amber-500/30 text-amber-300 px-1 rounded">PRO</span>}
            </Button>
            {/* Parcel Pick Mode — de-emphasized in demo, available for exploration */}
            <Button
              size="sm"
              variant="ghost"
              className={`${parcelPickMode 
                ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50' 
                : (demoMode || heroParcel)
                  ? 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  : 'text-white/80 hover:text-white hover:bg-white/10'
              }`}
              onClick={() => {
                setParcelPickMode(!parcelPickMode);
                if (!parcelPickMode) setActiveHeroSlug(null);
              }}
              title="Pick a Parcel — click any parcel on the map to analyze it"
              disabled={parcelPickLoading}
            >
              <MapPin className="h-4 w-4 mr-1" />
              {parcelPickMode ? 'Picking…' : 'Pick Parcel'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-white/80 hover:text-white hover:bg-white/10"
              onClick={flyToCenter}
            >
              <Crosshair className="h-4 w-4 mr-1" />
              Re-center
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`${exportMode 
                ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/50' 
                : 'text-white/80 hover:text-white hover:bg-white/10'
              }`}
              onClick={() => setExportMode(!exportMode)}
              title="Screenshot mode — clean map view"
            >
              <Download className="h-4 w-4 mr-1" />
              {exportMode ? 'Exit Screenshot' : 'Screenshot'}
            </Button>
          </div>
        </div>
      </div>

      {/* ========== PARCEL PICK MODE BANNER ========== */}
      {parcelPickMode && !parcelPickLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-amber-900/90 backdrop-blur-sm border border-amber-500/40 rounded-xl px-5 py-3 shadow-xl pointer-events-auto flex items-center gap-3">
            <MapPin className="h-5 w-5 text-amber-300 flex-shrink-0 animate-pulse" />
            <div>
              <p className="text-amber-100 font-semibold text-sm">Click any location to analyze that parcel</p>
              <p className="text-amber-300/70 text-xs">We&apos;ll find the parcel boundary and run the Terrain Analyzer</p>
            </div>
            <button
              onClick={() => {
                setParcelPickMode(false);
                if (territoryMode) {
                  setTerritoryMode(false);
                  // Only hide territory layers if no parcels were added.
                  if (territoryParcelsRef.current.length === 0 && mapRef.current) {
                    try {
                      mapRef.current.setLayoutProperty('tfp-territory-fill', 'visibility', 'none');
                      mapRef.current.setLayoutProperty('tfp-territory-outline', 'visibility', 'none');
                      mapRef.current.setLayoutProperty('tfp-territory-glow', 'visibility', 'none');
                    } catch(e) {}
                  }
                }
              }}
              className="ml-3 text-amber-300/60 hover:text-amber-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {parcelPickLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-stone-900/90 backdrop-blur-sm border border-stone-600/40 rounded-xl px-5 py-3 shadow-xl flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-amber-300 flex-shrink-0 animate-spin" />
            <p className="text-stone-200 font-medium text-sm">Finding parcel boundary…</p>
          </div>
        </div>
      )}

      {/* ========== QA PARCEL LOOKUP UI ========== */}
      {qaParcelLookupMode && (
        <>
          {/* Loading State */}
          {qaParcelLoading && <ParcelLookupLoading />}
          
          {/* Error State */}
          {qaParcelError && !qaParcel && (
            <ParcelLookupError 
              message={qaParcelError} 
              onDismiss={() => setQaParcelError(null)} 
            />
          )}
          
          {/* Parcel Card */}
          {qaParcel && (
            <ParcelLookupCard
              parcel={qaParcel}
              isLoading={qaParcelLoading}
              isAnalyzing={qaParcelAnalyzing}
              onAnalyze={handleQaParcelAnalyze}
              onClear={handleQaParcelClear}
              onCopyInfo={handleQaParcelCopyInfo}
              error={qaParcelError}
              geometryValidationError={geometryValidationError}
            />
          )}
          
          {/* Debug Mode Legend (shows when debug mode is on and parcel is selected) */}
          {geometryDebugMode && qaParcel && (
            <div className="absolute top-[300px] left-4 z-40 w-64 bg-gray-900/95 backdrop-blur-sm border border-red-500/40 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-red-400 mb-2">
                <Bug className="h-3.5 w-3.5" />
                <span>Geometry Debug Overlay</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-1 bg-red-500 rounded border border-dashed border-red-600" />
                  <span className="text-gray-400">Raw (Regrid)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-1 bg-cyan-500 rounded" />
                  <span className="text-gray-400">Normalized (API)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-1 bg-amber-400 rounded" />
                  <span className="text-gray-400">Analysis Input</span>
                </div>
              </div>
              {geometryTrace?.mismatchDetected && (
                <div className="mt-2 pt-2 border-t border-red-500/30">
                  <div className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="font-medium">Mismatch Detected!</span>
                  </div>
                  <ul className="mt-1 text-xs text-red-400/70 space-y-0.5">
                    {geometryTrace.mismatchDetails.slice(0, 3).map((d, i) => (
                      <li key={i} className="truncate" title={d}>• {d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!geometryTrace?.mismatchDetected && analysisCoords && (
                <div className="mt-2 pt-2 border-t border-emerald-500/30 text-xs text-emerald-400">
                  ✓ Boundaries match - no offset detected
                </div>
              )}
              <div className="mt-2 text-[10px] text-gray-500">
                Check console for full trace log
              </div>
            </div>
          )}
          
          {/* QA Scorecard (after analysis runs) */}
          {qaParcel && qaShowScorecard && !terrainFlowLoading && (
            <div className="absolute top-64 left-4 z-40 w-72">
              <QAScorecard
                parcelId={qaParcel.parcelId}
                state={qaParcel.state}
                county={qaParcel.county}
                acreage={qaParcel.acreage}
                demMode={terrainFlowData?.metadata?.mode || terrainFlowData?.metadata?.dem_source || 'unknown'}
                brokerScore={qaBrokerScore?.brokerScore}
                brokerClass={qaBrokerScore?.brokerClass}
                brokerComponents={qaBrokerScore?.components}
                onRatingSubmit={handleQaRatingSubmit}
                onSkip={handleQaScorecardSkip}
              />
            </div>
          )}
          
          {/* QA Session Summary (bottom left when entries exist) */}
          {qaSessionEntries.length > 0 && (
            <div className="absolute bottom-4 left-4 z-40 w-72">
              <QASessionSummary
                entries={qaSessionEntries}
                onClear={handleQaSessionClear}
                onExport={handleQaSessionExport}
                onShowAnalytics={() => setQaShowAnalytics(true)}
              />
            </div>
          )}
          
          {/* QA Analytics Panel (right side when visible) */}
          {qaShowAnalytics && (
            <div className="absolute top-16 right-4 z-50 w-80">
              <QAAnalyticsPanel
                entries={qaSessionEntries}
                onClose={() => setQaShowAnalytics(false)}
              />
            </div>
          )}
          
          {/* Instruction Banner (when no parcel selected) */}
          {!qaParcel && !qaParcelLoading && !qaParcelError && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-cyan-900/90 backdrop-blur rounded-lg px-4 py-2 border border-cyan-500/40 shadow-lg">
              <div className="flex items-center gap-2 text-sm text-cyan-100">
                <MapPin className="h-4 w-4 text-cyan-400" />
                <span>Click anywhere in <strong>Kansas</strong> or <strong>Missouri</strong> to explore a parcel</span>
              </div>
            </div>
          )}
          
          {/* Random Parcel Picker (when no parcel selected) */}
          {!qaParcel && !qaParcelLoading && (
            <RandomParcelPicker
              onParcelFound={handleRandomParcelFound}
              recentParcelIds={qaRecentParcelIds}
              disabled={qaParcelLoading}
            />
          )}
        </>
      )}

      {/* ========== EXPORT MODE OVERLAY ========== */}
      {exportMode && (
        <>
          {/* Export Mode Title Bar */}
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-gray-900/95 backdrop-blur rounded-xl px-6 py-3 border border-emerald-500/40 shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-emerald-500" />
                <span className="text-lg font-bold text-white">Terrain Intelligence</span>
              </div>
              <div className="h-5 w-px bg-white/20" />
              <div className="text-sm text-white/70">
                {address || 'Property Analysis'}
              </div>
            </div>
          </div>

          {/* Export Mode Legend - Main Row */}
          <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 bg-gray-900/95 backdrop-blur rounded-xl px-6 py-4 border border-white/15 shadow-2xl">
            <div className="flex items-center gap-6">
              {/* Flow Confidence */}
              <div className="space-y-2">
                <div className="text-[10px] text-stone-400 uppercase tracking-wider font-medium">Flow Confidence</div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-1 rounded-full bg-emerald-500" />
                    <span className="text-emerald-400">Strong</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-0.5 rounded-full bg-cyan-400" />
                    <span className="text-cyan-400">Moderate</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 rounded-full bg-slate-400 opacity-50" />
                    <span className="text-slate-400">Weak</span>
                  </div>
                </div>
              </div>

              <div className="h-10 w-px bg-white/20" />

              {/* Terrain Features */}
              <div className="space-y-2">
                <div className="text-[10px] text-stone-400 uppercase tracking-wider font-medium">Terrain Features</div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.funnelSaddle }} />
                    <span className="text-white/80">Saddle</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.funnelDraw }} />
                    <span className="text-white/80">Draw</span>
                  </div>
                </div>
              </div>

              <div className="h-10 w-px bg-white/20" />

              {/* Analysis Quality */}
              <div className="space-y-2">
                <div className="text-[10px] text-stone-400 uppercase tracking-wider font-medium">Analysis</div>
                <AnalysisQualityBadge 
                  mode={(terrainFlowData?.metadata?.mode || 'synthetic') as FlowMode}
                  compact={true}
                />
              </div>
            </div>
          </div>
          
          {/* Export Mode - Terrain Story Panel */}
          {terrainStory && (
            <div className="absolute bottom-28 right-4 z-30">
              <TerrainStoryExportLegend story={terrainStory} />
            </div>
          )}

          {/* Screenshot instruction */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 text-stone-500 text-xs">
            Press <kbd className="px-1.5 py-0.5 bg-stone-800 rounded text-stone-400">Cmd/Ctrl + Shift + 4</kbd> to screenshot • Click "Exit Export" when done
          </div>
        </>
      )}

      {/* Left Panel - Controls (hidden in export mode) */}
      {/* v3.8.3 — transition only width+opacity (not 'all') to prevent flicker on React re-renders */}
      <div className={`
        absolute top-16 bottom-4 left-4 z-10
        transition-[width,opacity] duration-300 will-change-[width]
        ${panelCollapsed ? 'w-12' : 'w-80'}
        ${exportMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}
      `}>
        <div className="h-full bg-gray-950/95 backdrop-blur-xl rounded-xl border border-white/[0.08] overflow-hidden flex flex-col shadow-2xl">
          {/* Collapse Toggle */}
          <button
            onClick={() => {
              setPanelCollapsed(v => !v);
              setTimeout(() => mapRef.current?.resize(), 310);
            }}
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 bg-gray-900/90 border border-white/[0.1] rounded-full p-1.5 hover:bg-gray-800 transition-all shadow-lg"
          >
            {panelCollapsed ? <ChevronRight className="h-4 w-4 text-white" /> : <ChevronLeft className="h-4 w-4 text-white" />}
          </button>

          {panelCollapsed ? (
            <div className="flex flex-col items-center py-4 gap-3 text-white/50">
              <MapPin className="h-5 w-5" />
              <span className="text-[10px] [writing-mode:vertical-rl] rotate-180">Parcel</span>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">

              {/* ═══ ONBOARDING — Demo welcome (dismissible) ═══ */}
              {/* ═══ HERO PARCEL SELECTOR — curated demo parcels ═══ */}
              {(demoMode || heroParcel) && (
                <div className="mx-3 mt-3 mb-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Demo Parcels</span>
                    <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] to-transparent" />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {HERO_PARCELS.map((hero) => {
                      const isActive = activeHeroSlug === hero.slug;
                      return (
                        <button
                          key={hero.slug}
                          onClick={() => !isActive && loadHeroParcel(hero)}
                          disabled={isLoading && !isActive}
                          className={`text-left rounded-lg px-2.5 py-2 transition-all duration-200 border ${
                            isActive
                              ? 'bg-amber-500/15 border-amber-500/40 ring-1 ring-amber-500/20'
                              : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.07] hover:border-white/[0.12]'
                          } ${isLoading && !isActive ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <p className={`text-[11px] font-semibold leading-tight ${isActive ? 'text-amber-300' : 'text-white/80'}`}>
                            {hero.label}
                          </p>
                          <p className="text-[9px] text-stone-500 leading-tight mt-0.5">{hero.tagline}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {showOnboarding && (
                <div className="mx-3 mt-2 mb-1 bg-gradient-to-br from-amber-500/[0.12] to-orange-500/[0.06] border border-amber-500/20 rounded-xl p-3 relative">
                  <button
                    onClick={() => setShowOnboarding(false)}
                    className="absolute top-2 right-2 text-white/40 hover:text-white/70 transition-colors"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex items-start gap-2.5 pr-4">
                    <span className="text-lg flex-shrink-0 mt-0.5">🦌</span>
                    <div>
                      <p className="text-[11px] font-semibold text-amber-300">Welcome to Deer Intel</p>
                      <p className="text-[10px] text-stone-400 leading-relaxed mt-1">
                        {"You're viewing a live terrain analysis of a real Missouri parcel. Switch between demo parcels above to see different terrain features — funnels, ridges, bedding areas, and stand placements."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══ CHAPTER 1 — PARCEL IDENTITY ═══ */}
              <div className="px-3 pt-3 pb-2">
                <div className="flex items-center gap-2 mb-2.5">
                  <MapPin className="h-3 w-3 text-amber-500/70" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Parcel Identity</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] to-transparent" />
                </div>
                {/* Address + Share */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/90 font-semibold leading-tight">{address}</p>
                    <p className="text-[10px] text-stone-600 mt-0.5">{lat.toFixed(5)}, {lng.toFixed(5)}</p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.href).then(() => {
                        setShareCopied(true);
                        setTimeout(() => setShareCopied(false), 2000);
                      });
                    }}
                    className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-stone-400 hover:text-amber-400 transition-all duration-200"
                    title="Copy shareable link"
                  >
                    {shareCopied ? <Check className="h-3 w-3 text-emerald-400" /> : <Share2 className="h-3 w-3" />}
                    <span className="text-[9px] font-medium uppercase tracking-wider">
                      {shareCopied ? 'Copied!' : 'Share'}
                    </span>
                  </button>
                </div>
                {/* Compact stat row */}
                <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                  <div className="bg-white/[0.04] rounded-lg px-2 py-1.5 text-center">
                    <p className="text-[9px] text-stone-500/70 uppercase tracking-wider font-medium">Acres</p>
                    <p className="text-sm text-white font-bold">{acreageParam || '~80'}</p>
                  </div>
                  {qaParcel?.county && (
                    <div className="bg-white/[0.04] rounded-lg px-2 py-1.5 text-center">
                      <p className="text-[9px] text-stone-500/70 uppercase tracking-wider font-medium">County</p>
                      <p className="text-[10px] text-white font-semibold mt-0.5">{qaParcel.county}{qaParcel.state ? `, ${qaParcel.state}` : ''}</p>
                    </div>
                  )}
                  {qaParcel?.owner && (
                    <div className="bg-white/[0.04] rounded-lg px-2 py-1.5 text-center">
                      <p className="text-[9px] text-stone-500/70 uppercase tracking-wider font-medium">Owner</p>
                      <p className="text-[10px] text-white/80 font-semibold mt-0.5 truncate">{qaParcel.owner}</p>
                    </div>
                  )}
                </div>
                {/* Zoning & PLSS inline */}
                {(qaParcel?.zoning || qaParcel?.plss) && (
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-stone-500/70">
                    {qaParcel?.zoning && <span>Zoning: <span className="text-white/60">{qaParcel.zoning}</span></span>}
                    {qaParcel?.plss && <span>PLSS: <span className="text-white/60 truncate">{qaParcel.plss}</span></span>}
                  </div>
                )}
              </div>

              {/* ═══ CHAPTER 2 — CONDITIONS ═══ */}
              <div className="px-3 pt-2 pb-2 border-t border-white/[0.04]">
                <div className="flex items-center gap-2 mb-2.5">
                  <Calendar className="h-3 w-3 text-amber-500/70" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Conditions</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] to-transparent" />
                </div>
                {/* Season picker */}
                <div className="grid grid-cols-3 gap-1.5">
                  {SEASONS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setSeason(s.value)}
                      className={`
                        p-2 rounded-lg text-center transition-all duration-150
                        ${season === s.value
                          ? 'bg-amber-500/20 border border-amber-500/50 text-white shadow-sm'
                          : 'bg-white/[0.03] border border-transparent text-white/60 hover:bg-white/[0.06] hover:text-white/80'}
                      `}
                    >
                      <span className="text-base block">{s.icon}</span>
                      <span className="text-[11px] font-medium block mt-1">{s.label}</span>
                      <span className="text-[9px] text-white/40 block">{s.dates}</span>
                    </button>
                  ))}
                </div>
                {/* Season profile hint (merged, no separate divider) */}
                <div className="bg-white/[0.04] rounded-lg p-2.5 mt-2.5">
                  {season === 'early' && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">🌿</span>
                        <span className="text-[11px] font-semibold text-white/90">Early Season</span>
                      </div>
                      <p className="text-[10px] text-stone-400 leading-relaxed">
                        Predictable bed-to-feed patterns. Focus food sources &amp; travel corridors near field edges.
                      </p>
                    </div>
                  )}
                  {season === 'rut' && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">🦌</span>
                        <span className="text-[11px] font-semibold text-white/90">Rut Phase</span>
                      </div>
                      <p className="text-[10px] text-stone-400 leading-relaxed">
                        Bucks cruise between bedding areas. Saddles, funnels &amp; ridge connections see peak traffic.
                      </p>
                    </div>
                  )}
                  {season === 'late' && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">❄️</span>
                        <span className="text-[11px] font-semibold text-white/90">Late Season</span>
                      </div>
                      <p className="text-[10px] text-stone-400 leading-relaxed">
                        Caloric stress drives deer to food. South-facing slopes provide thermal cover.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Wind compass (part of Conditions chapter, no separate header) */}
              <WindCompass
                windDirection={windDirection}
                windMinAgo={windMinAgo}
                season={season}
                onWindChange={(dir) => {
                  setWindDirection(dir);
                  setWindLastUpdated(new Date());
                }}
              />

              {/* ═══ CHAPTER 3 — INTELLIGENCE READOUT ═══ */}
              {summary && (
                <div className="px-3 pt-2 pb-2 border-t border-white/[0.04]">
                  <div className="flex items-center gap-2 mb-2.5">
                    <Target className="h-3 w-3 text-amber-500/70" />
                    <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Intelligence</span>
                    <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] to-transparent" />
                  </div>

                  {/* ── Plain-English "What We Found" summary ── */}
                  {!isLoading && (
                    <div className="bg-gradient-to-br from-emerald-500/[0.08] to-green-500/[0.04] border border-emerald-500/15 rounded-lg p-2.5 mb-2.5">
                      <p className="text-[10px] text-emerald-400/80 font-semibold uppercase tracking-wider mb-1">What We Found</p>
                      <p className="text-[11px] text-white/85 leading-relaxed">
                        {(() => {
                          const stands = alignedStands.length;
                          const score = summary.topStandScore;
                          const beds = summary.totalBeddingAcres;
                          const funnels = summary.funnelCount;
                          const acres = acreageParam || summary.analysisAreaAcres?.toFixed(0) || '—';

                          // Build a natural sentence
                          const quality = score >= 80 ? 'excellent' : score >= 65 ? 'strong' : score >= 50 ? 'moderate' : 'limited';
                          const standPhrase = stands > 0 
                            ? `We identified ${stands} stand placement${stands > 1 ? 's' : ''} with ${quality} alignment to the terrain` 
                            : 'No stand placements met our quality threshold on this parcel';
                          const beddingPhrase = beds > 3 ? `, ${beds.toFixed(1)} acres of bedding cover` : beds > 0 ? ` and some bedding cover` : '';
                          const funnelPhrase = funnels > 2 ? `, and ${funnels} natural funnels that concentrate movement` : funnels > 0 ? ` with ${funnels} natural funnel${funnels > 1 ? 's' : ''}` : '';

                          return `${standPhrase}${beddingPhrase}${funnelPhrase}. This ${acres}-acre property ${score >= 65 ? 'shows real hunting potential' : 'has some terrain features worth scouting'}.`;
                        })()}
                      </p>
                    </div>
                  )}

                  {/* ── Terrain Story Headline ── */}
                  {terrainStory && (
                    <div className="mb-2.5">
                      <p className="text-[11px] text-white/90 font-semibold leading-snug">{terrainStory.headline}</p>
                      {terrainStory.narrative && (
                        <p className="text-[10px] text-stone-400 leading-relaxed mt-1">{terrainStory.narrative}</p>
                      )}
                    </div>
                  )}

                  {/* ── Parcel Character Bar ── */}
                  <div className="bg-white/[0.03] rounded-lg p-2 mb-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] text-stone-500/70 uppercase tracking-wider font-medium">Parcel Character</span>
                      {terrainStory && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                          terrainStory.confidence === 'high' ? 'bg-emerald-500/15 text-emerald-400' :
                          terrainStory.confidence === 'medium' ? 'bg-amber-500/15 text-amber-400' :
                          'bg-stone-500/15 text-stone-400'
                        }`}>
                          {terrainStory.confidence === 'high' ? '● High Confidence' : terrainStory.confidence === 'medium' ? '● Medium' : '● Low'}
                        </span>
                      )}
                    </div>
                    {/* Character description derived from data */}
                    <p className="text-[10px] text-white/70 leading-relaxed">
                      {summary.totalBeddingAcres > 5 ? 'Strong bedding cover' : summary.totalBeddingAcres > 2 ? 'Moderate bedding cover' : 'Limited bedding cover'}
                      {summary.funnelCount > 3 ? ' with heavy funnel density' : summary.funnelCount > 1 ? ' with natural funneling' : ''}
                      {summary.topStandScore >= 80 ? ' — premium stand opportunities.' : summary.topStandScore >= 60 ? ' — solid stand potential.' : ' — marginal stand options.'}
                    </p>
                  </div>

                  {/* ── Movement & Drivers ── */}
                  {terrainStory?.primaryDriver && (
                    <div className="flex items-start gap-2 mb-2">
                      <div className="w-1 h-full min-h-[24px] rounded-full bg-amber-500/40 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[9px] text-stone-500/70 uppercase tracking-wider font-medium">Primary Movement</p>
                        <p className="text-[11px] text-amber-400/90 font-semibold">{terrainStory.primaryDriver.label}</p>
                        {terrainStory.secondaryDriver && (
                          <p className="text-[10px] text-stone-500 mt-0.5">+ {terrainStory.secondaryDriver.label}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Key Metrics Row ── */}
                  <div className="grid grid-cols-4 gap-1 mb-2">
                    <div className="text-center">
                      <p className="text-sm text-white font-bold">{summary.totalBeddingAcres.toFixed(1)}</p>
                      <p className="text-[8px] text-stone-500/70 uppercase">Bed ac</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-white font-bold">{summary.funnelCount}</p>
                      <p className="text-[8px] text-stone-500/70 uppercase">Funnels</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-sm font-bold ${summary.topStandScore >= 80 ? 'text-red-400' : summary.topStandScore >= 60 ? 'text-amber-400' : 'text-stone-400'}`}>
                        {summary.topStandScore}
                      </p>
                      <p className="text-[8px] text-stone-500/70 uppercase">Top Score</p>
                      <p className="text-[8px] text-stone-500/50 italic mt-0.5">Wind &amp; season adjusted</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-white font-bold">{alignedStands.length || '—'}</p>
                      <p className="text-[8px] text-stone-500/70 uppercase">Stands</p>
                    </div>
                  </div>

                  {/* ── Share Score Card ── */}
                  {!isLoading && summary.topStandScore > 0 && (
                    <button
                      onClick={() => setShowScoreCard(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 mb-2
                                 rounded-lg bg-amber-500/10 border border-amber-500/20
                                 text-amber-400 text-[11px] font-semibold
                                 hover:bg-amber-500/20 transition-colors"
                    >
                      📤 Share My Score
                    </button>
                  )}


                  {/* ── Key Opportunity ── */}
                  {terrainStory?.keyOpportunity && (
                    <div className="bg-amber-500/[0.06] border border-amber-500/10 rounded-lg px-2 py-1.5 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-400 text-[10px]">★</span>
                        <p className="text-[10px] text-amber-300/90 font-medium">{terrainStory.keyOpportunity.reason}</p>
                      </div>
                      <p className="text-[9px] text-stone-500 mt-0.5 ml-4">{terrainStory.keyOpportunity.location}</p>
                    </div>
                  )}

                  {/* ── Elevation Profile (if DEM metrics available) ── */}
                  {summary.demMetrics && (
                    <div className="flex items-center gap-3 text-[9px] text-stone-500/60 mt-1">
                      <span>{summary.demMetrics.elevRange.toFixed(0)}m relief</span>
                      <span>·</span>
                      <span>{summary.demMetrics.slopeMean?.toFixed(1) ?? '—'}° avg slope</span>
                      <span>·</span>
                      <span>{summary.analysisAreaAcres.toFixed(0)} ac</span>
                    </div>
                  )}
                  {!summary.demMetrics && (
                    <div className="flex items-center gap-3 text-[9px] text-stone-500/60 mt-1">
                      <span>{summary.analysisAreaAcres.toFixed(0)} ac analyzed</span>
                    </div>
                  )}

                  {/* Provenance */}
                  {provenance && (
                    <p className="mt-1.5 text-[9px] text-white/20">
                      {provenance.demSource} · {provenance.demResolution}{provenance.processingTimeSeconds ? ` · ${provenance.processingTimeSeconds.toFixed(1)}s` : ''}
                    </p>
                  )}
                </div>
              )}

              {/* ═══ CHAPTER 4 — REFINE (single-parcel only) ═══ */}
              {!territoryMode && (
              <div className="p-3 border-t border-white/[0.06] mt-auto">
                {/* Last analysis timestamp */}
                {summary && !isLoading && (
                  <div className="flex items-center justify-center gap-1.5 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500/80 animate-pulse" />
                    <span className="text-[10px] text-stone-500/70">Terrain aligned</span>
                  </div>
                )}
                <button
                  onClick={runAnalysis}
                  disabled={isLoading}
                  className={`
                    group relative w-full overflow-hidden rounded-xl px-4 py-3.5 
                    font-semibold text-sm tracking-wide
                    transition-all duration-300 ease-out
                    focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:ring-offset-2 focus:ring-offset-gray-950
                    ${isLoading
                      ? 'bg-amber-900/30 border border-amber-700/30 cursor-wait text-amber-300/70'
                      : 'bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 hover:from-amber-500 hover:via-amber-400 hover:to-orange-400 text-white shadow-lg shadow-amber-900/30 hover:shadow-amber-800/40 hover:shadow-xl active:scale-[0.98] border border-amber-500/20'}
                  `}
                >
                  {/* Animated shimmer on hover */}
                  {!isLoading && (
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                    </div>
                  )}
                  {/* Loading progress bar embedded in button */}
                  {isLoading && (
                    <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-amber-500 via-amber-400 to-orange-400 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
                  )}
                  <div className="relative flex items-center justify-center gap-2.5">
                    {isLoading ? (
                      <>
                        <div className="relative">
                          <RefreshCw className="h-4 w-4 animate-spin" style={{ animationDuration: '2s' }} />
                          <div className="absolute inset-0 animate-ping opacity-20">
                            <RefreshCw className="h-4 w-4" />
                          </div>
                        </div>
                        <span>Refining Terrain…</span>
                        <span className="text-amber-400/60 text-xs font-mono">{progress}%</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 transition-transform duration-300 group-hover:rotate-180" />
                        <span>Re-Align Terrain</span>
                      </>
                    )}
                  </div>
                </button>
                {/* Contextual hint */}
                {!isLoading && !summary && (
                  <p className="text-[10px] text-stone-500/60 text-center mt-2 leading-relaxed">
                    Runs terrain analysis with current season &amp; wind settings
                  </p>
                )}
              </div>
              )}

              {/* ═══ SAVE PROMPT + CTA ═══ */}
              {summary && !isLoading && (
                <div className="px-3 pb-3 space-y-2">
                  {/* Save to Library prompt — non-Pro, logged-in, not yet saved */}
                  {session?.user && !saveConfirmed && !lastSavedPropertyId && !territoryMode && (
                    <div className="bg-emerald-500/[0.08] border border-emerald-500/20 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">📌</span>
                        <p className="text-[11px] text-emerald-300 font-semibold">Save to your library</p>
                      </div>
                      <p className="text-[10px] text-stone-400 leading-relaxed mb-2">
                        Keep this parcel in your Terrain Intelligence Library for quick access anytime.
                      </p>
                      <button
                        onClick={handleSaveProperty}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold rounded-lg transition-colors"
                      >
                        Save Parcel
                      </button>
                    </div>
                  )}
                  {/* Saved confirmation */}
                  {saveConfirmed && (
                    <div className="bg-emerald-500/[0.08] border border-emerald-500/20 rounded-xl p-3 text-center">
                      <p className="text-[11px] text-emerald-300 font-semibold">✓ Saved to your library</p>
                      <Link href="/properties" className="text-[10px] text-emerald-400/70 hover:text-emerald-300 underline mt-1 inline-block">
                        View all saved parcels →
                      </Link>
                    </div>
                  )}
                  {/* Sign up prompt for non-logged-in users */}
                  {!session?.user && (
                    <div className="bg-amber-500/[0.08] border border-amber-500/20 rounded-xl p-3">
                      <p className="text-[11px] text-amber-300 font-semibold">Create an account to save this hunt plan</p>
                      <p className="text-[10px] text-stone-400 leading-relaxed mt-1 mb-2">
                        Save parcels, unlock full intelligence, and build your terrain library.
                      </p>
                      <Link
                        href="/login?callbackUrl=%2Fintel"
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold rounded-lg transition-colors"
                      >
                        Sign Up / Log In
                      </Link>
                    </div>
                  )}
                  {/* Unlock CTA for locked parcels */}
                  {!parcelUnlocked && !isPro && !territoryMode && (
                    <div className="bg-gradient-to-br from-amber-500/[0.10] to-orange-500/[0.06] border border-amber-500/20 rounded-xl p-3">
                      <p className="text-[11px] text-white/90 font-semibold">🔒 Full hunt plan locked</p>
                      <p className="text-[10px] text-stone-400 leading-relaxed mt-1 mb-2">
                        Unlock stand locations, approach routes, and your complete Hunt Report for just $19.
                      </p>
                      <button
                        onClick={() => setShowParcelPaywall(true)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold rounded-lg transition-colors shadow-lg shadow-amber-900/30"
                      >
                        <Target className="h-3.5 w-3.5" />
                        Unlock — $19
                      </button>
                    </div>
                  )}
                  {/* Existing CTA for demo visitors */}
                  {demoMode && (
                    <div className="bg-gradient-to-br from-red-500/[0.10] to-orange-500/[0.06] border border-red-500/20 rounded-xl p-3">
                      <p className="text-[11px] text-white/90 font-semibold">Ready to scout your own land?</p>
                      <p className="text-[10px] text-stone-400 leading-relaxed mt-1">
                        Get the same terrain intelligence for any property.
                      </p>
                      <div className="flex gap-2 mt-2.5">
                        <Link
                          href="/map"
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold rounded-lg transition-colors shadow-lg shadow-red-900/30"
                        >
                          <Target className="h-3.5 w-3.5" />
                          Analyze My Property
                        </Link>
                        <Link
                          href="/pricing"
                          className="flex items-center justify-center gap-1 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.10] text-stone-300 text-[10px] font-medium rounded-lg transition-colors border border-white/[0.08]"
                        >
                          Pricing
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Layer Filters + Top 2 Stands (hidden in export mode) */}
      {/* v3.8.3 — transition only width+opacity (not 'all') to prevent flicker on React re-renders */}
      <div className={`
        absolute top-16 bottom-4 right-4 z-10
        transition-[width,opacity] duration-300 will-change-[width]
        ${rightPanelCollapsed ? 'w-12' : 'w-72'}
        ${exportMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}
      `}>
        <div className="h-full bg-gray-950/95 backdrop-blur-xl rounded-xl border border-white/[0.08] overflow-hidden flex flex-col shadow-2xl">
          {/* Collapse Toggle */}
          <button
            onClick={() => {
              setRightPanelCollapsed(v => !v);
              setTimeout(() => mapRef.current?.resize(), 310);
            }}
            className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 bg-gray-900/90 border border-white/[0.1] rounded-full p-1.5 hover:bg-gray-800 transition-all shadow-lg"
          >
            {rightPanelCollapsed ? <ChevronLeft className="h-4 w-4 text-white" /> : <ChevronRight className="h-4 w-4 text-white" />}
          </button>

          {rightPanelCollapsed ? (
            <div className="flex flex-col items-center py-4 gap-3 text-white/60">
              <Layers className="h-5 w-5" />
              <span className="text-[10px] [writing-mode:vertical-rl] rotate-180">Intel</span>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* ─── ANALYSIS LOADING BAR ─── */}
              <TerrainLoadingBar visible={terrainFlowLoading || qaParcelAnalyzing || (isLoading && backgroundAnalysis)} />
              {/* ─── TERRAIN FLOW ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Terrain Flow</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
                <p className="text-[9px] text-stone-600 mt-1 leading-relaxed">How terrain shapes where deer travel</p>
              </div>

              {/* Travel Corridor Layer (Primary Movement Path - ON by default) */}
              <div className="p-3 border-b border-white/[0.06]">
                <h3 className="font-medium text-white flex items-center gap-2 mb-2 text-sm">
                  <Mountain className="h-4 w-4 text-stone-400" />
                  Travel Corridor
                </h3>
                <div className="space-y-1">
                  {(() => {
                    // Calculate corridor status
                    const primaryCount = ridgeSpineData?.metadata?.ridge_count_primary || 0;
                    const secondaryCount = ridgeSpineData?.metadata?.ridge_count_secondary || 0;
                    const saddleCount = ridgeSpineData?.metadata?.saddle_count || 0;
                    const totalFeatures = primaryCount + secondaryCount + saddleCount;
                    const isAwaitingData = ridgeSpineData?.metadata?.dem_source === 'AWAITING_DEM' || 
                                           ridgeSpineData?.metadata?.dem_source === 'NONE' ||
                                           !ridgeSpineData;
                    const hasFeatures = totalFeatures > 0;
                    
                    return (
                      <button
                        onClick={() => setVisibility(v => ({ ...v, ridgeSpines: !v.ridgeSpines }))}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                          visibility.ridgeSpines ? 'bg-white/[0.08] border border-white/[0.12]' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.ridgePrimary, opacity: visibility.ridgeSpines ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${visibility.ridgeSpines ? 'text-white' : 'text-stone-500'}`}>Primary Path</span>
                        {/* Status badge */}
                        {hasFeatures ? (
                          <span className="text-[9px] text-green-400 px-1.5 py-0.5 bg-green-900/40 rounded">
                            {primaryCount}{secondaryCount > 0 ? `+${secondaryCount}` : ''}
                          </span>
                        ) : isAwaitingData ? (
                          <span className="text-[9px] text-stone-500 px-1.5 py-0.5 bg-stone-800 rounded">—</span>
                        ) : null}
                      </button>
                    );
                  })()}
                </div>
                
                {/* Expanded details when toggle is on */}
                {visibility.ridgeSpines && (
                  <div className="mt-2 text-[10px] space-y-1 px-1">
                    {(() => {
                      const primaryCount = ridgeSpineData?.metadata?.ridge_count_primary || 0;
                      const secondaryCount = ridgeSpineData?.metadata?.ridge_count_secondary || 0;
                      const saddleCount = ridgeSpineData?.metadata?.saddle_count || 0;
                      const totalFeatures = primaryCount + secondaryCount + saddleCount;
                      const isAwaitingData = ridgeSpineData?.metadata?.dem_source === 'AWAITING_DEM' || 
                                             ridgeSpineData?.metadata?.dem_source === 'NONE' ||
                                             !ridgeSpineData;
                      
                      // Case 1: Features detected
                      if (totalFeatures > 0) {
                        return (
                          <div className="text-stone-400 space-y-0.5">
                            <div className="flex justify-between">
                              <span>Primary Spines</span>
                              <span className="text-white">{primaryCount}</span>
                            </div>
                            {secondaryCount > 0 && (
                              <div className="flex justify-between">
                                <span>Secondary</span>
                                <span className="text-white">{secondaryCount}</span>
                              </div>
                            )}
                            {saddleCount > 0 && (
                              <div className="flex justify-between">
                                <span>Saddles</span>
                                <span className="text-white">{saddleCount}</span>
                              </div>
                            )}
                            {ridgeSpineData?.metadata?.total_ridge_length_m && ridgeSpineData.metadata.total_ridge_length_m > 0 && (
                              <div className="flex justify-between text-stone-500 pt-0.5 border-t border-white/5">
                                <span>Total Length</span>
                                <span>{Math.round(ridgeSpineData.metadata.total_ridge_length_m)}m</span>
                              </div>
                            )}
                          </div>
                        );
                      }
                      
                      // Case 2: No features detected (clean empty state)
                      return (
                        <div className="text-stone-500 bg-stone-800/30 rounded p-2">
                          <p className="italic">Not detected on this parcel</p>
                          <p className="text-stone-600 mt-1 text-[9px]">
                            Terrain may be too flat or uniform for distinct spine features.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
              <div className="p-3 border-b border-white/[0.06]">
                <div className="space-y-1">
                  <button
                    onClick={() => setVisibility(v => ({ ...v, saddles: !v.saddles }))}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                      visibility.saddles ? 'bg-white/[0.08] border border-white/[0.12]' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.funnelSaddle, opacity: visibility.saddles ? 1 : 0.4 }} />
                    <span className={`flex-1 text-left ${visibility.saddles ? 'text-white' : 'text-stone-500'}`}>
                      Saddles
                    </span>
                  </button>
                </div>
              </div>
              {/* Legacy "Bedding" toggle removed — replaced by Bedding Zones (tfp-bedding-probability) */}
              <div className="p-3 border-b border-white/[0.06]">
                {/* v3.6.0: Terrain Reasons Toggle */}
                <div className="mt-1">
                  <button
                    onClick={() => setShowTerrainReasons(v => !v)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                      showTerrainReasons 
                        ? 'bg-gradient-to-r from-purple-900/40 to-violet-900/40 border border-purple-700/40' 
                        : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    <Info className={`h-4 w-4 ${showTerrainReasons ? 'text-purple-400' : 'text-stone-500'}`} />
                    <span className={`flex-1 text-left font-medium ${showTerrainReasons ? 'text-purple-300' : 'text-stone-400'}`}>
                      Show Terrain Reasons
                    </span>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full uppercase tracking-wider ${
                      showTerrainReasons ? 'bg-purple-500/30 text-purple-300' : 'bg-stone-700/50 text-stone-500'
                    }`}>
                      {showTerrainReasons ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  {showTerrainReasons && (
                    <p className="text-[9px] text-purple-300/70 mt-1.5 px-2 leading-relaxed">
                      Click any stand, corridor, or bedding zone to see why terrain factors make it significant.
                    </p>
                  )}
                </div>
              </div>

              <div className="p-3 border-b border-white/[0.06]">
                <div className="space-y-1">
                  
                  {/* v3.7: Bedding Zone Toggle with type legend */}
                  {(() => {
                    const beddingCount = huntabilityData?.metadata?.beddingZoneCount || 0;
                    const hasData = beddingCount > 0;
                    
                    return (
                      <>
                        <button
                          onClick={() => setShowBeddingProbability(v => !v)}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                            !huntabilityData ? 'opacity-40 cursor-not-allowed' :
                            showBeddingProbability ? 'bg-emerald-900/30' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                          }`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#52b788', opacity: showBeddingProbability ? 1 : 0.4 }} />
                          <span className={`flex-1 text-left ${showBeddingProbability ? 'text-white' : 'text-stone-500'}`}>Bedding Zones</span>
                          {hasData ? (
                            <span className="text-[9px] text-emerald-300 px-1.5 py-0.5 bg-emerald-800/40 rounded">
                              {beddingCount}
                            </span>
                          ) : (
                            <span className="text-[8px] text-emerald-400/60 px-1 py-0.5 bg-emerald-900/30 rounded uppercase tracking-wider">
                              v3
                            </span>
                          )}
                        </button>
                        {showBeddingProbability && hasData && (
                          <div className="ml-5 mt-1 space-y-0.5">
                            {[
                              { type: 'Sanctuary', color: '#1a5c2a', desc: 'Remote ridge pocket' },
                              { type: 'Thermal', color: '#52b788', desc: 'South-facing warmth' },
                              { type: 'Staging', color: '#95d5b2', desc: 'Near corridor offset' },
                              { type: 'Escape', color: '#74c69d', desc: 'High ridge cover' },
                            ].map(b => (
                              <div key={b.type} className="flex items-center gap-1.5 text-[9px]">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: b.color }} />
                                <span className="text-stone-400">{b.type}</span>
                                <span className="text-stone-600">— {b.desc}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              {/* ─── DEER FLOW ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Deer Flow</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
                <p className="text-[9px] text-stone-600 mt-1 leading-relaxed">Predicted movement patterns and pressure zones</p>
              </div>

              {/* ========== TERRAIN FLOW LAYER (Movement Likelihood) ========== */}
              <div className="p-3 border-b border-white/[0.06]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-white flex items-center gap-2 text-sm">
                    <Compass className="h-4 w-4 text-cyan-400" />
                    Terrain Flow
                    {terrainFlowLoading && (
                      <Loader2 className="h-3 w-3 animate-spin text-cyan-400/60" />
                    )}
                    {/* V2 Badge */}
                    {!flowComparisonMode && !terrainFlowLoading && (
                      <span className="text-[8px] text-cyan-500 bg-cyan-950 px-1 py-0.5 rounded">V2</span>
                    )}
                  </h3>
                  {/* Inspect Mode Toggle */}
                  <button
                    onClick={() => setInspectModeEnabled(!inspectModeEnabled)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all ${
                      inspectModeEnabled 
                        ? 'bg-amber-900/50 text-amber-400 border border-amber-700/50' 
                        : 'bg-stone-800/50 text-stone-500 hover:bg-stone-700/50 hover:text-stone-400'
                    }`}
                    title="Enable inspect mode to click flow segments for detailed analysis"
                  >
                    <Crosshair className="h-3 w-3" />
                    <span>{inspectModeEnabled ? 'Inspecting' : 'Inspect'}</span>
                  </button>
                </div>
                
                {/* Analysis Quality Badge - compact inline version */}
                {!terrainFlowLoading && terrainFlowData && (
                  <div className="mb-2">
                    <AnalysisQualityBadge 
                      mode={(terrainFlowData?.metadata?.mode || 'synthetic') as FlowMode}
                      compact={true}
                    />
                  </div>
                )}
                
                {/* Before/After Comparison Toggle */}
                {legacySyntheticData && (
                  <div className="mb-2 p-2 bg-stone-800/40 rounded-lg">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className={flowComparisonMode ? 'text-stone-500' : 'text-cyan-400 font-medium'}>
                        Terrain-Driven (V2)
                      </span>
                      <button
                        onClick={() => setFlowComparisonMode(!flowComparisonMode)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${
                          flowComparisonMode ? 'bg-amber-700' : 'bg-cyan-700'
                        }`}
                        title="Toggle between terrain-driven (V2) and legacy synthetic flow"
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          flowComparisonMode ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                      </button>
                      <span className={flowComparisonMode ? 'text-amber-400 font-medium' : 'text-stone-500'}>
                        Legacy (V1)
                      </span>
                    </div>
                    {flowComparisonMode && (
                      <div className="mt-1.5 text-[9px] text-amber-400/80 bg-amber-900/30 rounded p-1.5">
                        <span className="font-medium">⚠️ LEGACY MODE:</span> Showing old parcel-axis-based flow for comparison. 
                        Lines follow property shape, not terrain.
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-1">
                  {/* HEAT MAP Toggle (PRIMARY) */}
                  <button
                    onClick={() => setFlowVisibility(v => ({ ...v, pressureHeatmap: !v.pressureHeatmap }))}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                      flowVisibility.pressureHeatmap ? 'bg-amber-900/40 border border-amber-700/30' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ 
                      background: 'linear-gradient(135deg, #0f766e, #06b6d4, #10b981, #f59e0b)', 
                      opacity: flowVisibility.pressureHeatmap ? 1 : 0.4 
                    }} />
                    <span className={`flex-1 text-left font-medium ${flowVisibility.pressureHeatmap ? 'text-amber-300' : 'text-stone-500'}`}>
                      Deer Flow
                    </span>
                    <span className="text-[8px] text-amber-400 px-1 py-0.5 bg-amber-900/50 rounded uppercase tracking-wider">
                      Primary
                    </span>
                  </button>

                  {/* pressureFocus/pressureView UI removed — locked to balanced/pressure */}
                  {/* Divider with "Supporting Evidence" label */}
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-px bg-stone-700/50" />
                    <span className="text-[8px] text-stone-600 uppercase tracking-wider">Supporting</span>
                    <div className="flex-1 h-px bg-stone-700/50" />
                  </div>
                  
                  {/* Primary Flow Toggle (now secondary) */}
                  {(() => {
                    const primaryCount = terrainFlowData?.metadata?.flow_count_primary || 0;
                    const hasData = primaryCount > 0;
                    const isLoading = terrainFlowLoading;
                    
                    return (
                      <button
                        onClick={() => setFlowVisibility(v => ({ ...v, flowPrimary: !v.flowPrimary }))}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded transition-all text-[11px] ${
                          flowVisibility.flowPrimary ? 'bg-cyan-900/20' : 'bg-stone-800/20 hover:bg-stone-700/20'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded" style={{ background: LAYER_COLORS.flowPrimary, opacity: flowVisibility.flowPrimary ? 1 : 0.3 }} />
                        <span className={`flex-1 text-left ${flowVisibility.flowPrimary ? 'text-stone-300' : 'text-stone-600'}`}>Flow Lines</span>
                        {hasData ? (
                          <span className="text-[8px] text-cyan-400/70 px-1 py-0.5 bg-cyan-900/30 rounded">
                            {primaryCount}
                          </span>
                        ) : isLoading ? (
                          <span className="text-[8px] text-stone-600 px-1 py-0.5 bg-stone-800 rounded">...</span>
                        ) : (
                          <span className="text-[8px] text-stone-600 px-1 py-0.5 bg-stone-800 rounded">—</span>
                        )}
                      </button>
                    );
                  })()}
                  
                  {/* Secondary Flow Toggle */}
                  {(() => {
                    const secondaryCount = terrainFlowData?.metadata?.flow_count_secondary || 0;
                    const hasData = secondaryCount > 0;
                    
                    return (
                      <button
                        onClick={() => setFlowVisibility(v => ({ ...v, flowSecondary: !v.flowSecondary }))}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                          flowVisibility.flowSecondary ? 'bg-cyan-900/20' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.flowSecondary, opacity: flowVisibility.flowSecondary ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${flowVisibility.flowSecondary ? 'text-white' : 'text-stone-500'}`}>Secondary Flow</span>
                        {hasData && (
                          <span className="text-[9px] text-cyan-300 px-1.5 py-0.5 bg-cyan-900/30 rounded">
                            {secondaryCount}
                          </span>
                        )}
                      </button>
                    );
                  })()}
                  
                  {/* Convergence Zones Toggle */}
                  {(() => {
                    const convergenceCount = terrainFlowData?.metadata?.convergence_count || 0;
                    const hasData = convergenceCount > 0;
                    
                    return (
                      <button
                        onClick={() => setFlowVisibility(v => ({ ...v, convergenceZones: !v.convergenceZones }))}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                          flowVisibility.convergenceZones ? 'bg-amber-900/20' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.flowConvergence, opacity: flowVisibility.convergenceZones ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${flowVisibility.convergenceZones ? 'text-white' : 'text-stone-500'}`}>Convergence</span>
                        {hasData && (
                          <span className="text-[9px] text-amber-400 px-1.5 py-0.5 bg-amber-900/30 rounded">
                            {convergenceCount}
                          </span>
                        )}
                      </button>
                    );
                  })()}
                </div>

                
                {/* Expanded details when any flow toggle is on */}
                {(flowVisibility.flowPrimary || flowVisibility.flowSecondary || flowVisibility.convergenceZones) && (
                  <div className="mt-2 space-y-2 px-1">
                    {(() => {
                      const primaryCount = terrainFlowData?.metadata?.flow_count_primary || 0;
                      const secondaryCount = terrainFlowData?.metadata?.flow_count_secondary || 0;
                      const convergenceCount = terrainFlowData?.metadata?.convergence_count || 0;
                      const totalFlowLength = terrainFlowData?.metadata?.total_flow_length_m || 0;
                      const totalFeatures = primaryCount + secondaryCount + convergenceCount;
                      const isSynthetic = terrainFlowData?.isSynthetic || false;
                      const mode = (terrainFlowData?.metadata?.mode || 'synthetic') as FlowMode;
                      
                      if (terrainFlowLoading) {
                        return (
                          <div className="text-stone-500 bg-stone-800/30 rounded p-2 flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span className="text-[10px]">Analyzing terrain flow...</span>
                          </div>
                        );
                      }
                      
                      if (totalFeatures > 0) {
                        return (
                          <>
                            {/* Data Quality — clean, customer-facing */}
                            <div className={`p-2 rounded-lg border ${mode === 'real_dem' ? 'bg-emerald-900/20 border-emerald-700/30' : 'bg-amber-900/20 border-amber-700/30'}`}>
                              <div className="flex items-center gap-2">
                                <CheckCircle className={`h-3.5 w-3.5 ${mode === 'real_dem' ? 'text-emerald-400' : 'text-amber-400'}`} />
                                <span className={`text-[10px] font-medium ${mode === 'real_dem' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                  {mode === 'real_dem' ? 'High-Resolution Terrain Data' : 'Estimated Terrain'}
                                </span>
                              </div>
                            </div>
                            
                            {/* Movement summary — plain language */}
                            <div className="text-[10px] text-stone-400 space-y-0.5">
                              {primaryCount > 0 && (
                                <div className="flex justify-between">
                                  <span>Primary Routes</span>
                                  <span className="text-emerald-400">{primaryCount}</span>
                                </div>
                              )}
                              {secondaryCount > 0 && (
                                <div className="flex justify-between">
                                  <span>Secondary Routes</span>
                                  <span className="text-cyan-400">{secondaryCount}</span>
                                </div>
                              )}
                              {convergenceCount > 0 && (
                                <div className="flex justify-between">
                                  <span>Pinch Points</span>
                                  <span className="text-amber-400">{convergenceCount}</span>
                                </div>
                              )}
                            </div>
                            
                            {/* Click instruction - highlighted when inspect mode is on */}
                            <div className={`text-[9px] text-center pt-1 border-t border-white/5 ${
                              inspectModeEnabled ? 'text-amber-400 bg-amber-900/20 -mx-2 px-2 py-1 rounded' : 'text-stone-600'
                            }`}>
                              {inspectModeEnabled ? (
                                <span className="flex items-center justify-center gap-1">
                                  <Crosshair className="h-3 w-3" />
                                  Inspect mode ON — click any flow or zone
                                </span>
                              ) : (
                                'Click any flow line for detailed analysis'
                              )}
                            </div>
                          </>
                        );
                      }
                      
                      return (
                        <div className="text-stone-500 bg-stone-800/30 rounded p-2">
                          <p className="italic text-[10px]">Not detected on this parcel</p>
                          <p className="text-stone-600 mt-1 text-[9px]">
                            Terrain may be too flat or uniform for distinct flow patterns.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>


              {/* ========== TERRAIN STORY PANEL (Secondary detail) ========== */}
              {(terrainStory || terrainFlowLoading) && !exportMode && (
                <div className="p-3 border-b border-white/[0.06]">
                  <TerrainStoryPanel 
                    story={terrainStory}
                    isLoading={terrainFlowLoading}
                    defaultExpanded={false}
                    showNarrative={true}
                    compact={true}
                  />
                </div>
              )}

              {/* Terrain Rating panel removed — data (qaBrokerScore) still computed for export/tooltips */}

              {/* ========== TERRAIN WORK MODE NOTICE ========== */}
              {TERRAIN_WORK_MODE && <TerrainWorkModeNotice />}

              {/* ─── STAND SELECTION ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Stand Selection</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
                <p className="text-[9px] text-stone-600 mt-1 leading-relaxed">Best treestand locations ranked by terrain advantage</p>
              </div>

              <div className="p-3 border-b border-white/[0.06]">
                <div className="space-y-1">
                  {/* Stands toggle - disabled during terrain refinement */}
                  {!TERRAIN_WORK_MODE && (
                    <button
                      onClick={() => {
                        const wasVisible = visibility.stands;
                        setVisibility(v => ({ ...v, stands: !v.stands }));
                        // Hiding stands → also exit solo mode for a clean re-show
                        if (wasVisible && soloStandMode) {
                          setSoloStandMode(false);
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                        visibility.stands ? 'bg-white/[0.08] border border-white/[0.12]' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.standGold, opacity: visibility.stands ? 1 : 0.4 }} />
                      <span className={`flex-1 text-left ${visibility.stands ? 'text-white' : 'text-stone-500'}`}>
                        {visibility.stands ? 'Hide Stands' : 'Show Stands'}
                      </span>
                    </button>
                  )}

                  {/* Solo Selected Stand toggle — only enabled when stands are visible */}
                  {!TERRAIN_WORK_MODE && visibility.stands && (
                    <button
                      onClick={() => {
                        const next = !soloStandMode;
                        setSoloStandMode(next);
                        // When entering solo mode with no stand selected,
                        // auto-select the top stand so there's something visible.
                        if (next && selectedStand === null && alignedStands.length > 0) {
                          setSelectedStand(alignedStands[0].rank);
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                        soloStandMode ? 'bg-amber-900/40 border border-amber-600/30' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: soloStandMode ? '#f59e0b' : '#78716c', opacity: soloStandMode ? 1 : 0.4 }} />
                      <span className={`flex-1 text-left ${soloStandMode ? 'text-amber-200' : 'text-stone-500'}`}>
                        {soloStandMode ? 'Show All Stands' : 'Solo Selected Stand'}
                      </span>
                    </button>
                  )}


                  {/* ========== STAND COMPARE SELECTORS (v1.2) ==========
                      Two compact dropdowns for selecting stands to compare.
                      State-only — no calculations or layer changes yet. */}
                  {flowVisibility.pressureHeatmap && alignedStands.length >= 2 && (
                    <div className="px-2 py-2 bg-white/[0.03] rounded-lg border border-white/[0.06] mt-1">
                      <span className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium block mb-1.5">Compare Stands</span>
                      <div className="grid grid-cols-2 gap-2">
                        {/* Compare A */}
                        <div>
                          <label className="text-[8px] text-stone-500 block mb-0.5">A</label>
                          <select
                            value={compareStandA ?? ''}
                            onChange={e => setCompareStandA(e.target.value === '' ? null : Number(e.target.value))}
                            className="w-full text-[10px] bg-white/[0.06] border border-white/[0.08] rounded-lg px-1.5 py-1 text-stone-300 focus:outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-500/40"
                          >
                            <option value="">—</option>
                            {alignedStands.map((s, i) => (
                              <option key={i} value={i} disabled={compareStandB === i}>
                                Stand {i + 1}{s.name ? ` · ${s.name}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        {/* Compare B */}
                        <div>
                          <label className="text-[8px] text-stone-500 block mb-0.5">B</label>
                          <select
                            value={compareStandB ?? ''}
                            onChange={e => setCompareStandB(e.target.value === '' ? null : Number(e.target.value))}
                            className="w-full text-[10px] bg-white/[0.06] border border-white/[0.08] rounded-lg px-1.5 py-1 text-stone-300 focus:outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-500/40"
                          >
                            <option value="">—</option>
                            {alignedStands.map((s, i) => (
                              <option key={i} value={i} disabled={compareStandA === i}>
                                Stand {i + 1}{s.name ? ` · ${s.name}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* ========== STAND COMPARE CARD (v1.2) ==========
                      Side-by-side summary using existing stand properties + nearby raster samples.
                      Appears only when both Compare A and Compare B are selected. */}
                  {compareStandA !== null && compareStandB !== null && (() => {
                    const standA = alignedStands[compareStandA];
                    const standB = alignedStands[compareStandB];
                    if (!standA || !standB) return null;

                    const resA = standA.resilience?.score ?? null;
                    const resB = standB.resilience?.score ?? null;
                    const alignA = standA.alignment.score;
                    const alignB = standB.alignment.score;

                    // Helper: highlight the HIGHER value in amber
                    const hi = (a: number | null, b: number | null) => {
                      if (a === null || b === null) return { a: '', b: '' };
                      if (a > b) return { a: 'text-amber-400 font-semibold', b: '' };
                      if (b > a) return { a: '', b: 'text-amber-400 font-semibold' };
                      return { a: '', b: '' };
                    };
                    // Helper: highlight the LOWER value (for pressure — lower is better)
                    const lo = (a: number | null, b: number | null) => {
                      if (a === null || b === null) return { a: '', b: '' };
                      if (a < b) return { a: 'text-amber-400 font-semibold', b: '' };
                      if (b < a) return { a: '', b: 'text-amber-400 font-semibold' };
                      return { a: '', b: '' };
                    };
                    const resHi = hi(resA, resB);
                    const alignHi = hi(alignA, alignB);

                    const fmt = (v: number | null) => v !== null ? v.toFixed(2) : '—';

                    // ---- Sample raster cells within 60m of each stand ----
                    const SAMPLE_RADIUS = 60; // meters
                    const sampleNearby = (coords: [number, number]) => {
                      if (!rasterGrid) return null;
                      const [sLng, sLat] = coords;
                      let sumP = 0, sumPost = 0, sumRefuge = 0, n = 0;
                      for (let r = 0; r < rasterGrid.rows; r++) {
                        for (let c = 0; c < rasterGrid.cols; c++) {
                          const cell = rasterGrid.cells[r][c];
                          // Fast lat/lng approximate distance (avoids full haversine per cell)
                          const dLat = (cell.lat - sLat) * 111320;
                          const dLng = (cell.lng - sLng) * 111320 * Math.cos(sLat * Math.PI / 180);
                          const dist = Math.sqrt(dLat * dLat + dLng * dLng);
                          if (dist > SAMPLE_RADIUS) continue;
                          sumP += cell.pressure;
                          const post = Math.min(1, Math.max(0, cell.terrain - 0.7 * cell.pressure));
                          const refuge = post * (1 - cell.pressure);
                          sumPost += post;
                          sumRefuge += refuge;
                          n++;
                        }
                      }
                      if (n === 0) return null;
                      return { avgPressure: sumP / n, avgMovementPost: sumPost / n, avgRefugeScore: sumRefuge / n };
                    };

                    const rasterA = sampleNearby(standA.coords);
                    const rasterB = sampleNearby(standB.coords);

                    const pressHi = lo(rasterA?.avgPressure ?? null, rasterB?.avgPressure ?? null);
                    const postHi = hi(rasterA?.avgMovementPost ?? null, rasterB?.avgMovementPost ?? null);
                    const refugeHi = hi(rasterA?.avgRefugeScore ?? null, rasterB?.avgRefugeScore ?? null);

                    return (
                      <div className="px-2 py-2 bg-stone-900/50 rounded-lg border border-amber-700/20 mt-1">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] text-amber-400/80 uppercase tracking-wider font-medium">Stand Compare</span>
                          <button
                            onClick={() => { setCompareStandA(null); setCompareStandB(null); }}
                            className="text-[8px] text-stone-600 hover:text-stone-400 transition-colors"
                          >✕ Clear</button>
                        </div>
                        {/* Column headers */}
                        <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 mb-1.5">
                          <span className="text-[9px] text-stone-400 font-medium truncate text-center">
                            Stand {compareStandA + 1}{standA.name ? ` · ${standA.name}` : ''}
                          </span>
                          <span className="text-[8px] text-stone-600" />
                          <span className="text-[9px] text-stone-400 font-medium truncate text-center">
                            Stand {compareStandB + 1}{standB.name ? ` · ${standB.name}` : ''}
                          </span>
                        </div>
                        {/* Rows */}
                        <div className="space-y-1">
                          {/* Rank */}
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                            <span className="text-[10px] text-stone-300 text-center">#{standA.rank}</span>
                            <span className="text-[8px] text-stone-600 w-14 text-center">Rank</span>
                            <span className="text-[10px] text-stone-300 text-center">#{standB.rank}</span>
                          </div>
                          {/* Alignment Score */}
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                            <span className={`text-[10px] text-stone-300 text-center ${alignHi.a}`}>{fmt(alignA)}</span>
                            <span className="text-[8px] text-stone-600 w-14 text-center">Alignment</span>
                            <span className={`text-[10px] text-stone-300 text-center ${alignHi.b}`}>{fmt(alignB)}</span>
                          </div>
                          {/* Resilience */}
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                            <span className={`text-[10px] text-stone-300 text-center ${resHi.a}`}>{fmt(resA)}</span>
                            <span className="text-[8px] text-stone-600 w-14 text-center">Resilience</span>
                            <span className={`text-[10px] text-stone-300 text-center ${resHi.b}`}>{fmt(resB)}</span>
                          </div>
                          {/* Corridor Distance */}
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                            <span className="text-[10px] text-stone-300 text-center">{Math.round(standA.props.distToCorridorMeters)}m</span>
                            <span className="text-[8px] text-stone-600 w-14 text-center">Corridor</span>
                            <span className="text-[10px] text-stone-300 text-center">{Math.round(standB.props.distToCorridorMeters)}m</span>
                          </div>
                          {/* Elevation */}
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                            <span className="text-[10px] text-stone-300 text-center">{Math.round(standA.props.elevation)}m</span>
                            <span className="text-[8px] text-stone-600 w-14 text-center">Elevation</span>
                            <span className="text-[10px] text-stone-300 text-center">{Math.round(standB.props.elevation)}m</span>
                          </div>
                          {/* Alignment Label */}
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                            <span className="text-[9px] text-stone-400 text-center italic">{standA.alignment.label}</span>
                            <span className="text-[8px] text-stone-600 w-14 text-center">Grade</span>
                            <span className="text-[9px] text-stone-400 text-center italic">{standB.alignment.label}</span>
                          </div>

                          {/* ---- Raster-sampled pressure metrics (60m radius) ---- */}
                          {(rasterA || rasterB) && (
                            <>
                              <div className="border-t border-stone-700/30 my-1" />
                              {/* Pressure — lower is better */}
                              <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                                <span className={`text-[10px] text-stone-300 text-center ${pressHi.a}`}>{fmt(rasterA?.avgPressure ?? null)}</span>
                                <span className="text-[8px] text-stone-600 w-14 text-center">Pressure</span>
                                <span className={`text-[10px] text-stone-300 text-center ${pressHi.b}`}>{fmt(rasterB?.avgPressure ?? null)}</span>
                              </div>
                              {/* Movement Post — higher is better */}
                              <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                                <span className={`text-[10px] text-stone-300 text-center ${postHi.a}`}>{fmt(rasterA?.avgMovementPost ?? null)}</span>
                                <span className="text-[8px] text-stone-600 w-14 text-center">Mvmt Post</span>
                                <span className={`text-[10px] text-stone-300 text-center ${postHi.b}`}>{fmt(rasterB?.avgMovementPost ?? null)}</span>
                              </div>
                              {/* Refuge Support — higher is better */}
                              <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center">
                                <span className={`text-[10px] text-stone-300 text-center ${refugeHi.a}`}>{fmt(rasterA?.avgRefugeScore ?? null)}</span>
                                <span className="text-[8px] text-stone-600 w-14 text-center">Refuge</span>
                                <span className={`text-[10px] text-stone-300 text-center ${refugeHi.b}`}>{fmt(rasterB?.avgRefugeScore ?? null)}</span>
                              </div>
                            </>
                          )}

                          {/* ---- Best Overall Today (lightweight compare-only summary) ---- */}
                          {(() => {
                            // Normalise each metric to 0–1 before weighting.
                            // Resilience is 0–100 → / 100.  Alignment is 0–100 → / 100.
                            // Raster metrics are already 0–1.
                            const norm = (v: number | null, scale: number) => (v !== null ? v / scale : null);

                            const rA = norm(resA, 100);
                            const rB = norm(resB, 100);
                            const aA = norm(alignA, 100);
                            const aB = norm(alignB, 100);
                            const pA = rasterA?.avgPressure ?? null;
                            const pB = rasterB?.avgPressure ?? null;
                            const mA = rasterA?.avgMovementPost ?? null;
                            const mB = rasterB?.avgMovementPost ?? null;
                            const fA = rasterA?.avgRefugeScore ?? null;
                            const fB = rasterB?.avgRefugeScore ?? null;

                            const score = (res: number | null, align: number | null, press: number | null, mvmt: number | null, ref: number | null) => {
                              // If any core metric is missing, return null
                              if (res === null || align === null) return null;
                              // Raster metrics optional — zero-weight if unavailable
                              const p = press ?? 0;
                              const m = mvmt ?? 0;
                              const f = ref ?? 0;
                              const hasRaster = press !== null;
                              if (hasRaster) {
                                return 0.30 * res + 0.20 * align + 0.20 * m + 0.20 * f - 0.10 * p;
                              }
                              // Fallback: only resilience + alignment (re-weighted to sum to 1)
                              return 0.60 * res + 0.40 * align;
                            };

                            const sA = score(rA, aA, pA, mA, fA);
                            const sB = score(rB, aB, pB, mB, fB);

                            if (sA === null || sB === null) return null;

                            const CLOSE_THRESHOLD = 0.03; // within 3% is "too close"
                            const diff = sA - sB;
                            let verdict: string;
                            let verdictColor: string;
                            let reason = '';
                            if (Math.abs(diff) < CLOSE_THRESHOLD) {
                              verdict = 'Too Close to Call';
                              verdictColor = 'text-stone-400 italic';
                              reason = 'Choose based on wind, access, or preference';
                            } else {
                              // Determine winner metrics for the reason line
                              const winA = diff > 0;
                              verdict = winA ? `Stand ${compareStandA! + 1}` : `Stand ${compareStandB! + 1}`;
                              verdictColor = 'text-amber-400 font-semibold';

                              // Pick the most decisive advantage from displayed metrics
                              const wP = (winA ? pA : pB) ?? 0;
                              const lP = (winA ? pB : pA) ?? 0;
                              const wM = (winA ? mA : mB) ?? 0;
                              const lM = (winA ? mB : mA) ?? 0;
                              const wF = (winA ? fA : fB) ?? 0;
                              const lF = (winA ? fB : fA) ?? 0;

                              const pressureEdge = lP - wP;   // positive = winner has lower pressure
                              const movementEdge = wM - lM;   // positive = winner has higher movement
                              const refugeEdge   = wF - lF;   // positive = winner has higher refuge

                              if (pressureEdge >= movementEdge && pressureEdge >= refugeEdge && pressureEdge > 0) {
                                reason = 'Cleaner pressure setup';
                              } else if (refugeEdge >= movementEdge && refugeEdge > 0) {
                                reason = 'Better recovery / refuge support';
                              } else if (movementEdge > 0) {
                                reason = 'Stronger surviving movement';
                              }
                            }

                            return (
                              <>
                                <div className="border-t border-amber-700/30 my-1.5" />
                                <div className="text-center">
                                  <span className="text-[8px] text-stone-500 uppercase tracking-wider block mb-0.5">Best Overall Today</span>
                                  <span className={`text-[11px] ${verdictColor}`}>{verdict}</span>
                                  {reason && <span className="text-[8px] text-stone-500 block mt-0.5">{reason}</span>}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>


              {/* ─── CORRIDORS & ALIGNMENT ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Corridors &amp; Alignment</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
              </div>

              <div className="p-3 border-b border-white/[0.06]">
                <div className="space-y-1">
                  {/* Primary Corridors */}
                  {!TERRAIN_WORK_MODE && (
                    <button
                      onClick={() => setVisibility(v => ({ ...v, corridors: !v.corridors }))}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                        visibility.corridors ? 'bg-white/[0.08] border border-white/[0.12]' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                      }`}
                    >
                      <span className="w-3 h-[3px] rounded-full" style={{ background: LAYER_COLORS.corridorHigh, opacity: visibility.corridors ? 1 : 0.4 }} />
                      <span className={`flex-1 text-left ${visibility.corridors ? 'text-white' : 'text-stone-500'}`}>
                        Primary Corridors
                      </span>
                    </button>
                  )}
                  {/* Draws — terrain channels */}
                  <button
                    onClick={() => setVisibility(v => ({ ...v, draws: !v.draws }))}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                      visibility.draws ? 'bg-white/[0.08] border border-white/[0.12]' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    <span className="w-3 h-[2px] rounded-full" style={{ background: LAYER_COLORS.funnelDraw, opacity: visibility.draws ? 1 : 0.4 }} />
                    <span className={`flex-1 text-left ${visibility.draws ? 'text-white' : 'text-stone-500'}`}>
                      Draws
                    </span>
                  </button>
                </div>
              </div>
              {(() => {
                const edgeCorridors = edgeIntelData?.corridorArrows?.features?.length || 0;
                const edgeSaddles = edgeIntelData?.ghostSaddles?.features?.length || 0;
                const edgeDraws = edgeIntelData?.drawExtensions?.features?.length || 0;
                const totalEdge = edgeCorridors + edgeSaddles + edgeDraws;
                const movementVisible = visibility.corridors || visibility.funnels;
                return (
                  <>
                    {!TERRAIN_WORK_MODE && totalEdge > 0 && movementVisible && (
                      <div 
                        className="mt-2 p-2 rounded-lg bg-gradient-to-r from-pink-900/20 to-orange-900/20 border border-white/[0.04] cursor-pointer hover:border-white/10 transition-colors"
                        onClick={() => {
                          // Trigger unlock modal for the first available edge type
                          if (edgeCorridors > 0) {
                            setUnlockModalData({ edgeType: 'corridor', lngLat: [lng, lat], segmentBearing: 0 });
                            setShowUnlockModal(true);
                          } else if (edgeSaddles > 0) {
                            setUnlockModalData({ edgeType: 'saddle', lngLat: [lng, lat], segmentBearing: 0 });
                            setShowUnlockModal(true);
                          } else if (edgeDraws > 0) {
                            setUnlockModalData({ edgeType: 'draw', lngLat: [lng, lat], segmentBearing: 0 });
                            setShowUnlockModal(true);
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Lock className="w-3 h-3 text-pink-400" />
                          <span className="text-[10px] text-white/70 font-medium">Continues Off-Property</span>
                        </div>
                        <div className="flex gap-2 text-[9px] text-stone-400">
                          {edgeCorridors > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-0.5 rounded" style={{ background: LAYER_COLORS.edgeCorridorArrow }} />
                              {edgeCorridors} corridor{edgeCorridors > 1 ? 's' : ''}
                            </span>
                          )}
                          {edgeSaddles > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded" style={{ background: LAYER_COLORS.edgeGhostSaddle, opacity: 0.6 }} />
                              {edgeSaddles} saddle{edgeSaddles > 1 ? 's' : ''}
                            </span>
                          )}
                          {edgeDraws > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-0.5 rounded" style={{ background: LAYER_COLORS.edgeDrawExtension }} />
                              {edgeDraws} draw{edgeDraws > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[9px] text-pink-400/80">
                          🔓 Tap to unlock adjacent intel
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              {/* ========== ALIGNMENT PANEL (V2 - DISABLED DURING TERRAIN REFINEMENT) ========== */}
              {!TERRAIN_WORK_MODE && (
               <div className="relative">
                <StandAlignmentPanel
                  alignedStands={alignedStands}
                  highlightedStandRank={highlightedStandRank}
                  selectedStand={selectedStand}
                  expanded={alignmentPanelExpanded}
                  onToggleExpanded={() => setAlignmentPanelExpanded(!alignmentPanelExpanded)}
                  onStandClick={(stand) => {
                    if (!parcelUnlocked && !isPro) {
                      setShowParcelPaywall(true);
                      return;
                    }
                    handleUserInteraction();
                    setHighlightedStandRank(stand.rank);
                    const deselecting = selectedStand === stand.rank;
                    setSelectedStand(deselecting ? null : stand.rank);
                    // Deselecting in solo mode → exit solo so all stands reappear
                    if (deselecting && soloStandMode) {
                      setSoloStandMode(false);
                    }
                    // V4 Step 11b: Cinematic flyTo from panel
                    if (!deselecting && mapRef.current) {
                      mapRef.current.flyTo({
                        center: stand.coords,
                        zoom: Math.max(mapRef.current.getZoom(), 15.5),
                        duration: 1200,
                        essential: true,
                        padding: { top: 80, bottom: 40, left: 40, right: 40 },
                      });
                    }
                  }}
                />
                {/* PAYWALL BLUR OVERLAY — covers stand details for non-unlocked free users */}
                {!parcelUnlocked && !isPro && alignedStands.length > 0 && (
                  <div className="absolute inset-0 z-10 backdrop-blur-[6px] bg-black/40 rounded-lg flex flex-col items-center justify-center gap-3 p-4">
                    <div className="text-amber-400 text-xl">🎯</div>
                    <p className="text-amber-300/90 text-xs font-bold tracking-wide uppercase text-center">
                      {alignedStands.length} Stand Location{alignedStands.length !== 1 ? 's' : ''} Identified
                    </p>
                    <p className="text-white text-sm font-semibold text-center">Unlock Your Hunt Plan</p>
                    <p className="text-white/50 text-xs text-center max-w-[200px]">Stand pins, approach routes & full intelligence hidden until unlocked</p>
                    <button
                      onClick={() => setShowParcelPaywall(true)}
                      className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-5 py-2 rounded-lg transition mt-1"
                    >
                      Unlock — $19
                    </button>
                  </div>
                )}
               </div>
               )}
               {/* End of TERRAIN_WORK_MODE conditional wrapper for Alignment Panel */}

              {/* ========== PARCEL-HUNT FILE DOWNLOAD / PREVIEW ========== */}
              <div className="p-3 border-t border-white/[0.06]">
                {isPro ? (
                  /* Pro/ProMax: direct download */
                  <button
                    onClick={handleDownloadParcelHuntFile}
                    disabled={isDownloading || isLoading}
                    style={{
                      background: isDownloading || isLoading ? '#1c1917' : '#c0a020',
                      color: isDownloading || isLoading ? '#78716c' : '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: isDownloading || isLoading ? 'not-allowed' : 'pointer',
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <span>⬇ Download Hunt Report</span>
                    )}
                  </button>
                ) : (
                  /* Free/logged-out: VIEW button opens on-screen preview */
                  <button
                    onClick={() => setShowReportPreview(true)}
                    disabled={isLoading}
                    style={{
                      background: isLoading ? '#1c1917' : '#2d3748',
                      color: isLoading ? '#78716c' : '#f0c040',
                      border: '1px solid #f0c040',
                      borderRadius: '8px',
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      opacity: isLoading ? 0.5 : 1,
                    }}
                  >
                    <span>📄 View Hunt Report Preview</span>
                  </button>
                )}
                <p className="text-[10px] text-stone-500 text-center mt-1.5">
                  {isPro ? '5-page terrain & alignment report' : 'Free preview — upgrade to download PDF'}
                </p>
              </div>

              {/* ========== OPEN IN onX HUNT ========== */}
              {activeLat && activeLng && (
                <div className="px-3 pb-3">
                  <button
                    onClick={() => {
                      const zoom = 15;
                      const url = `https://app.onxmaps.com/hunt/map/${zoom}/${activeLat}/${activeLng}`;
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                      transition-all text-sm font-semibold
                      bg-[#FF6B00] hover:bg-[#e05f00] text-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/onx-icon.png" alt="" className="h-4 w-4 rounded-sm" />
                    <span>Open in onX Hunt</span>
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                  </button>
                  <p className="text-[10px] text-stone-500 text-center mt-1.5">
                    View this parcel on onX Maps
                  </p>
                </div>
              )}

              {/* Save to My Properties — Pro only */}
              {session?.user && isPro ? (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleSaveProperty}
                    className="flex items-center gap-2 flex-1 px-4 py-2 rounded-lg
                               bg-green-700 hover:bg-green-600 text-white font-semibold
                               transition-colors duration-200"
                  >
                    {saveConfirmed ? '✅ Saved!' : '⭐ Save'}
                  </button>
                  <button
                    onClick={handleShareTerritory}
                    disabled={shareLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg
                               bg-blue-700 hover:bg-blue-600 text-white font-semibold
                               transition-colors duration-200 disabled:opacity-50"
                    title="Save & get shareable link"
                  >
                    {shareLoading ? '…' : shareCopied ? '✅ Copied!' : '🔗 Share'}
                  </button>
                </div>
              ) : session?.user && !isPro ? (
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="flex items-center gap-2 w-full px-4 py-2 rounded-lg
                             bg-amber-600 hover:bg-amber-500 text-white font-semibold
                             transition-colors duration-200 mt-2"
                >
                  ⭐ Upgrade to Pro to Save & Share
                </button>
              ) : (
                <button
                  onClick={() => router.push('/login?callbackUrl=%2Fintel')}
                  className="flex items-center gap-2 w-full px-4 py-2 rounded-lg
                             bg-green-900 hover:bg-green-800 text-white font-semibold
                             transition-colors duration-200 mt-2"
                >
                  ⭐ Save to My Properties — Sign In
                </button>
              )}

              {/* Fade-in keyframe animation */}
              <style jsx>{`
                @keyframes fadeIn {
                  from { opacity: 0; transform: translateY(-4px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
            </div>
          )}
        </div>
      </div>

      {/* ========== SCORE CARD MODAL ========== */}
      {showScoreCard && summary && (
        <ScoreCard
          address={
            territoryMode
              ? `${territoryParcels.length}-Parcel Territory`
              : activeAddress || 'Your Property'
          }
          acres={
            territoryMode
              ? totalTerritoryAcres
              : (parseFloat(activeAcreage || '0') || summary?.analysisAreaAcres || 0)
          }
          score={summary.topStandScore || 0}
          grade={
            (summary.topStandScore >= 90) ? 'A+' :
            (summary.topStandScore >= 80) ? 'A' :
            (summary.topStandScore >= 70) ? 'B+' :
            (summary.topStandScore >= 60) ? 'B' :
            (summary.topStandScore >= 50) ? 'C+' :
            (summary.topStandScore >= 40) ? 'C' : 'D'
          }
          primaryMovement={terrainStory?.primaryDriver?.label || 'Terrain-driven'}
          funnelCount={summary.funnelCount || 0}
          standCount={alignedStands?.length || 0}
          bedAcres={Math.round((summary.totalBeddingAcres || 0) * 10) / 10}
          onClose={() => setShowScoreCard(false)}
        />
      )}

      {/* ========== UPGRADE MODAL (Pro / Pro Max) ========== */}
      {showUpgradeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowUpgradeModal(false); }}
        >
          <div style={{
            background: '#1a1a2e',
            border: '1px solid #4a5568',
            borderRadius: '12px',
            padding: '36px 40px',
            maxWidth: '440px',
            width: '90%',
            textAlign: 'center' as const,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🦌</div>
            <h2 style={{ color: '#f0c040', fontSize: '22px', margin: '0 0 12px' }}>
              Unlock Your Hunt Report
            </h2>
            <p style={{ color: '#a0aec0', fontSize: '14px', lineHeight: 1.6, margin: '0 0 24px' }}>
              You&apos;re seeing a free preview. Upgrade to <strong style={{ color: '#f0c040' }}>Terra Firma Pro</strong> to download your full, print-ready Hunt Report — plus unlimited territory analysis.
            </p>
            <button
              onClick={() => handleUpgrade('annual', 'pro')}
              disabled={!!upgradeLoading}
              style={{
                background: '#c0a020',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 28px',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
                marginBottom: '12px',
                opacity: upgradeLoading ? 0.6 : 1,
              }}
            >
              {upgradeLoading === 'pro_annual' ? '…' : 'Upgrade to Pro — $99/yr'}
            </button>
            <button
              onClick={() => setShowUpgradeModal(false)}
              style={{
                background: 'transparent',
                color: '#718096',
                border: 'none',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* ========== REPORT PREVIEW MODAL (inline JSX — no API fetch) ========== */}
      {showReportPreview && (() => {
        const top3 = alignedStands.slice(0, 3);
        const topScore = summary?.topStandScore ?? 0;
        const _scoreColor = topScore >= 70 ? '#2d6a4f' : topScore >= 40 ? '#d4a017' : '#c0392b';
        const _scoreLabel = topScore >= 70 ? 'PRIME' : topScore >= 40 ? 'HUNTABLE' : 'MARGINAL';
        const _grade = topScore >= 90 ? 'A+' : topScore >= 80 ? 'A' : topScore >= 70 ? 'B' : topScore >= 60 ? 'C' : 'D';
        const _gradeColor = topScore >= 70 ? '#1a3a2a' : topScore >= 50 ? '#8b6f47' : '#8b0000';
        const _riskColor = (r: string) => r === 'low' ? '#2d6a4f' : r === 'medium' ? '#d4a017' : '#c0392b';
        const isTerritory = territoryParcelsRef.current.length > 1;
        const displayAcreage = isTerritory
          ? territoryParcelsRef.current.reduce((sum, p) => sum + p.acreage, 0)
          : (acreageParam ?? 40);
        return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.80)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            overflowY: 'auto',
            padding: '40px 20px',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowReportPreview(false); }}
        >
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            maxWidth: '780px',
            width: '100%',
            position: 'relative',
            boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}>

            {/* PREVIEW watermark */}
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 20,
              transform: 'rotate(-35deg)',
            }}>
              <span style={{
                fontSize: '96px',
                fontWeight: 900,
                color: 'rgba(180, 30, 30, 0.08)',
                letterSpacing: '0.1em',
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}>PREVIEW</span>
            </div>

            {/* ── Report Content ── */}
            <div style={{ padding: '40px 36px', color: '#1a1a1a', fontFamily: 'Georgia, serif', position: 'relative', zIndex: 10 }}>

              {/* Header */}
              <div style={{ background: '#1a3a2a', color: 'white', padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                  <div style={{ fontSize: '20px', letterSpacing: '2px', fontWeight: 'bold' }}>TERRA FIRMA PARTNERS</div>
                  <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>Terrain Intelligence for Landowners</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '11px', opacity: 0.8 }}>HUNT REPORT PREVIEW</div>
              </div>

              {/* Title */}
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '22px', fontWeight: 'bold', letterSpacing: '2px', color: '#1a3a2a' }}>
                  {isTerritory ? 'TERRITORY INTELLIGENCE REPORT' : 'HUNTING INTELLIGENCE REPORT'}
                </div>
                <div style={{ fontSize: '13px', color: '#666', marginTop: '6px' }}>
                  {isTerritory ? `${territoryName} — ${territoryParcelsRef.current.length} parcels` : address}
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{Math.round(Number(displayAcreage))} Acres</div>
              </div>

              {/* Gold bar */}
              <div style={{ height: '3px', background: 'linear-gradient(90deg, #c9a84c, #f0d080, #c9a84c)', marginBottom: '24px' }} />

              {/* Terrain narrative */}
              {terrainStory?.narrative && (
                <div style={{ background: '#f8f6f0', borderLeft: '4px solid #c9a84c', padding: '14px 18px', marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', color: '#1a3a2a', marginBottom: '4px' }}>Terrain Character</div>
                  {terrainStory.headline && <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#1a3a2a', marginBottom: '6px' }}>{terrainStory.headline}</div>}
                  <div style={{ fontSize: '12px', color: '#333', lineHeight: 1.6, fontStyle: 'italic' }}>&ldquo;{terrainStory.narrative}&rdquo;</div>
                </div>
              )}

              {/* Score hero */}
              <div style={{ textAlign: 'center', padding: '24px', background: '#f8f6f0', border: '2px solid #1a3a2a', marginBottom: '24px' }}>
                <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '2px', color: '#666', marginBottom: '8px' }}>Overall Huntability Score</div>
                <div style={{ fontSize: '64px', fontWeight: 'bold', lineHeight: 1, color: _scoreColor }}>{topScore}</div>
                <div style={{ fontSize: '16px', letterSpacing: '3px', marginTop: '8px', color: _scoreColor }}>{_scoreLabel}</div>
                <div style={{ fontSize: '11px', color: '#999', fontStyle: 'italic', marginTop: '8px' }}>Score reflects current wind and season conditions</div>
              </div>

              {/* Key stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                <div style={{ background: '#f8f6f0', border: '1px solid #ddd', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a3a2a' }}>{summary?.totalBeddingAcres?.toFixed(1) ?? '0'}</div>
                  <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>Bedding Acres</div>
                </div>
                <div style={{ background: '#f8f6f0', border: '1px solid #ddd', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a3a2a' }}>{tieredCorridorData?.corridors_primary?.features?.length ?? 0}</div>
                  <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>Primary Corridors</div>
                </div>
                <div style={{ background: '#f8f6f0', border: '1px solid #ddd', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a3a2a' }}>{summary?.funnelCount ?? 0}</div>
                  <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>Funnel Zones</div>
                </div>
              </div>

              {/* Seasonal Huntability */}
              {(() => {
                const recSeason = summary?.recommendedSeason ?? 'rut';
                const base = topScore;
                // Derive per-season grades: recommended season gets the base score, others get reduced
                const seasonScoreMap: Record<string, number> = {
                  early: recSeason === 'early' ? base : recSeason === 'rut' ? Math.max(0, base - 12) : Math.max(0, base - 8),
                  rut:   recSeason === 'rut'   ? base : recSeason === 'early' ? Math.max(0, base - 8) : Math.max(0, base - 10),
                  late:  recSeason === 'late'  ? base : recSeason === 'rut' ? Math.max(0, base - 15) : Math.max(0, base - 10),
                };
                const toGrade = (s: number) => s >= 93 ? 'A+' : s >= 85 ? 'A' : s >= 78 ? 'B+' : s >= 70 ? 'B' : s >= 60 ? 'C+' : s >= 50 ? 'C' : 'D';
                const gradeColor = (s: number) => s >= 78 ? '#2d6a4f' : s >= 60 ? '#8b6f47' : '#c0392b';
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    {[
                      { label: 'Early Season', key: 'early' },
                      { label: 'Rut', key: 'rut' },
                      { label: 'Late Season', key: 'late' },
                    ].map(({ label, key }) => {
                      const sc = seasonScoreMap[key];
                      const g = toGrade(sc);
                      return (
                        <div key={key} style={{ background: '#f8f6f0', border: '1px solid #ddd', padding: '14px', textAlign: 'center' }}>
                          <div style={{ fontSize: '24px', fontWeight: 'bold', color: gradeColor(sc) }}>{g}</div>
                          <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>{label}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Parcel Intelligence */}
              {(() => {
                const ac = Number(displayAcreage) || 40;
                const showHunterCapacity = ac >= 40;
                const recHunters = Math.max(2, Math.floor(ac / 40));
                const elevMinM = summary?.demMetrics?.elevMin ?? 0;
                const elevMaxM = summary?.demMetrics?.elevMax ?? 0;
                const elevRangeFt = Math.round((elevMaxM - elevMinM) * 3.281);
                const leaseLow = Math.round(ac < 80 ? 12 : ac < 200 ? 10 : 8);
                const leaseHigh = Math.round(ac < 80 ? 18 : ac < 200 ? 14 : 12);
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: showHunterCapacity ? '1fr 1fr 1fr' : '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                    {showHunterCapacity && (
                      <div style={{ background: '#f8f6f0', border: '1px solid #ddd', padding: '14px', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a3a2a' }}>{recHunters}</div>
                        <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>Hunter Capacity</div>
                        <div style={{ fontSize: '9px', color: '#999', marginTop: '2px' }}>Terrain-based estimate</div>
                      </div>
                    )}
                    <div style={{ background: '#f8f6f0', border: '1px solid #ddd', padding: '14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a3a2a' }}>{elevRangeFt}ft</div>
                      <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>Elevation Range</div>
                    </div>
                    <div style={{ background: '#f8f6f0', border: '1px solid #ddd', padding: '14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a3a2a' }}>${leaseLow}-{leaseHigh}</div>
                      <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>Est. Lease $/Acre</div>
                    </div>
                  </div>
                );
              })()}

              {/* Divider */}
              <div style={{ background: '#1a3a2a', color: 'white', padding: '10px 16px', fontSize: '13px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>
                Intercept Point Analysis
              </div>

              {/* Stand cards */}
              {top3.map((stand, i) => {
                const s = stand.alignment?.score ?? 0;
                const sColor = s >= 70 ? '#2d6a4f' : s >= 40 ? '#d4a017' : '#c0392b';
                const risk = stand.props?.approachRisk ?? 'medium';
                return (
                  <div key={i} style={{ border: '2px solid #1a3a2a', marginBottom: '16px' }}>
                    <div style={{
                      padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: i === 0 ? '#1a3a2a' : '#f8f6f0', color: i === 0 ? 'white' : '#1a1a1a'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{ textAlign: 'center', marginRight: '12px' }}>
                          <div style={{ fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', color: '#c9a84c' }}>INTERCEPT</div>
                          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#c9a84c' }}>#{i + 1}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{stand.name ?? stand.props?.name ?? `Stand ${i + 1}`}</div>
                          <div style={{ fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', opacity: 0.8 }}>
                            {stand.alignment?.label ?? 'Field Stone'} · {stand.resilience?.label ?? 'Unknown'}
                          </div>
                        </div>
                      </div>
                      <div style={{ padding: '8px 16px', fontSize: '20px', fontWeight: 'bold', color: 'white', background: sColor, minWidth: '70px', textAlign: 'center' }}>{s}</div>
                    </div>
                    <div style={{ padding: '16px', borderTop: '1px solid #ddd', background: '#f8f6f0' }}>
                      {stand.props?.reasoning && (
                        <div style={{ fontSize: '12px', lineHeight: 1.6, color: '#333', fontStyle: 'italic', marginBottom: '12px' }}>
                          &ldquo;{stand.props.reasoning}&rdquo;
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                        <div style={{ textAlign: 'center', background: 'white', padding: '8px', border: '1px solid #ddd' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold', color: _riskColor(risk) }}>{risk.toUpperCase()}</div>
                          <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#666' }}>Approach Risk</div>
                        </div>
                        <div style={{ textAlign: 'center', background: 'white', padding: '8px', border: '1px solid #ddd' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                            {stand.props?.distToCorridorMeters ? Math.round(stand.props.distToCorridorMeters * 1.0936) : '—'} yds
                          </div>
                          <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#666' }}>To Corridor</div>
                        </div>
                        <div style={{ textAlign: 'center', background: 'white', padding: '8px', border: '1px solid #ddd' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                            {stand.props?.distToBeddingMeters ? Math.round(stand.props.distToBeddingMeters * 1.0936) : '—'} yds
                          </div>
                          <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#666' }}>To Bedding</div>
                        </div>
                        <div style={{ textAlign: 'center', background: 'white', padding: '8px', border: '1px solid #ddd' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                            {stand.props?.elevation ? Math.round(stand.props.elevation * 3.281) : '—'}ft
                          </div>
                          <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#666' }}>Elevation</div>
                        </div>
                      </div>
                      {/* Wind alignment */}
                      {((stand.props?.windOk?.length ?? 0) > 0 || (stand.props?.windBad?.length ?? 0) > 0) && (
                        <div style={{ marginTop: '12px' }}>
                          <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#666', marginBottom: '4px' }}>Wind Alignment</div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {(stand.props?.windOk ?? []).map((w: string, wi: number) => (
                              <span key={`ok-${wi}`} style={{ padding: '3px 8px', fontSize: '10px', borderRadius: '2px', fontWeight: 'bold', background: '#d4edda', color: '#155724' }}>✓ {w}</span>
                            ))}
                            {(stand.props?.windBad ?? []).map((w: string, wi: number) => (
                              <span key={`bad-${wi}`} style={{ padding: '3px 8px', fontSize: '10px', borderRadius: '2px', fontWeight: 'bold', background: '#f8d7da', color: '#721c24' }}>✗ {w}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Hunt Certificate section */}
              <div style={{ border: '3px solid #c9a84c', padding: '36px 48px', textAlign: 'center', marginTop: '32px' }}>
                <div style={{ fontSize: '11px', letterSpacing: '4px', color: '#888', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Terra Firma Partners — Official Terrain Assessment
                </div>
                <div style={{ fontSize: '13px', letterSpacing: '3px', color: '#666', marginBottom: '8px' }}>
                  {isTerritory ? 'TERRITORY HUNT CERTIFICATE' : 'TERRAIN HUNT CERTIFICATE'}
                </div>
                <div style={{ height: '2px', background: 'linear-gradient(90deg, #c9a84c, #f0d080, #c9a84c)', marginBottom: '24px' }} />
                <div style={{ fontSize: '80px', fontWeight: 'bold', color: _gradeColor, lineHeight: 1, marginBottom: '8px' }}>{_grade}</div>
                <div style={{ fontSize: '13px', letterSpacing: '2px', color: '#666', marginBottom: '24px' }}>HUNTABILITY GRADE</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                  <div style={{ background: '#1a3a2a', color: 'white', padding: '12px' }}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#c9a84c' }}>{topScore}</div>
                    <div style={{ fontSize: '9px', letterSpacing: '1px', opacity: 0.8, marginTop: '4px' }}>HUNTABILITY SCORE</div>
                  </div>
                  <div style={{ background: '#1a3a2a', color: 'white', padding: '12px' }}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#c9a84c' }}>{top3.length}</div>
                    <div style={{ fontSize: '9px', letterSpacing: '1px', opacity: 0.8, marginTop: '4px' }}>INTERCEPT POINTS</div>
                  </div>
                  <div style={{ background: '#1a3a2a', color: 'white', padding: '12px' }}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#c9a84c' }}>{tieredCorridorData?.corridors_primary?.features?.length ?? 0}</div>
                    <div style={{ fontSize: '9px', letterSpacing: '1px', opacity: 0.8, marginTop: '4px' }}>CORRIDORS</div>
                  </div>
                </div>
                <div style={{ fontSize: '10px', color: '#999', lineHeight: 1.6 }}>
                  This certificate confirms that the above property has been analyzed using satellite terrain intelligence,
                  elevation modeling, and deer movement prediction.
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#999', borderTop: '1px solid #ddd', paddingTop: '12px', marginTop: '24px' }}>
                <span>TERRA FIRMA PARTNERS</span>
                <span>terrafirma.partners</span>
                <span>Hunt Report Preview</span>
              </div>
            </div>

            {/* Bottom CTA bar */}
            <div style={{
              borderTop: '1px solid #e2e8f0',
              padding: '20px 32px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f7f8fa',
              borderRadius: '0 0 12px 12px',
              flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px', color: '#1a202c' }}>
                  You&apos;re seeing 50% of your Hunt Report
                </div>
                <div style={{ fontSize: '13px', color: '#718096' }}>
                  The full PDF includes your complete stand rotation calendar, approach routes, wind strategy by season, and printable Terrain Hunt Certificate.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setShowReportPreview(false)}
                  style={{ background: 'transparent', border: '1px solid #cbd5e0', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', color: '#718096', fontSize: '13px' }}
                >
                  Close
                </button>
                <button
                  onClick={() => { setShowReportPreview(false); setShowUpgradeModal(true); }}
                  style={{ background: '#c0a020', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 20px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' }}
                >
                  🔒 Unlock Full Report — Go Pro
                </button>
              </div>
            </div>

          </div>
        </div>
        );
      })()}

      {/* ========== DOWNLOAD WALL MODAL (Free → Pro) ========== */}
      {showDownloadWall && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDownloadWall(false); }}
        >
          <div style={{
            background: '#1a1a2e',
            border: '1px solid #4a5568',
            borderRadius: '12px',
            padding: '36px 40px',
            maxWidth: '440px',
            width: '90%',
            textAlign: 'center' as const,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🦌</div>
            <h2 style={{ color: '#f0c040', fontSize: '22px', margin: '0 0 12px' }}>
              Share Your Territory Score
            </h2>
            <p style={{ color: '#a0aec0', fontSize: '14px', lineHeight: 1.6, margin: '0 0 24px' }}>
              Upgrade to <strong style={{ color: '#f0c040' }}>Terra Firma Pro</strong> to download and share your Territory Hunt Certificate — your A+ score, lease value estimate, and intercept points in one shareable PDF.
            </p>
            <button
              onClick={() => { setShowDownloadWall(false); handleUpgrade('annual', 'pro'); }}
              disabled={!!upgradeLoading}
              style={{
                background: '#c0a020',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 28px',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
                marginBottom: '12px',
                opacity: upgradeLoading ? 0.6 : 1,
              }}
            >
              {upgradeLoading === 'pro_annual' ? '…' : 'Go Pro — $99/yr'}
            </button>
            <button
              onClick={() => setShowDownloadWall(false)}
              style={{
                background: 'transparent',
                color: '#718096',
                border: 'none',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Maybe Later
            </button>
          </div>
        </div>
      )}

      {/* ========== $19 PARCEL PAYWALL MODAL ========== */}
      {showParcelPaywall && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.70)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowParcelPaywall(false); }}
        >
          <div style={{
            background: 'linear-gradient(180deg, #1a2332 0%, #111822 100%)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '16px',
            padding: '32px 36px',
            maxWidth: '420px',
            width: '92%',
            textAlign: 'center' as const,
            boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 40px rgba(245,158,11,0.08)',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>🎯</div>
            <h2 style={{ color: '#f59e0b', fontSize: '22px', fontWeight: 700, margin: '0 0 8px' }}>
              Unlock Your Hunt Plan
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: 1.6, margin: '0 0 6px' }}>
              {activeAddress || 'This parcel'} · {activeAcres?.toFixed(0) || '—'} acres
            </p>
            <div style={{ background: 'rgba(245,158,11,0.08)', borderRadius: '10px', padding: '14px 16px', margin: '16px 0' }}>
              <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>
                <strong>Full access includes:</strong>
              </p>
              <ul style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.8, margin: '8px 0 0', paddingLeft: '16px', textAlign: 'left' as const }}>
                <li>Top 3 stand locations with approach routes</li>
                <li>Today&apos;s Sit recommendation</li>
                <li>Full terrain & corridor intelligence</li>
                <li>Downloadable Hunt Report PDF</li>
                <li>Permanent access — never re-locked</li>
              </ul>
            </div>
            <button
              onClick={handlePurchaseParcel}
              disabled={purchaseLoading}
              style={{
                background: 'linear-gradient(135deg, #d97706, #b45309)',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                padding: '14px 28px',
                fontSize: '16px',
                fontWeight: 700,
                cursor: purchaseLoading ? 'wait' : 'pointer',
                width: '100%',
                marginBottom: '10px',
                opacity: purchaseLoading ? 0.7 : 1,
                boxShadow: '0 4px 20px rgba(217,119,6,0.3)',
              }}
            >
              {purchaseLoading ? 'Opening checkout…' : 'Unlock This Parcel — $19'}
            </button>
            <p style={{ color: '#64748b', fontSize: '11px', margin: '0 0 12px' }}>
              One-time purchase · Instant access · No subscription
            </p>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px', marginTop: '4px' }}>
              <p style={{ color: '#64748b', fontSize: '11px', margin: '0 0 8px' }}>
                Want unlimited access to all parcels?
              </p>
              <button
                onClick={() => { setShowParcelPaywall(false); handleUpgrade('annual', 'pro'); }}
                style={{
                  background: 'transparent',
                  color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.3)',
                  borderRadius: '8px',
                  padding: '8px 20px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Go Pro — $99/yr (all parcels unlocked)
              </button>
            </div>
            <button
              onClick={() => setShowParcelPaywall(false)}
              style={{ background: 'transparent', color: '#475569', border: 'none', fontSize: '12px', cursor: 'pointer', marginTop: '12px' }}
            >
              Maybe Later
            </button>
          </div>
        </div>
      )}

      {/* Loading Overlay — full-screen for fresh load, compact chip for background analysis */}
      {/* TERRITORY FIREWALL: Never show full-screen overlay in territory mode — it blocks map picks */}
      {isLoading && !backgroundAnalysis && !territoryMode && (
        <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-md flex items-center justify-center">
          <div className="bg-gray-950/95 rounded-2xl p-8 text-center max-w-sm border border-white/[0.08] shadow-2xl shadow-black/50">
            {/* Animated radar rings */}
            <div className="relative w-24 h-24 mx-auto mb-5">
              {/* Outer pulse ring */}
              <div className="absolute inset-0 rounded-full border border-amber-500/20 animate-ping" style={{ animationDuration: '2s' }} />
              {/* Middle ring */}
              <div className="absolute inset-2 rounded-full border border-amber-500/30" />
              {/* Spinning ring */}
              <div 
                className="absolute inset-1 rounded-full border-2 border-amber-500/50 border-t-transparent border-r-transparent animate-spin"
                style={{ animationDuration: '1.5s' }}
              />
              {/* Counter-spin inner ring */}
              <div 
                className="absolute inset-4 rounded-full border border-amber-400/40 border-b-transparent border-l-transparent animate-spin"
                style={{ animationDuration: '2.5s', animationDirection: 'reverse' }}
              />
              {/* Center icon with glow */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative">
                  <div className="absolute inset-0 bg-amber-500/20 rounded-full blur-md" style={{ margin: '-4px' }} />
                  <Target className="relative h-8 w-8 text-amber-500" />
                </div>
              </div>
            </div>
            <h3 className="text-white font-semibold text-lg mb-1 tracking-tight">
              {(demoMode || heroParcel) ? 'Loading Demo Parcel' : isDemoFallbackActive ? 'Loading Verified Demo Parcel' : 'Refining Terrain Intelligence'}
            </h3>
            <p className="text-stone-400 text-[11px] mb-4 font-mono tracking-wide">
              {progressStep}
            </p>
            {/* Premium progress bar */}
            <div className="relative w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden mb-2">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ 
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #d97706, #f59e0b, #fbbf24)',
                  boxShadow: '0 0 12px rgba(245,158,11,0.4)',
                }}
              />
              {/* Shimmer on progress bar */}
              <div 
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.15] to-transparent animate-pulse"
                style={{ animationDuration: '1.5s' }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-stone-500">Processing</span>
              <span className="text-amber-400 font-mono font-semibold">{progress}%</span>
            </div>
            {/* Stall recovery UI */}
            {analysisStalled && (
              <div className="mt-4 pt-3 border-t border-white/[0.06]">
                <p className="text-stone-400 text-[11px] mb-3">Taking longer than expected. The terrain server may be warming up.</p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => { setIsLoading(false); setBackgroundAnalysis(false); setError(null); setAnalysisStalled(false); runAnalysis(); }}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry Analysis
                  </button>
                  <button
                    onClick={() => { setIsLoading(false); setBackgroundAnalysis(false); setAnalysisStalled(false); setError('Analysis stalled — please retry when ready'); }}
                    className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-stone-300 text-xs rounded font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Compact background-analysis progress chip — parcel boundary stays visible.
          Hidden during the 1.5 s "clean parcel view" hold so the user can absorb
          the parcel boundary before terrain analysis UI appears. */}
      {isLoading && backgroundAnalysis && !parcelViewHold && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
          <div className="flex items-center gap-3 bg-gray-950/90 backdrop-blur-sm border border-amber-500/25 rounded-full px-4 py-2 shadow-xl shadow-black/40 min-w-[260px]">
            <div className="relative h-5 w-5 flex-shrink-0">
              <div className="absolute inset-0 rounded-full border-2 border-amber-500/50 border-t-transparent animate-spin" style={{ animationDuration: '1.2s' }} />
              <Target className="absolute inset-0.5 h-4 w-4 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{progressStep}</p>
              <div className="relative w-full h-1 bg-white/[0.08] rounded-full overflow-hidden mt-1">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #d97706, #f59e0b, #fbbf24)' }}
                />
              </div>
            </div>
            <span className="text-amber-400 text-[10px] font-mono font-semibold flex-shrink-0">{progress}%</span>
          </div>
        </div>
      )}

      {/* Demo parcel badge — subtle, non-alarming confirmation that auto-dismisses */}
      {isDemoFallbackActive && !isLoading && (
        <div 
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none"
          style={{ 
            opacity: showDemoBadge ? 1 : 0,
            transform: showDemoBadge ? 'translate(-50%, 0)' : 'translate(-50%, -6px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}
        >
          <div className="flex items-center gap-2 bg-gray-950/90 backdrop-blur-sm border border-amber-500/20 rounded-full px-4 py-1.5 shadow-lg shadow-black/30">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-amber-400/90 text-[11px] font-medium tracking-wide">Demo Parcel Loaded</span>
          </div>
        </div>
      )}

      {/* Error Toast - shows actual error message.
          TERRITORY FIREWALL: In territory mode, suppress the scary error modal
          and auto-clear it — the user should just see a gentle toast instead. */}
      {error && !territoryMode && (() => {
        const isColdStart = error.includes('warming up');
        return (
        <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-30 ${isColdStart ? 'bg-amber-900/95 border border-amber-500/50' : 'bg-red-900/95 border border-red-500/50'} rounded-lg px-6 py-4 shadow-xl max-w-lg`}>
          <div className="flex items-start gap-4">
            <AlertTriangle className={`h-5 w-5 ${isColdStart ? 'text-amber-400' : 'text-red-400'} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <p className={`${isColdStart ? 'text-amber-200' : 'text-red-200'} font-medium`}>{isColdStart ? 'Terrain servers warming up' : 'Analysis Failed'}</p>
              <p className={`${isColdStart ? 'text-amber-300/80' : 'text-red-300/80'} text-sm mt-1 ${isColdStart ? '' : 'font-mono'} break-words`}>{isColdStart ? 'The terrain engine is starting up. Please wait a moment and try again.' : error}</p>
              <div className="flex gap-3 mt-3">
                <button 
                  onClick={() => { setError(null); runAnalysis(); }}
                  className={`px-3 py-1.5 ${isColdStart ? 'bg-amber-600 hover:bg-amber-500' : 'bg-red-600 hover:bg-red-500'} text-white text-xs rounded font-medium flex items-center gap-1.5`}
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
                <button 
                  onClick={() => setError(null)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/80 text-xs rounded font-medium"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button onClick={() => setError(null)} className={`${isColdStart ? 'text-amber-400 hover:text-amber-300' : 'text-red-400 hover:text-red-300'} flex-shrink-0`}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        );
      })()}

      {/* Map Error Indicator — v4-fix: graceful with retry */}
      {mapError && (
        <div className="absolute bottom-4 left-4 z-30 bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-amber-500/30">
          <p className="text-amber-400 text-xs font-medium">📍 Map recovering...</p>
          <p className="text-white/60 text-xs mb-1">Interactive map is reconnecting</p>
          <button
            onClick={() => {
              setMapError(null);
              setMapReady(false);
              if (mapRef.current) {
                try { mapRef.current.remove(); } catch (_) { /* ignore */ }
                mapRef.current = null;
              }
              if (mapContainerRef.current) {
                mapContainerRef.current.innerHTML = '';
              }
              overlaySourcesCreated.current = false;
              mapRetryCountRef.current = 0;
              setMapCreateAttempt(prev => prev + 1);
            }}
            className="text-amber-400 text-xs underline hover:text-amber-300"
          >
            Retry now
          </button>
        </div>
      )}

      {/* Unlock Adjacent Parcel Modal */}
      {showUnlockModal && unlockModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowUnlockModal(false)}
          />
          
          {/* Modal Content */}
          <div className="relative bg-gray-900 border border-white/20 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            {/* Header with gradient */}
            <div className="relative bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 px-6 py-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
              <div className="relative flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                  <Lock className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Unlock Adjacent Intel</h3>
                  <p className="text-white/80 text-sm">Expand your strategic advantage</p>
                </div>
              </div>
            </div>
            
            {/* Body */}
            <div className="p-6">
              {/* Context based on what was clicked */}
              <div className="bg-white/5 rounded-xl p-4 mb-5 border border-white/10">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    unlockModalData.edgeType === 'corridor' ? 'bg-pink-500/20' :
                    unlockModalData.edgeType === 'bedding' ? 'bg-green-500/20' :
                    unlockModalData.edgeType === 'saddle' ? 'bg-orange-500/20' :
                    unlockModalData.edgeType === 'draw' ? 'bg-blue-500/20' :
                    unlockModalData.edgeType === 'pressure' ? 'bg-amber-500/20' :
                    'bg-purple-500/20'
                  }`}>
                    {unlockModalData.edgeType === 'corridor' && <ArrowUpRight className="w-5 h-5 text-pink-400" />}
                    {unlockModalData.edgeType === 'bedding' && <Target className="w-5 h-5 text-green-400" />}
                    {unlockModalData.edgeType === 'saddle' && <Mountain className="w-5 h-5 text-orange-400" />}
                    {unlockModalData.edgeType === 'draw' && <Compass className="w-5 h-5 text-blue-400" />}
                    {unlockModalData.edgeType === 'pressure' && <Wind className="w-5 h-5 text-amber-400" />}
                    {unlockModalData.edgeType === 'boundary' && <MapPin className="w-5 h-5 text-purple-400" />}
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">
                      {unlockModalData.edgeType === 'corridor' && 'Travel corridor continues beyond your boundary'}
                      {unlockModalData.edgeType === 'bedding' && 'External bedding influence detected'}
                      {unlockModalData.edgeType === 'saddle' && 'Terrain pinch point extends off-property'}
                      {unlockModalData.edgeType === 'draw' && 'Natural draw continues to adjacent land'}
                      {unlockModalData.edgeType === 'pressure' && 'Deer movement originates off-property'}
                      {unlockModalData.edgeType === 'boundary' && 'Adjacent parcel may impact your hunt'}
                    </p>
                    <p className="text-white/60 text-xs mt-1">
                      Unlock the neighboring property to see the full picture and optimize your strategy.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* What you get */}
              <div className="space-y-3 mb-6">
                <p className="text-xs text-white/50 uppercase tracking-wider font-medium">What You'll Unlock</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 text-sm text-white/80">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>Full corridor routes</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white/80">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>Bedding locations</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white/80">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>Optimal stand sites</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white/80">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>Pressure analysis</span>
                  </div>
                </div>
              </div>
              
              {/* Pricing */}
              <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-xl p-4 border border-amber-500/30 mb-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <span className="text-white font-semibold">Hunting Intel</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-white">$79</span>
                    <span className="text-white/50 text-sm ml-1">one-time</span>
                  </div>
                </div>
                <p className="text-amber-200/70 text-xs mt-2">
                  Permanent unlock • Never expires • Includes all future updates
                </p>
              </div>
              
              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                  onClick={() => setShowUnlockModal(false)}
                >
                  Maybe Later
                </Button>
                <Button
                  className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-semibold"
                  onClick={() => {
                    // Navigate to map with coordinates for adjacent parcel
                    const adjacentLat = unlockModalData.lngLat[1];
                    const adjacentLng = unlockModalData.lngLat[0];
                    router.push(`/map?lat=${adjacentLat}&lng=${adjacentLng}&product=hunting_intel`);
                  }}
                >
                  <Unlock className="w-4 h-4 mr-2" />
                  Unlock Parcel
                </Button>
              </div>
            </div>
            
            {/* Close button */}
            <button
              onClick={() => setShowUnlockModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white/80 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ========== FLOW SEGMENT INSPECTOR PANEL ========== */}
      {(selectedFlowSegment || flowSegmentExplainLoading) && (
        <FlowSegmentInspector
          data={flowSegmentExplain}
          isLoading={flowSegmentExplainLoading}
          onClose={() => {
            setSelectedFlowSegment(null);
            setFlowSegmentExplain(null);
            setFlowSegmentClickPosition(null);
          }}
          position={flowSegmentClickPosition}
        />
      )}
      

      
      {/* ========== v3.6.0: TERRAIN REASONS PANEL ========== */}
      {showTerrainReasons && terrainReasonData && terrainReasonPosition && (
        <TerrainReasonsPanel
          data={terrainReasonData}
          position={terrainReasonPosition}
          onClose={() => {
            setTerrainReasonData(null);
            setTerrainReasonPosition(null);
          }}
        />
      )}

      {/* Legend - Premium V1 styling (hidden in export mode - replaced by export legend) */}
      <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-gray-900/95 backdrop-blur rounded-xl px-5 py-3 flex items-center gap-5 text-xs text-white/80 border border-white/15 shadow-2xl transition-opacity duration-300 ${exportMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {/* Terrain */}
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.bedding }} />
          <span>Bedding</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.funnelSaddle }} />
          <span>Saddle</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.funnelDraw }} />
          <span>Draw</span>
        </div>
        
        <div className="h-5 w-px bg-white/20" />
        
        {/* Corridors - Confidence based */}
        <div className="flex items-center gap-2">
          <span className="w-6 h-1 rounded-full" style={{ background: LAYER_COLORS.corridorHigh }} />
          <span>High</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-0.5 rounded-full" style={{ background: LAYER_COLORS.corridorMed }} />
          <span>Med</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-0.5 rounded-full opacity-70" style={{ background: LAYER_COLORS.corridorLow, borderTop: '2px dashed' }} />
          <span className="text-white/60">Low</span>
        </div>
        
        <div className="h-5 w-px bg-white/20" />
        
        {/* Stands */}
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px]" style={{ background: `linear-gradient(135deg, ${LAYER_COLORS.standGold}, #f59e0b)`, boxShadow: `0 0 8px ${LAYER_COLORS.standGold}60` }}>⭐</span>
          <span className="text-amber-300 font-medium">#1 Sit</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.standHigh }} />
          <span>#2</span>
        </div>
      </div>

      {/* ========== ADJACENT PARCEL POPUP ========== */}
      {selectedAdjacentParcel && adjacentParcelPopupPos && (
        <div
          className="fixed z-[9999] pointer-events-auto"
          style={{
            left: Math.min(adjacentParcelPopupPos.x, typeof window !== 'undefined' ? window.innerWidth - 280 : 600),
            top: Math.max(adjacentParcelPopupPos.y - 10, 10),
            transform: 'translateY(-100%)',
          }}
        >
          <div className="bg-stone-900/95 backdrop-blur-sm border border-stone-700/60 rounded-lg shadow-xl p-3 min-w-[240px] max-w-[300px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-blue-400 uppercase tracking-wider">Adjacent Parcel</span>
              <button
                onClick={() => { setSelectedAdjacentParcel(null); setAdjacentParcelPopupPos(null); }}
                className="text-stone-500 hover:text-white text-xs p-0.5"
              >✕</button>
            </div>
            <div className="text-xs text-white/90 font-medium mb-1 leading-tight">
              {selectedAdjacentParcel.address}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-stone-400 mt-2">
              <div>Owner</div>
              <div className="text-white/80 truncate">{selectedAdjacentParcel.owner}</div>
              <div>Acreage</div>
              <div className="text-white/80">{selectedAdjacentParcel.acreage > 0 ? `${selectedAdjacentParcel.acreage} ac` : '\u2014'}</div>
              {selectedAdjacentParcel.county && (
                <>
                  <div>County</div>
                  <div className="text-white/80">{selectedAdjacentParcel.county}</div>
                </>
              )}
            </div>
            <div className="mt-2.5 pt-2 border-t border-stone-700/40 space-y-1.5">
              <button
                onClick={() => {
                  const lat = selectedAdjacentParcel.centroid[1];
                  const lng = selectedAdjacentParcel.centroid[0];
                  const addr = encodeURIComponent(selectedAdjacentParcel.address);
                  window.location.href = `/intel?lat=${lat}&lng=${lng}&address=${addr}`;
                }}
                className="w-full text-[10px] text-center py-1.5 rounded bg-stone-700/40 text-stone-300 hover:bg-stone-700/60 hover:text-white transition-colors font-medium"
              >
                Scout This Parcel (Free)
              </button>
              <button
                onClick={() => {
                  const lat = selectedAdjacentParcel.centroid[1];
                  const lng = selectedAdjacentParcel.centroid[0];
                  const addr = encodeURIComponent(selectedAdjacentParcel.address);
                  window.location.href = `/map?lat=${lat}&lng=${lng}&address=${addr}&product=hunting_intel`;
                }}
                className="w-full text-[10px] text-center py-1.5 rounded bg-amber-600/30 text-amber-300 hover:bg-amber-600/50 hover:text-amber-200 transition-colors font-medium"
              >
                Hunting Intel — $79
              </button>
              <button
                onClick={() => {
                  const lat = selectedAdjacentParcel.centroid[1];
                  const lng = selectedAdjacentParcel.centroid[0];
                  const addr = encodeURIComponent(selectedAdjacentParcel.address);
                  window.location.href = `/map?lat=${lat}&lng=${lng}&address=${addr}&product=full_report`;
                }}
                className="w-full text-[10px] text-center py-1.5 rounded bg-emerald-600/25 text-emerald-400 hover:bg-emerald-600/40 hover:text-emerald-300 transition-colors font-medium"
              >
                Full Report — $350
              </button>
            </div>
          </div>

      {/* ========== v3.9.0 — Custom Sit Pin context menu (Pro feature) ========== */}
      {sitPinMenu && (() => {
        // Keep the menu inside the viewport (flip if near right/bottom edge)
        const MENU_W = sitPinMenu.gated ? 296 : 200;
        const MENU_H = sitPinMenu.gated ? 232 : 52;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
        const left = Math.max(8, Math.min(sitPinMenu.x + 4, vw - MENU_W - 8));
        const top  = Math.max(8, Math.min(sitPinMenu.y + 4, vh - MENU_H - 8));
        return (
          <div
            role="menu"
            aria-label="Sit Pin menu"
            style={{
              position: 'fixed',
              left,
              top,
              zIndex: 9500,
              background: '#1a1a2e',
              border: sitPinMenu.gated ? '1px solid #c0a020' : '1px solid #4a5568',
              borderRadius: '10px',
              boxShadow: sitPinMenu.gated
                ? '0 14px 38px rgba(0,0,0,0.6), 0 0 0 1px rgba(192,160,32,0.15) inset'
                : '0 10px 30px rgba(0,0,0,0.55)',
              minWidth: MENU_W,
              padding: sitPinMenu.gated ? '16px 18px 14px' : '6px 0',
              color: '#e2e8f0',
              fontSize: '13px',
              // Smooth entrance
              animation: 'tfpSitPinMenuIn 160ms cubic-bezier(.2,.9,.3,1)',
              transformOrigin: 'top left',
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Shared keyframes — injected once inline (cheap, scoped by name) */}
            <style>{`
              @keyframes tfpSitPinMenuIn {
                from { opacity: 0; transform: translateY(-4px) scale(0.96); }
                to   { opacity: 1; transform: translateY(0)    scale(1); }
              }
            `}</style>

            {sitPinMenu.gated ? (
              <>
                {/* Header with lock + title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div
                    aria-hidden
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #c0a020 0%, #8b6b1f 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      flexShrink: 0,
                      boxShadow: '0 2px 8px rgba(192,160,32,0.3)',
                    }}
                  >
                    🔒
                  </div>
                  <div style={{ lineHeight: 1.25 }}>
                    <div style={{ color: '#f0c040', fontSize: 14, fontWeight: 700, letterSpacing: 0.2 }}>
                      Custom Sit Pins
                    </div>
                    <div style={{ color: '#a0aec0', fontSize: 11, marginTop: 2, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                      Pro feature
                    </div>
                  </div>
                </div>

                {/* Benefit bullets */}
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  fontSize: 12,
                  color: '#cbd5e0',
                  lineHeight: 1.4,
                }}>
                  {[
                    'Drop your own named stands anywhere',
                    'Pins persist across visits & parcels',
                    'Hover to see pin names on the map',
                  ].map((b) => (
                    <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ color: '#34d399', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA row */}
                <button
                  onClick={() => {
                    setSitPinMenu(null);
                    setShowUpgradeModal(true);
                  }}
                  style={{
                    width: '100%',
                    background: '#c0a020',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 7,
                    padding: '10px 12px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    letterSpacing: 0.2,
                    boxShadow: '0 2px 8px rgba(192,160,32,0.25)',
                    transition: 'background 120ms, transform 120ms',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#d4b030'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#c0a020'; }}
                >
                  Upgrade to Pro — $99/yr
                </button>
                <button
                  onClick={() => setSitPinMenu(null)}
                  style={{
                    display: 'block',
                    width: '100%',
                    background: 'transparent',
                    color: '#718096',
                    border: 'none',
                    marginTop: 6,
                    padding: '6px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#a0aec0'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#718096'; }}
                >
                  Maybe later
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  console.log('[SitPin] Drop at', sitPinMenu.lng.toFixed(6), sitPinMenu.lat.toFixed(6));
                  setSitPinModal({ lng: sitPinMenu.lng, lat: sitPinMenu.lat });
                  setSitPinName('');
                  setSitPinError(null);
                  setSitPinMenu(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  color: '#e2e8f0',
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#2d3748')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 16 }}>📍</span>
                <span>Drop Sit Pin here</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* ========== v3.9.0 — Sit Pin naming modal ========== */}
      {sitPinModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 9600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !sitPinSaving) {
              setSitPinModal(null);
              setSitPinName('');
              setSitPinError(null);
            }
          }}
        >
          <div
            style={{
              background: '#1a1a2e',
              border: '1px solid #4a5568',
              borderRadius: '12px',
              padding: '28px 28px 22px',
              maxWidth: '440px',
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              color: '#e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22 }}>📍</span>
              <h2 style={{ color: '#f0c040', fontSize: '18px', margin: 0, fontWeight: 700 }}>
                Drop a Sit Pin
              </h2>
            </div>
            <p style={{ color: '#a0aec0', fontSize: '12px', margin: '0 0 18px', lineHeight: 1.5 }}>
              Mark a permanent stand location on your parcel.
            </p>

            {/* Input */}
            <label
              htmlFor="sit-pin-name"
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#cbd5e0',
                marginBottom: 6,
              }}
            >
              Name this stand
            </label>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input
                id="sit-pin-name"
                type="text"
                autoFocus
                maxLength={20}
                value={sitPinName}
                onChange={(e) => setSitPinName(e.target.value.slice(0, 20))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && sitPinName.trim() && !sitPinSaving) {
                    saveSitPin();
                  } else if (e.key === 'Escape' && !sitPinSaving) {
                    setSitPinModal(null);
                    setSitPinName('');
                    setSitPinError(null);
                  }
                }}
                placeholder="e.g. North Ridge Blind"
                style={{
                  width: '100%',
                  background: '#0f1420',
                  border: '1px solid #4a5568',
                  borderRadius: 8,
                  padding: '10px 56px 10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 11,
                  color: sitPinName.length >= 18 ? '#f0c040' : '#718096',
                  fontVariantNumeric: 'tabular-nums',
                  pointerEvents: 'none',
                }}
              >
                {sitPinName.length}/20
              </span>
            </div>

            {/* Quick suggestions */}
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#cbd5e0',
                  marginBottom: 8,
                }}
              >
                Quick suggestions
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['Stand A', 'Ridge Blind', 'Food Plot', 'Creek Crossing', 'Field Edge'].map((suggestion) => {
                  const active = sitPinName === suggestion;
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setSitPinName(suggestion)}
                      style={{
                        background: active ? '#2d6a4f' : '#0f1420',
                        color: active ? '#fff' : '#cbd5e0',
                        border: `1px solid ${active ? '#2d6a4f' : '#4a5568'}`,
                        borderRadius: 999,
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background 120ms, color 120ms, border-color 120ms',
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = '#1f2937';
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = '#0f1420';
                      }}
                    >
                      {suggestion}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Inline error (auth / network / validation) */}
            {sitPinError && (
              <div
                role="alert"
                style={{
                  background: '#3a1414',
                  border: '1px solid #b45454',
                  color: '#fca5a5',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  marginBottom: 12,
                  lineHeight: 1.5,
                }}
              >
                {sitPinError}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={sitPinSaving}
                onClick={() => {
                  setSitPinModal(null);
                  setSitPinName('');
                  setSitPinError(null);
                }}
                style={{
                  background: 'transparent',
                  color: '#a0aec0',
                  border: '1px solid #4a5568',
                  borderRadius: 8,
                  padding: '9px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: sitPinSaving ? 'not-allowed' : 'pointer',
                  opacity: sitPinSaving ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!sitPinName.trim() || sitPinSaving}
                onClick={() => saveSitPin()}
                style={{
                  background: !sitPinName.trim() ? '#4a5568' : '#c0a020',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 22px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: !sitPinName.trim() || sitPinSaving ? 'not-allowed' : 'pointer',
                  opacity: sitPinSaving ? 0.7 : 1,
                }}
              >
                {sitPinSaving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Stand Journal modal ========== */}
      {journalPin && (() => {
        // Wind → arrow glyph
        const WIND_ARROWS: Record<string, string> = {
          N: '↑', NE: '↗', E: '→', SE: '↘',
          S: '↓', SW: '↙', W: '←', NW: '↖',
        };
        const windArrow = (dir: string | null | undefined): string =>
          (dir ? WIND_ARROWS[dir.toUpperCase()] : '') || '';
        // "2026-04-21" → "Tue, Apr 21" (parse as LOCAL date to avoid TZ drift)
        const fmtDate = (iso: string): string => {
          try {
            const [y, m, d] = iso.split('-').map(Number);
            if (!y || !m || !d) return iso;
            const dt = new Date(y, m - 1, d);
            return dt.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            });
          } catch {
            return iso;
          }
        };

        // Shared input styling
        const labelStyle: React.CSSProperties = {
          display: 'block',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#cbd5e0',
          marginBottom: 5,
        };
        const inputStyle: React.CSSProperties = {
          width: '100%',
          background: '#0f1420',
          border: '1px solid #4a5568',
          borderRadius: 6,
          padding: '8px 10px',
          color: '#fff',
          fontSize: 13,
          outline: 'none',
          boxSizing: 'border-box',
          fontFamily: 'inherit',
        };

        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.65)',
              zIndex: 9700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && !journalSubmitting) {
                closeJournal();
              }
            }}
          >
            <div
              style={{
                background: '#1a1a2e',
                border: '1px solid #4a5568',
                borderRadius: '12px',
                padding: '22px 26px 20px',
                maxWidth: '560px',
                width: '100%',
                maxHeight: '85vh',
                overflowY: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                color: '#e2e8f0',
                position: 'relative',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 4,
                  paddingRight: 32,
                }}
              >
                <span style={{ fontSize: 22 }}>📓</span>
                <h2
                  style={{
                    color: '#f0c040',
                    fontSize: '18px',
                    margin: 0,
                    fontWeight: 700,
                    lineHeight: 1.3,
                  }}
                >
                  {journalPin.name} — Stand Journal
                </h2>
              </div>
              <p style={{ color: '#a0aec0', fontSize: 12, margin: '0 0 14px', lineHeight: 1.5 }}>
                Log wind, temp, and deer sightings for every sit at this stand.
              </p>

              {/* Close button */}
              <button
                type="button"
                aria-label="Close journal"
                disabled={journalSubmitting}
                onClick={closeJournal}
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: 'transparent',
                  color: '#a0aec0',
                  border: 'none',
                  borderRadius: 6,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: journalSubmitting ? 'not-allowed' : 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                  opacity: journalSubmitting ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!journalSubmitting) {
                    e.currentTarget.style.background = '#2d3748';
                    e.currentTarget.style.color = '#f0c040';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#a0aec0';
                }}
              >
                <X size={18} />
              </button>

              {/* Entries list / empty state / loading */}
              {journalLoading ? (
                <div
                  style={{
                    textAlign: 'center',
                    color: '#a0aec0',
                    fontSize: 12,
                    padding: '28px 0',
                  }}
                >
                  <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                  <div style={{ marginTop: 6 }}>Loading…</div>
                </div>
              ) : journalError && journalEntries.length === 0 ? (
                <div
                  role="alert"
                  style={{
                    background: '#3a1414',
                    border: '1px solid #b45454',
                    color: '#fca5a5',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 12,
                    lineHeight: 1.5,
                    marginBottom: 12,
                  }}
                >
                  {journalError}
                </div>
              ) : journalEntries.length === 0 && !journalFormOpen ? (
                <div
                  style={{
                    padding: '24px 16px',
                    background: '#0f1420',
                    border: '1px dashed #4a5568',
                    borderRadius: 8,
                    textAlign: 'center',
                    color: '#a0aec0',
                    fontSize: 13,
                    lineHeight: 1.6,
                    marginBottom: 12,
                  }}
                >
                  No entries yet — add your first sit below.
                </div>
              ) : journalEntries.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {journalEntries.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        background: '#0f1420',
                        border: '1px solid #2d3748',
                        borderRadius: 8,
                        padding: '10px 12px',
                      }}
                    >
                      {/* Top row: date + wind + temp + delete */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginBottom: (entry.sightings || entry.notes) ? 6 : 0,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            flexWrap: 'wrap',
                            fontSize: 12,
                          }}
                        >
                          <span style={{ color: '#f0c040', fontWeight: 700 }}>
                            {fmtDate(entry.entry_date)}
                          </span>
                          {entry.wind_direction && (
                            <span
                              style={{
                                color: '#93c5fd',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                              }}
                            >
                              <Wind size={11} />
                              {entry.wind_direction}
                              <span style={{ fontSize: 14, lineHeight: 1 }}>
                                {windArrow(entry.wind_direction)}
                              </span>
                            </span>
                          )}
                          {entry.temp_f !== null && (
                            <span style={{ color: '#fbbf24' }}>{entry.temp_f}°F</span>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label="Delete entry"
                          title="Delete entry"
                          onClick={() => deleteJournalEntry(entry.id)}
                          style={{
                            background: 'transparent',
                            color: '#718096',
                            border: 'none',
                            borderRadius: 4,
                            padding: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#3a1414';
                            e.currentTarget.style.color = '#fca5a5';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = '#718096';
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {entry.sightings && (
                        <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>
                          <span style={{ color: '#a0aec0', fontWeight: 600 }}>Sightings:</span>{' '}
                          {entry.sightings}
                        </div>
                      )}
                      {entry.notes && (
                        <div
                          style={{
                            fontSize: 12,
                            color: '#e2e8f0',
                            lineHeight: 1.5,
                            marginTop: entry.sightings ? 3 : 0,
                          }}
                        >
                          <span style={{ color: '#a0aec0', fontWeight: 600 }}>Notes:</span>{' '}
                          {entry.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Add Entry button OR inline form */}
              {!journalFormOpen ? (
                <button
                  type="button"
                  onClick={openJournalForm}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#c0a020',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '9px 18px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'background 120ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#d1ae25';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#c0a020';
                  }}
                >
                  <Plus size={14} /> Add Entry
                </button>
              ) : (
                <div
                  style={{
                    background: '#0f1420',
                    border: '1px solid #2d3748',
                    borderRadius: 8,
                    padding: '14px 14px 12px',
                  }}
                >
                  {/* Row 1: Date + Wind */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <label htmlFor="journal-date" style={labelStyle}>Date</label>
                      <input
                        id="journal-date"
                        type="date"
                        value={journalDate}
                        onChange={(e) => setJournalDate(e.target.value)}
                        disabled={journalSubmitting}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label htmlFor="journal-wind" style={labelStyle}>Wind</label>
                      <select
                        id="journal-wind"
                        value={journalWind}
                        onChange={(e) => setJournalWind(e.target.value)}
                        disabled={journalSubmitting}
                        style={inputStyle}
                      >
                        <option value="">—</option>
                        <option value="N">N  ↑</option>
                        <option value="NE">NE ↗</option>
                        <option value="E">E  →</option>
                        <option value="SE">SE ↘</option>
                        <option value="S">S  ↓</option>
                        <option value="SW">SW ↙</option>
                        <option value="W">W  ←</option>
                        <option value="NW">NW ↖</option>
                      </select>
                    </div>
                  </div>

                  {/* Row 2: Temp */}
                  <div style={{ marginBottom: 10 }}>
                    <label htmlFor="journal-temp" style={labelStyle}>Temp (°F)</label>
                    <input
                      id="journal-temp"
                      type="number"
                      min={-60}
                      max={150}
                      value={journalTemp}
                      onChange={(e) => setJournalTemp(e.target.value)}
                      disabled={journalSubmitting}
                      placeholder="e.g. 42"
                      style={inputStyle}
                    />
                  </div>

                  {/* Row 3: Sightings */}
                  <div style={{ marginBottom: 10 }}>
                    <label htmlFor="journal-sightings" style={labelStyle}>Sightings</label>
                    <input
                      id="journal-sightings"
                      type="text"
                      maxLength={200}
                      value={journalSightings}
                      onChange={(e) => setJournalSightings(e.target.value.slice(0, 200))}
                      disabled={journalSubmitting}
                      placeholder="2 does, 1 spike"
                      style={inputStyle}
                    />
                  </div>

                  {/* Row 4: Notes */}
                  <div style={{ marginBottom: journalError ? 10 : 14 }}>
                    <label htmlFor="journal-notes" style={labelStyle}>Notes</label>
                    <textarea
                      id="journal-notes"
                      rows={3}
                      maxLength={200}
                      value={journalNotes}
                      onChange={(e) => setJournalNotes(e.target.value.slice(0, 200))}
                      disabled={journalSubmitting}
                      placeholder="Wind was perfect, heard something in the draw at dusk…"
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
                    />
                  </div>

                  {/* Inline error */}
                  {journalError && (
                    <div
                      role="alert"
                      style={{
                        background: '#3a1414',
                        border: '1px solid #b45454',
                        color: '#fca5a5',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 11,
                        marginBottom: 10,
                        lineHeight: 1.5,
                      }}
                    >
                      {journalError}
                    </div>
                  )}

                  {/* Form actions */}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      disabled={journalSubmitting}
                      onClick={cancelJournalForm}
                      style={{
                        background: 'transparent',
                        color: '#a0aec0',
                        border: '1px solid #4a5568',
                        borderRadius: 8,
                        padding: '8px 16px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: journalSubmitting ? 'not-allowed' : 'pointer',
                        opacity: journalSubmitting ? 0.6 : 1,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!journalDate || journalSubmitting}
                      onClick={submitJournalEntry}
                      style={{
                        background: !journalDate ? '#4a5568' : '#c0a020',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '8px 20px',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: !journalDate || journalSubmitting ? 'not-allowed' : 'pointer',
                        opacity: journalSubmitting ? 0.7 : 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {journalSubmitting && (
                        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                      )}
                      {journalSubmitting ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}


        </div>
      )}
    </div>
  );
}