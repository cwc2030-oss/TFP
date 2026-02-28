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
  Unlock, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  scoreStandsWithExceptional,
  shouldRecomputeWind,
  type StandInputs,
  type StandScore,
} from '@/lib/scoring/stand-alignment';
import { buildStandInputs, windDirectionToDeg } from '@/lib/scoring/stand-inputs';
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
} from '@/types/terrain';

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

// ========== V1 STYLING RULES (Final Visual Direction) ==========
// Corridors: Confidence-based styling
//   High (≥0.7): SOLID bright red-violet, thick - primary travel routes
//   Med (0.4-0.7): SOLID purple - secondary routes  
//   Low (<0.4): DASHED light lavender - potential routes (ONLY low confidence is dashed)
// Draws: Solid blue lines (water/drainage)
// Saddles: Orange polygons (pinch points)
// Stands: #1 gets gold ring (Today's Sit), #2 red

const LAYER_COLORS = {
  bedding: '#22c55e',
  beddingOutline: '#16a34a',
  funnelSaddle: '#f97316',
  funnelDraw: '#3b82f6',           // Solid blue for draws
  corridorHigh: '#db2777',         // High score ≥0.7: bright red-violet (pink-600)
  corridorMed: '#9333ea',          // Med score 0.4-0.7: solid purple (purple-600)
  corridorLow: '#c4b5fd',          // Low score <0.4: light lavender (DASHED only)
  standHigh: '#ef4444',            // #2+ stands: red
  standGold: '#fbbf24',            // #1 Today's Sit: gold highlight ring
  standMed: '#f59e0b',
  standLow: '#6b7280',
  parcelBoundary: '#fbbf24',
  // Edge Intelligence Layer colors
  edgeCorridorArrow: '#db2777',    // Faded red-violet for continuation arrows
  edgeGhostBedding: '#22c55e',     // Semi-transparent green for ghost bedding
  edgePressureInbound: '#22c55e',  // Green for inbound pressure
  edgePressureOutbound: '#f59e0b', // Amber for outbound pressure
  edgeBoundaryHighlight: '#8b5cf6', // Purple highlight for adjacent parcel boundaries
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
  const [selectedStand, setSelectedStand] = useState<number | null>(null);
  const [visibility, setVisibility] = useState<TerrainLayerVisibility>({
    bedding: true,
    funnels: true,
    stands: true,
    corridors: true,
  });

  // UI state
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [parcelPolygon, setParcelPolygon] = useState<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);

  // Edge Intelligence Layer state
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockModalData, setUnlockModalData] = useState<{
    segmentBearing: number;
    edgeType: 'corridor' | 'bedding' | 'pressure' | 'boundary';
    lngLat: [number, number];
  } | null>(null);
  const [edgeIntelData, setEdgeIntelData] = useState<{
    corridorArrows: GeoJSON.FeatureCollection;
    ghostBedding: GeoJSON.FeatureCollection;
    pressureArrows: GeoJSON.FeatureCollection;
    adjacentBoundary: GeoJSON.FeatureCollection;
  } | null>(null);

  // ========== ALIGNMENT ENGINE STATE ==========
  type AlignedStand = {
    rank: number;
    props: StandPointProperties;
    inputs: StandInputs;
    alignment: StandScore;
    coords: [number, number];
  };
  const [alignedStands, setAlignedStands] = useState<AlignedStand[]>([]);
  const [highlightedStandRank, setHighlightedStandRank] = useState<number | null>(null);
  const [exceptionalIndex, setExceptionalIndex] = useState<number | null>(null);
  const [parcelStrength, setParcelStrength] = useState<number>(0);
  const [prevWindDirection, setPrevWindDirection] = useState<WindDirection | null>(null);
  const [mostAlignedHint, setMostAlignedHint] = useState<{ standRank: number; name: string } | null>(null);
  const [alignmentPanelExpanded, setAlignmentPanelExpanded] = useState(true);
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
    const aligned: AlignedStand[] = stands.map((f, i) => ({
      rank: (f.properties as StandPointProperties).rank,
      props: f.properties as StandPointProperties,
      inputs: inputs[i],
      alignment: scores[i],
      coords: f.geometry.coordinates as [number, number],
    })).sort((a, b) => b.alignment.score - a.alignment.score);

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
    
    // Check wind stability
    if (prevWindDirection !== null) {
      const prevDeg = windToDegrees[prevWindDirection];
      const newDeg = windToDegrees[windDirection];
      if (!shouldRecomputeWind(prevDeg, newDeg)) {
        // Wind change too small, skip recompute
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

    try {
      // Import shared terrain client
      const { fetchParcelGeometry, fetchTerrainAnalysis, generateSyntheticParcel } = await import('@/lib/terrain-client');
      
      // Get real parcel geometry from Regrid
      setProgress(15);
      const parcel = await fetchParcelGeometry(lat, lng);
      
      if (!parcel) {
        // Use synthetic fallback instead of failing
        console.warn('[INTEL] No Regrid parcel, using synthetic boundary');
        const syntheticParcel = generateSyntheticParcel(lat, lng, parseFloat(acreageParam || '80'));
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

  // ========== UPDATE NATIVE MAPBOX SOURCES WHEN DATA CHANGES ==========
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !overlaySourcesCreated.current) return;

    try {
      // Update parcel boundary
      const parcelSource = map.getSource('tfp-parcel') as mapboxgl.GeoJSONSource;
      if (parcelSource && parcelPolygon) {
        parcelSource.setData(validateGeoJSON(parcelPolygon));
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
      const pressureArrows = generatePressureArrows(corridorsFC, parcelCoords);
      const adjacentBoundary = generateAdjacentParcelBoundary(parcelCoords);

      console.log('[EDGE INTEL] Generated:', {
        corridorArrows: corridorArrows.features.length,
        ghostBedding: ghostBedding.features.length,
        pressureArrows: pressureArrows.features.length,
        adjacentBoundary: adjacentBoundary.features.length
      });

      setEdgeIntelData({
        corridorArrows,
        ghostBedding,
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

      // Funnel visibility - draws layer
      if (map.getLayer('tfp-funnels-lines-draws')) {
        map.setLayoutProperty('tfp-funnels-lines-draws', 'visibility', visibility.funnels ? 'visible' : 'none');
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
        const funnelVisible = visibility.funnels || visibility.corridors;
        map.setLayoutProperty('tfp-funnels-lines', 'visibility', funnelVisible ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-funnels-polys-fill')) {
        map.setLayoutProperty('tfp-funnels-polys-fill', 'visibility', visibility.funnels ? 'visible' : 'none');
      }
      if (map.getLayer('tfp-funnels-polys-outline')) {
        map.setLayoutProperty('tfp-funnels-polys-outline', 'visibility', visibility.funnels ? 'visible' : 'none');
      }
    } catch (err) {
      console.error('[MAP] Error updating visibility (non-fatal):', err);
    }
  }, [visibility, mapReady]);

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
        
        // Bedding source
        if (!map.getSource('tfp-bedding')) {
          map.addSource('tfp-bedding', { type: 'geojson', data: EMPTY_FC });
          map.addLayer({
            id: 'tfp-bedding-fill',
            type: 'fill',
            source: 'tfp-bedding',
            paint: {
              'fill-color': LAYER_COLORS.bedding,
              'fill-opacity': 0.25,
            },
          });
          map.addLayer({
            id: 'tfp-bedding-outline',
            type: 'line',
            source: 'tfp-bedding',
            paint: {
              'line-color': LAYER_COLORS.beddingOutline,
              'line-width': 2,
            },
          });
        }
        
        // Funnel lines source (draws, corridors) - separate by funnelType for different colors
        if (!map.getSource('tfp-funnels-lines')) {
          map.addSource('tfp-funnels-lines', { type: 'geojson', data: EMPTY_FC });
          // Draws layer (blue)
          map.addLayer({
            id: 'tfp-funnels-lines-draws',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['==', ['get', 'funnelType'], 'draw'],
            paint: {
              'line-color': LAYER_COLORS.funnelDraw,
              'line-width': 3,
            },
          });
          // Corridors layer: HIGH + MEDIUM confidence = SOLID lines
          map.addLayer({
            id: 'tfp-funnels-lines-corridors-solid',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['all', 
              ['==', ['get', 'funnelType'], 'corridor'],
              ['>=', ['coalesce', ['get', 'corridorScore'], 0.5], 0.4]  // Med + High only
            ],
            paint: {
              // Score-based color: High ≥0.7 (bright red-violet), Med 0.4-0.7 (purple)
              'line-color': [
                'case',
                ['>=', ['coalesce', ['get', 'corridorScore'], 0.5], 0.7], LAYER_COLORS.corridorHigh,
                LAYER_COLORS.corridorMed
              ],
              // Thick lines for high confidence
              'line-width': [
                'case',
                ['>=', ['coalesce', ['get', 'corridorScore'], 0.5], 0.7], 6,  // High = thick
                4  // Medium = medium
              ],
              // SOLID - no dash array
            },
          });
          
          // Corridors layer: LOW confidence = DASHED lines only
          map.addLayer({
            id: 'tfp-funnels-lines-corridors-dashed',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['all', 
              ['==', ['get', 'funnelType'], 'corridor'],
              ['<', ['coalesce', ['get', 'corridorScore'], 0.5], 0.4]  // Low only
            ],
            paint: {
              'line-color': LAYER_COLORS.corridorLow,  // Light lavender
              'line-width': 3,
              'line-dasharray': [3, 2],  // DASHED = low confidence only
            },
          });
          
          // Legacy layer ID for compatibility (hidden, references both solid + dashed)
          map.addLayer({
            id: 'tfp-funnels-lines-corridors',
            type: 'line',
            source: 'tfp-funnels-lines',
            filter: ['==', ['literal', false], true],  // Never matches, just for layer existence
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
        
        // ========== EDGE INTELLIGENCE SOURCES AND LAYERS ==========
        
        // Corridor continuation arrows
        if (!map.getSource('tfp-edge-arrows')) {
          map.addSource('tfp-edge-arrows', { type: 'geojson', data: EMPTY_FC });
          // Arrow lines (faded)
          map.addLayer({
            id: 'tfp-edge-arrows-lines',
            type: 'line',
            source: 'tfp-edge-arrows',
            filter: ['==', ['get', 'type'], 'corridor_continuation'],
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
            paint: {
              'fill-color': LAYER_COLORS.edgeGhostBedding,
              'fill-opacity': 0.15,
            },
          });
          map.addLayer({
            id: 'tfp-edge-ghost-outline',
            type: 'line',
            source: 'tfp-edge-ghost',
            paint: {
              'line-color': LAYER_COLORS.edgeGhostBedding,
              'line-width': 2,
              'line-opacity': 0.4,
              'line-dasharray': [4, 2],
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
        
        const handleEdgeClick = (e: mapboxgl.MapLayerMouseEvent, edgeType: 'corridor' | 'bedding' | 'pressure' | 'boundary') => {
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
        map.on('click', 'tfp-edge-pressure-lines', (e) => handleEdgeClick(e, 'pressure'));
        map.on('click', 'tfp-edge-boundary-fill', (e) => handleEdgeClick(e, 'boundary'));
        
        console.log('[MAP] Edge intelligence click handlers registered');
        
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

  // ========== HTML STAND MARKERS (top 2 only) ==========
  useEffect(() => {
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

      const el = document.createElement('div');
      el.className = 'intel-stand-marker';
      el.innerHTML = `
        <div style="
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
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        ">
          ${isTopStand ? '⭐' : props.rank}
        </div>
        ${isTopStand ? `
          <div style="
            position: absolute;
            bottom: -22px;
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
        (el.firstElementChild as HTMLElement).style.transform = 'scale(1.2)';
        (el.firstElementChild as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)';
        hoverTooltip.style.opacity = '1';
      };
      el.onmouseleave = () => {
        (el.firstElementChild as HTMLElement).style.transform = 'scale(1)';
        (el.firstElementChild as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
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

    // #1 = Today's Sit with gold styling
    const isTodaysSit = props.rank === 1;
    const popupBadgeColor = isTodaysSit ? `linear-gradient(135deg, ${LAYER_COLORS.standGold}, #f59e0b)` : 
      props.rank <= 3 ? LAYER_COLORS.standHigh : props.rank <= 7 ? LAYER_COLORS.standMed : LAYER_COLORS.standLow;
    const popupBadgeLabel = isTodaysSit ? "⭐ Today's Sit" : `Stand #${props.rank}`;
    const badgeTextColor = isTodaysSit ? '#1a1a1a' : 'white';
    
    const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '340px', className: 'intel-popup' })
      .setLngLat(coords)
      .setHTML(`
        <div style="padding: 16px; font-family: system-ui, sans-serif;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <span style="
              background: ${popupBadgeColor};
              color: ${badgeTextColor};
              font-weight: bold;
              padding: 6px 14px;
              border-radius: 16px;
              font-size: 15px;
              ${isTodaysSit ? 'box-shadow: 0 0 12px rgba(251, 191, 36, 0.5);' : ''}
            ">${popupBadgeLabel}</span>
            <span style="font-weight: 700; font-size: 22px;">${props.score}<span style="font-size: 14px; color: #6b7280;">/100</span></span>
          </div>
          
          <p style="margin: 12px 0; font-size: 14px; color: #374151; line-height: 1.5;">
            ${props.reasoning}
          </p>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px;">
            <div style="background: #f3f4f6; padding: 8px 10px; border-radius: 6px;">
              <span style="color: #6b7280; font-size: 11px; display: block;">To Corridor</span>
              <span style="font-weight: 600; font-size: 14px;">${props.distToCorridorMeters}m</span>
            </div>
            <div style="background: #f3f4f6; padding: 8px 10px; border-radius: 6px;">
              <span style="color: #6b7280; font-size: 11px; display: block;">To Bedding</span>
              <span style="font-weight: 600; font-size: 14px;">${props.distToBeddingMeters}m</span>
            </div>
            <div style="background: #dcfce7; padding: 8px 10px; border-radius: 6px;">
              <span style="color: #166534; font-size: 11px; display: block;">✓ Good Wind</span>
              <span style="font-weight: 600; font-size: 14px;">${props.windOk.join(', ')}</span>
            </div>
            <div style="background: #fee2e2; padding: 8px 10px; border-radius: 6px;">
              <span style="color: #991b1b; font-size: 11px; display: block;">✗ Avoid</span>
              <span style="font-weight: 600; font-size: 14px;">${props.windBad.join(', ')}</span>
            </div>
          </div>
          
          <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e5e7eb; display: flex; align-items: center; gap: 12px;">
            <span style="
              padding: 4px 10px;
              border-radius: 6px;
              font-weight: 500;
              font-size: 12px;
              background: ${props.approachRisk === 'low' ? '#dcfce7' : props.approachRisk === 'medium' ? '#fef3c7' : '#fee2e2'};
              color: ${props.approachRisk === 'low' ? '#166534' : props.approachRisk === 'medium' ? '#92400e' : '#991b1b'};
            ">
              ${props.approachRisk.toUpperCase()} approach risk
            </span>
            <span style="color: #6b7280; font-size: 12px;">Elev: ${Math.round(props.elevation)}m</span>
          </div>
          
          <button
            id="copy-coords-btn"
            style="
              margin-top: 12px;
              width: 100%;
              padding: 8px 12px;
              background: #1f2937;
              border: 1px solid #374151;
              border-radius: 6px;
              color: white;
              font-size: 12px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              transition: background 0.15s;
            "
            onmouseover="this.style.background='#374151'"
            onmouseout="this.style.background='#1f2937'"
            onclick="
              navigator.clipboard.writeText('${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}');
              this.innerHTML = '✓ Copied!';
              this.style.background = '#166534';
              setTimeout(() => {
                this.innerHTML = '📋 Copy Coordinates';
                this.style.background = '#1f2937';
              }, 2000);
            "
          >
            📋 Copy Coordinates
          </button>
          <div style="margin-top: 6px; text-align: center; color: #6b7280; font-size: 11px; font-family: monospace;">
            ${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}
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
  const BUILD_STAMP = 'V7-NATIVE-MAPBOX-2026-02-22';

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

      {/* BUILD STAMP - visible debug marker */}
      <div className="absolute bottom-2 left-2 z-50 bg-fuchsia-600 text-white px-3 py-1 rounded font-mono text-xs font-bold shadow-lg">
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
            <Button
              size="sm"
              variant="ghost"
              className="text-white/80 hover:text-white hover:bg-white/10"
              onClick={flyToCenter}
            >
              <Crosshair className="h-4 w-4 mr-1" />
              Re-center
            </Button>
          </div>
        </div>
      </div>

      {/* Left Panel - Controls */}
      <div className={`
        absolute top-16 bottom-4 left-4 z-10 transition-all duration-300
        ${panelCollapsed ? 'w-12' : 'w-80'}
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
            <div className="flex flex-col items-center py-4 gap-4 text-white/60">
              <Mountain className="h-5 w-5" />
              <Calendar className="h-5 w-5" />
              <Wind className="h-5 w-5" />
              <Layers className="h-5 w-5" />
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

              {/* Wind Selector */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Wind className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium text-white">Prevailing Wind</span>
                </div>
                <div className="relative w-40 h-40 mx-auto">
                  {/* Compass Rose */}
                  <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                  <div className="absolute inset-4 rounded-full border border-white/10" />
                  <Compass className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 text-white/30" />
                  
                  {WIND_DIRECTIONS.map((dir, i) => {
                    const angle = (i * 45 - 90) * (Math.PI / 180);
                    const radius = 60;
                    const x = 80 + Math.cos(angle) * radius;
                    const y = 80 + Math.sin(angle) * radius;
                    const isSelected = windDirection === dir;
                    
                    return (
                      <button
                        key={dir}
                        onClick={() => {
                          setWindDirection(dir);
                          runAnalysis();
                        }}
                        style={{ left: x - 14, top: y - 14 }}
                        className={`
                          absolute w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
                          ${isSelected
                            ? 'bg-blue-500 text-white scale-110 shadow-lg shadow-blue-500/50'
                            : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'}
                        `}
                      >
                        {dir}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-white/50 text-center mt-2">Select your dominant wind</p>
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

      {/* Right Panel - Layer Filters + Top 2 Stands */}
      <div className={`
        absolute top-16 bottom-4 right-4 z-10 transition-all duration-300
        ${rightPanelCollapsed ? 'w-12' : 'w-72'}
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
              <Layers className="h-5 w-5" />
              <span className="text-xs [writing-mode:vertical-rl] rotate-180">Filters</span>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* Layer Filters */}
              <div className="p-4 border-b border-white/10">
                <h3 className="font-semibold text-white flex items-center gap-2 mb-3">
                  <Layers className="h-4 w-4 text-purple-400" />
                  Map Layers
                </h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setVisibility(v => ({ ...v, bedding: !v.bedding }))}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                      visibility.bedding ? 'bg-green-500/20 border border-green-500/50' : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <span className="w-4 h-4 rounded" style={{ background: LAYER_COLORS.bedding }} />
                    <span className="text-sm text-white/90 flex-1 text-left">Bedding Areas</span>
                    {visibility.bedding && <Check className="h-4 w-4 text-green-400" />}
                  </button>
                  <button
                    onClick={() => setVisibility(v => ({ ...v, funnels: !v.funnels }))}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                      visibility.funnels ? 'bg-orange-500/20 border border-orange-500/50' : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <span className="w-4 h-4 rounded" style={{ background: LAYER_COLORS.funnelSaddle }} />
                    <span className="text-sm text-white/90 flex-1 text-left">Saddles & Draws</span>
                    {visibility.funnels && <Check className="h-4 w-4 text-orange-400" />}
                  </button>
                  <button
                    onClick={() => setVisibility(v => ({ ...v, corridors: !v.corridors }))}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                      visibility.corridors ? 'bg-pink-600/20 border border-pink-500/50' : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <span className="w-4 h-4 rounded" style={{ background: LAYER_COLORS.corridorHigh }} />
                    <span className="text-sm text-white/90 flex-1 text-left">Travel Corridors</span>
                    {visibility.corridors && <Check className="h-4 w-4 text-pink-400" />}
                  </button>
                  <button
                    onClick={() => setVisibility(v => ({ ...v, stands: !v.stands }))}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${
                      visibility.stands ? 'bg-amber-500/20 border border-amber-500/50' : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full" style={{ background: `linear-gradient(135deg, ${LAYER_COLORS.standGold}, #f59e0b)` }} />
                    <span className="text-sm text-white/90 flex-1 text-left">Sit Locations</span>
                    {visibility.stands && <Check className="h-4 w-4 text-amber-400" />}
                  </button>
                </div>
              </div>

              {/* ========== ALIGNMENT PANEL ========== */}
              <div className="border-b border-white/10">
                {/* Header - Always visible */}
                <button
                  onClick={() => setAlignmentPanelExpanded(!alignmentPanelExpanded)}
                  className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-amber-500" />
                    <span className="font-bold text-white">
                      {alignmentPanelExpanded ? 'Most Aligned Today' : (
                        alignedStands.length > 0 
                          ? `Stand #${alignedStands[0].rank} — Most Aligned` 
                          : 'Most Aligned Today'
                      )}
                    </span>
                  </div>
                  <ChevronRight 
                    className={`h-4 w-4 text-white/50 transition-transform duration-200 ${alignmentPanelExpanded ? 'rotate-90' : ''}`} 
                  />
                </button>

                {/* "Now Most Aligned" Hint */}
                {mostAlignedHint && (
                  <button
                    onClick={() => {
                      setHighlightedStandRank(mostAlignedHint.standRank);
                      setMostAlignedHint(null);
                      const stand = alignedStands.find(s => s.rank === mostAlignedHint.standRank);
                      if (stand) {
                        mapRef.current?.flyTo({ center: stand.coords, zoom: 16 });
                        showStandPopup(stand.coords, stand.props);
                      }
                    }}
                    className="w-full px-4 py-2 bg-amber-500/10 border-y border-amber-500/20 text-amber-300 text-sm flex items-center gap-2 hover:bg-amber-500/20 transition-all"
                    style={{ animation: 'fadeIn 0.2s ease-out' }}
                  >
                    <Compass className="h-4 w-4" />
                    <span>{mostAlignedHint.name} now most aligned.</span>
                  </button>
                )}

                {/* Expanded Content - Top 3 Stands */}
                {alignmentPanelExpanded && (
                  <div className="pb-2">
                    {alignedStands.slice(0, 3).map((stand, idx) => {
                      const isHighlighted = highlightedStandRank === stand.rank;
                      const isExceptional = idx === 0 && exceptionalIndex === 0;
                      
                      // Earth-tone label colors
                      const labelColors: Record<string, string> = {
                        'Deep Moss': 'text-emerald-400',
                        'Weathered Oak': 'text-amber-600',
                        'Field Stone': 'text-stone-400',
                        'Open Ground': 'text-stone-500',
                      };

                      return (
                        <button
                          key={stand.rank}
                          onClick={() => {
                            handleUserInteraction();
                            setHighlightedStandRank(stand.rank);
                            setSelectedStand(stand.rank);
                            showStandPopup(stand.coords, stand.props);
                            mapRef.current?.flyTo({ center: stand.coords, zoom: 16 });
                          }}
                          className={`
                            w-full px-4 py-3 text-left transition-colors border-b border-white/5
                            ${isHighlighted ? 'bg-stone-700/30' : 'hover:bg-white/5'}
                          `}
                        >
                          <div className="flex items-start gap-3">
                            {/* Rank Badge */}
                            <div className="flex flex-col items-center">
                              <span className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-white font-bold text-sm">
                                {idx + 1}
                              </span>
                            </div>

                            {/* Stand Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between">
                                <span className="text-white font-semibold">Stand #{stand.rank}</span>
                                {/* Small understated score */}
                                <span className="text-white/40 text-xs font-mono">{stand.alignment.score}</span>
                              </div>

                              {/* Earth-tone Label */}
                              <div className={`text-sm font-medium ${labelColors[stand.alignment.label] || 'text-stone-400'}`}>
                                {stand.alignment.label}
                              </div>

                              {/* Exceptional - only top stand, calm 200ms fade-in */}
                              {isExceptional && (
                                <div 
                                  className="text-emerald-300/80 text-xs mt-0.5"
                                  style={{ animation: 'fadeIn 0.2s ease-out' }}
                                >
                                  Exceptional
                                </div>
                              )}

                              {/* Wind & Approach */}
                              <div className="flex items-center gap-3 mt-2 text-xs text-white/50">
                                <span className={stand.props.windOk.includes(windDirection) ? 'text-green-400' : 'text-white/40'}>
                                  Wind: {stand.props.windOk.slice(0, 2).join(', ')}
                                </span>
                                <span className={`capitalize ${
                                  stand.props.approachRisk === 'low' ? 'text-green-400/70' :
                                  stand.props.approachRisk === 'high' ? 'text-stone-500' : 'text-stone-400'
                                }`}>
                                  {stand.props.approachRisk} approach
                                </span>
                              </div>

                              {/* Movement indicator */}
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="flex-1 h-1 bg-stone-800 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-gradient-to-r from-stone-600 to-stone-500 rounded-full transition-all"
                                    style={{ width: `${Math.round(stand.inputs.movement * 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-white/30">movement</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    {/* Parcel Strength footer */}
                    {alignedStands.length > 0 && (
                      <div className="px-4 py-2 flex items-center justify-between text-xs text-white/40">
                        <span>Parcel Strength</span>
                        <span className="font-mono">{Math.round(parcelStrength)}</span>
                      </div>
                    )}
                  </div>
                )}
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
                    unlockModalData.edgeType === 'pressure' ? 'bg-amber-500/20' :
                    'bg-purple-500/20'
                  }`}>
                    {unlockModalData.edgeType === 'corridor' && <ArrowUpRight className="w-5 h-5 text-pink-400" />}
                    {unlockModalData.edgeType === 'bedding' && <Target className="w-5 h-5 text-green-400" />}
                    {unlockModalData.edgeType === 'pressure' && <Wind className="w-5 h-5 text-amber-400" />}
                    {unlockModalData.edgeType === 'boundary' && <MapPin className="w-5 h-5 text-purple-400" />}
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">
                      {unlockModalData.edgeType === 'corridor' && 'Travel corridor continues beyond your boundary'}
                      {unlockModalData.edgeType === 'bedding' && 'External bedding influence detected'}
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

      {/* Legend - Premium V1 styling */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-gray-900/95 backdrop-blur rounded-xl px-5 py-3 flex items-center gap-5 text-xs text-white/80 border border-white/15 shadow-2xl">
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
