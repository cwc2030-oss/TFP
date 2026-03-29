'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense, useMemo, Component, ErrorInfo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
// NOTE: Deck.gl removed - using native Mapbox sources/layers only for stability
import { 
  Target, TreePine, Wind, Calendar, ChevronLeft, ChevronRight, 
  Compass, Info, CheckCircle, AlertTriangle, Loader2, X, MapPin,
  Mountain, Eye, EyeOff, Layers, Crosshair, Home, ExternalLink,
  Maximize2, Minimize2, RefreshCw, Check, Bug, Lock, ArrowUpRight,
  Unlock, Sparkles, Settings, Download, FileText, Grid3X3, User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  scoreStandsWithExceptional,
  type StandInputs,
  type StandScore,
} from '@/lib/scoring/stand-alignment';
import { buildStandInputs, windDirectionToDeg } from '@/lib/scoring/stand-inputs';
import { useFlowAnimation } from '@/hooks/intel/useFlowAnimation';
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
import { buildTerrainHeatMap, rescoreStandSites, getFocusPaintParams, type PressureFocus, type PressureView } from '@/lib/terrain-heatmap';
import { buildTerrainRaster, primeStandSitesToGeoJSON, type RasterGrid } from '@/lib/terrain-raster';
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
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[INTEL ERROR BOUNDARY] Caught error:', error);
    console.error('[INTEL ERROR BOUNDARY] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full bg-red-950/80 border border-red-500/50 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <Bug className="h-8 w-8 text-red-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-red-300 mb-2">Intel Page Crashed</h1>
                <div className="bg-black/50 rounded-lg p-4 mb-4 overflow-auto max-h-48">
                  <p className="text-red-200 font-mono text-sm break-words">
                    {this.state.error?.message || 'Unknown error'}
                  </p>
                </div>
                {this.state.error?.stack && (
                  <details className="mb-4">
                    <summary className="text-red-400 text-sm cursor-pointer hover:text-red-300">
                      Stack trace
                    </summary>
                    <pre className="bg-black/50 rounded-lg p-3 mt-2 text-xs text-red-300/80 overflow-auto max-h-64 whitespace-pre-wrap">
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
                {this.state.errorInfo?.componentStack && (
                  <details className="mb-4">
                    <summary className="text-red-400 text-sm cursor-pointer hover:text-red-300">
                      Component stack
                    </summary>
                    <pre className="bg-black/50 rounded-lg p-3 mt-2 text-xs text-red-300/80 overflow-auto max-h-48 whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg font-medium"
                  >
                    Reload Page
                  </button>
                  <Link
                    href="/core"
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg font-medium"
                  >
                    Try /core instead
                  </Link>
                </div>
              </div>
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
  edgeBoundaryHighlight: '#8b5cf6', // Purple highlight for adjacent parcel boundaries
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
  standEmphasisGlow: '#2dd4bf',    // Teal-400: subtle glow bias toward top stand
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

  // v3.8.6: More extreme teardrop + tighter perpendicular squeeze
  const FWD_STRETCH = 2.8;    // longer upstream reach
  const BWD_STRETCH = 0.35;   // minimal downstream presence
  const LAT_COMPRESS = 0.45;  // tight lateral squeeze — strongly flow-aligned

  // v3.8.6: Upstream center offset (fraction of max radius shifted along bearing)
  // This places the stand near the trailing edge, not the center.
  const UPSTREAM_SHIFT = 0.30; // 30% of scaled max radius

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

    // ---- Determine flow bearing ----
    let stretchBearing = 315;
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

    const bearingRad = stretchBearing * Math.PI / 180;

    // v3.8.6: Shift pocket origin upstream so stand sits on trailing edge
    const shiftDist = MAX_RADIUS * scaleFactor * UPSTREAM_SHIFT;
    const shiftedCenter = movePoint(center, stretchBearing, shiftDist);

    // ---- Build concentric teardrop shells ----
    for (let ring = RINGS; ring >= 1; ring--) {
      const t = ring / RINGS;
      const radius = (BASE_RADIUS + (MAX_RADIUS - BASE_RADIUS) * t) * scaleFactor;
      const coords: [number, number][] = [];

      for (let i = 0; i <= SEGMENTS; i++) {
        const angle = (i / SEGMENTS) * 2 * Math.PI;
        const localX = Math.cos(angle);
        const localY = Math.sin(angle);

        // Smooth teardrop deformation with cubic easing
        const fwdBlend = (localX + 1) / 2;
        const axialStretch = BWD_STRETCH + (FWD_STRETCH - BWD_STRETCH) * fwdBlend * fwdBlend;
        const deformedX = localX * axialStretch;
        const deformedY = localY * LAT_COMPRESS;

        const mag = Math.sqrt(deformedX * deformedX + deformedY * deformedY);
        if (mag < 0.001) { coords.push(shiftedCenter); continue; }

        // Rotate to geographic bearing
        const geoX = deformedX * Math.cos(bearingRad) - deformedY * Math.sin(bearingRad);
        const geoY = deformedX * Math.sin(bearingRad) + deformedY * Math.cos(bearingRad);

        const ptBearing = (Math.atan2(geoX, geoY) * 180 / Math.PI + 360) % 360;
        const ptDist = radius * mag / Math.max(axialStretch, LAT_COMPRESS);

        coords.push(movePoint(shiftedCenter, ptBearing, ptDist));
      }

      // v3.8.6: 6-harmonic organic jitter — stronger amplitude on outer shells
      // Higher base (8%) + steeper ring-dependent growth (12%) = 8–20% distortion
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

      // v3.8.6: Compute average corridor-axis bias for this ring.
      // Points along the corridor axis (high |localX|) get bias ~1.0;
      // points perpendicular (high |localY|) get bias ~0.5.
      // This is averaged across all vertices to produce a single ring value
      // (Mapbox expressions can't do per-vertex, so we bias per-ring via
      // the dominant axis direction of each ring's shape).
      // For the teardrop, all rings share the same deformation so we store
      // a constant representing the overall shape's corridor alignment.
      const corridorBias = 0.85; // teardrop is heavily corridor-aligned

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
          corridorBias, // v3.8.6: flow-axis intensity multiplier
          resilienceFactor, // v-resilience: derived from standResilience
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
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (!stands.length) return { type: 'FeatureCollection', features };

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

  for (const stand of stands) {
    const center = stand.coords;

    // Movement-axis bearing: uses corridor-tangent (same as hunt pocket stretchBearing)
    // so the wedge aligns with the pocket's long axis.  This is flow direction,
    // not a true approach vector — see header comment on buildStandDirectionFeatures.
    let faceBearing = 315; // fallback NW
    let nearestCorridorDist = Infinity;
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
      faceBearing = corridorBrg;
    } else {
      // Fallback: draw segment tangent
      let nearestDrawDist = Infinity;
      for (const line of drawLines) {
        if (line.length < 2) continue;
        const result = closestPointOnLineString(center, line);
        if (result.dist < nearestDrawDist) {
          nearestDrawDist = result.dist;
          const seg = line[result.segIndex];
          const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
          faceBearing = calculateBearing(seg, segEnd);
        }
      }
      if (nearestDrawDist >= 500) {
        // Fallback: perpendicular to nearest ridge
        let nearestRidgeDist = Infinity;
        for (const line of ridgeLines) {
          if (line.length < 2) continue;
          const result = closestPointOnLineString(center, line);
          if (result.dist < nearestRidgeDist) {
            nearestRidgeDist = result.dist;
            const seg = line[result.segIndex];
            const segEnd = line[Math.min(result.segIndex + 1, line.length - 1)];
            faceBearing = (calculateBearing(seg, segEnd) + 90) % 360;
          }
        }
      }
    }

    // Build a thin flow-axis wedge: center → tip, with two flanking lines at ±12°
    const WEDGE_LENGTH = 55; // meters — subtle, not overpowering
    const WEDGE_HALF_ANGLE = 12; // degrees
    const OFFSET = 12; // start 12m from center (outside the marker)

    const tipMain = movePoint(center, faceBearing, WEDGE_LENGTH);
    const startPt = movePoint(center, faceBearing, OFFSET);
    const tipLeft = movePoint(center, (faceBearing - WEDGE_HALF_ANGLE + 360) % 360, WEDGE_LENGTH * 0.85);
    const tipRight = movePoint(center, (faceBearing + WEDGE_HALF_ANGLE) % 360, WEDGE_LENGTH * 0.85);

    // Main vector line
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [startPt, tipMain] },
      properties: {
        standRank: stand.rank,
        isTopStand: stand.rank === stands[0]?.rank,
        type: 'main',
      },
    });

    // Left flank
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [startPt, tipLeft] },
      properties: {
        standRank: stand.rank,
        isTopStand: stand.rank === stands[0]?.rank,
        type: 'flank',
      },
    });

    // Right flank
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [startPt, tipRight] },
      properties: {
        standRank: stand.rank,
        isTopStand: stand.rank === stands[0]?.rank,
        type: 'flank',
      },
    });
  }

  return { type: 'FeatureCollection', features };
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
  parcelCoords: number[][]
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
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  
  // v3.5.1 — Animation frame ref for corridor flow animation
  const flowAnimationRef = useRef<number | null>(null);
  const flowAnimationPhase = useRef<number>(0);

  // URL params (initial values)
  const urlLat = parseFloat(searchParams.get('lat') || '36.638590');
  const urlLng = parseFloat(searchParams.get('lng') || '-94.345581');
  const urlAddress = searchParams.get('address') || 'Sample Property';
  const urlAcreage = searchParams.get('acreage');
  const debugMode = searchParams.get('debug') === 'true'; // Admin/debug only features

  // Active coordinates — start from URL, updated by Exploration Mode clicks
  const [activeLat, setActiveLat] = useState(urlLat);
  const [activeLng, setActiveLng] = useState(urlLng);
  const [activeAddress, setActiveAddress] = useState(urlAddress);
  const [activeAcreage, setActiveAcreage] = useState(urlAcreage);
  
  // Derived aliases for backward compatibility throughout the file
  const lat = activeLat;
  const lng = activeLng;
  const address = activeAddress;
  const acreageParam = activeAcreage;

  // Analysis state
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TerrainMode>('preview');
  const [layers, setLayers] = useState<TerrainLayers | null>(null);
  const [summary, setSummary] = useState<TerrainSummary | null>(null);
  const [provenance, setProvenance] = useState<TerrainProvenance | null>(null);

  // Global/unhandled error state
  const [globalError, setGlobalError] = useState<{ message: string; stack?: string } | null>(null);

  // User controls
  const [season, setSeason] = useState<SeasonProfile>('rut');
  const [pressureFocus, setPressureFocus] = useState<PressureFocus>('balanced');
  const [pressureView, setPressureView] = useState<PressureView>('pressure');
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

  // Raster grid state — persisted so the compare card can sample nearby cells
  const [rasterGrid, setRasterGrid] = useState<RasterGrid | null>(null);

  // Parcel-Hunt File download state
  const [isDownloading, setIsDownloading] = useState(false);

  // Inspect Mode state (visual indicator that flow segments are clickable)
  const [inspectModeEnabled, setInspectModeEnabled] = useState(false);
  
  // Export/Screenshot Mode state (clean map for broker demos)
  const [exportMode, setExportMode] = useState(false);

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

  // ========== GLOBAL ERROR HANDLERS ==========
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[INTEL] Unhandled promise rejection:', event.reason);
      const errorMsg = event.reason instanceof Error 
        ? event.reason.message 
        : String(event.reason);
      const errorStack = event.reason instanceof Error ? event.reason.stack : undefined;
      setGlobalError({ message: `Unhandled rejection: ${errorMsg}`, stack: errorStack });
      setError(`Unhandled error: ${errorMsg}`);
      setIsLoading(false);
    };

    const handleGlobalError = (event: ErrorEvent) => {
      console.error('[INTEL] Global error:', event.message, event.filename, event.lineno);
      setGlobalError({ 
        message: `${event.message} (${event.filename}:${event.lineno})`,
        stack: event.error?.stack 
      });
      setError(`Error: ${event.message}`);
      setIsLoading(false);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleGlobalError);

    console.log('[INTEL] Global error handlers registered');

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleGlobalError);
    };
  }, []);

  // Check WebGL support
  const checkWebGLSupport = (): boolean => {
    return true; // Let Mapbox handle gracefully
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

    // Build aligned stands array sorted by score desc
    const aligned: AlignedStand[] = stands.map((f, i) => {
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
    }).sort((a, b) => b.alignment.score - a.alignment.score);

    // Log stand resilience values for verification
    if (aligned.length > 0) {
      console.log('[StandResilience] Sample values:', aligned.slice(0, 5).map(s => ({
        rank: s.rank, name: s.name,
        standResilience: s.props?.standResilience?.toFixed(3) ?? 'N/A',
        corridorResilience: s.resilience?.score?.toFixed(3) ?? 'N/A',
      })));
    }

    setAlignedStands(aligned);
    setExceptionalIndex(ei !== null ? aligned.findIndex((_, idx) => idx === ei) : null);
    setParcelStrength(ps);

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
              setMostAlignedHint({ standRank: newTop.rank, name: `Stand #${newTop.rank}` });
              if (hintFadeTimeoutRef.current) clearTimeout(hintFadeTimeoutRef.current);
              hintFadeTimeoutRef.current = setTimeout(() => setMostAlignedHint(null), 6000);
            }
          }, 2000);
        }
      }
    }
  }, [layers?.standPoints, windDirection, season]);

  // v1.2 wind-compass fix: fire alignment scorer directly when deps change.
  // Removed the prevWindDirection stability gate — compass clicks are always 45°
  // increments which far exceed any useful jitter threshold. The old gate could
  // swallow valid clicks when React batched state updates.
  useEffect(() => {
    if (!layers?.standPoints) return;
    computeAlignmentScores();
  }, [layers?.standPoints, windDirection, season, computeAlignmentScores]);

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

  // Download Parcel-Hunt File PDF
  const handleDownloadParcelHuntFile = useCallback(async () => {
    if (isDownloading) return;
    
    setIsDownloading(true);
    try {
      const top3 = alignedStands.slice(0, 3);
      const payload = {
        address,
        lat,
        lng,
        acreage: acreageParam ?? 40,
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
      };

      // Save terrain results to order for report generation
      try {
        const savedOrder = localStorage.getItem('tfp_current_order_id');
        if (savedOrder) {
          await fetch(`/api/orders/${savedOrder}/save-terrain`, {
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

      if (!response.ok) throw new Error('Report generation failed');

      const html = await response.text();
      const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `TFP-Hunt-Report-${new Date().toISOString().slice(0,10)}.html`;
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
  }, [isDownloading, alignedStands, address, lat, lng, acreageParam, windDirection, summary, tieredCorridorData, parcelPolygon, terrainStory]);

  // Progress step text for UI
  const [progressStep, setProgressStep] = useState<string>('Initializing...');

  // ========== FULL OVERLAY RESET — clears every tfp-* GeoJSON source ==========
  const clearAllOverlaySources = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const ALL_TFP_SOURCES = [
      'tfp-parcel', 'tfp-qa-parcel',
      'tfp-debug-raw', 'tfp-debug-normalized', 'tfp-debug-analysis',
      'tfp-bedding', 'tfp-funnels-lines', 'tfp-funnels-polys',
      'tfp-corridors-primary', 'tfp-corridors-possible', 'tfp-corridors-exploratory',
      'tfp-corridors-context-primary', 'tfp-corridors-context-possible',
      'tfp-funnels-hard', 'tfp-funnels-slight', 'tfp-intrusion-overlay',
      'tfp-ridges-primary', 'tfp-ridges-secondary', 'tfp-saddle-nodes',
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
      'tfp-stand-emphasis', // v3.8.1 — top-stand attention glow
      'tfp-hunt-pockets', // Hunt pocket halos around stands
      'tfp-stand-direction', // v1.1 — movement-axis / flow-axis wedge (not approach direction)
      'tfp-stand-tertiary', // v1.1 — tertiary stand dots
    ];
    for (const id of ALL_TFP_SOURCES) {
      try {
        const src = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
        if (src) src.setData(EMPTY_FC);
      } catch (e) {
        // Source may have been removed — safe to ignore
      }
    }
    console.log('[OVERLAY RESET] Cleared all', ALL_TFP_SOURCES.length, 'tfp-* sources');
  }, []);

  // Fetch terrain analysis using shared client
  const runAnalysis = useCallback(async () => {
    // Clear ALL previous overlay sources before starting fresh analysis
    clearAllOverlaySources();

    setIsLoading(true);
    setError(null);
    setProgress(10);
    setProgressStep('Fetching parcel boundary...');
    
    // Read current season/wind from refs so we always get the latest values
    // even though these are intentionally excluded from the dep array.
    const currentSeason = seasonRef.current;
    const currentWind = windDirectionRef.current;
    
    const startTime = Date.now();
    console.log('[INTEL] === ANALYSIS START ===');
    console.log('[INTEL] Coordinates:', lat, lng);
    console.log('[INTEL] Season:', currentSeason, 'Wind:', currentWind);
    console.log('[INTEL] Current parcelPolygon:', parcelPolygon ? 'EXISTS' : 'NULL');

    try {
      // Import shared terrain client
      const { fetchParcelGeometry, fetchTerrainAnalysis, generateSyntheticParcel } = await import('@/lib/terrain-client');
      
      // Get real parcel geometry from Regrid
      setProgress(15);
      console.log('[INTEL] Fetching parcel geometry for:', lat, lng);
      const parcel = await fetchParcelGeometry(lat, lng);
      
      if (!parcel) {
        // Use synthetic fallback instead of failing
        console.warn('[INTEL] No Regrid parcel, using synthetic boundary');
        const syntheticParcel = generateSyntheticParcel(lat, lng, parseFloat(acreageParam || '80'));
        console.log('[INTEL] Setting parcelPolygon to SYNTHETIC parcel');
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
            setProgress(20 + Math.round(prog * 0.8)); // Scale 0-100 to 20-100
          },
          45_000 // 45 second timeout
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
        console.log('[INTEL] Analysis complete (synthetic):', result.durationMs, 'ms');
        return;
      }
      
      console.log('[INTEL] Setting parcelPolygon to REAL parcel:', parcel.properties?.parcelId);
      console.log('[INTEL] Parcel geometry type:', parcel.geometry.type);
      console.log('[INTEL] Parcel coords length:', parcel.geometry.type === 'Polygon' 
        ? parcel.geometry.coordinates[0].length 
        : parcel.geometry.coordinates.map((p: any) => p[0]?.length || 0));
      setParcelPolygon(parcel);
      setProgress(20);
      setProgressStep('Running terrain analysis...');
      console.log('[INTEL] Got real parcel:', parcel.properties?.parcelId);

      // Run terrain analysis with 120s timeout
      const result = await fetchTerrainAnalysis(
        {
          parcel,
          seasonProfile: currentSeason,
          prevailingWinds: [currentWind],
          bufferMeters: 800,
        },
        (step, prog) => {
          setProgressStep(step);
          setProgress(20 + Math.round(prog * 0.8)); // Scale 0-100 to 20-100
        },
        45_000 // 45 second timeout
      );

      const totalDuration = Date.now() - startTime;
      console.log('[INTEL] Total analysis time:', totalDuration, 'ms');

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
      
      console.log('[INTEL] === ANALYSIS COMPLETE ===');

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Analysis failed';
      console.error('[INTEL] Analysis error:', errorMsg);
      setError(errorMsg);
      setProgressStep('Failed');
    } finally {
      setIsLoading(false);
    }
  // NOTE: season and windDirection intentionally excluded from deps.
  // Season/wind changes only affect the heatmap repaint (handled by the terrain flow painting effect),
  // NOT the full terrain analysis pipeline. This prevents data loss on season/wind toggle.
  }, [lat, lng, acreageParam, clearAllOverlaySources]); // eslint-disable-line react-hooks/exhaustive-deps

  // ========== NATIVE MAPBOX SOURCES INITIALIZED FLAG ==========
  const overlaySourcesCreated = useRef(false);
  const hasFitToParcel = useRef(false);

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

      // Update bedding polygons
      const beddingSource = map.getSource('tfp-bedding') as mapboxgl.GeoJSONSource;
      if (beddingSource) {
        const beddingFC = layers?.beddingPolygons ? validateGeoJSON(layers.beddingPolygons) : EMPTY_FC;
        const polygonsOnly = filterByGeometryType(beddingFC, ['Polygon', 'MultiPolygon']);
        beddingSource.setData(polygonsOnly);
      }

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
      const funnelPolysSource = map.getSource('tfp-funnels-polys') as mapboxgl.GeoJSONSource;
      if (funnelPolysSource) {
        const funnelsFC = layers?.funnels ? validateGeoJSON(layers.funnels) : EMPTY_FC;
        const polys = filterByGeometryType(funnelsFC, ['Polygon', 'MultiPolygon']);
        funnelPolysSource.setData(polys);
      }

      console.log('[MAP] Updated native Mapbox sources with terrain data');
    } catch (err) {
      console.error('[MAP] Error updating sources (non-fatal):', err);
    }
  }, [layers, parcelPolygon, mapReady]);

  // ========== FIT TO PARCEL ON LOAD (IMMEDIATE ORIENTATION) ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !parcelPolygon || hasFitToParcel.current) return;
    // v3.8.4-fix — guard: style must be loaded before fitBounds
    if (!map.isStyleLoaded()) {
      console.warn('[MAP] fitBounds deferred — style not yet loaded');
      return;
    }
    
    try {
      // Extract bounds from parcel geometry
      const coords = parcelPolygon.geometry.type === 'Polygon'
        ? parcelPolygon.geometry.coordinates[0]
        : parcelPolygon.geometry.coordinates[0][0]; // First polygon of MultiPolygon
      
      if (coords && coords.length >= 3) {
        const bounds = new mapboxgl.LngLatBounds();
        coords.forEach((coord: number[]) => {
          bounds.extend([coord[0], coord[1]]);
        });
        
        // Immediately fit to parcel with comfortable padding
        map.fitBounds(bounds, {
          padding: 80,
          duration: 800,
          maxZoom: 16,
        });
        
        hasFitToParcel.current = true;
        console.log('[MAP] Fit to parcel bounds for immediate orientation');
      }
    } catch (err) {
      console.error('[MAP] FitBounds error (non-fatal):', err);
    }
  }, [parcelPolygon, mapReady]);

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
      const ghostBedding = generateGhostBedding(
        layers.beddingPolygons || { type: 'FeatureCollection', features: [] },
        parcelCoords
      );
      const funnelsFC = layers.funnels || { type: 'FeatureCollection', features: [] };
      const ghostSaddles = generateGhostSaddles(funnelsFC, parcelCoords);
      const drawExtensions = generateDrawExtensions(funnelsFC, parcelCoords);
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

          setRidgeSpineData({
            ridges_primary: result.data.ridges_primary,
            ridges_secondary: result.data.ridges_secondary,
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
          const synthetic = generateSyntheticRidgeSpines(parcelPolygon);
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
      const saddleSource = map.getSource('tfp-saddle-nodes') as mapboxgl.GeoJSONSource;
      if (saddleSource) {
        saddleSource.setData(ridgeSpineData.saddle_nodes);
      }

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
      const beddingSource = map.getSource('tfp-bedding-probability') as mapboxgl.GeoJSONSource;
      if (beddingSource && huntabilityData.beddingProbabilityGeoJSON) {
        beddingSource.setData(huntabilityData.beddingProbabilityGeoJSON);
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

  // ========== UPDATE TERRAIN FLOW MAP SOURCES ==========
  // v3.8.4 — debounce 300ms so rapid season/wind clicks coalesce into one setData pass
  const terrainFlowDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;

    if (terrainFlowDebounceRef.current) clearTimeout(terrainFlowDebounceRef.current);
    terrainFlowDebounceRef.current = setTimeout(() => {
    terrainFlowDebounceRef.current = null;

    // Select data source based on comparison mode
    const flowData = flowComparisonMode && legacySyntheticData 
      ? legacySyntheticData 
      : terrainFlowData;
    
    // CRITICAL FIX: When flowData is null, clear map sources (not return early)
    // This prevents stale terrain flow from persisting across parcel changes
    const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    try {
      // Update primary flow source
      const primarySource = map.getSource('tfp-flow-primary') as mapboxgl.GeoJSONSource;
      if (primarySource) {
        primarySource.setData(flowData?.flow_primary || emptyFC);
      }

      // Update secondary flow source
      const secondarySource = map.getSource('tfp-flow-secondary') as mapboxgl.GeoJSONSource;
      if (secondarySource) {
        secondarySource.setData(flowData?.flow_secondary || emptyFC);
      }

      // Update convergence zones source
      const convergenceSource = map.getSource('tfp-flow-convergence') as mapboxgl.GeoJSONSource;
      if (convergenceSource) {
        convergenceSource.setData(flowData?.convergence_zones || emptyFC);
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
        const rasterResult = buildTerrainRaster({
          parcelCoords: parcelCoordsForGrid,
          beddingPolygons: layers?.beddingPolygons || undefined,
          ridgeSpineData: ridgeSpineData || undefined,
          season,
          focusMode: pressureFocus,
        });

        if (rasterResult) {
          // Persist grid for stand-compare sampling
          setRasterGrid(rasterResult.grid);

          // Update heat map from raster surface
          if (heatmapSource) {
            heatmapSource.setData(rasterResult.heatPoints);
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
              focusMode: pressureFocus,
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
            focusMode: pressureFocus,
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
  }, [terrainFlowData, legacySyntheticData, flowComparisonMode, mapReady, layers, pressureFocus, parcelPolygon, ridgeSpineData, season]);

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
  }, [selectedStand, alignedStands, terrainFlowData, mapReady, flowVisibility.flowPrimary]);

  // ========== UPDATE LAYER VISIBILITY ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;

    try {
      // Bedding visibility
      if (map.getLayer('tfp-bedding-fill')) {
        map.setLayoutProperty('tfp-bedding-fill', 'visibility', visibility.bedding ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-bedding-outline')) {
        map.setLayoutProperty('tfp-bedding-outline', 'visibility', visibility.bedding ? 'visible' : 'none');
      }

      // Funnel visibility - draws layer (now independently controlled)
      if (map.getLayer('tfp-funnels-lines-draws')) {
        map.setLayoutProperty('tfp-funnels-lines-draws', 'visibility', visibility.draws ? 'visible' : 'none');
      }
      // Corridors layers (solid for high/med, dashed for low)
      if (map.getLayer('tfp-funnels-lines-corridors-solid')) {
        map.setLayoutProperty('tfp-funnels-lines-corridors-solid', 'visibility', visibility.corridors ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-funnels-lines-corridors-dashed')) {
        map.setLayoutProperty('tfp-funnels-lines-corridors-dashed', 'visibility', visibility.corridors ? 'visible' : 'none');
      }
      // Legacy corridors layer (for compatibility)
      if (map.getLayer('tfp-funnels-lines-corridors')) {
        map.setLayoutProperty('tfp-funnels-lines-corridors', 'visibility', visibility.corridors ? 'visible' : 'none');
      }
      // Fallback layer
      if (map.getLayer('tfp-funnels-lines')) {
        const funnelVisible = visibility.draws || visibility.saddles || visibility.corridors;
        map.setLayoutProperty('tfp-funnels-lines', 'visibility', funnelVisible ? 'visible' : 'none');
      }
      // Saddle polygons (now independently controlled)
      if (map.getLayer('tfp-funnels-polys-fill')) {
        map.setLayoutProperty('tfp-funnels-polys-fill', 'visibility', visibility.saddles ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-funnels-polys-outline')) {
        map.setLayoutProperty('tfp-funnels-polys-outline', 'visibility', visibility.saddles ? 'visible' : 'none');
      }
      
      // V2 Tiered corridor visibility
      const tieredCorridorLayers = [
        'tfp-corridors-primary',
        'tfp-corridors-possible',
        'tfp-corridors-exploratory',
        'tfp-corridors-context-primary',
        'tfp-corridors-context-possible',
        'tfp-intrusion-overlay',
      ];
      tieredCorridorLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', visibility.corridors ? 'visible' : 'none');
        }
      });
      
      // V2 Tiered funnel visibility
      const tieredFunnelLayers = [
        'tfp-funnels-hard-fill',
        'tfp-funnels-hard-outline',
        'tfp-funnels-slight-fill',
        'tfp-funnels-slight-outline',
      ];
      tieredFunnelLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', visibility.funnels ? 'visible' : 'none');
        }
      });
      
      // Ridge spine visibility (structure-first terrain anatomy)
      // Includes casing/halo layers for the "terrain skeleton" effect
      const ridgeSpineLayers = [
        'tfp-ridges-primary-casing',    // Halo/casing
        'tfp-ridges-primary',           // Core line
        'tfp-ridges-secondary-casing',  // Halo/casing
        'tfp-ridges-secondary',         // Core line
        'tfp-saddle-nodes',
        'tfp-saddle-nodes-outline',
      ];
      ridgeSpineLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', visibility.ridgeSpines ? 'visible' : 'none');
        }
      });
      
      // When ridge spines are ON, reduce heatmap opacity slightly so skeleton is readable
      if (map.getLayer('tfp-pressure-heatmap')) {
        const heatmapOpacity = visibility.ridgeSpines ? 0.55 : 0.75;
        map.setPaintProperty('tfp-pressure-heatmap', 'heatmap-opacity', heatmapOpacity);
      }
      
      // Terrain Flow visibility (movement likelihood layers)
      // Pressure Simulation v1 — pressureView controls which of the 4 heat layers is active.
      // All four share the master pressureHeatmap toggle; pressureView picks one.
      const heatOn = flowVisibility.pressureHeatmap;
      if (map.getLayer('tfp-pressure-heatmap')) {
        map.setLayoutProperty('tfp-pressure-heatmap', 'visibility', heatOn && pressureView === 'pressure' ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-movement-delta')) {
        map.setLayoutProperty('tfp-movement-delta', 'visibility', heatOn && pressureView === 'damage' ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-movement-post')) {
        map.setLayoutProperty('tfp-movement-post', 'visibility', heatOn && pressureView === 'movement' ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-refuge-zones')) {
        map.setLayoutProperty('tfp-refuge-zones', 'visibility', heatOn && pressureView === 'refuge' ? 'visible' : 'none');
      }
      // Flow lines (SUPPORTING EVIDENCE) — v3.5.1 animated corridors
      if (map.getLayer('tfp-flow-primary')) {
        map.setLayoutProperty('tfp-flow-primary', 'visibility', flowVisibility.flowPrimary ? 'visible' : 'none');
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
      if (map.getLayer('tfp-flow-primary-glow')) {
        map.setLayoutProperty('tfp-flow-primary-glow', 'visibility', flowVisibility.flowPrimary ? 'visible' : 'none');
        // Widen glow slightly when Deer Flow is active for extra readability
        map.setPaintProperty('tfp-flow-primary-glow', 'line-opacity', isPressureMode ? 0.35 : 0.25);
      }
      // Nearest corridor highlight follows primary flow visibility + stand selection
      if (map.getLayer('tfp-flow-nearest-highlight')) {
        const showHighlight = flowVisibility.flowPrimary && selectedStand !== null;
        map.setLayoutProperty('tfp-flow-nearest-highlight', 'visibility', showHighlight ? 'visible' : 'none');
      }
      // v3.8.1 — Directional chevrons follow primary flow visibility
      if (map.getLayer('tfp-flow-direction-chevrons')) {
        map.setLayoutProperty('tfp-flow-direction-chevrons', 'visibility', flowVisibility.flowPrimary ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-flow-secondary')) {
        map.setLayoutProperty('tfp-flow-secondary', 'visibility', flowVisibility.flowSecondary ? 'visible' : 'none');
        // When Deer Flow is active, boost secondary enough to read as supporting routes
        map.setPaintProperty('tfp-flow-secondary', 'line-opacity', isPressureMode ? 0.50 : 0.45);
        map.setPaintProperty('tfp-flow-secondary', 'line-width', isPressureMode ? [
          'interpolate', ['linear'], ['zoom'],
          10, 1.8,
          15, 2.2,
          18, 2.8,
        ] : 1.5);
      }
      if (map.getLayer('tfp-flow-convergence')) {
        map.setLayoutProperty('tfp-flow-convergence', 'visibility', flowVisibility.convergenceZones ? 'visible' : 'none');
        // Fade convergence blobs when Pressure Map is active so the new heat surface dominates
        map.setPaintProperty('tfp-flow-convergence', 'circle-opacity', isPressureMode ? 0.1 : 0.85);
      }
      if (map.getLayer('tfp-flow-convergence-pulse')) {
        map.setLayoutProperty('tfp-flow-convergence-pulse', 'visibility', flowVisibility.convergenceZones ? 'visible' : 'none');
        map.setPaintProperty('tfp-flow-convergence-pulse', 'circle-opacity', isPressureMode ? 0.1 : 0.15);
      }
      // v3.6.0: Bedding Probability visibility
      if (map.getLayer('tfp-bedding-probability-glow')) {
        map.setLayoutProperty('tfp-bedding-probability-glow', 'visibility', showBeddingProbability ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-bedding-probability-fill')) {
        map.setLayoutProperty('tfp-bedding-probability-fill', 'visibility', showBeddingProbability ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-bedding-probability-outline')) {
        map.setLayoutProperty('tfp-bedding-probability-outline', 'visibility', showBeddingProbability ? 'visible' : 'none');
      }
    } catch (err) {
      console.error('[MAP] Error updating visibility (non-fatal):', err);
    }
  }, [visibility, flowVisibility, showBeddingProbability, pressureView, isPressureMode, mapReady, selectedStand]);

  // ========== PRESSURE FOCUS — DYNAMIC PAINT UPDATE ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      const fp = getFocusPaintParams(pressureFocus);
      if (map.getLayer('tfp-pressure-heatmap')) {
        // Weight curve: 6-stop ramp — kills haze below 0.25, focus mode shapes mid-range
        map.setPaintProperty('tfp-pressure-heatmap', 'heatmap-weight', [
          'interpolate', ['linear'],
          ['coalesce', ['get', 'score'], ['get', 'intensity'], 0.5],
          0.00, fp.weightCurve[0],
          0.25, fp.weightCurve[1],
          0.40, fp.weightCurve[2],
          0.60, fp.weightCurve[3],
          0.80, fp.weightCurve[4],
          1.00, fp.weightCurve[5],
        ]);
        // Intensity: scaled per focus
        map.setPaintProperty('tfp-pressure-heatmap', 'heatmap-intensity', [
          'interpolate', ['linear'], ['zoom'],
          10, 0.7 * fp.intensityMult,
          15, 1.3 * fp.intensityMult,
        ]);
        // Radius: tight lanes — offset per focus (tighter in focused, wider in broad)
        map.setPaintProperty('tfp-pressure-heatmap', 'heatmap-radius', [
          'interpolate', ['linear'], ['zoom'],
          10, Math.max(8, 18 + fp.radiusOffset),
          15, Math.max(12, 24 + fp.radiusOffset),
          18, Math.max(18, 34 + fp.radiusOffset),
        ]);
        // Opacity: reduce when ridge spines are visible so skeleton shows through
        const baseOpacity = visibility.ridgeSpines ? 0.55 : fp.opacity;
        map.setPaintProperty('tfp-pressure-heatmap', 'heatmap-opacity', baseOpacity);
      }

      console.log('[PressureFocus]', pressureFocus, fp, 'ridgeSpines:', visibility.ridgeSpines);
    } catch (err) {
      console.error('[PressureFocus] Error updating paint (non-fatal):', err);
    }
  }, [pressureFocus, mapReady, visibility.ridgeSpines]);

  // ========== SINGLE MAPBOX MAP INSTANCE ==========
  // Track instance count for debugging double-mount issues
  const mountIdRef = useRef<string>('');
  
  useEffect(() => {
    const mountId = Date.now().toString(36);
    mountIdRef.current = mountId;
    console.log('[LIFECYCLE] useEffect ENTER id=' + mountId + ' mapRef=' + !!mapRef.current + ' container=' + !!mapContainerRef.current);
    
    if (!mapContainerRef.current) {
      console.log('[LIFECYCLE] No container ref, skipping');
      return;
    }
    
    if (mapRef.current) {
      console.log('[LIFECYCLE] Map already exists, skipping creation');
      return;
    }

    // Check WebGL support
    if (!checkWebGLSupport()) {
      setMapError("Your browser doesn't support WebGL, which is required for 3D terrain viewing.");
      setIsLoading(false);
      return;
    }

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

    console.log('[MAP] BEFORE new mapboxgl.Map() id=' + mId + ' center=[' + lng + ',' + lat + ']');
    try {
      map = new mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: 14,
        pitch: 0,    // Flat 2D view - no 3D terrain
        bearing: 0,  // North up
      });
      console.log('[MAP] AFTER new mapboxgl.Map() id=' + mId + ' map exists=' + !!map);
      
      // Expose for debugging
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = map;
        console.log('[MAP] __TFP_MAP__ SET to', !!map);
      }
    } catch (err) {
      console.error("[MAP] FAILED to create Map:", err);
      setMapError("Failed to load map. Please try refreshing the page.");
      setIsLoading(false);
      return;
    }

    // v3.8.4-fix — Detailed error handler: log full error object + stack
    map.on('error', (e: any) => {
      const err = e?.error || e;
      console.error("[MAP ERROR] message:", err?.message, "status:", err?.status, "url:", err?.url);
      console.error("[MAP ERROR] full:", JSON.stringify(err, null, 2));
      if (err?.stack) console.error("[MAP ERROR] stack:", err.stack);
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
    // v3.8.4-fix — CRITICAL: Force resize IMMEDIATELY on style.load so Mapbox
    // recalculates its internal viewport and actually requests tiles.
    map.once('style.load', () => {
      console.log('[MAP] style.load event — forcing resize() to trigger tile requests');
      try {
        map.resize();
        console.log('[MAP] style.load resize() completed');
      } catch (resErr) {
        console.warn('[MAP] style.load resize() failed:', resErr);
      }
    });
    // Also listen for 'idle' once — by then all initial tiles should be painted
    map.once('idle', () => {
      const canvas = map.getCanvas();
      console.log('[MAP DIAG] idle event — canvas:', canvas?.width, 'x', canvas?.height,
        'loaded:', map.loaded(), 'areTilesLoaded:', map.areTilesLoaded());
    });

    // Handler for when map is fully loaded
    const onMapLoad = () => {
      console.log('[MAP] LOAD EVENT FIRED id=' + mountId + ' map.loaded()=' + map.loaded());
      
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
        
        // Bedding source - HIDE in Terrain Work Mode (deer interpretation)
        if (!map.getSource('tfp-bedding')) {
          map.addSource('tfp-bedding', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-bedding-fill',
            type: 'fill',
            source: 'tfp-bedding',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'fill-color': LAYER_COLORS.bedding,
              'fill-opacity': 0.25,
            },
          });
          map.addLayer({
            id: 'tfp-bedding-outline',
            type: 'line',
            source: 'tfp-bedding',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
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
          map.addLayer({
            id: 'tfp-funnels-lines-draws',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['==', ['get', 'funnelType'], 'draw'],
            layout: { visibility: 'visible' }, // Draws = terrain structure, always visible initially
            paint: {
              'line-color': LAYER_COLORS.funnelDraw,
              'line-width': 3,
            },
          });
          // Corridors layer: HIGH + MEDIUM confidence = SOLID lines - HIDE in Terrain Work Mode
          map.addLayer({
            id: 'tfp-funnels-lines-corridors-solid',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['all', 
              ['==', ['get', 'funnelType'], 'corridor'],
              ['>=', ['coalesce', ['get', 'corridorScore'], 0.5], 0.4]  // Med + High only
            ],
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
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
          
          // Corridors layer: LOW confidence = DASHED lines - HIDE in Terrain Work Mode
          map.addLayer({
            id: 'tfp-funnels-lines-corridors-dashed',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['all', 
              ['==', ['get', 'funnelType'], 'corridor'],
              ['<', ['coalesce', ['get', 'corridorScore'], 0.5], 0.4]  // Low only
            ],
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
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
        
        // Primary corridors: Top band - VISUAL CALM (reduced weight)
        if (!map.getSource('tfp-corridors-primary')) {
          map.addSource('tfp-corridors-primary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-primary',
            type: 'line',
            source: 'tfp-corridors-primary',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorPrimary,
              'line-width': 3,           // Reduced from 4
              'line-opacity': 0.70,      // Reduced from 0.85
            },
          });
        }
        
        // Possible corridors - subtle
        if (!map.getSource('tfp-corridors-possible')) {
          map.addSource('tfp-corridors-possible', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-possible',
            type: 'line',
            source: 'tfp-corridors-possible',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorPossible,
              'line-width': 2,           // Reduced from 2.5
              'line-opacity': 0.35,      // Reduced from 0.45
            },
          });
        }
        
        // Exploratory lanes - very faint
        if (!map.getSource('tfp-corridors-exploratory')) {
          map.addSource('tfp-corridors-exploratory', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-exploratory',
            type: 'line',
            source: 'tfp-corridors-exploratory',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorExploratory,
              'line-width': 1.2,         // Reduced from 1.5
              'line-opacity': 0.20,      // Reduced from 0.25
              'line-dasharray': [4, 3],
            },
          });
        }
        
        // Context corridors (off-parcel) - Primary tier
        if (!map.getSource('tfp-corridors-context-primary')) {
          map.addSource('tfp-corridors-context-primary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-context-primary',
            type: 'line',
            source: 'tfp-corridors-context-primary',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorContext,
              'line-width': 2.5,         // Reduced from 3
              'line-opacity': 0.30,      // Reduced from 0.35
              'line-dasharray': [3, 2],
            },
          });
        }
        
        // Context corridors (off-parcel) - Possible tier
        if (!map.getSource('tfp-corridors-context-possible')) {
          map.addSource('tfp-corridors-context-possible', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-corridors-context-possible',
            type: 'line',
            source: 'tfp-corridors-context-possible',
            layout: { visibility: TERRAIN_WORK_MODE ? 'none' : 'visible' },
            paint: {
              'line-color': LAYER_COLORS.corridorContext,
              'line-width': 1.5,         // Reduced from 2
              'line-opacity': 0.15,      // Reduced from 0.20
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
              'circle-radius': 4,          // Smaller
              'circle-color': LAYER_COLORS.saddleNode,
              'circle-opacity': 0.50,      // Subtle
            },
          });
          map.addLayer({
            id: 'tfp-saddle-nodes-outline',
            type: 'circle',
            source: 'tfp-saddle-nodes',
            paint: {
              'circle-radius': 5,
              'circle-color': 'transparent',
              'circle-stroke-color': LAYER_COLORS.saddleNode,
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.60,
            },
          });
        }
        
        // ========== TERRAIN PRESSURE HEAT MAP (PRIMARY VISUAL) ==========
        // This is the MAIN visual story - shows hunting potential as a gradient
        // Flow lines are demoted to supporting evidence only
        
        // Heat map from opportunity + convergence zones
        if (!map.getSource('tfp-pressure-heatmap')) {
          map.addSource('tfp-pressure-heatmap', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-pressure-heatmap',
            type: 'heatmap',
            source: 'tfp-pressure-heatmap',
            paint: {
              // Weight: hide weak haze — values below ~0.25 contribute almost nothing
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'score'], ['get', 'intensity'], 0.5],
                0.00, 0.0,
                0.25, 0.0,
                0.40, 0.2,
                0.60, 0.6,
                0.80, 0.9,
                1.00, 1.0,
              ],
              // Intensity: peak contrast — strong areas pop above mid-range
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                10, 0.7,
                15, 1.3,
              ],
              // Color gradient: yellow → orange → red (9-stop for smooth blending)
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0.00, 'rgba(0,0,0,0)',
                0.10, 'rgba(254,240,138,0.22)',  // yellow-200
                0.20, 'rgba(250,204,21,0.34)',   // yellow-400
                0.35, 'rgba(245,158,11,0.46)',   // amber-500
                0.50, 'rgba(249,115,22,0.56)',   // orange-500
                0.65, 'rgba(239,68,68,0.65)',    // red-500
                0.80, 'rgba(220,38,38,0.74)',    // red-600
                0.92, 'rgba(185,28,28,0.80)',    // red-700
                1.00, 'rgba(153,27,27,0.85)',    // red-800 (hot)
              ],
              // Radius: tight lanes, not broad blobs
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, 18,
                15, 24,
                18, 34,
              ],
              'heatmap-opacity': 0.75, // slight boost from 0.7
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
              // Weight: hide weak haze — values below ~0.25 contribute almost nothing
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'delta'], ['get', 'intensity'], 0],
                0.00, 0.0,
                0.25, 0.0,
                0.40, 0.2,
                0.60, 0.6,
                0.80, 0.9,
                1.00, 1.0,
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                10, 0.7,
                15, 1.3,
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0.00, 'rgba(0,0,0,0)',
                0.10, 'rgba(255,237,160,0.22)', // faint yellow
                0.20, 'rgba(254,215,100,0.34)', // warm yellow
                0.35, 'rgba(254,178,76,0.46)',  // orange-light
                0.50, 'rgba(251,146,60,0.56)',  // orange-400
                0.65, 'rgba(252,78,42,0.65)',   // red-orange
                0.80, 'rgba(220,38,38,0.74)',   // red-600
                0.92, 'rgba(185,28,28,0.80)',   // red-700
                1.00, 'rgba(153,27,27,0.85)',   // deep red
              ],
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, 18,
                15, 24,
                18, 34,
              ],
              'heatmap-opacity': 0.5,
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
              // Weight: hide weak haze — values below ~0.25 contribute almost nothing
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'movement_post'], ['get', 'intensity'], 0],
                0.00, 0.0,
                0.25, 0.0,
                0.40, 0.2,
                0.60, 0.6,
                0.80, 0.9,
                1.00, 1.0,
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                10, 0.7,
                15, 1.3,
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0.00, 'rgba(0,0,0,0)',
                0.10, 'rgba(254,240,138,0.22)',  // yellow-200
                0.20, 'rgba(250,204,21,0.34)',   // yellow-400
                0.35, 'rgba(234,179,8,0.44)',    // yellow-500
                0.50, 'rgba(163,230,53,0.54)',   // lime-400
                0.65, 'rgba(132,204,22,0.62)',   // lime-500
                0.80, 'rgba(34,197,94,0.72)',    // green-500
                0.92, 'rgba(22,163,74,0.80)',    // green-600
                1.00, 'rgba(21,128,61,0.85)',    // green-700 (strong)
              ],
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, 18,
                15, 24,
                18, 34,
              ],
              'heatmap-opacity': 0.5,
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
              // Weight: hide weak haze — values below ~0.25 contribute almost nothing
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'refuge_score'], ['get', 'intensity'], 0],
                0.00, 0.0,
                0.25, 0.0,
                0.40, 0.2,
                0.60, 0.6,
                0.80, 0.9,
                1.00, 1.0,
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                10, 0.7,
                15, 1.3,
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0.00, 'rgba(0,0,0,0)',
                0.10, 'rgba(207,250,254,0.22)',   // cyan-100
                0.20, 'rgba(165,243,252,0.34)',   // cyan-200
                0.35, 'rgba(34,211,238,0.44)',    // cyan-400
                0.50, 'rgba(6,182,212,0.54)',     // cyan-500
                0.65, 'rgba(14,165,233,0.63)',    // sky-500
                0.80, 'rgba(59,130,246,0.72)',    // blue-500
                0.92, 'rgba(37,99,235,0.80)',     // blue-600
                1.00, 'rgba(29,78,216,0.85)',     // blue-700 (strong refuge)
              ],
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, 18,
                15, 24,
                18, 34,
              ],
              'heatmap-opacity': 0.6,
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
              'symbol-spacing': [
                'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
                0.4, 160,    // Weak corridors: sparse chevrons
                0.55, 110,   // Moderate: tighter
                0.75, 75,    // Strong: dense
              ],
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
                LAYER_COLORS.standPrimary,
                '#e8943a',                        // Stand 2: brighter amber (was standSecondary #c45d22)
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

        // ========== STAND MOVEMENT-AXIS WEDGE LAYER (v1.1) ==========
        // Thin wedge extending from stand along the corridor/draw flow axis.
        // Shows likely movement flow past the stand — NOT a true approach direction.
        // See buildStandDirectionFeatures() header for full semantic notes.
        if (!map.getSource('tfp-stand-direction')) {
          map.addSource('tfp-stand-direction', { type: 'geojson', data: EMPTY_FC });
          // Main vector line
          map.addLayer({
            id: 'tfp-stand-direction-main',
            type: 'line',
            source: 'tfp-stand-direction',
            filter: ['==', ['get', 'type'], 'main'],
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                LAYER_COLORS.standPrimaryRing,
                '#f0a050',                        // Stand 2: brighter amber for satellite contrast
              ],
              'line-width': 2.5,
              'line-opacity': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                0.55,                             // Stand 1: unchanged
                0.75,                             // Stand 2: boosted from 0.55
              ],
            },
          });
          // Flank lines (thinner)
          map.addLayer({
            id: 'tfp-stand-direction-flank',
            type: 'line',
            source: 'tfp-stand-direction',
            filter: ['==', ['get', 'type'], 'flank'],
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                LAYER_COLORS.standPrimaryRing,
                '#f0a050',                        // Stand 2: brighter amber for satellite contrast
              ],
              'line-width': 1.2,
              'line-opacity': [
                'case',
                ['==', ['get', 'isTopStand'], true],
                0.35,                             // Stand 1: unchanged
                0.55,                             // Stand 2: boosted from 0.35
              ],
            },
          });
        }

        // ========== TERTIARY STAND DOTS LAYER (v1.1) ==========
        // Faint circle dots for stands 3+ showing additional huntable opportunities
        if (!map.getSource('tfp-stand-tertiary')) {
          map.addSource('tfp-stand-tertiary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-stand-tertiary-dot',
            type: 'circle',
            source: 'tfp-stand-tertiary',
            paint: {
              'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                13, 4,
                15, 6,
                17, 8,
              ],
              'circle-color': LAYER_COLORS.standTertiary,
              'circle-opacity': 0.45,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.25,
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
          // v3.6.1: Outer glow — tighter, more compact pockets
          map.addLayer({
            id: 'tfp-bedding-probability-glow',
            type: 'circle',
            source: 'tfp-bedding-probability',
            layout: { visibility: 'none' }, // Controlled by showBeddingProbability toggle
            paint: {
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'beddingScore'],
                0.55, 28,  // v2: raised threshold, smaller radius
                0.75, 38,  // High probability = modest radius increase
                1.0, 45,   // Max stays compact
              ],
              'circle-color': LAYER_COLORS.beddingProbabilityGlow,
              'circle-opacity': 0.15,
              'circle-blur': 1.2,
            },
          });
          // v3.6.1: Inner fill — tighter pockets
          map.addLayer({
            id: 'tfp-bedding-probability-fill',
            type: 'circle',
            source: 'tfp-bedding-probability',
            layout: { visibility: 'none' }, // Controlled by showBeddingProbability toggle
            paint: {
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'beddingScore'],
                0.55, 14,  // v2: tighter
                0.75, 20,  
                1.0, 28,   // Matches radiusM config
              ],
              'circle-color': LAYER_COLORS.beddingProbability,
              'circle-opacity': 0.30,
            },
          });
          // v3.6.1: Outline ring — matches fill
          map.addLayer({
            id: 'tfp-bedding-probability-outline',
            type: 'circle',
            source: 'tfp-bedding-probability',
            layout: { visibility: 'none' }, // Controlled by showBeddingProbability toggle
            paint: {
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'beddingScore'],
                0.55, 14,
                0.75, 20,
                1.0, 28,
              ],
              'circle-color': 'transparent',
              'circle-stroke-color': LAYER_COLORS.beddingProbabilityOutline,
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.45,
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
          'tfp-edge-boundary-context',     // Adjacent parcel context lines
          'tfp-parcel-glow',               // Selected parcel glow (below main line)
          'tfp-parcel-outline',            // Selected parcel boundary
          // Terrain structure
          'tfp-bedding-fill',
          'tfp-bedding-outline',
          'tfp-funnels-lines-draws',
          'tfp-funnels-polys-fill',
          'tfp-funnels-polys-outline',
          // Corridors & funnels
          'tfp-corridors-primary',
          'tfp-corridors-possible',
          'tfp-corridors-exploratory',
          // Pressure heatmap
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
          map.getCanvas().style.cursor = 'pointer';
          if (map.getLayer('tfp-adjacent-parcels-hover')) {
            map.setLayoutProperty('tfp-adjacent-parcels-hover', 'visibility', 'visible');
          }
        });
        map.on('mouseleave', 'tfp-adjacent-parcels-fill', () => {
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
              upperSlope: props.upperSlope || 0,
              leewardAspect: props.leewardAspect || 0,
              ridgeDistance: props.ridgeDistance || 0,
              slopeSuitability: props.slopeSuitability || 0,
              terrainShelter: props.terrainShelter || 0,
              corridorOffset: props.corridorOffset || 0,
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
        const style = map.getStyle();
        console.log('[MAP DIAG] After layer setup — sources:', Object.keys(style?.sources || {}).length, 'layers:', (style?.layers || []).length);
      } catch (_) { /* ignore */ }

      // ALWAYS set map ready - even if source setup failed
      console.log('[MAP] BEFORE setMapReady(true)');
      setMapReady(true);
      console.log('[MAP] AFTER setMapReady(true) - map should now be interactive');
      
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
      console.log('[LIFECYCLE] CLEANUP id=' + mountId + ' (current=' + mountIdRef.current + ')');
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = null;
      }
      overlaySourcesCreated.current = false;
      // v3.5.1 — Cleanup flow animation
      if (flowAnimationRef.current !== null) {
        cancelAnimationFrame(flowAnimationRef.current);
        flowAnimationRef.current = null;
      }
      // v3.8.4-fix3 — Let Mapbox properly release WebGL context FIRST,
      // THEN purge orphaned DOM so Strict-Mode re-mount gets a clean container.
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch (e) { console.warn('[LIFECYCLE] map.remove() error:', e); }
        mapRef.current = null;
      }
      if (container && container.childNodes.length > 0) {
        console.log('[LIFECYCLE] Clearing', container.childNodes.length, 'orphaned children from map container');
        container.innerHTML = '';
      }
    };
  }, []); // Empty deps - only mount once
  
  // v3.9 — Flow corridor dash animation (extracted to hook)
  useFlowAnimation(mapReady, mapRef);

  // Run analysis once on mount — season/wind changes are handled by local alignment rescore
  useEffect(() => {
    runAnalysis();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      
      // CRITICAL: Reset hasFitToParcel so the new parcel bounds fit occurs
      hasFitToParcel.current = false;
      console.log('[EXPLORE] Reset hasFitToParcel for new parcel orientation');
      
      // ========== UNIFIED PIPELINE: Update active coords and trigger runAnalysis ==========
      // This routes the exploration click through the SAME full analysis pipeline
      // that the initial page load uses, ensuring complete terrain state is retained.
      setActiveLat(qaParcel.centroid[1]);
      setActiveLng(qaParcel.centroid[0]);
      setActiveAddress(qaParcel.address);
      setActiveAcreage(qaParcel.acreage.toString());
      
      console.log('[EXPLORE] Updated active coords to:', qaParcel.centroid[1], qaParcel.centroid[0]);
      console.log('[EXPLORE] Full analysis pipeline will trigger via lat/lng dep change');
      
      // Show scorecard after analysis completes
      setTimeout(() => setQaShowScorecard(true), 2000);

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
    
    // Reset fit flag for next parcel
    hasFitToParcel.current = false;

    // Trigger full analysis pipeline to reload original parcel
    setTimeout(() => runAnalysis(), 100);
    
    console.log('[EXPLORE] Restored to original URL coords:', urlLat, urlLng);
  }, [urlLat, urlLng, urlAddress, urlAcreage, runAnalysis]);
  
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

  // Keyboard handler for Esc to clear QA parcel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && qaParcel) {
        handleQaParcelClear();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [qaParcel, handleQaParcelClear]);

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
          upperSlope: detail.upperSlope,
          leewardAspect: detail.leewardAspect,
          ridgeDistance: detail.ridgeDistance,
          slopeSuitability: detail.slopeSuitability,
          terrainShelter: detail.terrainShelter,
          corridorOffset: detail.corridorOffset,
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

  // ========== HTML STAND MARKERS + DIRECTION WEDGES + TERTIARY DOTS (v1.1) ==========
  // Uses alignedStands (wind-sorted) so markers react to wind changes.
  // Primary + secondary get full markers, tertiary gets faint dots on map.
  useEffect(() => {
    if (!mapReady || !alignedStands.length) return;

    const timer = setTimeout(() => {
      if (!mapRef.current) return;
      addStandMarkers();
      const map = mapRef.current;

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

      // v1.1: Movement-axis wedges for top 2 stands (flow direction, not approach)
      if (map.getSource('tfp-stand-direction')) {
        const topStands = alignedStands.slice(0, 2);
        const dirFC = buildStandDirectionFeatures(topStands, layers?.funnels, ridgeSpineData);
        (map.getSource('tfp-stand-direction') as mapboxgl.GeoJSONSource).setData(dirFC);
      }

      // v1.1: Tertiary stand dots (stands 3+ as faint map dots)
      if (map.getSource('tfp-stand-tertiary')) {
        const tertiaryStands = alignedStands.slice(2); // everything after top 2
        const tertiaryFC: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: tertiaryStands.map(s => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: s.coords },
            properties: {
              rank: s.rank,
              score: s.alignment.score,
              name: s.name,
            },
          })),
        };
        (map.getSource('tfp-stand-tertiary') as mapboxgl.GeoJSONSource).setData(tertiaryFC);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [alignedStands, mapReady, layers?.funnels, ridgeSpineData]); // eslint-disable-line

  // Toggle visibility of HTML markers + stand emphasis glow
  useEffect(() => {
    markersRef.current.forEach(marker => {
      marker.getElement().style.display = visibility.stands ? 'block' : 'none';
    });
    // v3.8.1 — Toggle stand emphasis glow with stands visibility
    const map = mapRef.current;
    if (map && map.getLayer('tfp-stand-emphasis-glow')) {
      map.setLayoutProperty('tfp-stand-emphasis-glow', 'visibility', visibility.stands ? 'visible' : 'none');
    }
    // Toggle hunt pocket visibility with stands
    if (map && map.getLayer('tfp-hunt-pockets-fill')) {
      map.setLayoutProperty('tfp-hunt-pockets-fill', 'visibility', visibility.stands ? 'visible' : 'none');
    }
    if (map && map.getLayer('tfp-hunt-pockets-stroke')) {
      map.setLayoutProperty('tfp-hunt-pockets-stroke', 'visibility', visibility.stands ? 'visible' : 'none');
    }
    // v1.1: Toggle movement-axis wedge layers with stands
    if (map && map.getLayer('tfp-stand-direction-main')) {
      map.setLayoutProperty('tfp-stand-direction-main', 'visibility', visibility.stands ? 'visible' : 'none');
    }
    if (map && map.getLayer('tfp-stand-direction-flank')) {
      map.setLayoutProperty('tfp-stand-direction-flank', 'visibility', visibility.stands ? 'visible' : 'none');
    }
    // v1.1: Toggle tertiary stand dots with stands
    if (map && map.getLayer('tfp-stand-tertiary-dot')) {
      map.setLayoutProperty('tfp-stand-tertiary-dot', 'visibility', visibility.stands ? 'visible' : 'none');
    }
    // Nearest corridor highlight is stand-related — hide with stands
    if (map && map.getLayer('tfp-flow-nearest-highlight')) {
      map.setLayoutProperty('tfp-flow-nearest-highlight', 'visibility', visibility.stands && selectedStand !== null ? 'visible' : 'none');
    }
  }, [visibility.stands, selectedStand]);

  const cleanupMarkers = () => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
  };

  const addStandMarkers = () => {
    const map = mapRef.current;
    if (!map || !alignedStands.length) return;

    const oldMarkers = [...markersRef.current];
    markersRef.current = [];

    // v3.8: Use wind-sorted alignedStands — top 2 by current alignment score
    const topTwo = alignedStands.slice(0, 2);

    topTwo.forEach((stand, idx) => {
      const props = stand.props;
      const coords = stand.coords;
      const alignScore = stand.alignment.score;
      const tierLabel = stand.alignment.label === 'Open Ground' ? 'Field Stone' : stand.alignment.label;

      // Index 0 in aligned order gets blaze-orange highlight = "Today's Sit"
      const isTopStand = idx === 0;
      const markerColor = isTopStand ? LAYER_COLORS.standPrimary : LAYER_COLORS.standSecondary;
      const ringColor = isTopStand ? LAYER_COLORS.standPrimaryRing : '#d4a574';
      const ringWidth = isTopStand ? 6 : 4;
      const markerSize = isTopStand ? 56 : 48;
      const fontSize = isTopStand ? 22 : 20;

      // Create marker with invisible expanded hitbox for reliable hover
      const hitboxSize = markerSize + 24; // 24px larger than marker for easier targeting
      const el = document.createElement('div');
      el.className = 'intel-stand-marker';
      el.style.cssText = `
        position: relative;
        width: ${hitboxSize}px;
        height: ${hitboxSize}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      `;
      el.innerHTML = `
        <div class="stand-visual" style="
          position: relative;
          width: ${markerSize}px;
          height: ${markerSize}px;
          ${isTopStand ? `
            background: linear-gradient(135deg, ${LAYER_COLORS.standPrimary}, ${LAYER_COLORS.standPrimaryRing});
            border: ${ringWidth}px solid ${LAYER_COLORS.standPrimaryRing};
            box-shadow: 0 0 20px ${LAYER_COLORS.standPrimary}80, 0 6px 20px rgba(0,0,0,0.5);
          ` : `
            background: ${markerColor};
            border: ${ringWidth}px solid ${ringColor};
            box-shadow: 0 6px 20px rgba(0,0,0,0.5);
          `}
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: ${fontSize}px;
          transition: transform 0.2s, box-shadow 0.2s;
          pointer-events: none;
        ">
          ${isTopStand ? '⭐' : idx + 1}
        </div>
        ${isTopStand ? `
          <div style="
            position: absolute;
            bottom: -10px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, ${LAYER_COLORS.standPrimary}, ${LAYER_COLORS.standPrimaryRing});
            color: #fff;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 10px;
            white-space: nowrap;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            pointer-events: none;
          ">Today's Sit</div>
        ` : ''}
      `;

      // Hover tooltip — v3.8: shows alignment score + tier, not static analysis score
      const hoverTooltip = document.createElement('div');
      hoverTooltip.className = 'stand-hover-tooltip';
      hoverTooltip.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(17, 24, 39, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 10px 12px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s;
        z-index: 100;
        margin-bottom: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      `;
      const bestTime = season === 'rut' ? 'All Day' : season === 'early' ? 'AM/PM' : 'Midday';
      const tooltipColor = isTopStand ? LAYER_COLORS.standPrimaryRing : LAYER_COLORS.standPrimary;
      const standLabel = isTopStand ? "⭐ Today's Sit" : stand.name;
      const resil = stand.resilience;
      const resilLabel = resil ? resil.label : '—';
      const resilScore = resil ? resil.score : 0;
      const resilColor = resilScore >= 75 ? '#22c55e' : resilScore >= 45 ? '#eab308' : '#ef4444';
      hoverTooltip.innerHTML = `
        <div style="font-weight: bold; color: ${tooltipColor}; font-size: 13px; margin-bottom: 4px;">
          ${standLabel} • ${alignScore}/100
        </div>
        <div style="color: #ccc; font-size: 12px; line-height: 1.4;">
          <div>🏷️ Tier: <b style="color: ${tooltipColor}">${tierLabel}</b></div>
          <div>🌬️ Best Wind: <b style="color: #22c55e">${props.windOk.slice(0, 2).join(', ')}</b></div>
          <div>⏰ Best Time: <b>${bestTime}</b></div>
          <div>🦌 To Corridor: <b>${props.distToCorridorMeters}m</b></div>
          <div>🛡️ Resilience: <b style="color: ${resilColor}">${resilLabel} (${resilScore})</b></div>
        </div>
      `;
      el.style.position = 'relative';
      el.appendChild(hoverTooltip);

      el.onmouseenter = () => {
        const visual = el.querySelector('.stand-visual') as HTMLElement;
        if (visual) {
          visual.style.transform = 'scale(1.2)';
          visual.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)';
        }
        hoverTooltip.style.opacity = '1';
      };
      el.onmouseleave = () => {
        const visual = el.querySelector('.stand-visual') as HTMLElement;
        if (visual) {
          visual.style.transform = 'scale(1)';
          visual.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
        }
        hoverTooltip.style.opacity = '0';
      };

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(coords)
        .addTo(map);

      el.onclick = () => {
        hoverTooltip.style.opacity = '0'; // Hide tooltip on click
        setSelectedStand(stand.rank);
        showStandPopup(coords, props, stand.resilience);
        map.flyTo({ center: coords, zoom: 16 });
      };

      markersRef.current.push(marker);
      oldMarkers.forEach(m => m.remove());
    });
  };

  const showStandPopup = (coords: [number, number], props: StandPointProperties, resilience?: StandResilience) => {
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

    // #1 = Today's Sit with gold styling
    const isTodaysSit = props.rank === 1;
    const popupBadgeColor = isTodaysSit ? `linear-gradient(135deg, ${LAYER_COLORS.standPrimary}, ${LAYER_COLORS.standPrimaryRing})` : 
      props.rank <= 3 ? LAYER_COLORS.standPrimary : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow;
    const popupBadgeLabel = isTodaysSit ? "⭐ Today's Sit" : `Stand #${props.rank}`;
    const badgeTextColor = isTodaysSit ? '#1a1a1a' : 'white';
    
    const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '320px', offset: 12, className: 'intel-popup' })
      .setLngLat(coords)
      .setHTML(`
        <div style="max-height: 240px; overflow: auto; padding: 10px 12px; font-size: 12px; line-height: 1.25; font-family: system-ui, sans-serif;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
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
          
          <p style="margin: 8px 0; font-size: 11px; color: #4b5563; line-height: 1.35;">
            ${props.reasoning}
          </p>
          
          <div style="margin-bottom: 8px; font-size: 11px; color: #1f2937;">
            <span style="font-weight: 600;">Face:</span> ${faceCompass} (${faceDeg}°)
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
            <div style="background: #f3f4f6; padding: 5px 7px; border-radius: 4px;">
              <span style="color: #6b7280; font-size: 9px; display: block;">To Corridor</span>
              <span style="font-weight: 600; font-size: 11px;">${props.distToCorridorMeters}m</span>
            </div>
            <div style="background: #f3f4f6; padding: 5px 7px; border-radius: 4px;">
              <span style="color: #6b7280; font-size: 9px; display: block;">To Bedding</span>
              <span style="font-weight: 600; font-size: 11px;">${props.distToBeddingMeters}m</span>
            </div>
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
              ${props.approachRisk.toUpperCase()} risk
            </span>
            <span style="color: #6b7280; font-size: 10px;">Elev: ${Math.round(props.elevation)}m</span>
          </div>
          
          ${resilience ? `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 5px;">
              <span style="font-weight: 600; font-size: 11px; color: #1f2937;">🛡️ Resilience</span>
              <span style="
                padding: 2px 7px;
                border-radius: 10px;
                font-weight: 600;
                font-size: 10px;
                background: ${resilience.score >= 75 ? '#dcfce7' : resilience.score >= 45 ? '#fef3c7' : '#fee2e2'};
                color: ${resilience.score >= 75 ? '#166534' : resilience.score >= 45 ? '#92400e' : '#991b1b'};
              ">${resilience.label} ${resilience.score}/100</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 3px; font-size: 10px;">
              <div style="background: #f9fafb; padding: 3px 5px; border-radius: 3px;">
                <span style="color: #6b7280;">Corridors</span>
                <span style="float: right; font-weight: 600;">${resilience.corridorCount} (${resilience.corridorCountScore})</span>
              </div>
              <div style="background: #f9fafb; padding: 3px 5px; border-radius: 3px;">
                <span style="color: #6b7280;">Spread</span>
                <span style="float: right; font-weight: 600;">${resilience.angularSpread}° (${resilience.angularSpreadScore})</span>
              </div>
              <div style="background: #f9fafb; padding: 3px 5px; border-radius: 3px;">
                <span style="color: #6b7280;">Central</span>
                <span style="float: right; font-weight: 600;">${resilience.centralityDist}m (${resilience.centralityScore})</span>
              </div>
              <div style="background: #f9fafb; padding: 3px 5px; border-radius: 3px;">
                <span style="color: #6b7280;">Re-entry</span>
                <span style="float: right; font-weight: 600;">${resilience.reentryPaths} (${resilience.reentryScore})</span>
              </div>
              <div style="background: #f9fafb; padding: 3px 5px; border-radius: 3px; grid-column: span 2;">
                <span style="color: #6b7280;">Downwind</span>
                <span style="float: right; font-weight: 600;">${resilience.downwindDirs} dirs (${resilience.downwindScore})</span>
              </div>
            </div>
          </div>
          ` : ''}
          
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

  const flyToCenter = () => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 14 });
  };

  // BUILD STAMP - remove after debugging
  const BUILD_STAMP = 'v3.8.4-fix3 | webgl-context-fix | 2026-03-17';

  // ========== GLOBAL ERROR PANEL (catches unhandled errors) ==========
  if (globalError) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-8">
        <div className="max-w-2xl w-full bg-red-950/80 border border-red-500/50 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <Bug className="h-8 w-8 text-red-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-red-300 mb-2">Unhandled Error in /intel</h1>
              <div className="bg-black/50 rounded-lg p-4 mb-4 overflow-auto max-h-48">
                <p className="text-red-200 font-mono text-sm break-words">
                  {globalError.message}
                </p>
              </div>
              {globalError.stack && (
                <details className="mb-4">
                  <summary className="text-red-400 text-sm cursor-pointer hover:text-red-300">
                    Stack trace
                  </summary>
                  <pre className="bg-black/50 rounded-lg p-3 mt-2 text-xs text-red-300/80 overflow-auto max-h-64 whitespace-pre-wrap">
                    {globalError.stack}
                  </pre>
                </details>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => { setGlobalError(null); window.location.reload(); }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg font-medium"
                >
                  Reload Page
                </button>
                <Link
                  href="/core"
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg font-medium"
                >
                  Try /core instead
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-900 relative">
      {/* Map Container — double-div pattern: outer div owns layout (absolute inset-0),
           inner div is the Mapbox target. Mapbox overrides position to 'relative' on its
           container, which breaks inset-0 sizing. By giving the inner div explicit 100%
           width/height it fills the outer regardless of Mapbox's override. */}
      <div className="absolute inset-0 z-0" style={{ overflow: 'hidden' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
      </div>

      {/* BUILD STAMP - visible debug marker (hidden in export mode) */}
      <div className={`absolute bottom-2 left-2 z-50 bg-fuchsia-600 text-white px-3 py-1 rounded font-mono text-xs font-bold shadow-lg transition-opacity duration-300 ${exportMode ? 'opacity-0' : 'opacity-100'}`}>
        BUILD: {BUILD_STAMP}
      </div>

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

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
        <div className="flex items-center justify-between px-4 py-3 pointer-events-auto">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/80 hover:text-white transition-colors">
              <Home className="h-5 w-5" />
            </Link>
            <div className="h-6 w-px bg-white/30" />
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-red-500" />
              <span className="font-bold text-white text-lg">Deer Intel</span>
            </div>
          </div>

          {/* Mode Badge */}
          <div className={`
            px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2
            ${mode === 'real' 
              ? 'bg-green-500/20 text-green-300 border border-green-500/40' 
              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}
          `}>
            {mode === 'real' ? (
              <><CheckCircle className="h-4 w-4" />USGS 10m DEM</>
            ) : (
              <><Info className="h-4 w-4" />Preview Mode</>
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
            {/* Exploration Mode Toggle */}
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
                  // Turning off - clear any selected parcel
                  handleQaParcelClear();
                }
              }}
              title="Explore Mode - Click anywhere in KS/MO to analyze parcels"
            >
              <Layers className="h-4 w-4 mr-1" />
              {explorationMode ? 'Explore ON' : 'Explore'}
            </Button>
            {/* Geometry Debug Toggle (only show when QA Mode is on) */}
            {qaParcelLookupMode && (
              <Button
                size="sm"
                variant="ghost"
                className={`${geometryDebugMode 
                  ? 'bg-red-600/30 text-red-400 border border-red-500/50' 
                  : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
                onClick={() => setGeometryDebugMode(!geometryDebugMode)}
                title="Show 3-boundary debug overlay: Red=Raw, Cyan=Normalized, Yellow=Analysis"
              >
                <Bug className="h-4 w-4 mr-1" />
                {geometryDebugMode ? 'Debug ON' : 'Debug'}
              </Button>
            )}
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
              title="Export Mode - Clean map view for screenshots/demos"
            >
              <Download className="h-4 w-4 mr-1" />
              {exportMode ? 'Exit Export' : 'Export'}
            </Button>
          </div>
        </div>
      </div>

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
              {/* ─── PARCEL INFO ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Parcel Info</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
              </div>
              <div className="p-3 border-b border-white/[0.06]">
                <div className="space-y-2.5">
                  {/* Address */}
                  <div className="flex items-start gap-2.5">
                    <MapPin className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">Address</p>
                      <p className="text-xs text-white/90 font-semibold leading-tight">{address}</p>
                    </div>
                  </div>
                  {/* Acreage & County */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/[0.04] rounded-lg p-2.5">
                      <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">Acreage</p>
                      <p className="text-base text-white font-bold">{acreageParam || '~80'}<span className="text-xs text-stone-400 ml-1">ac</span></p>
                    </div>
                    {qaParcel?.county && (
                      <div className="bg-white/[0.04] rounded-lg p-2.5">
                        <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">County</p>
                        <p className="text-xs text-white font-semibold mt-0.5">{qaParcel.county}{qaParcel.state ? `, ${qaParcel.state}` : ''}</p>
                      </div>
                    )}
                  </div>
                  {/* Coordinates */}
                  <p className="text-[10px] text-stone-600 text-center">
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                  </p>
                </div>
              </div>

              {/* ─── LANDOWNER ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Landowner</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
              </div>
              <div className="p-3 border-b border-white/[0.06]">
                <div className="space-y-2.5">
                  {qaParcel?.owner && (
                    <div className="flex items-start gap-2.5">
                      <User className="h-3.5 w-3.5 text-stone-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">Landowner</p>
                        <p className="text-xs text-white/80 truncate">{qaParcel.owner}</p>
                      </div>
                    </div>
                  )}
                  {/* Zoning & PLSS */}
                  {(qaParcel?.zoning || qaParcel?.plss) && (
                    <div className="grid grid-cols-2 gap-2">
                      {qaParcel?.zoning && (
                        <div className="bg-white/[0.04] rounded-lg p-2.5">
                          <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">Zoning</p>
                          <p className="text-xs text-white/80 mt-0.5">{qaParcel.zoning}</p>
                        </div>
                      )}
                      {qaParcel?.plss && (
                        <div className="bg-white/[0.04] rounded-lg p-2.5">
                          <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">PLSS</p>
                          <p className="text-[10px] text-white/80 mt-0.5 truncate">{qaParcel.plss}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ─── SEASONS ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Seasons</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
              </div>
              <div className="p-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-medium text-white/90">Season</span>
                </div>
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
              </div>

              {/* ─── PROFILES ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Profiles</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
              </div>
              <div className="p-3 border-b border-white/[0.06]">
                <div className="bg-white/[0.04] rounded-lg p-3">
                  {season === 'early' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">🌿</span>
                        <span className="text-[11px] font-semibold text-white/90">Early Season Profile</span>
                      </div>
                      <p className="text-[11px] text-stone-400 leading-relaxed">
                        Deer follow predictable bed-to-feed patterns. Focus on food sources &amp; travel corridors near field edges. Morning thermals carry scent downhill.
                      </p>
                    </div>
                  )}
                  {season === 'rut' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">🦌</span>
                        <span className="text-[11px] font-semibold text-white/90">Rut Profile</span>
                      </div>
                      <p className="text-[11px] text-stone-400 leading-relaxed">
                        Bucks cruise between bedding areas checking does. Saddles, funnels &amp; ridge connections see peak traffic. All-day sits produce.
                      </p>
                    </div>
                  )}
                  {season === 'late' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">❄️</span>
                        <span className="text-[11px] font-semibold text-white/90">Late Season Profile</span>
                      </div>
                      <p className="text-[11px] text-stone-400 leading-relaxed">
                        Caloric stress drives deer to remaining food. South-facing slopes provide thermal cover. Short afternoon hunts near food are most effective.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* ─── WIND ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Wind</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
              </div>
              <WindCompass
                windDirection={windDirection}
                windMinAgo={windMinAgo}
                onWindChange={(dir) => {
                  setWindDirection(dir);
                  setWindLastUpdated(new Date());
                }}
              />

              {/* ─── ANALYSIS SUMMARY ─── */}
              {summary && (
                <>
                  <div className="px-3 pt-3 pb-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                      <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Analysis Summary</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                    </div>
                  </div>
                  <div className="p-3 flex-1">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white/[0.04] rounded-lg p-2.5">
                        <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">Bedding Acres</p>
                        <p className="text-base text-white font-bold">{summary.totalBeddingAcres.toFixed(1)}</p>
                      </div>
                      <div className="bg-white/[0.04] rounded-lg p-2.5">
                        <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">Funnels</p>
                        <p className="text-base text-white font-bold">{summary.funnelCount}</p>
                      </div>
                      <div className="bg-white/[0.04] rounded-lg p-2.5">
                        <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">Top Stand</p>
                        <p className="text-base text-red-400 font-bold">{summary.topStandScore}<span className="text-xs text-stone-400">/100</span></p>
                      </div>
                      <div className="bg-white/[0.04] rounded-lg p-2.5">
                        <p className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium">Area</p>
                        <p className="text-base text-white font-bold">{summary.analysisAreaAcres.toFixed(0)}<span className="text-xs text-stone-400 ml-1">ac</span></p>
                      </div>
                    </div>
                    {/* Provenance */}
                    {provenance && (
                      <div className="mt-3 pt-3 border-t border-white/[0.06] text-[10px] text-white/40 space-y-0.5">
                        <p>Source: {provenance.demSource}</p>
                        <p>Resolution: {provenance.demResolution}</p>
                        {provenance.processingTimeSeconds && (
                          <p>Processed in {provenance.processingTimeSeconds.toFixed(2)}s</p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ─── RE-ALIGN TERRAIN ─── */}
              <div className="p-3 border-t border-white/[0.06] mt-auto">
                <Button
                  onClick={runAnalysis}
                  disabled={isLoading}
                  className="w-full bg-amber-600 hover:bg-amber-500 text-white font-medium"
                >
                  {isLoading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing...</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-2" />Re-Align Terrain</>
                  )}
                </Button>
              </div>
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
              {/* ─── TERRAIN FLOW ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Terrain Flow</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
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
              <div className="p-3 border-b border-white/[0.06]">
                <div className="space-y-1">
                  <button
                    onClick={() => setVisibility(v => ({ ...v, bedding: !v.bedding }))}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                      visibility.bedding ? 'bg-white/[0.08] border border-white/[0.12]' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.bedding, opacity: visibility.bedding ? 1 : 0.4 }} />
                    <span className={`flex-1 text-left ${visibility.bedding ? 'text-white' : 'text-stone-500'}`}>Bedding</span>
                  </button>
                </div>
              </div>
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
                  
                  {/* v3.6.1: Bedding Probability Toggle (v2 tightening) */}
                  {(() => {
                    const beddingCount = huntabilityData?.metadata?.beddingZoneCount || 0;
                    const hasData = beddingCount > 0;
                    
                    return (
                      <button
                        onClick={() => setShowBeddingProbability(v => !v)}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-xs ${
                          showBeddingProbability ? 'bg-purple-900/30' : 'bg-white/[0.03] hover:bg-white/[0.06] border border-transparent'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: LAYER_COLORS.beddingProbability, opacity: showBeddingProbability ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${showBeddingProbability ? 'text-white' : 'text-stone-500'}`}>Bedding Zones</span>
                        {hasData ? (
                          <span className="text-[9px] text-purple-300 px-1.5 py-0.5 bg-purple-800/40 rounded">
                            {beddingCount}
                          </span>
                        ) : (
                          <span className="text-[8px] text-purple-400/60 px-1 py-0.5 bg-purple-900/30 rounded uppercase tracking-wider">
                            v2
                          </span>
                        )}
                      </button>
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

                  {/* Pressure Focus Slider */}
                  {flowVisibility.pressureHeatmap && (
                    <div className="px-2 py-2 bg-white/[0.03] rounded-lg border border-white/[0.06] mt-1">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-stone-400 uppercase tracking-wider font-medium">Focus</span>
                        <span className="text-[10px] text-amber-400 font-semibold">
                          {pressureFocus === 'broad' ? '🌲 Broad' : pressureFocus === 'focused' ? '🎯 Focused' : '⚖️ Balanced'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {([
                          { key: 'broad' as PressureFocus, label: 'Broad', sub: 'Full parcel', icon: '🌲' },
                          { key: 'balanced' as PressureFocus, label: 'Balanced', sub: 'Default', icon: '⚖️' },
                          { key: 'focused' as PressureFocus, label: 'Focused', sub: 'Best spots', icon: '🎯' },
                        ]).map(m => (
                          <button
                            key={m.key}
                            onClick={() => setPressureFocus(m.key)}
                            className={`p-1.5 rounded text-center transition-all ${
                              pressureFocus === m.key
                                ? 'bg-amber-500/25 border border-amber-500/60 text-white'
                                : 'bg-white/[0.04] border border-white/[0.06] text-white/50 hover:bg-white/[0.08] hover:text-white/70'
                            }`}
                          >
                            <span className="text-sm block">{m.icon}</span>
                            <span className="text-[9px] font-medium block mt-0.5">{m.label}</span>
                            <span className="text-[7px] text-white/40 block">{m.sub}</span>
                          </button>
                        ))}
                      </div>
                      <p className="text-[8px] text-stone-600 mt-1.5 text-center">
                        {pressureFocus === 'broad' ? 'Showing wider terrain pressure — overall huntability' :
                         pressureFocus === 'focused' ? 'Suppressing weak zones — strongest hotspots only' :
                         'Balanced terrain structure and strongest areas'}
                      </p>
                    </div>
                  )}

                  {/* Pressure View Selector */}
                  {flowVisibility.pressureHeatmap && (
                    <div className="px-2 py-2 bg-white/[0.03] rounded-lg border border-white/[0.06] mt-1">
                      <span className="text-[10px] text-stone-500/70 uppercase tracking-wider font-medium block mb-1.5">View</span>
                      <div className="grid grid-cols-4 gap-0.5 bg-stone-800/60 rounded p-0.5">
                        {([
                          { key: 'pressure' as PressureView, label: 'Deer Flow', gradient: 'linear-gradient(90deg, #facc15, #ef4444)' },
                          { key: 'damage' as PressureView, label: 'Flow Disruption', gradient: 'linear-gradient(90deg, #facc15, #f97316)' },
                          { key: 'movement' as PressureView, label: 'Flow Survival', gradient: 'linear-gradient(90deg, #facc15, #22c55e)' },
                          { key: 'refuge' as PressureView, label: 'Flow Refuge', gradient: 'linear-gradient(90deg, #06b6d4, #3b82f6)' },
                        ]).map(v => (
                          <button
                            key={v.key}
                            onClick={() => setPressureView(v.key)}
                            className={`relative px-1 py-1.5 rounded text-center transition-all ${
                              pressureView === v.key
                                ? 'bg-stone-700/80 text-white shadow-sm'
                                : 'text-stone-500 hover:text-stone-300 hover:bg-stone-700/30'
                            }`}
                          >
                            <div
                              className="w-full h-1 rounded-sm mx-auto mb-1"
                              style={{ background: v.gradient, opacity: pressureView === v.key ? 1 : 0.35 }}
                            />
                            <span className="text-[8px] font-medium leading-none">{v.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Layer Color Legend — contextual to active pressureView */}
                  {flowVisibility.pressureHeatmap && (
                    <div className="px-2 py-1.5 bg-white/[0.03] rounded-lg border border-white/[0.06] mt-1">
                      <span className="text-[9px] text-stone-400 font-semibold block mb-1">
                        {pressureView === 'pressure' && 'Deer Flow'}
                        {pressureView === 'damage' && 'Flow Disruption'}
                        {pressureView === 'movement' && 'Flow Survival'}
                        {pressureView === 'refuge' && 'Flow Refuge'}
                      </span>
                      <div className="flex items-center gap-2">
                        {pressureView === 'pressure' && <div className="w-10 h-1.5 rounded-sm" style={{ background: 'linear-gradient(90deg, #facc15, #f97316, #ef4444)' }} />}
                        {pressureView === 'damage' && <div className="w-10 h-1.5 rounded-sm" style={{ background: 'linear-gradient(90deg, #facc15, #f97316)' }} />}
                        {pressureView === 'movement' && <div className="w-10 h-1.5 rounded-sm" style={{ background: 'linear-gradient(90deg, #facc15, #22c55e)' }} />}
                        {pressureView === 'refuge' && <div className="w-10 h-1.5 rounded-sm" style={{ background: 'linear-gradient(90deg, #06b6d4, #3b82f6)' }} />}
                        <span className="text-[8px] text-stone-500">
                          {pressureView === 'pressure' && 'Low → High terrain pressure'}
                          {pressureView === 'damage' && 'Low → High movement likelihood'}
                          {pressureView === 'movement' && 'Low → High post-pressure quality'}
                          {pressureView === 'refuge' && 'Low → High refuge value'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-10 h-1.5 rounded-sm flex">
                          <div className="flex-1 rounded-l-sm bg-amber-700/40" />
                          <div className="flex-1 rounded-r-sm bg-amber-400" />
                        </div>
                        <span className="text-[8px] text-stone-500">Brighter stand = more resilient</span>
                      </div>
                    </div>
                  )}
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
                            {/* DEM Mode Badge */}
                            <DEMModeBadge 
                              mode={mode}
                              metadata={terrainFlowData?.metadata ? {
                                ...terrainFlowData.metadata,
                                processing_time_seconds: terrainFlowData.metadata?.total_flow_length_m ? 0.5 : 0,
                                buffer_m: 1000,
                                mode: mode,
                                dem_source: terrainFlowData.metadata.dem_source || 'unknown',
                                resolution_m: 30,
                                weights: {
                                  bench_likelihood: 0.28,
                                  saddle_proximity: 0.24,
                                  spine_proximity: 0.20,
                                  terrain_convergence: 0.18,
                                  moderate_slope: 0.10,
                                },
                                thresholds: {
                                  primary_min: 0.55,
                                  secondary_min: 0.35,
                                  min_length_m_primary: 150,
                                  min_length_m_secondary: 80,
                                  convergence_threshold: 0.5,
                                  opportunity_threshold: 0.6,
                                },
                                stats: {
                                  flow_count_primary: primaryCount,
                                  flow_count_secondary: secondaryCount,
                                  convergence_count: convergenceCount,
                                  opportunity_count: 0, // merged into convergence
                                  total_flow_length_m: totalFlowLength,
                                  coverage_pct: 0,
                                },
                                fallback_reason: isSynthetic ? 'No terrain data available' : null,
                              } : null}
                            />
                            
                            {/* Confidence Legend */}
                            <div className="p-2 bg-stone-800/30 rounded-lg">
                              <div className="text-[9px] text-stone-500 uppercase tracking-wider mb-1.5 font-medium">
                                Confidence Colors
                              </div>
                              <div className="flex items-center gap-3 text-[9px]">
                                <div className="flex items-center gap-1">
                                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#10b981' }} />
                                  <span className="text-emerald-400">Strong</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#22d3ee' }} />
                                  <span className="text-cyan-400">Moderate</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#60a5fa' }} />
                                  <span className="text-blue-400">Weak</span>
                                </div>
                              </div>
                            </div>
                            
                            {/* Stats */}
                            <div className="text-[10px] text-stone-400 space-y-0.5">
                              {totalFlowLength > 0 && (
                                <div className="flex justify-between">
                                  <span>Total Flow Length</span>
                                  <span className="text-white">{Math.round(totalFlowLength)}m</span>
                                </div>
                              )}
                              {convergenceCount > 0 && (
                                <div className="flex justify-between">
                                  <span>Flow Convergences</span>
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


              {/* ========== HUNTING POTENTIAL CARD (PRIMARY ANSWER) ========== */}
              {/* This is THE answer to "Does this parcel have hunting potential?" */}
              {!exportMode && parcelPolygon && (
                <div className="p-3 border-b border-white/[0.06]">
                  <HuntingPotentialCard
                    flowData={terrainFlowData ? (() => {
                      // Build a TerrainFlowResponse-compatible object
                      const defaultMetadata = {
                        processing_time_seconds: 0,
                        mode: 'terrain_driven' as const,
                        dem_source: 'unknown',
                        resolution_m: 30,
                        buffer_m: 1000,
                        weights: {
                          bench_likelihood: 0.28,
                          saddle_proximity: 0.24,
                          spine_proximity: 0.20,
                          terrain_convergence: 0.18,
                          moderate_slope: 0.10,
                        },
                        thresholds: {
                          primary_min: 0.55,
                          secondary_min: 0.35,
                          min_length_m_primary: 150,
                          min_length_m_secondary: 80,
                          convergence_threshold: 0.5,
                          opportunity_threshold: 0.6,
                        },
                        stats: {
                          flow_count_primary: terrainFlowData.flow_primary?.features?.length || 0,
                          flow_count_secondary: terrainFlowData.flow_secondary?.features?.length || 0,
                          convergence_count: terrainFlowData.convergence_zones?.features?.length || 0,
                          opportunity_count: 0, // merged into convergence
                          total_flow_length_m: 0,
                          coverage_pct: 0,
                        },
                      };
                      return {
                        success: true,
                        bbox: [0, 0, 0, 0] as [number, number, number, number],
                        flow_primary: terrainFlowData.flow_primary,
                        flow_secondary: terrainFlowData.flow_secondary,
                        convergence_zones: terrainFlowData.convergence_zones,
                        opportunity_zones: terrainFlowData.opportunity_zones,
                        metadata: terrainFlowData.metadata ? { ...defaultMetadata, ...terrainFlowData.metadata } : defaultMetadata,
                      } as TerrainFlowResponse;
                    })() : null}
                    acreage={(() => {
                      // Extract acreage from URL params or calculate rough estimate
                      const searchParams = new URLSearchParams(window.location.search);
                      const acreageParam = searchParams.get('acreage');
                      if (acreageParam) return parseFloat(acreageParam);
                      // Rough estimate from parcel bbox
                      if (parcelPolygon) {
                        try {
                          const coords = parcelPolygon.geometry.type === 'Polygon' 
                            ? parcelPolygon.geometry.coordinates[0]
                            : parcelPolygon.geometry.coordinates[0][0];
                          if (coords && coords.length >= 4) {
                            const lngs = coords.map(c => c[0]);
                            const lats = coords.map(c => c[1]);
                            const widthDeg = Math.max(...lngs) - Math.min(...lngs);
                            const heightDeg = Math.max(...lats) - Math.min(...lats);
                            const centerLat = (Math.max(...lats) + Math.min(...lats)) / 2;
                            const widthM = widthDeg * 111320 * Math.cos(centerLat * Math.PI / 180);
                            const heightM = heightDeg * 111320;
                            return (widthM * heightM * 0.8) / 4046.86; // Approx acres
                          }
                        } catch {}
                      }
                      return undefined;
                    })()}
                    isLoading={terrainFlowLoading}
                    onHighlightOpportunity={() => {}}
                  />
                </div>
              )}

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

              {/* ========== TERRAIN RATING PANEL (always visible after analysis) ========== */}
              {!exportMode && qaBrokerScore && !terrainFlowLoading && (
                <div className="p-3 border-b border-white/[0.06]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-white flex items-center gap-2 text-sm">
                      <Target className="h-4 w-4 text-amber-400" />
                      Terrain Rating
                    </h3>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      qaBrokerScore.brokerClass === 'broker_ready' ? 'bg-emerald-900/60 text-emerald-400' :
                      qaBrokerScore.brokerClass === 'potential_demo' ? 'bg-amber-900/60 text-amber-400' :
                      'bg-slate-900/60 text-slate-400'
                    }`}>
                      {qaBrokerScore.brokerScore}/100
                    </span>
                  </div>
                  <div className="space-y-1">
                    {qaBrokerScore.components && Object.entries(qaBrokerScore.components).map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <span className="text-stone-400 capitalize">{key.replace(/_/g, ' ')}</span>
                        <span className="text-white font-medium">{typeof val === 'number' ? val.toFixed(1) : String(val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ========== TERRAIN WORK MODE NOTICE ========== */}
              {TERRAIN_WORK_MODE && <TerrainWorkModeNotice />}

              {/* ─── STAND SELECTION ─── */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  <span className="text-[10px] text-stone-500/80 uppercase tracking-[0.2em] font-medium">Stand Selection</span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>
              </div>

              <div className="p-3 border-b border-white/[0.06]">
                <div className="space-y-1">
                  {/* Stands toggle - disabled during terrain refinement */}
                  {!TERRAIN_WORK_MODE && (
                    <button
                      onClick={() => setVisibility(v => ({ ...v, stands: !v.stands }))}
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

                  {/* Solo Selected Stand toggle */}
                  {!TERRAIN_WORK_MODE && (
                    <button
                      onClick={() => setSoloStandMode(v => !v)}
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
               <StandAlignmentPanel
                 alignedStands={alignedStands}
                 highlightedStandRank={highlightedStandRank}
                 selectedStand={selectedStand}
                 expanded={alignmentPanelExpanded}
                 onToggleExpanded={() => setAlignmentPanelExpanded(!alignmentPanelExpanded)}
                 onStandClick={(stand) => {
                   handleUserInteraction();
                   setHighlightedStandRank(stand.rank);
                   setSelectedStand(selectedStand === stand.rank ? null : stand.rank);
                   mapRef.current?.flyTo({ center: stand.coords, zoom: 16, duration: 800 });
                 }}
               />
               )}
               {/* End of TERRAIN_WORK_MODE conditional wrapper for Alignment Panel */}

              {/* ========== PARCEL-HUNT FILE DOWNLOAD ========== */}
              <div className="p-3 border-t border-white/[0.06]">
                <button
                  onClick={handleDownloadParcelHuntFile}
                  disabled={isDownloading || isLoading}
                  className={`
                    w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                    transition-all text-sm font-medium
                    ${isDownloading || isLoading
                      ? 'bg-stone-800 text-stone-500 cursor-not-allowed'
                      : 'bg-stone-800 hover:bg-stone-700 text-white border border-stone-600 hover:border-stone-500'}
                  `}
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      <span>Download Parcel-Hunt File</span>
                    </>
                  )}
                </button>
                <p className="text-[10px] text-stone-500 text-center mt-1.5">
                  5-page terrain & alignment report
                </p>
              </div>

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

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-gray-900/95 rounded-xl p-8 text-center max-w-sm border border-white/10">
            <div className="relative w-20 h-20 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-amber-500/30" />
              <div 
                className="absolute inset-0 rounded-full border-4 border-amber-500 border-t-transparent animate-spin"
                style={{ animationDuration: '1s' }}
              />
              <Target className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-amber-500" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">Analyzing Terrain</h3>
            <p className="text-white/60 text-sm mb-4 font-mono">
              {progressStep}
            </p>
            <div className="text-white/40 text-xs mb-3">{progress}%</div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-white/40 text-xs mt-2">{progress}% complete</p>
          </div>
        </div>
      )}

      {/* Error Toast - shows actual error message */}
      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-red-900/95 border border-red-500/50 rounded-lg px-6 py-4 shadow-xl max-w-lg">
          <div className="flex items-start gap-4">
            <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-red-200 font-medium">Analysis Failed</p>
              <p className="text-red-300/80 text-sm mt-1 font-mono break-words">{error}</p>
              <div className="flex gap-3 mt-3">
                <button 
                  onClick={() => { setError(null); runAnalysis(); }}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded font-medium flex items-center gap-1.5"
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
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 flex-shrink-0">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Map Error Indicator - subtle notice without blocking UI */}
      {mapError && (
        <div className="absolute bottom-4 left-4 z-30 bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-amber-500/30">
          <p className="text-amber-400 text-xs font-medium">📍 Static View</p>
          <p className="text-white/60 text-xs">Interactive 3D unavailable</p>
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
        </div>
      )}
    </div>
  );
}