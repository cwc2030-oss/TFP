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
  Unlock, Sparkles, Settings, Download, FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  scoreStandsWithExceptional,
  type StandInputs,
  type StandScore,
} from '@/lib/scoring/stand-alignment';
import { buildStandInputs, windDirectionToDeg, smallestAngleDiffDeg } from '@/lib/scoring/stand-inputs';
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
import type { TerrainFlowResponse, TerrainFlowVisibility, FlowComparisonState, FlowSegmentScoreResponse, OpportunityZoneProperties, FlowMode } from '@/types/terrain-flow';
import FlowSegmentInspector from '@/components/terrain/flow-segment-inspector';
import OpportunityZoneTooltip from '@/components/terrain/opportunity-zone-tooltip';
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

const WIND_DIRECTIONS: WindDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SEASONS: { value: SeasonProfile; label: string; dates: string; icon: string }[] = [
  { value: 'early', label: 'Early Season', dates: 'Sept-Oct', icon: '🌿' },
  { value: 'rut', label: 'Rut', dates: 'Nov', icon: '🦌' },
  { value: 'late', label: 'Late Season', dates: 'Dec-Jan', icon: '❄️' },
];

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
  standHigh: '#ef4444',            // #2+ stands: red
  standGold: '#fbbf24',            // #1 Today's Sit: gold highlight ring
  standMed: '#f59e0b',
  standLow: '#6b7280',
  parcelBoundary: '#fbbf24',
  // Edge Intelligence Layer colors
  edgeCorridorArrow: '#8B4513',    // Sienna for continuation arrows
  edgeGhostBedding: '#22c55e',     // Semi-transparent green for ghost bedding
  edgeGhostSaddle: '#f97316',      // Semi-transparent orange for ghost saddles
  edgeDrawExtension: '#3b82f6',    // Blue dashed for draw extensions
  edgePressureInbound: '#22c55e',  // Green for inbound pressure
  edgePressureOutbound: '#f59e0b', // Amber for outbound pressure
  edgeBoundaryHighlight: '#8b5cf6', // Purple highlight for adjacent parcel boundaries
  // Terrain Spine colors (structure-first, restrained earth tones)
  ridgePrimary: '#5D4037',        // Deep brown - major continuous spines (restrained)
  ridgeSecondary: '#795548',      // Medium brown - secondary spines (lighter)
  saddleNode: '#8D6E63',          // Warm taupe - saddle markers (subtle)
  // Terrain Flow colors (movement likelihood - blue/teal palette)
  flowPrimary: '#0891b2',         // Cyan-600: primary flow lines (bold, readable)
  flowSecondary: '#67e8f9',       // Cyan-300: secondary flow lines (lighter)
  flowConvergence: '#f59e0b',     // Amber-500: convergence zone markers
  flowOpportunity: '#fbbf24',     // Amber-400: opportunity zone markers (gold)
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

  // URL params
  const lat = parseFloat(searchParams.get('lat') || '38.7958');
  const lng = parseFloat(searchParams.get('lng') || '-94.2733');
  const address = searchParams.get('address') || 'Sample Property';
  const acreageParam = searchParams.get('acreage');
  const debugMode = searchParams.get('debug') === 'true'; // Admin/debug only features

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
  const [windDirection, setWindDirection] = useState<WindDirection>('NW');
  const [windLastUpdated, setWindLastUpdated] = useState<Date>(new Date());
  const [selectedStand, setSelectedStand] = useState<number | null>(null);
  // ========== TERRAIN WORK MODE ==========
  // A terrain study tool for verifying terrain anatomy before deer interpretation layers.
  // 
  // ENABLED LAYERS (physical terrain structure):
  //   • Terrain Spine (Backbone) - ridge crests
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
  const TERRAIN_WORK_MODE = true;
  
  const [visibility, setVisibility] = useState<TerrainLayerVisibility>({
    // Deer interpretation - HIDE in Terrain Work Mode
    bedding: !TERRAIN_WORK_MODE,   // Bedding circles = deer interpretation
    stands: !TERRAIN_WORK_MODE,     // Stand markers = deer interpretation
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
    convergenceZones: true, // Convergence zone markers
    opportunityZones: true, // Opportunity zone markers
  });

  // UI state
  const [panelCollapsed, setPanelCollapsed] = useState(true); // Left panel collapsed by default
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [parcelPolygon, setParcelPolygon] = useState<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);

  // Parcel-Hunt File download state
  const [isDownloading, setIsDownloading] = useState(false);

  // Inspect Mode state (visual indicator that flow segments are clickable)
  const [inspectModeEnabled, setInspectModeEnabled] = useState(false);
  
  // Export/Screenshot Mode state (clean map for broker demos)
  const [exportMode, setExportMode] = useState(false);

  // ========== QA PARCEL LOOKUP STATE (KS/MO validation) ==========
  const [qaParcelLookupMode, setQaParcelLookupMode] = useState(false); // Enable click-to-lookup
  const [qaParcelLoading, setQaParcelLoading] = useState(false);
  const [qaParcel, setQaParcel] = useState<LookupParcel | null>(null);
  const [qaParcelError, setQaParcelError] = useState<string | null>(null);
  const [qaParcelAnalyzing, setQaParcelAnalyzing] = useState(false);
  const [qaRecentParcelIds, setQaRecentParcelIds] = useState<string[]>([]); // Track visited parcels
  const [qaSessionEntries, setQaSessionEntries] = useState<QAEntry[]>([]); // QA validation log
  const [qaShowScorecard, setQaShowScorecard] = useState(false); // Show rating UI after analysis
  const [qaShowAnalytics, setQaShowAnalytics] = useState(false); // Show analytics panel
  const [qaBrokerScore, setQaBrokerScore] = useState<BrokerScoreResult | null>(null); // Broker scoring

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
    opportunity_zones: GeoJSON.FeatureCollection;
    isSynthetic: boolean;
    metadata?: {
      flow_count_primary: number;
      flow_count_secondary: number;
      convergence_count: number;
      opportunity_count: number;
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
    opportunity_zones: GeoJSON.FeatureCollection;
    metadata?: {
      flow_count_primary: number;
      flow_count_secondary: number;
      convergence_count: number;
      opportunity_count: number;
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
  
  // Opportunity Zone Tooltip State
  const [selectedOpportunityZone, setSelectedOpportunityZone] = useState<OpportunityZoneProperties | null>(null);
  const [opportunityZonePosition, setOpportunityZonePosition] = useState<{ x: number; y: number } | null>(null);

  // Terrain Story State (structural narrative)
  const [terrainStory, setTerrainStory] = useState<TerrainStorySummary | null>(null);

  // ========== ALIGNMENT ENGINE STATE ==========
  type AlignedStand = {
    rank: number;
    name: string; // Auto-generated or user-assigned
    props: StandPointProperties;
    inputs: StandInputs;
    alignment: StandScore;
    coords: [number, number];
  };
  
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
  const [prevWindDirection, setPrevWindDirection] = useState<WindDirection | null>(null);
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
  
  // Wind direction to degrees mapping (for stability check)
  const windToDegrees: Record<WindDirection, number> = {
    N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315
  };

  // Compute alignment for all stands
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
          // timeFit: 0.5 (default, could add time selector later)
        }
      );
    });

    const { scores, parcelStrength: ps, exceptionalIndex: ei } = scoreStandsWithExceptional(inputs);

    // Build aligned stands array sorted by score desc
    const aligned: AlignedStand[] = stands.map((f, i) => {
      const props = f.properties as StandPointProperties;
      const coords = f.geometry.coordinates as [number, number];
      return {
        rank: props.rank,
        name: generateStandName(props.rank, coords, props),
        props,
        inputs: inputs[i],
        alignment: scores[i],
        coords,
      };
    }).sort((a, b) => b.alignment.score - a.alignment.score);

    setAlignedStands(aligned);
    setExceptionalIndex(ei !== null ? aligned.findIndex((_, idx) => idx === ei) : null);
    setParcelStrength(ps);

    // Set initial highlighted stand to top
    if (highlightedStandRank === null && aligned.length > 0) {
      setHighlightedStandRank(aligned[0].rank);
    }

    // Check for "most aligned" hint
    if (highlightedStandRank !== null && aligned.length > 0) {
      const currentHighlighted = aligned.find(s => s.rank === highlightedStandRank);
      const newTop = aligned[0];
      
      if (currentHighlighted && newTop.rank !== highlightedStandRank) {
        const scoreDiff = newTop.alignment.score - currentHighlighted.alignment.score;
        
        if (scoreDiff >= 5) {
          // Start 2s debounce for hint
          if (mostAlignedDebounceRef.current) clearTimeout(mostAlignedDebounceRef.current);
          mostAlignedDebounceRef.current = setTimeout(() => {
            // Verify still true
            if (aligned[0].rank === newTop.rank && scoreDiff >= 5) {
              setMostAlignedHint({ standRank: newTop.rank, name: `Stand #${newTop.rank}` });
              // Auto-fade after 6s
              if (hintFadeTimeoutRef.current) clearTimeout(hintFadeTimeoutRef.current);
              hintFadeTimeoutRef.current = setTimeout(() => setMostAlignedHint(null), 6000);
            }
          }, 2000);
        }
      }
    }
  }, [layers?.standPoints, windDirection, season, highlightedStandRank]);

  // Recompute alignment when layers, wind, or season change
  useEffect(() => {
    if (!layers?.standPoints) return;
    
    // Check wind stability using wrap-safe delta (handles 350° → 10° correctly)
    if (prevWindDirection !== null) {
      const prevDeg = windToDegrees[prevWindDirection];
      const newDeg = windToDegrees[windDirection];
      const delta = smallestAngleDiffDeg(prevDeg, newDeg);
      if (delta <= 10) {
        // Wind change too small, skip recompute to prevent jitter
        return;
      }
    }
    
    setPrevWindDirection(windDirection);
    computeAlignmentScores();
  }, [layers?.standPoints, windDirection, season, computeAlignmentScores, prevWindDirection]);

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
      // Build stand data from alignedStands
      const stands = alignedStands.slice(0, 3).map(s => ({
        name: s.name,
        tier: s.alignment.label === 'Open Ground' ? 'Field Stone' : s.alignment.label,
        score: s.alignment.score,
        face: s.props.windOk[0] || 'N',
        intrusion: s.props.approachRisk,
      }));

      // Extract county/state from address if possible
      const addressParts = address.split(',').map(p => p.trim());
      const stateZip = addressParts[addressParts.length - 1] || '';
      const stateMatch = stateZip.match(/^([A-Z]{2})/);
      const state = stateMatch ? stateMatch[1] : 'MO';
      const county = addressParts.length >= 3 ? addressParts[addressParts.length - 2].replace(' County', '') : 'Unknown';

      const response = await fetch('/api/parcel-hunt-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          county,
          state,
          acreage: parseFloat(acreageParam || '40'),
          address,
          lat,
          lng,
          stands,
          prevailingWind: windDirection,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }

      // Download the PDF
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') 
        || `ParcelHuntFile_${county}${state}_${Math.round(parseFloat(acreageParam || '40'))}ac_TerraFirma.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('[ParcelHuntFile] Download error:', err);
      setError('Failed to download Parcel-Hunt File');
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, alignedStands, address, lat, lng, acreageParam, windDirection]);

  // Progress step text for UI
  const [progressStep, setProgressStep] = useState<string>('Initializing...');

  // Fetch terrain analysis using shared client
  const runAnalysis = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setProgress(10);
    setProgressStep('Fetching parcel boundary...');
    
    const startTime = Date.now();
    console.log('[INTEL] === ANALYSIS START ===');
    console.log('[INTEL] Coordinates:', lat, lng);
    console.log('[INTEL] Season:', season, 'Wind:', windDirection);
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
            seasonProfile: season,
            prevailingWinds: [windDirection],
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
          seasonProfile: season,
          prevailingWinds: [windDirection],
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
  }, [lat, lng, season, windDirection, acreageParam]);

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
          const opportunityCount = result.data.opportunity_zones.features.length;
          
          console.log('[TerrainFlow] Result:', {
            primary: primaryCount,
            secondary: secondaryCount,
            convergence: convergenceCount,
            opportunity: opportunityCount,
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

  // ========== COMPUTE BROKER SCORE (QA MODE) ==========
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
      
      // Get convergence/opportunity zone counts
      const convergenceCount = terrainFlowData.convergence_zones?.features?.length || 0;
      const opportunityCount = terrainFlowData.opportunity_zones?.features?.length || 0;
      
      // Get max intensity from opportunity zones
      let maxOverlapIntensity = 0;
      if (terrainFlowData.opportunity_zones?.features) {
        terrainFlowData.opportunity_zones.features.forEach((feature: any) => {
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
        convergenceZoneCount: Math.max(convergenceCount, opportunityCount),
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

  // ========== UPDATE TERRAIN FLOW MAP SOURCES ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;
    
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

      // Update opportunity zones source — re-scored using 4-component terrain formula
      const opportunitySource = map.getSource('tfp-flow-opportunity') as mapboxgl.GeoJSONSource;
      if (opportunitySource) {
        const rescoredOpp = rescoreStandSites(flowData?.opportunity_zones, {
          beddingPolygons: layers?.beddingPolygons || undefined,
          funnels: layers?.funnels || undefined,
          ridgeSpineData: ridgeSpineData || undefined,
          season,
        });
        opportunitySource.setData(rescoredOpp);
      }
      
      // Update HEAT MAP source (PRIMARY VISUAL)
      // terrain_pressure = 0.35×bench + 0.25×saddle + 0.20×ridge + 0.20×draw
      // No synthetic grid fill — heat only where terrain structure exists
      const heatmapSource = map.getSource('tfp-pressure-heatmap') as mapboxgl.GeoJSONSource;
      if (heatmapSource) {
        // Extract parcel coordinates for grid generation
        let parcelCoordsForGrid: number[][] | undefined;
        if (parcelPolygon?.geometry) {
          const geom = parcelPolygon.geometry;
          if (geom.type === 'Polygon') {
            parcelCoordsForGrid = (geom as GeoJSON.Polygon).coordinates[0];
          } else if (geom.type === 'MultiPolygon') {
            parcelCoordsForGrid = ((geom as GeoJSON.MultiPolygon).coordinates[0] || [])[0];
          }
        }

        const heatMapData = buildTerrainHeatMap({
          // bench_probability (0.35) ← bedding polygons
          beddingPolygons: layers?.beddingPolygons || undefined,
          // draw_convergence (0.20) ← funnels / draws
          funnels: layers?.funnels || undefined,
          // ridge_structure (0.20) + saddle_probability (0.25) ← ridge spines
          ridgeSpineData: ridgeSpineData || undefined,
          // Parcel coords for proximity calculations
          parcelCoords: parcelCoordsForGrid,
          // Season modifier on all components
          season,
        });
        
        heatmapSource.setData(heatMapData);
      }

      console.log('[TerrainFlow] Updated map sources', flowData ? (flowComparisonMode ? '(LEGACY comparison)' : '(terrain-driven)') : '(CLEARED - parcel switch)');
    } catch (err) {
      console.error('[TerrainFlow] Error updating map sources (non-fatal):', err);
    }
  }, [terrainFlowData, legacySyntheticData, flowComparisonMode, mapReady, layers, season, parcelPolygon, ridgeSpineData]);

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
      const ridgeSpineLayers = [
        'tfp-ridges-primary',
        'tfp-ridges-secondary',
        'tfp-saddle-nodes',
        'tfp-saddle-nodes-outline',
      ];
      ridgeSpineLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', visibility.ridgeSpines ? 'visible' : 'none');
        }
      });
      
      // Terrain Flow visibility (movement likelihood layers)
      // HEAT MAP (PRIMARY VISUAL)
      if (map.getLayer('tfp-pressure-heatmap')) {
        map.setLayoutProperty('tfp-pressure-heatmap', 'visibility', flowVisibility.pressureHeatmap ? 'visible' : 'none');
      }
      // Flow lines (SUPPORTING EVIDENCE)
      if (map.getLayer('tfp-flow-primary')) {
        map.setLayoutProperty('tfp-flow-primary', 'visibility', flowVisibility.flowPrimary ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-flow-secondary')) {
        map.setLayoutProperty('tfp-flow-secondary', 'visibility', flowVisibility.flowSecondary ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-flow-convergence')) {
        map.setLayoutProperty('tfp-flow-convergence', 'visibility', flowVisibility.convergenceZones ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-flow-convergence-pulse')) {
        map.setLayoutProperty('tfp-flow-convergence-pulse', 'visibility', flowVisibility.convergenceZones ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-flow-opportunity')) {
        map.setLayoutProperty('tfp-flow-opportunity', 'visibility', flowVisibility.opportunityZones ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-flow-opportunity-glow')) {
        map.setLayoutProperty('tfp-flow-opportunity-glow', 'visibility', flowVisibility.opportunityZones ? 'visible' : 'none');
      }
    } catch (err) {
      console.error('[MAP] Error updating visibility (non-fatal):', err);
    }
  }, [visibility, flowVisibility, mapReady]);

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
    let map: mapboxgl.Map;

    console.log('[MAP] BEFORE new mapboxgl.Map() id=' + mountId + ' center=[' + lng + ',' + lat + ']');
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: 14,
        pitch: 0,    // Flat 2D view - no 3D terrain
        bearing: 0,  // North up
      });
      console.log('[MAP] AFTER new mapboxgl.Map() id=' + mountId + ' map exists=' + !!map);
      
      // Expose for debugging
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = map;
      }
    } catch (err) {
      console.error("[MAP] FAILED to create Map:", err);
      setMapError("Failed to load map. Please try refreshing the page.");
      setIsLoading(false);
      return;
    }

    // Error handler - log ALL map errors
    map.on('error', (e: any) => {
      console.error("[MAP ERROR]", e?.error || e);
      if (e?.error?.status === 401 || e?.error?.status === 403) {
        setMapError("Map authentication error. Please contact support.");
      }
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
        
        // Parcel boundary source
        if (!map.getSource('tfp-parcel')) {
          map.addSource('tfp-parcel', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-parcel-outline',
            type: 'line',
            source: 'tfp-parcel',
            paint: {
              'line-color': LAYER_COLORS.parcelBoundary,
              'line-width': 3,
              'line-dasharray': [4, 2],
            },
          });
        }
        
        // QA Parcel boundary source (for KS/MO validation workflow)
        if (!map.getSource('tfp-qa-parcel')) {
          map.addSource('tfp-qa-parcel', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-qa-parcel-fill',
            type: 'fill',
            source: 'tfp-qa-parcel',
            paint: {
              'fill-color': '#22d3ee', // Cyan-400
              'fill-opacity': 0.08,
            },
          });
          map.addLayer({
            id: 'tfp-qa-parcel-outline',
            type: 'line',
            source: 'tfp-qa-parcel',
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
        
        // ========== TERRAIN SPINE LAYERS (Structure-First, Calm, Minimal) ==========
        // Goal: A hunter toggles this on and says "Yep, that's the backbone"
        
        // Primary spines: Major structural ridges (>300m, >35ft prominence)
        if (!map.getSource('tfp-ridges-primary')) {
          map.addSource('tfp-ridges-primary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-ridges-primary',
            type: 'line',
            source: 'tfp-ridges-primary',
            paint: {
              'line-color': LAYER_COLORS.ridgePrimary,
              'line-width': 2.5,           // Restrained width
              'line-opacity': 0.65,        // Not too prominent
            },
          });
        }
        
        // Secondary spines: Shorter but valid ridges (>180m, >25ft prominence)
        if (!map.getSource('tfp-ridges-secondary')) {
          map.addSource('tfp-ridges-secondary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-ridges-secondary',
            type: 'line',
            source: 'tfp-ridges-secondary',
            paint: {
              'line-color': LAYER_COLORS.ridgeSecondary,
              'line-width': 1.5,           // Thinner than primary
              'line-opacity': 0.45,        // Subtler
            },
          });
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
              // Weight: sharper contrast between weak and strong signals
              'heatmap-weight': [
                'interpolate', ['linear'],
                ['coalesce', ['get', 'score'], ['get', 'intensity'], 0.5],
                0, 0.1,    // was 0.2 — weaker floor
                0.3, 0.45,
                0.6, 0.8,
                1, 1
              ],
              // Intensity: boosted to compensate for tighter radius
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                12, 1.1,   // was 0.8
                14, 1.5,   // was ~1.0
                16, 1.8,   // was ~1.35
                18, 2.0    // was 1.5
              ],
              // Color gradient: blue (low) → cyan → green → amber (high)
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(0,0,0,0)',
                0.12, 'rgba(15,118,110,0.25)',   // teal-700 (subtle)
                0.30, 'rgba(6,182,212,0.40)',    // cyan-500
                0.50, 'rgba(16,185,129,0.55)',   // emerald-500
                0.72, 'rgba(245,158,11,0.68)',   // amber-500
                1, 'rgba(239,68,68,0.80)'        // red-500 (hot)
              ],
              // Radius: TIGHTENED ~45% to separate adjacent hotspots
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                12, 22,    // was 40
                14, 35,    // was 60
                16, 50     // was 80
              ],
              'heatmap-opacity': 0.75, // slight boost from 0.7
            },
          });
        }
        
        // ========== TERRAIN FLOW LAYERS (SUPPORTING EVIDENCE) ==========
        // Flow lines are now SUBTLE supporting evidence, not the primary visual
        // The heat map above tells the main story
        
        // Primary flow lines: bold validation of heat map corridors
        // Fewer lines (1-3 per parcel) but each one clearly readable
        if (!map.getSource('tfp-flow-primary')) {
          map.addSource('tfp-flow-primary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-flow-primary',
            type: 'line',
            source: 'tfp-flow-primary',
            paint: {
              // Bold but not dominant — validates the heat map
              'line-color': [
                'case',
                ['>=', ['coalesce', ['get', 'likelihood'], 0.5], 0.7],
                'rgba(16,185,129,0.85)',  // emerald-500 — strong corridors
                ['>=', ['coalesce', ['get', 'likelihood'], 0.5], 0.5],
                'rgba(34,211,238,0.7)',   // cyan-400 — moderate
                'rgba(148,163,184,0.45)'  // slate-400 — weak
              ],
              // Bolder widths — fewer lines so each one counts
              'line-width': [
                'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
                0.4, 1.5,    // Weak: visible
                0.55, 2.5,   // Moderate: clear
                0.75, 3.5    // Strong: bold corridor
              ],
              'line-opacity': [
                'interpolate', ['linear'], ['coalesce', ['get', 'likelihood'], 0.5],
                0.4, 0.4,    // Weak: present but subordinate
                0.55, 0.55,  // Moderate: clear
                0.75, 0.7    // Strong: confident
              ],
              'line-blur': 0.5,
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
              'line-color': 'rgba(148,163,184,0.6)', // slate-400 at 60%
              'line-width': 1.3,
              'line-opacity': 0.4,
              'line-dasharray': [4, 3],
            },
          });
        }
        
        // Convergence zones: where flows overlap or pinch
        if (!map.getSource('tfp-flow-convergence')) {
          map.addSource('tfp-flow-convergence', { type: 'geojson', data: EMPTY_FC });
          // Outer glow/pulse effect
          map.addLayer({
            id: 'tfp-flow-convergence-pulse',
            type: 'circle',
            source: 'tfp-flow-convergence',
            paint: {
              'circle-radius': ['*', ['get', 'radiusM'], 0.8],
              'circle-color': LAYER_COLORS.flowConvergence,
              'circle-opacity': 0.20,
              'circle-blur': 0.8,
            },
          });
          // Inner marker
          map.addLayer({
            id: 'tfp-flow-convergence',
            type: 'circle',
            source: 'tfp-flow-convergence',
            paint: {
              'circle-radius': 8,
              'circle-color': LAYER_COLORS.flowConvergence,
              'circle-opacity': 0.70,
              'circle-stroke-color': '#fff',
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.80,
            },
          });
        }
        
        // Opportunity zones: high-value strategic locations
        if (!map.getSource('tfp-flow-opportunity')) {
          map.addSource('tfp-flow-opportunity', { type: 'geojson', data: EMPTY_FC });
          // Outer glow
          map.addLayer({
            id: 'tfp-flow-opportunity-glow',
            type: 'circle',
            source: 'tfp-flow-opportunity',
            paint: {
              'circle-radius': 18,
              'circle-color': LAYER_COLORS.flowOpportunity,
              'circle-opacity': 0.25,
              'circle-blur': 1,
            },
          });
          // Inner star marker
          map.addLayer({
            id: 'tfp-flow-opportunity',
            type: 'circle',
            source: 'tfp-flow-opportunity',
            paint: {
              'circle-radius': 10,
              'circle-color': LAYER_COLORS.flowOpportunity,
              'circle-opacity': 0.90,
              'circle-stroke-color': '#fff',
              'circle-stroke-width': 2.5,
              'circle-stroke-opacity': 0.95,
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
        
        // Adjacent parcel boundary (invisible but clickable)
        if (!map.getSource('tfp-edge-boundary')) {
          map.addSource('tfp-edge-boundary', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-edge-boundary-fill',
            type: 'fill',
            source: 'tfp-edge-boundary',
            paint: {
              'fill-color': LAYER_COLORS.edgeBoundaryHighlight,
              'fill-opacity': 0, // Invisible by default
            },
          });
          map.addLayer({
            id: 'tfp-edge-boundary-highlight',
            type: 'line',
            source: 'tfp-edge-boundary',
            paint: {
              'line-color': LAYER_COLORS.edgeBoundaryHighlight,
              'line-width': 0, // Hidden by default, shows on hover
              'line-opacity': 0.6,
            },
          });
        }
        
        console.log('[MAP] Edge intelligence sources created');
        
        overlaySourcesCreated.current = true;
        console.log('[MAP] Native Mapbox sources created successfully');
        
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
        
        // Adjacent boundary hover (show highlight)
        map.on('mouseenter', 'tfp-edge-boundary-fill', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          // Show boundary highlight on hover
          map.setPaintProperty('tfp-edge-boundary-highlight', 'line-width', 3);
          map.setPaintProperty('tfp-edge-boundary-fill', 'fill-opacity', 0.15);
        });
        map.on('mouseleave', 'tfp-edge-boundary-fill', () => {
          map.getCanvas().style.cursor = '';
          // Hide boundary highlight
          map.setPaintProperty('tfp-edge-boundary-highlight', 'line-width', 0);
          map.setPaintProperty('tfp-edge-boundary-fill', 'fill-opacity', 0);
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
        
        // Opportunity zone click - triggers tooltip
        const handleOpportunityClick = (e: mapboxgl.MapLayerMouseEvent) => {
          if (!e.features || !e.features[0]) return;
          
          const props = e.features[0].properties || {};
          
          window.dispatchEvent(new CustomEvent('tfp-opportunity-click', {
            detail: {
              id: props.id,
              score: props.score || 0.5,
              flowIntensity: props.flowIntensity || 0.3,
              convergenceBonus: props.convergenceBonus || 0.2,
              benchBonus: props.benchBonus || 0.15,
              saddleBonus: props.saddleBonus || 0.1,
              radiusM: props.radiusM || 50,
              screenX: e.point.x,
              screenY: e.point.y,
            }
          }));
        };
        
        // Register flow click handlers
        map.on('click', 'tfp-flow-primary', (e) => handleFlowSegmentClick(e, 'primary'));
        map.on('click', 'tfp-flow-secondary', (e) => handleFlowSegmentClick(e, 'secondary'));
        map.on('click', 'tfp-flow-opportunity', handleOpportunityClick);
        map.on('click', 'tfp-flow-opportunity-glow', handleOpportunityClick);
        
        // Cursor changes for clickable layers
        const flowLayers = ['tfp-flow-primary', 'tfp-flow-secondary', 'tfp-flow-opportunity', 'tfp-flow-opportunity-glow'];
        flowLayers.forEach(layerId => {
          map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
        });
        
        console.log('[MAP] Terrain flow click handlers registered');
        
      } catch (sourceErr) {
        console.error('[MAP] Source/layer setup failed (non-fatal):', sourceErr);
        // Continue anyway - panels must render even if map overlays fail
      }
      
      // ALWAYS set map ready - even if source setup failed
      console.log('[MAP] BEFORE setMapReady(true)');
      setMapReady(true);
      console.log('[MAP] AFTER setMapReady(true) - map should now be interactive');
      
      // Resize map to ensure proper tile loading after navigation
      // (prevents "checkered calendar" tile corruption on layout changes)
      setTimeout(() => {
        try {
          if (map && mapRef.current === map) {
            (map as any).resize();
            console.log('[MAP] map.resize() called to fix tile rendering');
          }
        } catch (e) {
          console.log('[MAP] map.resize() skipped - map may be disposed');
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
    console.log('[MAP] mapRef.current set, useEffect setup complete id=' + mountId);

    return () => {
      console.log('[LIFECYCLE] CLEANUP id=' + mountId + ' (current=' + mountIdRef.current + ')');
      if (typeof window !== 'undefined') {
        window.__TFP_MAP__ = null;
      }
      overlaySourcesCreated.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []); // Empty deps - only mount once

  // Run analysis immediately on mount, and when season/wind changes
  useEffect(() => {
    runAnalysis();
  }, [season, windDirection]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ========== QA PARCEL LOOKUP HANDLERS ==========
  const handleQaParcelLookup = useCallback(async (clickLng: number, clickLat: number) => {
    if (qaParcelLoading) return;
    
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
          console.warn('[QA PARCEL] Geometry validation failed:', validation.error);
        }
        
        // Track visited parcel (keep last 20)
        setQaRecentParcelIds(prev => {
          const updated = [data.parcel.parcelId, ...prev.filter((id: string) => id !== data.parcel.parcelId)];
          return updated.slice(0, 20);
        });
        console.log('[QA PARCEL] Found:', data.parcel.parcelId, data.parcel.acreage, 'ac');
        
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
      console.error('[QA PARCEL] Lookup error:', err);
      setQaParcelError('Failed to lookup parcel');
    } finally {
      setQaParcelLoading(false);
    }
  }, [qaParcelLoading, geometryDebugMode]);

  const handleQaParcelAnalyze = useCallback(async () => {
    if (!qaParcel || qaParcelAnalyzing) return;
    
    // Check for geometry validation error - block analysis if invalid
    if (geometryValidationError) {
      setQaParcelError(`Parcel geometry invalid for analysis: ${geometryValidationError}`);
      return;
    }
    
    setQaParcelAnalyzing(true);
    setQaShowScorecard(false); // Reset scorecard for new analysis
    console.log('[QA PARCEL] Analyzing:', qaParcel.parcelId);
    
    try {
      // Create parcel polygon feature for terrain flow
      const coords = [...qaParcel.coordinates];
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
      }
      
      // ========== GEOMETRY TRACE: Step 2 - Analysis coords ==========
      const analysisStep = createTraceStep(
        '2_ANALYSIS_INPUT',
        coords,
        'ring'
      );
      
      if (geometryTrace) {
        addTraceStep(geometryTrace, analysisStep);
        
        // Print updated trace
        if (geometryDebugMode) {
          printGeometryTrace(geometryTrace);
        }
        
        // Check for mismatch
        if (geometryTrace.mismatchDetected) {
          console.error('⚠️ GEOMETRY MISMATCH DETECTED:', geometryTrace.mismatchDetails);
        }
      }
      
      // Store analysis coords for debug comparison
      setAnalysisCoords(coords);
      
      const parcelFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature',
        properties: {
          parcelId: qaParcel.parcelId,
          address: qaParcel.address,
          acreage: qaParcel.acreage,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [coords]
        }
      };
      
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
      console.log('[QA PARCEL] Reset hasFitToParcel for new parcel orientation');
      
      // Update the parcelPolygon state - this triggers terrain flow analysis
      setParcelPolygon(parcelFeature);
      console.log('[QA PARCEL] setParcelPolygon called with:', parcelFeature.properties?.parcelId || qaParcel.parcelId);
      
      // Reset terrain flow data to trigger re-fetch (sources will be cleared by effect)
      setTerrainFlowData(null);
      setTerrainFlowLoading(true);
      setTerrainStory(null);
      
      // Also clear ridge spine data for clean slate
      setRidgeSpineData(null);
      
      // Clear tiered corridor data
      setTieredCorridorData(null);
      
      // Clear edge intel data  
      setEdgeIntelData(null);
      
      // Show scorecard after a short delay (analysis will complete)
      setTimeout(() => setQaShowScorecard(true), 500);
      
      console.log('[QA PARCEL] Analysis triggered for', qaParcel.address);
      console.log('[QA PARCEL] Analysis coords sample:', coords.slice(0, 3));
      console.log('[QA PARCEL] Cleared: terrainFlowData, ridgeSpineData, tieredCorridorData, edgeIntelData');
    } catch (err) {
      console.error('[QA PARCEL] Analysis error:', err);
      setQaParcelError('Failed to analyze parcel');
    } finally {
      setQaParcelAnalyzing(false);
    }
  }, [qaParcel, qaParcelAnalyzing, geometryValidationError, geometryTrace, geometryDebugMode]);

  const handleQaParcelClear = useCallback(() => {
    console.log('[QA PARCEL] === CLEARING PARCEL STATE ===');
    
    setQaParcel(null);
    setQaParcelError(null);
    setQaShowScorecard(false);
    setGeometryValidationError(null);
    setGeometryTrace(null);
    setRawRegridCoords(null);
    setAnalysisCoords(null);
    
    // Clear all terrain analysis data
    setTerrainFlowData(null);
    setTerrainStory(null);
    setRidgeSpineData(null);
    setTieredCorridorData(null);
    setEdgeIntelData(null);
    setTerrainFlowLoading(false);
    
    // Reset parcelPolygon to null (this will clear boundary via effect)
    setParcelPolygon(null);
    
    // Reset fit flag for next parcel
    hasFitToParcel.current = false;
    
    // Clear all map layers immediately
    const map = mapRef.current;
    if (map) {
      const emptyFC = { type: 'FeatureCollection' as const, features: [] };
      
      const qaSource = map.getSource('tfp-qa-parcel') as mapboxgl.GeoJSONSource;
      if (qaSource) qaSource.setData(emptyFC);
      
      // Clear main parcel boundary
      const parcelSource = map.getSource('tfp-parcel') as mapboxgl.GeoJSONSource;
      if (parcelSource) parcelSource.setData(emptyFC);
      
      // Clear debug layers
      const rawSource = map.getSource('tfp-debug-raw') as mapboxgl.GeoJSONSource;
      if (rawSource) rawSource.setData(emptyFC);
      const normalizedSource = map.getSource('tfp-debug-normalized') as mapboxgl.GeoJSONSource;
      if (normalizedSource) normalizedSource.setData(emptyFC);
      const analysisSource = map.getSource('tfp-debug-analysis') as mapboxgl.GeoJSONSource;
      if (analysisSource) analysisSource.setData(emptyFC);
      
      // Clear terrain flow sources
      const flowPrimary = map.getSource('tfp-flow-primary') as mapboxgl.GeoJSONSource;
      if (flowPrimary) flowPrimary.setData(emptyFC);
      const flowSecondary = map.getSource('tfp-flow-secondary') as mapboxgl.GeoJSONSource;
      if (flowSecondary) flowSecondary.setData(emptyFC);
      const convergence = map.getSource('tfp-flow-convergence') as mapboxgl.GeoJSONSource;
      if (convergence) convergence.setData(emptyFC);
      const opportunity = map.getSource('tfp-flow-opportunity') as mapboxgl.GeoJSONSource;
      if (opportunity) opportunity.setData(emptyFC);
      
      // Clear ridge spine sources
      const ridgesPrimary = map.getSource('tfp-ridges-primary') as mapboxgl.GeoJSONSource;
      if (ridgesPrimary) ridgesPrimary.setData(emptyFC);
      const ridgesSecondary = map.getSource('tfp-ridges-secondary') as mapboxgl.GeoJSONSource;
      if (ridgesSecondary) ridgesSecondary.setData(emptyFC);
      const saddleNodes = map.getSource('tfp-saddle-nodes') as mapboxgl.GeoJSONSource;
      if (saddleNodes) saddleNodes.setData(emptyFC);
      
      console.log('[QA PARCEL] Cleared all map sources');
    }
  }, []);
  
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
    console.log('[QA] Rating submitted:', entry.rating, entry.parcelId);
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
          'tfp-flow-primary', 'tfp-flow-secondary', 'tfp-flow-opportunity',
          'tfp-bedding-fill', 'tfp-funnels-lines-draws', 'tfp-funnels-polys-fill'
        ].filter(l => map.getLayer(l))
      });
      
      if (features && features.length > 0) return; // Let existing handlers take over
      
      handleQaParcelLookup(e.lngLat.lng, e.lngLat.lat);
    };
    
    map.on('click', handleMapClick);
    console.log('[QA PARCEL] Click handler registered');
    
    return () => {
      map.off('click', handleMapClick);
      console.log('[QA PARCEL] Click handler removed');
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
    
    // Opportunity zone click handler
    const handleOpportunityClick = (e: Event) => {
      const customEvent = e as CustomEvent<{
        id: string;
        score: number;
        flowIntensity: number;
        convergenceBonus: number;
        benchBonus: number;
        saddleBonus: number;
        radiusM: number;
        screenX: number;
        screenY: number;
      }>;
      
      const { id, score, flowIntensity, convergenceBonus, benchBonus, saddleBonus, radiusM, screenX, screenY } = customEvent.detail;
      console.log('[OPPORTUNITY ZONE] Click event received:', { id, score });
      
      setOpportunityZonePosition({ x: screenX, y: screenY });
      setSelectedOpportunityZone({
        id,
        score,
        flowIntensity,
        convergenceBonus,
        benchBonus,
        saddleBonus,
        radiusM,
      });
    };
    
    window.addEventListener('tfp-flow-segment-click', handleFlowSegmentClick);
    window.addEventListener('tfp-opportunity-click', handleOpportunityClick);
    
    return () => {
      window.removeEventListener('tfp-flow-segment-click', handleFlowSegmentClick);
      window.removeEventListener('tfp-opportunity-click', handleOpportunityClick);
    };
  }, []);

  // ========== HTML STAND MARKERS (top 2 only) ==========
  // Skip entirely in Terrain Work Mode - deer interpretation layer
  useEffect(() => {
    if (TERRAIN_WORK_MODE) {
      cleanupMarkers(); // Ensure no stale markers
      return;
    }
    if (!mapRef.current || !mapReady || !layers?.standPoints) return;
    addStandMarkers();
  }, [layers, mapReady]);

  // Toggle visibility of HTML markers
  useEffect(() => {
    markersRef.current.forEach(marker => {
      marker.getElement().style.display = visibility.stands ? 'block' : 'none';
    });
  }, [visibility.stands]);

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
    if (!map || !layers?.standPoints) return;

    cleanupMarkers();

    // Only show TOP 2 stands
    const topTwoStands = layers.standPoints?.features?.slice(0, 2) || [];

    topTwoStands.forEach((feature) => {
      const props = feature.properties as StandPointProperties;
      const coords = feature.geometry.coordinates as [number, number];

      // #1 gets gold highlight ring = "Today's Sit"
      const isTopStand = props.rank === 1;
      const markerColor = isTopStand ? LAYER_COLORS.standHigh : LAYER_COLORS.standHigh;
      const ringColor = isTopStand ? LAYER_COLORS.standGold : 'white';
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
            background: linear-gradient(135deg, ${LAYER_COLORS.standGold}, #f59e0b);
            border: ${ringWidth}px solid ${LAYER_COLORS.standGold};
            box-shadow: 0 0 20px ${LAYER_COLORS.standGold}80, 0 6px 20px rgba(0,0,0,0.5);
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
          ${isTopStand ? '⭐' : props.rank}
        </div>
        ${isTopStand ? `
          <div style="
            position: absolute;
            bottom: -10px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, ${LAYER_COLORS.standGold}, #f59e0b);
            color: #1a1a1a;
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

      // Hover tooltip for quick info
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
      const tooltipColor = props.rank === 1 ? LAYER_COLORS.standGold : props.rank <= 3 ? LAYER_COLORS.standHigh : LAYER_COLORS.standMed;
      const standLabel = props.rank === 1 ? "⭐ Today's Sit" : `Stand #${props.rank}`;
      hoverTooltip.innerHTML = `
        <div style="font-weight: bold; color: ${tooltipColor}; font-size: 13px; margin-bottom: 4px;">
          ${standLabel} • ${props.score}/100
        </div>
        <div style="color: #ccc; font-size: 12px; line-height: 1.4;">
          <div>🌬️ Best Wind: <b style="color: #22c55e">${props.windOk.slice(0, 2).join(', ')}</b></div>
          <div>⏰ Best Time: <b>${bestTime}</b></div>
          <div>🦌 To Corridor: <b>${props.distToCorridorMeters}m</b></div>
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
        setSelectedStand(props.rank);
        showStandPopup(coords, props);
        map.flyTo({ center: coords, zoom: 16 });
      };

      markersRef.current.push(marker);
    });
  };

  const showStandPopup = (coords: [number, number], props: StandPointProperties) => {
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
    const popupBadgeColor = isTodaysSit ? `linear-gradient(135deg, ${LAYER_COLORS.standGold}, #f59e0b)` : 
      props.rank <= 3 ? LAYER_COLORS.standHigh : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow;
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
  const BUILD_STAMP = 'v2.8.1 | tighter pressure smoothing | 2026-03-14 | cp:tps';

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
      {/* Map Container - z-0 ensures it's behind UI but visible */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ minHeight: '100vh', minWidth: '100vw' }} />

      {/* BUILD STAMP - visible debug marker (hidden in export mode) */}
      <div className={`absolute bottom-2 left-2 z-50 bg-fuchsia-600 text-white px-3 py-1 rounded font-mono text-xs font-bold shadow-lg transition-opacity duration-300 ${exportMode ? 'opacity-0' : 'opacity-100'}`}>
        BUILD: {BUILD_STAMP}
      </div>

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
            {/* QA Parcel Lookup Toggle */}
            <Button
              size="sm"
              variant="ghost"
              className={`${qaParcelLookupMode 
                ? 'bg-cyan-600/30 text-cyan-400 border border-cyan-500/50' 
                : 'text-white/80 hover:text-white hover:bg-white/10'
              }`}
              onClick={() => {
                setQaParcelLookupMode(!qaParcelLookupMode);
                if (qaParcelLookupMode) {
                  // Turning off - clear any selected parcel
                  handleQaParcelClear();
                }
              }}
              title="QA Mode - Click anywhere in KS/MO to lookup parcels"
            >
              <Layers className="h-4 w-4 mr-1" />
              {qaParcelLookupMode ? 'QA Mode ON' : 'QA Mode'}
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
                <span>Click anywhere in <strong>Kansas</strong> or <strong>Missouri</strong> to lookup a parcel</span>
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
                    <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelSaddle }} />
                    <span className="text-white/80">Saddle</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelDraw }} />
                    <span className="text-white/80">Draw</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.flowOpportunity }} />
                    <span className="text-amber-300">Opportunity</span>
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
      <div className={`
        absolute top-16 bottom-4 left-4 z-10 transition-all duration-300
        ${panelCollapsed ? 'w-12' : 'w-80'}
        ${exportMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}
      `}>
        <div className="h-full bg-gray-900/95 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden flex flex-col shadow-2xl">
          {/* Collapse Toggle */}
          <button
            onClick={() => setPanelCollapsed(!panelCollapsed)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 bg-gray-800 border border-white/20 rounded-full p-1.5 hover:bg-gray-700 transition-colors"
          >
            {panelCollapsed ? <ChevronRight className="h-4 w-4 text-white" /> : <ChevronLeft className="h-4 w-4 text-white" />}
          </button>

          {panelCollapsed ? (
            <div className="flex flex-col items-center py-4 gap-3 text-white/50">
              <Settings className="h-5 w-5" />
              <span className="text-[10px] [writing-mode:vertical-rl] rotate-180">Tools</span>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* Property Info */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h2 className="font-semibold text-white text-sm leading-tight">{address}</h2>
                    <p className="text-xs text-white/60 mt-1">
                      {acreageParam ? `${acreageParam} acres` : '~80 acres'} • {lat.toFixed(4)}, {lng.toFixed(4)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Season Selector */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-white">Season Profile</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {SEASONS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => {
                        setSeason(s.value);
                        runAnalysis();
                      }}
                      className={`
                        p-2 rounded-lg text-center transition-all
                        ${season === s.value
                          ? 'bg-amber-500/30 border-2 border-amber-500 text-white'
                          : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'}
                      `}
                    >
                      <span className="text-lg block">{s.icon}</span>
                      <span className="text-xs font-medium block mt-1">{s.label}</span>
                      <span className="text-[10px] text-white/50 block">{s.dates}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Analysis Summary */}
              {summary && (
                <div className="p-4 flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium text-white">Analysis Summary</span>
                  </div>
                  <div className="space-y-3">
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-xs">Bedding Acres</span>
                        <span className="text-white font-bold">{summary.totalBeddingAcres.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-xs">Funnels Identified</span>
                        <span className="text-white font-bold">{summary.funnelCount}</span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-xs">Top Stand Score</span>
                        <span className="text-red-400 font-bold">{summary.topStandScore}/100</span>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-xs">Analysis Area</span>
                        <span className="text-white font-bold">{summary.analysisAreaAcres.toFixed(0)} acres</span>
                      </div>
                    </div>
                  </div>

                  {/* Provenance */}
                  {provenance && (
                    <div className="mt-4 pt-4 border-t border-white/10 text-xs text-white/40 space-y-1">
                      <p>Source: {provenance.demSource}</p>
                      <p>Resolution: {provenance.demResolution}</p>
                      {provenance.processingTimeSeconds && (
                        <p>Processed in {provenance.processingTimeSeconds.toFixed(2)}s</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Re-analyze Button */}
              <div className="p-4 border-t border-white/10">
                <Button
                  onClick={runAnalysis}
                  disabled={isLoading}
                  className="w-full bg-amber-600 hover:bg-amber-500 text-white"
                >
                  {isLoading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing...</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-2" />Re-analyze Terrain</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Layer Filters + Top 2 Stands (hidden in export mode) */}
      <div className={`
        absolute top-16 bottom-4 right-4 z-10 transition-all duration-300
        ${rightPanelCollapsed ? 'w-12' : 'w-72'}
        ${exportMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}
      `}>
        <div className="h-full bg-gray-900/95 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden flex flex-col shadow-2xl">
          {/* Collapse Toggle */}
          <button
            onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 bg-gray-800 border border-white/20 rounded-full p-1.5 hover:bg-gray-700 transition-colors"
          >
            {rightPanelCollapsed ? <ChevronLeft className="h-4 w-4 text-white" /> : <ChevronRight className="h-4 w-4 text-white" />}
          </button>

          {rightPanelCollapsed ? (
            <div className="flex flex-col items-center py-4 gap-3 text-white/60">
              <Wind className="h-5 w-5" />
              <Layers className="h-5 w-5" />
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* ========== WIND GAUGE (UNIFIED - RIGHT SIDE) ========== */}
              <div className="p-3 border-b border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Wind className="h-4 w-4 text-stone-400" />
                    <span className="text-sm font-medium text-white">Wind: {windDirection}</span>
                  </div>
                  <span className="text-xs text-stone-500">
                    {Math.round((Date.now() - windLastUpdated.getTime()) / 60000)} min ago
                  </span>
                </div>
                {/* Compact compass selector */}
                <div className="flex flex-wrap gap-1 justify-center">
                  {WIND_DIRECTIONS.map((dir) => {
                    const isSelected = windDirection === dir;
                    return (
                      <button
                        key={dir}
                        onClick={() => {
                          setWindDirection(dir);
                          setWindLastUpdated(new Date());
                        }}
                        className={`
                          w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-all
                          ${isSelected
                            ? 'bg-stone-600 text-white'
                            : 'bg-stone-800/50 text-stone-400 hover:bg-stone-700 hover:text-white'}
                        `}
                      >
                        {dir}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ========== TERRAIN STRUCTURE / DEER MOVEMENT PANEL ========== */}
              {(() => {
                // Count terrain structure features
                const corridorCount = layers?.funnels?.features?.filter(f => f.properties?.funnelType === 'corridor').length || 0;
                const saddleCount = layers?.funnels?.features?.filter(f => f.properties?.funnelType === 'saddle').length || 0;
                const drawCount = layers?.funnels?.features?.filter(f => f.properties?.funnelType === 'draw').length || 0;
                const totalMovement = corridorCount + saddleCount + drawCount;
                
                // In Terrain Work Mode, only count terrain structure (saddles + draws)
                const terrainStructureCount = saddleCount + drawCount;
                
                // Edge features that extend beyond parcel
                const edgeCorridors = edgeIntelData?.corridorArrows?.features?.length || 0;
                const edgeSaddles = edgeIntelData?.ghostSaddles?.features?.length || 0;
                const edgeDraws = edgeIntelData?.drawExtensions?.features?.length || 0;
                const totalEdge = edgeCorridors + edgeSaddles + edgeDraws;
                
                const movementVisible = visibility.corridors || visibility.funnels;
                
                return (
                  <div className="p-3 border-b border-white/10">
                    {/* Header - context-aware for Terrain Work Mode */}
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-white flex items-center gap-2 text-sm">
                        {TERRAIN_WORK_MODE ? (
                          <>
                            <Mountain className="h-4 w-4 text-stone-400" />
                            Terrain Structure
                          </>
                        ) : (
                          <>
                            <Compass className="h-4 w-4 text-stone-400" />
                            Deer Movement
                          </>
                        )}
                      </h3>
                      {(TERRAIN_WORK_MODE ? terrainStructureCount : totalMovement) > 0 && (
                        <span className="text-xs text-stone-500">
                          {TERRAIN_WORK_MODE ? terrainStructureCount : totalMovement} features
                        </span>
                      )}
                    </div>
                    
                    {/* Movement feature rows */}
                    <div className="space-y-1 mb-2">
                      {/* Corridors - Hidden in Terrain Work Mode (deer interpretation) */}
                      {!TERRAIN_WORK_MODE && (
                        <button
                          onClick={() => setVisibility(v => ({ ...v, corridors: !v.corridors }))}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                            visibility.corridors ? 'bg-stone-700/50' : 'bg-stone-800/30 hover:bg-stone-700/30'
                          }`}
                        >
                          <span className="w-3 h-1 rounded-full" style={{ background: LAYER_COLORS.corridorHigh, opacity: visibility.corridors ? 1 : 0.4 }} />
                          <span className={`flex-1 text-left ${visibility.corridors ? 'text-white' : 'text-stone-500'}`}>
                            Corridors
                          </span>
                          <span className={`text-[10px] ${visibility.corridors ? 'text-stone-400' : 'text-stone-600'}`}>
                            {corridorCount}
                          </span>
                        </button>
                      )}
                      
                      {/* Saddles - Physical terrain structure (independent toggle) */}
                      <button
                        onClick={() => setVisibility(v => ({ ...v, saddles: !v.saddles }))}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                          visibility.saddles ? 'bg-stone-700/50' : 'bg-stone-800/30 hover:bg-stone-700/30'
                        }`}
                      >
                        <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelSaddle, opacity: visibility.saddles ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${visibility.saddles ? 'text-white' : 'text-stone-500'}`}>
                          Saddles
                        </span>
                        <span className={`text-[10px] ${visibility.saddles ? 'text-stone-400' : 'text-stone-600'}`}>
                          {saddleCount}
                        </span>
                      </button>
                      
                      {/* Draws - Physical terrain structure (independent toggle) */}
                      <button
                        onClick={() => setVisibility(v => ({ ...v, draws: !v.draws }))}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                          visibility.draws ? 'bg-stone-700/50' : 'bg-stone-800/30 hover:bg-stone-700/30'
                        }`}
                      >
                        <span className="w-3 h-0.5 rounded-full" style={{ background: LAYER_COLORS.funnelDraw, opacity: visibility.draws ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${visibility.draws ? 'text-white' : 'text-stone-500'}`}>
                          Draws
                        </span>
                        <span className={`text-[10px] ${visibility.draws ? 'text-stone-400' : 'text-stone-600'}`}>
                          {drawCount}
                        </span>
                      </button>
                    </div>
                    
                    {/* Edge Movement Teaser (flows beyond property) - Hidden in Terrain Work Mode */}
                    {!TERRAIN_WORK_MODE && totalEdge > 0 && movementVisible && (
                      <div 
                        className="mt-2 p-2 rounded-lg bg-gradient-to-r from-pink-900/20 to-orange-900/20 border border-white/5 cursor-pointer hover:border-white/10 transition-colors"
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
                  </div>
                );
              })()}
              
              {/* Terrain Spine Layer (Structure-First, DEM-Only - ON by default) */}
              <div className="p-3 border-b border-white/10">
                <h3 className="font-medium text-white flex items-center gap-2 mb-2 text-sm">
                  <Mountain className="h-4 w-4 text-stone-400" />
                  Terrain Spine
                </h3>
                <div className="space-y-1">
                  {(() => {
                    // Calculate backbone status
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
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                          visibility.ridgeSpines ? 'bg-stone-700/50' : 'bg-stone-800/30 hover:bg-stone-700/30'
                        }`}
                      >
                        <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.ridgePrimary, opacity: visibility.ridgeSpines ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${visibility.ridgeSpines ? 'text-white' : 'text-stone-500'}`}>Backbone</span>
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
              
              {/* ========== TERRAIN FLOW LAYER (Movement Likelihood) ========== */}
              <div className="p-3 border-b border-white/10">
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
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                      flowVisibility.pressureHeatmap ? 'bg-amber-900/40 border border-amber-700/30' : 'bg-stone-800/30 hover:bg-stone-700/30'
                    }`}
                  >
                    <span className="w-3 h-3 rounded" style={{ 
                      background: 'linear-gradient(135deg, #0f766e, #06b6d4, #10b981, #f59e0b)', 
                      opacity: flowVisibility.pressureHeatmap ? 1 : 0.4 
                    }} />
                    <span className={`flex-1 text-left font-medium ${flowVisibility.pressureHeatmap ? 'text-amber-300' : 'text-stone-500'}`}>
                      Pressure Map
                    </span>
                    <span className="text-[8px] text-amber-400 px-1 py-0.5 bg-amber-900/50 rounded uppercase tracking-wider">
                      Primary
                    </span>
                  </button>
                  
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
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                          flowVisibility.flowSecondary ? 'bg-cyan-900/20' : 'bg-stone-800/30 hover:bg-stone-700/30'
                        }`}
                      >
                        <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.flowSecondary, opacity: flowVisibility.flowSecondary ? 1 : 0.4 }} />
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
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                          flowVisibility.convergenceZones ? 'bg-amber-900/20' : 'bg-stone-800/30 hover:bg-stone-700/30'
                        }`}
                      >
                        <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.flowConvergence, opacity: flowVisibility.convergenceZones ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${flowVisibility.convergenceZones ? 'text-white' : 'text-stone-500'}`}>Convergence</span>
                        {hasData && (
                          <span className="text-[9px] text-amber-400 px-1.5 py-0.5 bg-amber-900/30 rounded">
                            {convergenceCount}
                          </span>
                        )}
                      </button>
                    );
                  })()}
                  
                  {/* Opportunity Zones Toggle */}
                  {(() => {
                    const opportunityCount = terrainFlowData?.metadata?.opportunity_count || 0;
                    const hasData = opportunityCount > 0;
                    
                    return (
                      <button
                        onClick={() => setFlowVisibility(v => ({ ...v, opportunityZones: !v.opportunityZones }))}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                          flowVisibility.opportunityZones ? 'bg-amber-900/30' : 'bg-stone-800/30 hover:bg-stone-700/30'
                        }`}
                      >
                        <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.flowOpportunity, opacity: flowVisibility.opportunityZones ? 1 : 0.4 }} />
                        <span className={`flex-1 text-left ${flowVisibility.opportunityZones ? 'text-white' : 'text-stone-500'}`}>Opportunity Zones</span>
                        {hasData && (
                          <span className="text-[9px] text-amber-300 px-1.5 py-0.5 bg-amber-800/40 rounded">
                            {opportunityCount}
                          </span>
                        )}
                      </button>
                    );
                  })()}
                </div>
                
                {/* Expanded details when any flow toggle is on */}
                {(flowVisibility.flowPrimary || flowVisibility.flowSecondary || flowVisibility.convergenceZones || flowVisibility.opportunityZones) && (
                  <div className="mt-2 space-y-2 px-1">
                    {(() => {
                      const primaryCount = terrainFlowData?.metadata?.flow_count_primary || 0;
                      const secondaryCount = terrainFlowData?.metadata?.flow_count_secondary || 0;
                      const convergenceCount = terrainFlowData?.metadata?.convergence_count || 0;
                      const opportunityCount = terrainFlowData?.metadata?.opportunity_count || 0;
                      const totalFlowLength = terrainFlowData?.metadata?.total_flow_length_m || 0;
                      const totalFeatures = primaryCount + secondaryCount + convergenceCount + opportunityCount;
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
                                  opportunity_count: opportunityCount,
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
                              {opportunityCount > 0 && (
                                <div className="flex justify-between">
                                  <span>Opportunity Zones</span>
                                  <span className="text-amber-300">{opportunityCount}</span>
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
                <div className="p-3 border-b border-white/10">
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
                          opportunity_count: terrainFlowData.opportunity_zones?.features?.length || 0,
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
                    onHighlightOpportunity={(oppId) => {
                      // Could highlight opportunity on map
                      console.log('[Intel] Highlight opportunity:', oppId);
                    }}
                  />
                </div>
              )}
              
              {/* ========== TERRAIN STORY PANEL (Secondary detail) ========== */}
              {(terrainStory || terrainFlowLoading) && !exportMode && (
                <div className="p-3 border-b border-white/10">
                  <TerrainStoryPanel 
                    story={terrainStory}
                    isLoading={terrainFlowLoading}
                    defaultExpanded={false}
                    showNarrative={true}
                    compact={true}
                  />
                </div>
              )}

              {/* ========== TERRAIN WORK MODE NOTICE ========== */}
              {TERRAIN_WORK_MODE && (
                <div className="p-3 border-b border-amber-700/30 bg-amber-900/20">
                  <div className="flex items-start gap-2 text-xs text-amber-400/90">
                    <Mountain className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Terrain Work Mode</p>
                      <p className="text-amber-400/70 mt-1">
                        Verifying terrain anatomy. Showing physical structure only — deer interpretation layers disabled.
                      </p>
                      <div className="mt-2 space-y-1 text-[10px] text-amber-400/60">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-500/60" />
                          <span>Backbone, Draws, Saddles, Flow</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-stone-600" />
                          <span>Corridors, Stands, Alignment (paused)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Other Layers */}
              <div className="p-3 border-b border-white/10">
                <h3 className="font-medium text-white flex items-center gap-2 mb-2 text-sm">
                  <Layers className="h-4 w-4 text-stone-400" />
                  Other Layers
                </h3>
                <div className="space-y-1">
                  <button
                    onClick={() => setVisibility(v => ({ ...v, bedding: !v.bedding }))}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                      visibility.bedding ? 'bg-stone-700/50' : 'bg-stone-800/30 hover:bg-stone-700/30'
                    }`}
                  >
                    <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.bedding, opacity: visibility.bedding ? 1 : 0.4 }} />
                    <span className={`flex-1 text-left ${visibility.bedding ? 'text-white' : 'text-stone-500'}`}>Bedding</span>
                  </button>
                  {/* Stands toggle - disabled during terrain refinement */}
                  {!TERRAIN_WORK_MODE && (
                    <button
                      onClick={() => setVisibility(v => ({ ...v, stands: !v.stands }))}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all text-xs ${
                        visibility.stands ? 'bg-stone-700/50' : 'bg-stone-800/30 hover:bg-stone-700/30'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.standGold, opacity: visibility.stands ? 1 : 0.4 }} />
                      <span className={`flex-1 text-left ${visibility.stands ? 'text-white' : 'text-stone-500'}`}>Stands</span>
                    </button>
                  )}
                </div>
              </div>

              {/* ========== ALIGNMENT PANEL (V2 - DISABLED DURING TERRAIN REFINEMENT) ========== */}
              {!TERRAIN_WORK_MODE && (
              <div className="border-b border-white/10">
                {/* Header - Always visible, NO auto-expand */}
                {(() => {
                  // Check if top two stands are within ≤3 pts (comparable)
                  const isComparable = alignedStands.length >= 2 && 
                    Math.abs(alignedStands[0].alignment.score - alignedStands[1].alignment.score) <= 3;
                  // When comparable: "Comparable Alignment Today" - removes "Most Aligned" entirely
                  const headerTitle = isComparable ? 'Comparable Alignment Today' : 'Stand Alignment';
                  // Collapsed summary: just show the top stand name (no "Most Aligned" or rankings)
                  const collapsedSummary = alignedStands.length > 0 
                    ? alignedStands[0].name
                    : 'Stand Alignment';
                  
                  return (
                    <button
                      onClick={() => setAlignmentPanelExpanded(!alignmentPanelExpanded)}
                      className="w-full p-3 flex items-center justify-between hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-stone-400" />
                        <span className="font-medium text-white text-sm">
                          {alignmentPanelExpanded ? headerTitle : collapsedSummary}
                        </span>
                      </div>
                      <ChevronRight 
                        className={`h-4 w-4 text-white/50 transition-transform duration-200 ${alignmentPanelExpanded ? 'rotate-90' : ''}`} 
                      />
                    </button>
                  );
                })()}

                {/* Expanded Content - Top 3 Stands (Compact Tiles V2 - Equal Typography) */}
                {alignmentPanelExpanded && (
                  <div className="px-2 pb-2 space-y-1">
                    {alignedStands.slice(0, 3).map((stand) => {
                      const isHighlighted = highlightedStandRank === stand.rank;
                      const isExpanded = selectedStand === stand.rank;
                      
                      // 3 tiers only - earth-tone accent colors (left bar)
                      // Open Ground maps to Field Stone for display
                      const tierLabel = stand.alignment.label === 'Open Ground' ? 'Field Stone' : stand.alignment.label;
                      const accentColors: Record<string, string> = {
                        'Deep Moss': '#4a7c59',      // muted forest green
                        'Weathered Oak': '#8b7355',  // warm brown
                        'Field Stone': '#708090',    // slate gray
                      };
                      const accentColor = accentColors[tierLabel] || '#708090';

                      return (
                        <div
                          key={stand.rank}
                          className={`
                            relative rounded-lg overflow-hidden transition-colors
                            ${isHighlighted ? 'bg-stone-800/60' : 'bg-stone-900/40 hover:bg-stone-800/40'}
                          `}
                        >
                          {/* Thin left accent bar */}
                          <div 
                            className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
                            style={{ background: accentColor }}
                          />
                          
                          {/* Main card content - stand NAME only (no numbering) */}
                          <button
                            onClick={() => {
                              handleUserInteraction();
                              setHighlightedStandRank(stand.rank);
                              // Toggle inline expand instead of popup
                              setSelectedStand(selectedStand === stand.rank ? null : stand.rank);
                              mapRef.current?.flyTo({ center: stand.coords, zoom: 16, duration: 800 });
                            }}
                            className="w-full pl-3 pr-2 py-2 text-left"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                {/* Stand name - equal typography, no "best" styling */}
                                <span className="text-white text-sm font-medium truncate block">{stand.name}</span>
                                {/* Tier label - equal styling across all tiers */}
                                <span className="text-stone-500 text-xs">{tierLabel}</span>
                              </div>
                              {/* Score - small, understated, monospace */}
                              <span className="text-stone-600 text-[11px] font-mono ml-2">{stand.alignment.score}</span>
                            </div>
                          </button>
                          
                          {/* Inline expanded details (no popup) */}
                          {isExpanded && (
                            <div className="pl-3 pr-2 pb-2 pt-1 border-t border-white/5 text-xs text-stone-400 space-y-1">
                              <div className="flex justify-between">
                                <span>Face:</span>
                                <span className="text-white">{stand.props.windOk[0] || 'N'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Intrusion:</span>
                                <span className="text-white capitalize">{stand.props.approachRisk}</span>
                              </div>
                              {stand.props.distToCorridorMeters > 0 && (
                                <div className="flex justify-between">
                                  <span>To corridor:</span>
                                  <span className="text-white">{stand.props.distToCorridorMeters}m</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              )}
              {/* End of TERRAIN_WORK_MODE conditional wrapper for Alignment Panel */}

              {/* ========== PARCEL-HUNT FILE DOWNLOAD ========== */}
              <div className="p-3 border-t border-white/10">
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
      
      {/* ========== OPPORTUNITY ZONE TOOLTIP ========== */}
      {selectedOpportunityZone && opportunityZonePosition && (
        <OpportunityZoneTooltip
          properties={selectedOpportunityZone}
          position={opportunityZonePosition}
          onClose={() => {
            setSelectedOpportunityZone(null);
            setOpportunityZonePosition(null);
          }}
        />
      )}

      {/* Legend - Premium V1 styling (hidden in export mode - replaced by export legend) */}
      <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-gray-900/95 backdrop-blur rounded-xl px-5 py-3 flex items-center gap-5 text-xs text-white/80 border border-white/15 shadow-2xl transition-opacity duration-300 ${exportMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {/* Terrain */}
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.bedding }} />
          <span>Bedding</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelSaddle }} />
          <span>Saddle</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded" style={{ background: LAYER_COLORS.funnelDraw }} />
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
          <span className="w-3 h-3 rounded-full" style={{ background: LAYER_COLORS.standHigh }} />
          <span>#2</span>
        </div>
      </div>
    </div>
  );
}