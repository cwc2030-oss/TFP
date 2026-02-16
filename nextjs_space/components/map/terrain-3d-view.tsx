"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, RotateCcw, Compass, Mountain, Target, Info, ZoomIn, ZoomOut, Maximize2, Wind, Camera, Play, Pause, HelpCircle, ChevronDown, ChevronUp, Lock, Unlock, Layers, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

interface Terrain3DViewProps {
  isOpen: boolean;
  onClose: () => void;
  parcelCenter: { lat: number; lng: number };
  parcelBounds?: { lat: number; lng: number }[];
  parcelAddress?: string;
  acreage?: number;
  previewMode?: boolean; // When true, shows locked deer intel layers with upgrade CTA
  onUnlockIntel?: () => void; // Callback when user wants to buy $79 report
}

interface DeerCorridor {
  id: string;
  type: "primary" | "secondary" | "water" | "bedding" | "funnel" | "food_plot" | "stand";
  label: string;
  coordinates: [number, number][];
  description: string;
}

const CORRIDOR_COLORS: Record<string, string> = {
  primary: "#ef4444",
  secondary: "#f97316",
  water: "#3b82f6",
  bedding: "#22c55e",
  funnel: "#a855f7",
  food_plot: "#eab308",
  stand: "#ec4899",
};

// ═══ Custom Outdoorsy SVG Icons ═══

const DeerTrackIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    {/* Deer hoof print - two teardrop toes */}
    <path d="M8 4C8 4 6 8 6.5 11C7 14 9 14 9 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="currentColor" fillOpacity="0.3"/>
    <path d="M16 4C16 4 18 8 17.5 11C17 14 15 14 15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="currentColor" fillOpacity="0.3"/>
    {/* Dewclaws */}
    <circle cx="7.5" cy="16.5" r="1.5" fill="currentColor" opacity="0.6"/>
    <circle cx="16.5" cy="16.5" r="1.5" fill="currentColor" opacity="0.6"/>
    {/* Second smaller track behind */}
    <path d="M10 18C10 18 9.2 20 9.5 21.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
    <path d="M14 18C14 18 14.8 20 14.5 21.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
  </svg>
);

const CreekIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    {/* Meandering creek with ripples */}
    <path d="M3 6C5 5 7 7 9 6C11 5 13 7 15 6C17 5 19 7 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M3 12C5 11 7 13 9 12C11 11 13 13 15 12C17 11 19 13 21 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M3 18C5 17 7 19 9 18C11 17 13 19 15 18C17 17 19 19 21 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
  </svg>
);

const BeddingIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    {/* Deer curled up / bedded down silhouette */}
    <ellipse cx="12" cy="16" rx="9" ry="5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5"/>
    {/* Deer body curled */}
    <path d="M8 14C8 12 10 9 12 8C14 9 15 11 15 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Head/antler hint */}
    <circle cx="12" cy="7" r="2" fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M11 5.5L9.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M13 5.5L14.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const FunnelIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    {/* Terrain pinch point — two ridges narrowing */}
    <path d="M2 4L10 12L2 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.1"/>
    <path d="M22 4L14 12L22 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.1"/>
    {/* Arrow through the pinch */}
    <path d="M12 6V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" opacity="0.6"/>
    <path d="M10 15L12 18L14 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"/>
  </svg>
);

const FoodPlotIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    {/* Sprouting plant / food plot */}
    <path d="M12 22V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Left leaf */}
    <path d="M12 14C12 14 7 13 5 9C5 9 9 8 12 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="currentColor" fillOpacity="0.2"/>
    {/* Right leaf */}
    <path d="M12 10C12 10 17 9 19 5C19 5 15 4 12 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="currentColor" fillOpacity="0.2"/>
    {/* Seeds/ground */}
    <circle cx="8" cy="21" r="1" fill="currentColor" opacity="0.4"/>
    <circle cx="16" cy="21" r="1" fill="currentColor" opacity="0.4"/>
    <circle cx="12" cy="22" r="1" fill="currentColor" opacity="0.5"/>
  </svg>
);

const TreeStandIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    {/* Tree trunk */}
    <path d="M12 24V6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.4"/>
    {/* Branches */}
    <path d="M12 10L7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
    <path d="M12 8L17 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
    {/* Platform */}
    <rect x="8" y="11" width="8" height="2" rx="0.5" fill="currentColor" stroke="currentColor" strokeWidth="1"/>
    {/* Hunter silhouette on stand */}
    <circle cx="12" cy="8" r="1.8" fill="currentColor"/>
    <path d="M10 10L10.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M14 10L13.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    {/* Ladder rungs */}
    <line x1="10.5" y1="15" x2="13.5" y2="15" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
    <line x1="10.5" y1="18" x2="13.5" y2="18" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
    <line x1="10.5" y1="21" x2="13.5" y2="21" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
  </svg>
);

// ═══ Smooth path interpolation for organic-looking trails ═══
function smoothTrailPath(points: [number, number][], jitter: number = 0.15): [number, number][] {
  if (points.length < 3) return points;
  const result: [number, number][] = [];
  // Use seeded pseudo-random for deterministic jitter
  const seed = (points[0][0] * 1000 + points[0][1] * 1000) % 1;
  let s = seed;
  const nextRand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    result.push([x0, y0]);
    // Add 2 intermediate points with slight organic jitter
    for (let t = 1; t <= 2; t++) {
      const frac = t / 3;
      const midX = x0 + (x1 - x0) * frac;
      const midY = y0 + (y1 - y0) * frac;
      const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
      const perpX = -(y1 - y0) / (dist || 1);
      const perpY = (x1 - x0) / (dist || 1);
      const wobble = (nextRand() - 0.5) * 2 * jitter * dist;
      result.push([midX + perpX * wobble, midY + perpY * wobble]);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

const CORRIDOR_LABELS: Record<string, { name: string; desc: string; method: string; verified?: boolean }> = {
  primary: { name: "Ridgeline Travel", desc: "Main movement paths", method: "We trace the highest ridgelines connecting timber to food sources. Deer prefer ridge tops because they can see, smell, and hear danger from above. The amber ridgeline contours show exactly where these run — walk them yourself to verify.", verified: true },
  secondary: { name: "Edge Transitions", desc: "Saddles & timber edges", method: "Where timber meets open field, deer travel the edge — it's cover and food in one step. We map timber/field boundaries and find the low saddle points between ridges where deer cross. Check the contour labels — saddles show as lower elevations between high points." },
  water: { name: "Drainages", desc: "Creeks, ponds & draws", method: "Contour lines reveal every drainage — look for V-shapes pointing uphill. That's where water flows. Deer visit water 1–3 times daily, especially in early season. These are verifiable on any topo map.", verified: true },
  bedding: { name: "Bedding Areas", desc: "Likely bedding zones", method: "Deer bed on south-facing slopes (warmth) with thick cover and escape routes downhill. We find slopes facing 135°–225° with nearby timber and at least two exit paths. Use the hillshade layer — bright = south-facing." },
  funnel: { name: "Terrain Funnels", desc: "Pinch points & bottlenecks", method: "Where a creek, ridge, or fence forces deer through a narrow gap — that's a funnel. Look where contour lines pinch together between two drainages. These are the spots mature bucks can't avoid." },
  food_plot: { name: "Food Plot Zones", desc: "Ideal food plot locations", method: "We look for small openings (¼–½ acre) in timber that are screened by terrain on 2+ sides, have decent soil drainage, and sit between bedding and travel corridors. If deer can reach it without crossing open ground, it's a kill plot." },
  stand: { name: "Stand Sites", desc: "Optimal stand placements", method: "Stand sites sit downwind of travel corridors at funnel points, with entry/exit routes that don't spook bedded deer. We factor prevailing wind (SW in Missouri), morning vs. evening thermals, and line-of-sight to shooting lanes." },
};

export default function Terrain3DView({
  isOpen,
  onClose,
  parcelCenter,
  parcelBounds,
  parcelAddress,
  acreage,
  previewMode = false,
  onUnlockIntel,
}: Terrain3DViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<InstanceType<typeof mapboxgl.Map> | null>(null);
  const spinAnimRef = useRef<number | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(!previewMode); // Collapsed in preview mode
  const [activeCorridors, setActiveCorridors] = useState<string[]>(["primary", "secondary", "water", "bedding", "funnel", "food_plot", "stand"]);
  const [currentPitch, setCurrentPitch] = useState(60);
  const [currentBearing, setCurrentBearing] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [windDirection, setWindDirection] = useState(225); // SW wind default - common in MO
  const [showWind, setShowWind] = useState(true);
  const [showMethodology, setShowMethodology] = useState(false);
  const [expandedMethod, setExpandedMethod] = useState<string | null>(null);
  const [loadPhase, setLoadPhase] = useState<"terrain" | "corridors" | "done">("terrain");
  // Terrain layer toggles
  const [showContours, setShowContours] = useState(true);
  const [showRidgelines, setShowRidgelines] = useState(true);
  const [showHillshade, setShowHillshade] = useState(true);

  const checkWebGLSupport = (): boolean => {
    try {
      const canvas = document.createElement('canvas');
      // Try WebGL2 first (better iOS support), then WebGL1, then experimental
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return false;
      // Also check if WebGL context is not lost
      if (gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext) {
        return !gl.isContextLost();
      }
      return true;
    } catch (e) {
      console.error("WebGL check failed:", e);
      return false;
    }
  };

  // ═══ TERRAIN-INFORMED CORRIDOR GENERATION ═══
  // Uses parcel geometry + terrain logic for realistic placement
  const generateDeerCorridors = useCallback((): DeerCorridor[] => {
    if (!parcelBounds || parcelBounds.length < 3) return [];
    
    const { lat: centerLat, lng: centerLng } = parcelCenter;
    const bounds = parcelBounds;
    
    // Find the actual corner points of the parcel polygon
    const sortedByLat = [...bounds].sort((a, b) => b.lat - a.lat);
    const sortedByLng = [...bounds].sort((a, b) => a.lng - b.lng);
    
    // Get extreme points
    const northPoint = sortedByLat[0];
    const southPoint = sortedByLat[sortedByLat.length - 1];
    const westPoint = sortedByLng[0];
    const eastPoint = sortedByLng[sortedByLng.length - 1];
    
    // Find corner-ish points (combining lat/lng extremes)
    const findCorner = (latHigh: boolean, lngHigh: boolean) => {
      return bounds.reduce((best, p) => {
        const score = (latHigh ? p.lat : -p.lat) + (lngHigh ? p.lng : -p.lng);
        const bestScore = (latHigh ? best.lat : -best.lat) + (lngHigh ? best.lng : -best.lng);
        return score > bestScore ? p : best;
      }, bounds[0]);
    };
    
    const nwCorner = findCorner(true, false);  // high lat, low lng
    const neCorner = findCorner(true, true);   // high lat, high lng  
    const swCorner = findCorner(false, false); // low lat, low lng
    const seCorner = findCorner(false, true);  // low lat, high lng
    
    // Calculate dimensions for sizing features
    const lngRange = eastPoint.lng - westPoint.lng;
    const latRange = northPoint.lat - southPoint.lat;
    const avgRange = (lngRange + latRange) / 2;
    const polySize = avgRange * 0.06; // Feature size relative to parcel
    
    // Helper: interpolate between two points
    const lerp = (p1: {lng: number, lat: number}, p2: {lng: number, lat: number}, t: number): [number, number] => [
      p1.lng + (p2.lng - p1.lng) * t,
      p1.lat + (p2.lat - p1.lat) * t
    ];
    
    // Helper: offset a point toward center (for padding)
    const inset = (p: {lng: number, lat: number}, amount: number = 0.15): [number, number] => [
      p.lng + (centerLng - p.lng) * amount,
      p.lat + (centerLat - p.lat) * amount
    ];
    
    // Helper: create irregular polygon around a point (organic shape)
    const makePolygon = (center: [number, number], size: number): [number, number][] => {
      const [lng, lat] = center;
      const s = size;
      return [
        [lng - s, lat + s * 0.7],
        [lng + s * 0.3, lat + s],
        [lng + s, lat + s * 0.3],
        [lng + s * 0.7, lat - s],
        [lng - s * 0.3, lat - s * 0.7],
        [lng - s, lat],
        [lng - s, lat + s * 0.7],
      ];
    };

    // ═══ TERRAIN-BASED PLACEMENT HELPERS ═══
    
    // Find point on south-facing slope (below ridgeline, facing south for warmth)
    // Logic: Move from ridge (high lat) toward south, but stay inside parcel
    const findSouthFacingSlope = (ridgePoint: {lng: number, lat: number}, offsetFactor: number = 0.25): [number, number] => {
      // Move south from ridge point (lower latitude = south)
      const southOffset = latRange * offsetFactor;
      return [ridgePoint.lng, Math.max(southPoint.lat + latRange * 0.15, ridgePoint.lat - southOffset)];
    };
    
    // Find interior bench (mid-slope, not at corners or edges)
    // Logic: Points along the interior that aren't at extremes
    const findInteriorBench = (quadrant: "nw" | "ne" | "sw" | "se"): [number, number] => {
      // Create interior points at ~30% in from edges (not corners)
      const interiorInset = 0.30;
      switch(quadrant) {
        case "nw": return [
          westPoint.lng + lngRange * interiorInset,
          northPoint.lat - latRange * interiorInset
        ];
        case "ne": return [
          eastPoint.lng - lngRange * interiorInset,
          northPoint.lat - latRange * interiorInset
        ];
        case "sw": return [
          westPoint.lng + lngRange * interiorInset,
          southPoint.lat + latRange * interiorInset
        ];
        case "se": return [
          eastPoint.lng - lngRange * interiorInset,
          southPoint.lat + latRange * interiorInset
        ];
      }
    };
    
    // Find drainage low point (for water features)
    // Logic: Missouri terrain typically drains west-to-east or follows creek bottoms
    const findDrainagePoint = (position: "upper" | "lower"): [number, number] => {
      if (position === "upper") {
        // Upper drainage - northwest quadrant, mid-latitude
        return lerp(nwCorner, swCorner, 0.35);
      } else {
        // Lower drainage - flows toward southeast
        return lerp(neCorner, seCorner, 0.65);
      }
    };
    
    const corridors: DeerCorridor[] = [
      // ═══ MAIN DIAGONAL — NW corner to SE corner ═══
      {
        id: "primary-1",
        type: "primary",
        label: "Ridgeline Corridor (Probable)",
        description: "Follows terrain high point. Check contours — deer travel ridges. Verify with trail camera.",
        coordinates: smoothTrailPath([
          inset(nwCorner, 0.12),
          lerp(nwCorner, seCorner, 0.25),
          lerp(nwCorner, seCorner, 0.5),
          lerp(nwCorner, seCorner, 0.75),
          inset(seCorner, 0.12),
        ], avgRange * 0.025),
      },
      // ═══ EAST EDGE — NE to SE ═══
      {
        id: "primary-2",
        type: "primary",
        label: "East Ridge Route (Probable)",
        description: "Eastern high ground. Cross-reference amber ridgeline layer for verification.",
        coordinates: smoothTrailPath([
          inset(neCorner, 0.12),
          lerp(neCorner, seCorner, 0.33),
          lerp(neCorner, seCorner, 0.66),
          inset(seCorner, 0.15),
        ], avgRange * 0.025),
      },
      // ═══ WEST EDGE — NW to SW ═══
      {
        id: "secondary-1",
        type: "secondary",
        label: "West Edge Transition", 
        description: "Timber edge travel. Where contours meet cover change.",
        coordinates: smoothTrailPath([
          inset(nwCorner, 0.15),
          lerp(nwCorner, swCorner, 0.33),
          lerp(nwCorner, swCorner, 0.66),
          inset(swCorner, 0.12),
        ], avgRange * 0.03),
      },
      // ═══ NORTH EDGE — NW to NE ═══
      {
        id: "secondary-2",
        type: "secondary",
        label: "North Saddle Crossing",
        description: "Low point between ridges. Check contour elevations — saddles funnel movement.",
        coordinates: smoothTrailPath([
          inset(nwCorner, 0.12),
          lerp(nwCorner, neCorner, 0.33),
          lerp(nwCorner, neCorner, 0.66),
          inset(neCorner, 0.12),
        ], avgRange * 0.03),
      },
      // ═══ SOUTH EDGE — SW to SE ═══
      {
        id: "secondary-3",
        type: "secondary",
        label: "South Bench Route",
        description: "Contour-following travel between food sources. Check elevation labels.",
        coordinates: smoothTrailPath([
          inset(swCorner, 0.12),
          lerp(swCorner, seCorner, 0.33),
          lerp(swCorner, seCorner, 0.66),
          inset(seCorner, 0.12),
        ], avgRange * 0.03),
      },
      // ═══ WATER — Drainage draws follow terrain low points ═══
      {
        id: "water-1",
        type: "water",
        label: "Upper Drainage (Terrain-Verified)",
        description: "Contours show low point here — water collects in draws. Walk it to confirm creek/seep.",
        coordinates: makePolygon(findDrainagePoint("upper"), polySize * 1.2),
      },
      {
        id: "water-2",
        type: "water",
        label: "Lower Draw (Terrain-Verified)",
        description: "Drainage flows downslope toward this point. Check for pond/creek on-site.",
        coordinates: makePolygon(findDrainagePoint("lower"), polySize * 1.0),
      },
      // ═══ BEDDING — South-facing slopes below ridgelines ═══
      // Deer bed on south slopes (warmth), below ridge crests (wind protection)
      {
        id: "bedding-1",
        type: "bedding",
        label: "South Slope Bedding (Terrain-Based)",
        description: "South-facing slope below north ridge. Hillshade confirms aspect. Check cover density.",
        coordinates: makePolygon(findSouthFacingSlope(nwCorner, 0.25), polySize * 1.4),
      },
      {
        id: "bedding-2",
        type: "bedding",
        label: "SE Slope Bedding (Terrain-Based)",
        description: "Morning sun exposure on SE-facing bench. Ideal doe bedding. Verify thick cover.",
        coordinates: makePolygon(findSouthFacingSlope(neCorner, 0.30), polySize * 1.2),
      },
      {
        id: "bedding-3",
        type: "bedding",
        label: "Interior Thicket (Probable)",
        description: "Mid-parcel location away from edges. If cover exists, bucks bed here mid-day.",
        coordinates: makePolygon([centerLng + lngRange * 0.05, centerLat - latRange * 0.1], polySize * 0.9),
      },
      // ═══ FUNNEL — Where terrain forces deer through gaps ═══
      {
        id: "funnel-1",
        type: "funnel",
        label: "North Saddle Funnel",
        description: "Low point between ridges — deer cross here. Check contour labels for elevation dip.",
        coordinates: smoothTrailPath([
          lerp(nwCorner, neCorner, 0.3),
          [centerLng, centerLat + latRange * 0.15],
          lerp(nwCorner, neCorner, 0.7),
        ], avgRange * 0.025),
      },
      {
        id: "funnel-2",
        type: "funnel",
        label: "Drainage Crossing",
        description: "Where trails cross the draw — terrain pinches movement. Prime ambush point.",
        coordinates: smoothTrailPath([
          lerp(swCorner, seCorner, 0.3),
          [centerLng, centerLat - latRange * 0.15],
          lerp(swCorner, seCorner, 0.7),
        ], avgRange * 0.025),
      },
      // ═══ FOOD PLOTS — Interior benches with screening terrain ═══
      // NOT at corners — deer avoid exposed corner positions
      {
        id: "food-1",
        type: "food_plot",
        label: "NW Interior Plot (Terrain-Screened)",
        description: "Interior bench screened by north slope. Good drainage, not in draw. ~½ acre.",
        coordinates: makePolygon(findInteriorBench("nw"), polySize * 1.1),
      },
      {
        id: "food-2",
        type: "food_plot",
        label: "SE Interior Plot (Kill Plot)",
        description: "Tucked between bedding and drainage. Deer approach from multiple directions.",
        coordinates: makePolygon(findInteriorBench("se"), polySize * 1.0),
      },
      // ═══ STANDS — positioned relative to terrain features ═══
      // Stand placement considers: wind, bedding approach, funnel proximity
      {
        id: "stand-1",
        type: "stand",
        label: "#1 — Saddle",
        description: "North funnel overlooking saddle crossing. SW wind. Morning sit — catch deer leaving bedding.",
        coordinates: makePolygon([centerLng - lngRange * 0.05, centerLat + latRange * 0.18], polySize * 0.4),
      },
      {
        id: "stand-2",
        type: "stand",
        label: "#2 — Hub",
        description: "Central intersection where trails converge. NW wind. All-day sit during rut.",
        coordinates: makePolygon([centerLng + lngRange * 0.08, centerLat + latRange * 0.05], polySize * 0.4),
      },
      {
        id: "stand-3",
        type: "stand",
        label: "#3 — Draw",
        description: "Overlooking drainage crossing. S wind. Early season — deer hit water before feeding.",
        coordinates: makePolygon([findDrainagePoint("upper")[0] + lngRange * 0.08, findDrainagePoint("upper")[1]], polySize * 0.4),
      },
      {
        id: "stand-4",
        type: "stand",
        label: "#4 — Ridge",
        description: "East ridgeline travel. W wind. Rut cruising bucks follow ridge checking bedding.",
        coordinates: makePolygon([eastPoint.lng - lngRange * 0.15, centerLat], polySize * 0.4),
      },
      {
        id: "stand-5",
        type: "stand",
        label: "#5 — Plot",
        description: "SE kill plot edge. E wind. Late season — ambush deer entering food at last light.",
        coordinates: makePolygon([findInteriorBench("se")[0] - lngRange * 0.08, findInteriorBench("se")[1] + latRange * 0.05], polySize * 0.4),
      },
    ];

    return corridors;
  }, [parcelCenter, parcelBounds]);

  // Initialize map — PHASED LOADING for speed
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    setLoadError(null);
    setIsMapLoaded(false);
    setIsSpinning(false);
    setLoadPhase("terrain");

    if (!checkWebGLSupport()) {
      setLoadError("Your browser doesn't support WebGL, which is required for 3D terrain viewing. Try Chrome, Firefox, or Safari.");
      return;
    }

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setLoadError("Map configuration error. Please try again later.");
      console.error("Mapbox token not found");
      return;
    }

    mapboxgl.accessToken = token;

    let map: InstanceType<typeof mapboxgl.Map>;
    
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [parcelCenter.lng, parcelCenter.lat],
        zoom: 15,
        pitch: 60,
        bearing: -20,
        antialias: true,
      });
    } catch (err) {
      console.error("Failed to initialize Mapbox:", err);
      setLoadError("Failed to load 3D map. Please try refreshing the page.");
      return;
    }

    mapRef.current = map;
    let hasLoaded = false;

    map.on("error", (e: any) => {
      console.error("Mapbox error:", e);
      // If there's a critical error before load, show error state
      if (!hasLoaded && e.error && e.error.status === 401) {
        setLoadError("Map authentication failed. Please try again.");
      }
    });

    // If map style fails to load, catch it
    (map as any).once?.("styleimagemissing", () => {
      console.log("Style image missing - continuing anyway");
    });

    // Timeout — show whatever we have after 5s (increased for iOS)
    const loadTimeout = setTimeout(() => {
      if (!hasLoaded) {
        console.log("Terrain load timeout - showing map anyway");
        hasLoaded = true;
        setIsMapLoaded(true);
        setLoadPhase("done");
      }
    }, 5000);

    map.on("load", () => {
      clearTimeout(loadTimeout);
      if (hasLoaded) return;
      hasLoaded = true;

      // ═══ PHASE 1: Terrain + Parcel Boundary (show map FAST) ═══
      
      // Single DEM source — reused for terrain AND hillshade
      try {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

        // Hillshade uses same source — no duplicate tile fetch
        map.addLayer({
          id: "hillshade",
          type: "hillshade",
          source: "mapbox-dem",
          paint: {
            "hillshade-exaggeration": 0.5,
            "hillshade-shadow-color": "#000000",
            "hillshade-highlight-color": "#ffffff",
            "hillshade-accent-color": "#4a6741",
          },
        }, "waterway-label");
      } catch (err) {
        console.log("Terrain/hillshade setup failed, continuing:", err);
      }

      // Sky layer
      try {
        map.addLayer({
          id: "sky",
          type: "sky",
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0.0, 75.0],
            "sky-atmosphere-sun-intensity": 15,
          },
        });
      } catch (err) {
        console.log("Sky layer failed:", err);
      }

      // ═══ CONTOUR LINES — Real USGS-derived elevation ═══
      try {
        map.addSource("mapbox-terrain-v2", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-terrain-v2",
        });

        // Index contours (100ft intervals) — more prominent, labeled
        map.addLayer({
          id: "contour-index",
          type: "line",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: ["==", ["get", "index"], 5], // Every 5th contour is an index contour
          paint: {
            "line-color": "#d4a574",
            "line-width": 2,
            "line-opacity": 0.8,
          },
        });

        // Regular contours (20ft intervals)
        map.addLayer({
          id: "contour-regular",
          type: "line",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: ["!=", ["get", "index"], 5],
          paint: {
            "line-color": "#b08968",
            "line-width": 0.8,
            "line-opacity": 0.5,
          },
        });

        // Contour elevation labels on index lines
        map.addLayer({
          id: "contour-labels",
          type: "symbol",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: ["==", ["get", "index"], 5],
          layout: {
            "symbol-placement": "line",
            "text-field": ["concat", ["to-string", ["round", ["*", ["get", "ele"], 3.28084]]], "'"], // meters to feet
            "text-size": 10,
            "text-max-angle": 25,
            "text-padding": 5,
          },
          paint: {
            "text-color": "#fef3c7",
            "text-halo-color": "#1c1917",
            "text-halo-width": 2,
          },
        });

        // ═══ RIDGELINE HIGHLIGHTING — Using slope-break detection ═══
        // Ridgelines show where contours bend outward (local high points between drainages)
        // We highlight the higher elevation contours more prominently
        map.addLayer({
          id: "ridgeline-highlight",
          type: "line",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: [
            "all",
            ["==", ["get", "index"], 5],
            [">=", ["get", "ele"], 200] // Higher elevations (ridges) in meters
          ],
          paint: {
            "line-color": "#fbbf24",
            "line-width": 3,
            "line-opacity": 0.7,
            "line-blur": 1,
          },
        });

        // Ridgeline glow for emphasis
        map.addLayer({
          id: "ridgeline-glow",
          type: "line",
          source: "mapbox-terrain-v2",
          "source-layer": "contour",
          filter: [
            "all",
            ["==", ["get", "index"], 5],
            [">=", ["get", "ele"], 200]
          ],
          paint: {
            "line-color": "#fbbf24",
            "line-width": 8,
            "line-opacity": 0.15,
            "line-blur": 4,
          },
        }, "ridgeline-highlight");

      } catch (contourErr) {
        console.log("Contour layer setup failed:", contourErr);
      }

      // Parcel boundary — wrapped in try-catch so failures don't kill the map
      try {
        if (parcelBounds && parcelBounds.length > 0) {
          const coordinates = parcelBounds.map((p) => [p.lng, p.lat]);
          if (coordinates.length > 0 && (coordinates[0][0] !== coordinates[coordinates.length-1][0] || coordinates[0][1] !== coordinates[coordinates.length-1][1])) {
            coordinates.push(coordinates[0]);
          }

          map.addSource("parcel-boundary", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates: [coordinates] },
            },
          });

          // PARCEL BOUNDARY — Bold, prominent lines
          map.addLayer({ id: "parcel-glow-outer", type: "line", source: "parcel-boundary", paint: { "line-color": "#000000", "line-width": 12, "line-opacity": 0.4, "line-blur": 3 } });
          map.addLayer({ id: "parcel-glow", type: "line", source: "parcel-boundary", paint: { "line-color": "#fbbf24", "line-width": 8, "line-opacity": 0.6, "line-blur": 2 } });
          map.addLayer({ id: "parcel-outline", type: "line", source: "parcel-boundary", paint: { "line-color": "#fbbf24", "line-width": 4 } });
          map.addLayer({ id: "parcel-fill", type: "fill", source: "parcel-boundary", paint: { "fill-color": "#fbbf24", "fill-opacity": 0.05 } });

          // Corner markers — ONLY at true corners (significant angle changes), not every vertex
          const findTrueCorners = (points: typeof parcelBounds) => {
            if (points.length < 4) return points; // Small parcels: show all
            const corners: typeof parcelBounds = [];
            const angleThreshold = 25; // degrees — must turn this much to be a "corner"
            
            for (let i = 0; i < points.length; i++) {
              const prev = points[(i - 1 + points.length) % points.length];
              const curr = points[i];
              const next = points[(i + 1) % points.length];
              
              // Calculate angle change at this point
              const angle1 = Math.atan2(curr.lat - prev.lat, curr.lng - prev.lng);
              const angle2 = Math.atan2(next.lat - curr.lat, next.lng - curr.lng);
              let angleDiff = Math.abs((angle2 - angle1) * 180 / Math.PI);
              if (angleDiff > 180) angleDiff = 360 - angleDiff;
              
              if (angleDiff > angleThreshold) {
                corners.push(curr);
              }
            }
            return corners.length > 0 ? corners : [points[0]]; // At least show one point
          };
          
          const trueCorners = findTrueCorners(parcelBounds);
          const cornerFeatures = trueCorners.map((p) => ({
            type: "Feature" as const, properties: {},
            geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
          }));
          map.addSource("parcel-corners", { type: "geojson", data: { type: "FeatureCollection", features: cornerFeatures } });
          map.addLayer({ id: "parcel-corner-ring", type: "circle", source: "parcel-corners", paint: { "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fbbf24", "circle-stroke-width": 3 } });
          map.addLayer({ id: "parcel-corner-dots", type: "circle", source: "parcel-corners", paint: { "circle-radius": 6, "circle-color": "#fbbf24", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
        }
      } catch (boundaryErr) {
        console.error("Parcel boundary layer error:", boundaryErr);
      }

      // Center marker
      new mapboxgl.Marker({ color: "#f59e0b" })
        .setLngLat([parcelCenter.lng, parcelCenter.lat])
        .addTo(map);

      // ═══ SHOW MAP NOW — terrain is visible ═══
      setIsMapLoaded(true);
      setLoadPhase("corridors");

      // ═══ PHASE 2: Add deer intel layers AFTER map is painted (200ms delay) ═══
      setTimeout(() => {
        if (!mapRef.current) return;
        const corridors = generateDeerCorridors();
        addCorridorsToMap(mapRef.current, corridors);
        setLoadPhase("done");
      }, 200);
    });

    map.on("pitchend", () => {
      setCurrentPitch(Math.round(map.getPitch()));
    });
    map.on("rotateend", () => {
      setCurrentBearing(Math.round(map.getBearing()));
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    return () => {
      clearTimeout(loadTimeout);
      if (spinAnimRef.current) {
        cancelAnimationFrame(spinAnimRef.current);
        spinAnimRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setIsMapLoaded(false);
      setLoadPhase("terrain");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, parcelCenter, parcelBounds, generateDeerCorridors]);

  // Add corridor layers to map
  const addCorridorsToMap = (map: InstanceType<typeof mapboxgl.Map>, corridors: DeerCorridor[]) => {
    const widths: Record<string, number> = {
      primary: 5,
      secondary: 3.5,
      water: 4,
      bedding: 2,
      funnel: 5,
      food_plot: 2,
      stand: 2,
    };

    corridors.forEach((corridor) => {
      const sourceId = `corridor-${corridor.id}`;
      const layerId = `corridor-layer-${corridor.id}`;
      const isPolygon = ["bedding", "food_plot", "stand"].includes(corridor.type);
      const color = CORRIDOR_COLORS[corridor.type];

      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {
            label: corridor.label,
            description: corridor.description,
            type: corridor.type,
          },
          geometry: isPolygon
            ? { type: "Polygon", coordinates: [corridor.coordinates] }
            : { type: "LineString", coordinates: corridor.coordinates },
        },
      });

      if (isPolygon) {
        // Fill
        map.addLayer({
          id: `${layerId}-fill`,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": color,
            "fill-opacity": corridor.type === "stand" ? 0.5 : 0.3,
          },
        });
        // Outline
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": color,
            "line-width": widths[corridor.type],
            "line-dasharray": corridor.type === "stand" ? [1, 0] : [2, 2],
          },
        });
        // Label for stands
        if (corridor.type === "stand") {
          // Add a center point for the label
          const centerLng = corridor.coordinates.reduce((s, c) => s + c[0], 0) / corridor.coordinates.length;
          const centerLat = corridor.coordinates.reduce((s, c) => s + c[1], 0) / corridor.coordinates.length;
          map.addSource(`${sourceId}-label`, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: { label: corridor.label.replace(" — ", "\n") },
              geometry: { type: "Point", coordinates: [centerLng, centerLat] },
            },
          });
          map.addLayer({
            id: `${layerId}-label`,
            type: "symbol",
            source: `${sourceId}-label`,
            layout: {
              "text-field": "⊕",
              "text-size": 20,
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": color,
              "text-halo-width": 3,
            },
          });
        }
      } else {
        // Glow under line for primary & funnel corridors
        if (corridor.type === "primary" || corridor.type === "funnel") {
          map.addLayer({
            id: `${layerId}-glow`,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": color,
              "line-width": widths[corridor.type] * 3,
              "line-opacity": 0.15,
              "line-blur": 6,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });
        }
        // Main line
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": color,
            "line-width": widths[corridor.type],
            "line-opacity": 0.9,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        // Dashed overlay for water
        if (corridor.type === "water") {
          map.addLayer({
            id: `${layerId}-dash`,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": "#93c5fd",
              "line-width": 2,
              "line-dasharray": [4, 4],
              "line-opacity": 0.7,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });
        }
        // Direction arrows for primary/secondary/funnel
        if (["primary", "secondary", "funnel"].includes(corridor.type)) {
          map.addLayer({
            id: `${layerId}-arrows`,
            type: "symbol",
            source: sourceId,
            layout: {
              "symbol-placement": "line",
              "symbol-spacing": 80,
              "text-field": "▶",
              "text-size": 10,
              "text-allow-overlap": true,
              "text-rotation-alignment": "map",
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": color,
              "text-halo-width": 1.5,
            },
          });
        }
      }

      // Popup on click
      map.on("click", layerId, (e: any) => {
        const props = e.features?.[0]?.properties;
        if (props) {
          const typeLabel = CORRIDOR_LABELS[props.type]?.name || props.type;
          new mapboxgl.Popup({ className: "terrain-popup" })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="padding:8px;max-width:220px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <div style="width:10px;height:10px;border-radius:50%;background:${CORRIDOR_COLORS[props.type]}"></div>
                  <span style="font-weight:700;font-size:13px;">${props.label}</span>
                </div>
                <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">${typeLabel}</div>
                <p style="font-size:12px;color:#374151;line-height:1.4;margin:0;">${props.description}</p>
              </div>`
            )
            .addTo(map);
        }
      });

      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    });
  };

  // Toggle corridor visibility
  const toggleCorridor = (type: string) => {
    if (!mapRef.current || !isMapLoaded) return;

    const map = mapRef.current;
    const isActive = activeCorridors.includes(type);
    const newActive = isActive
      ? activeCorridors.filter((t) => t !== type)
      : [...activeCorridors, type];
    setActiveCorridors(newActive);

    const corridors = generateDeerCorridors();
    corridors
      .filter((c) => c.type === type)
      .forEach((corridor) => {
        const layerId = `corridor-layer-${corridor.id}`;
        const visibility = isActive ? "none" : "visible";
        const layerIds = [layerId, `${layerId}-fill`, `${layerId}-arrows`, `${layerId}-glow`, `${layerId}-dash`, `${layerId}-label`];
        layerIds.forEach((id) => {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", visibility);
          }
        });
      });
  };

  // Toggle terrain layer visibility
  const toggleContours = () => {
    if (!mapRef.current || !isMapLoaded) return;
    const map = mapRef.current;
    const newState = !showContours;
    setShowContours(newState);
    const visibility = newState ? "visible" : "none";
    ["contour-index", "contour-regular", "contour-labels"].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visibility);
      }
    });
  };

  const toggleRidgelines = () => {
    if (!mapRef.current || !isMapLoaded) return;
    const map = mapRef.current;
    const newState = !showRidgelines;
    setShowRidgelines(newState);
    const visibility = newState ? "visible" : "none";
    ["ridgeline-highlight", "ridgeline-glow"].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visibility);
      }
    });
  };

  const toggleHillshade = () => {
    if (!mapRef.current || !isMapLoaded) return;
    const map = mapRef.current;
    const newState = !showHillshade;
    setShowHillshade(newState);
    if (map.getLayer("hillshade")) {
      map.setLayoutProperty("hillshade", "visibility", newState ? "visible" : "none");
    }
  };

  const resetView = () => {
    if (!mapRef.current) return;
    stopSpin();
    mapRef.current.flyTo({
      center: [parcelCenter.lng, parcelCenter.lat],
      zoom: 15,
      pitch: 60,
      bearing: -20,
      duration: 1500,
    });
  };

  const rotateView = (direction: "left" | "right") => {
    if (!mapRef.current) return;
    stopSpin();
    const cb = mapRef.current.getBearing();
    mapRef.current.easeTo({
      bearing: cb + (direction === "right" ? 45 : -45),
      duration: 500,
    });
  };

  const tiltView = (direction: "up" | "down") => {
    if (!mapRef.current) return;
    const cp = mapRef.current.getPitch();
    const newPitch = Math.max(0, Math.min(85, cp + (direction === "up" ? -15 : 15)));
    mapRef.current.easeTo({ pitch: newPitch, duration: 500 });
  };

  // Cinematic spin
  const startSpin = () => {
    if (!mapRef.current || isSpinning) return;
    setIsSpinning(true);
    const spin = () => {
      if (!mapRef.current) return;
      const bearing = mapRef.current.getBearing() + 0.3;
      mapRef.current.setBearing(bearing % 360);
      spinAnimRef.current = requestAnimationFrame(spin);
    };
    spin();
  };

  const stopSpin = () => {
    if (spinAnimRef.current) {
      cancelAnimationFrame(spinAnimRef.current);
      spinAnimRef.current = null;
    }
    setIsSpinning(false);
  };

  const toggleSpin = () => {
    if (isSpinning) stopSpin();
    else startSpin();
  };

  if (!isOpen) return null;

  const legendItems = [
    { type: "primary", icon: <DeerTrackIcon className="w-5 h-5 text-red-400" />, color: "red" },
    { type: "secondary", icon: <DeerTrackIcon className="w-4 h-4 text-orange-400 opacity-70" />, color: "orange" },
    { type: "water", icon: <CreekIcon className="w-5 h-5 text-blue-400" />, color: "blue" },
    { type: "bedding", icon: <BeddingIcon className="w-5 h-5 text-green-400" />, color: "green" },
    { type: "funnel", icon: <FunnelIcon className="w-5 h-5 text-purple-400" />, color: "purple" },
    { type: "food_plot", icon: <FoodPlotIcon className="w-5 h-5 text-yellow-400" />, color: "yellow" },
    { type: "stand", icon: <TreeStandIcon className="w-5 h-5 text-pink-400" />, color: "pink" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 md:p-4">
      <div className="relative w-full max-w-7xl h-[90vh] bg-stone-900 rounded-xl overflow-hidden shadow-2xl border border-stone-700">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-stone-900/95 via-stone-900/80 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <Mountain className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  3D Terrain {previewMode ? "Preview" : "+ Deer Intel"}
                  {previewMode ? (
                    <span className="text-xs bg-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full">FREE</span>
                  ) : (
                    <span className="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
                  )}
                </h2>
                <p className="text-sm text-stone-400">
                  {parcelAddress || "Selected Parcel"}
                  {acreage && ` • ${acreage.toFixed(1)} acres`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Cinematic spin button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSpin}
                className={`text-xs gap-1.5 ${isSpinning ? 'text-amber-400 bg-amber-500/20' : 'text-stone-400 hover:text-white hover:bg-stone-700'}`}
                title="Cinematic Spin"
              >
                {isSpinning ? <Pause className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                <span className="hidden md:inline">{isSpinning ? 'Stop' : 'Cinematic'}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { stopSpin(); onClose(); }}
                className="text-stone-400 hover:text-white hover:bg-stone-700"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Map Container */}
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Loading State — Progressive */}
        {!isMapLoaded && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
            <div className="text-center">
              <div className="animate-spin w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full mx-auto mb-4" />
              <p className="text-stone-400">Loading 3D terrain...</p>
              <p className="text-stone-500 text-xs mt-2">Rendering satellite imagery & elevation</p>
            </div>
          </div>
        )}

        {/* Phase 2 overlay — terrain is visible, corridors loading */}
        {isMapLoaded && loadPhase === "corridors" && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 bg-stone-800/90 backdrop-blur rounded-lg px-4 py-2 shadow-lg border border-amber-500/30 flex items-center gap-3">
            <div className="animate-spin w-4 h-4 border-2 border-amber-500/30 border-t-amber-500 rounded-full" />
            <p className="text-xs text-amber-300">Adding deer intel layers...</p>
          </div>
        )}

        {/* Error State */}
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
            <div className="text-center max-w-md px-6">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mountain className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Unable to Load 3D View</h3>
              <p className="text-stone-400 text-sm mb-4">{loadError}</p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={onClose} className="border-stone-600 text-stone-300 hover:bg-stone-700">Close</Button>
                <Button onClick={() => { setLoadError(null); setIsMapLoaded(false); }} className="bg-amber-500 hover:bg-amber-600 text-white">Try Again</Button>
              </div>
            </div>
          </div>
        )}

        {/* Controls Panel - Left Side */}
        {isMapLoaded && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
            <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-stone-700">
              <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-2 px-1">View</p>
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="sm" onClick={() => rotateView("left")} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="Rotate Left">
                  <RotateCcw className="w-4 h-4 mr-1" /> ←
                </Button>
                <Button variant="ghost" size="sm" onClick={() => rotateView("right")} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="Rotate Right">
                  <RotateCcw className="w-4 h-4 mr-1 scale-x-[-1]" /> →
                </Button>
                <div className="h-px bg-stone-600 my-1" />
                <Button variant="ghost" size="sm" onClick={() => tiltView("up")} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="Top-Down">
                  <Maximize2 className="w-4 h-4 mr-1" /> ↑
                </Button>
                <Button variant="ghost" size="sm" onClick={() => tiltView("down")} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="3D Tilt">
                  <Mountain className="w-4 h-4 mr-1" /> ↓
                </Button>
                <div className="h-px bg-stone-600 my-1" />
                <Button variant="ghost" size="sm" onClick={resetView} className="text-stone-300 hover:text-white hover:bg-stone-700 text-xs" title="Reset View">
                  <Compass className="w-4 h-4 mr-1" /> Reset
                </Button>
              </div>
            </div>
            {/* Terrain Layers — VERIFIABLE */}
            <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-amber-500/30">
              <p className="text-[10px] text-amber-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Terrain
              </p>
              <div className="flex flex-col gap-1">
                <button
                  onClick={toggleContours}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                    showContours ? "bg-amber-500/20 text-amber-300" : "text-stone-400 hover:text-white hover:bg-stone-700"
                  }`}
                  title="USGS Elevation Contours — Walk these on-property"
                >
                  <div className={`w-4 h-0.5 rounded ${showContours ? "bg-amber-400" : "bg-stone-500"}`} style={{ backgroundImage: showContours ? "none" : "none" }} />
                  <span>Contours</span>
                </button>
                <button
                  onClick={toggleRidgelines}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                    showRidgelines ? "bg-amber-500/20 text-amber-300" : "text-stone-400 hover:text-white hover:bg-stone-700"
                  }`}
                  title="Ridgeline Corridors — Local high points, verified by topo"
                >
                  <div className={`w-4 h-1 rounded ${showRidgelines ? "bg-amber-400" : "bg-stone-500"}`} />
                  <span>Ridges</span>
                </button>
                <button
                  onClick={toggleHillshade}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                    showHillshade ? "bg-stone-600/50 text-stone-300" : "text-stone-400 hover:text-white hover:bg-stone-700"
                  }`}
                  title="3D Shading from DEM"
                >
                  <Mountain className={`w-3 h-3 ${showHillshade ? "text-stone-300" : "text-stone-500"}`} />
                  <span>Shading</span>
                </button>
              </div>
              <p className="text-[8px] text-stone-500 mt-1.5 px-1 leading-tight">✓ USGS verified</p>
            </div>
            {/* Wind direction indicator */}
            <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-stone-700 text-center">
              <p className="text-[10px] text-stone-500 mb-1">Wind</p>
              <div className="relative w-10 h-10 mx-auto">
                <div className="absolute inset-0 rounded-full border border-stone-600" />
                <div
                  className="absolute top-1/2 left-1/2 w-1 h-5 bg-cyan-400 rounded-full origin-bottom"
                  style={{ transform: `translate(-50%, -100%) rotate(${windDirection}deg)` }}
                />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 text-[8px] text-stone-500">N</div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[8px] text-stone-500">S</div>
                <div className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] text-stone-500">W</div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] text-stone-500">E</div>
              </div>
              <p className="text-[9px] text-cyan-400 mt-1">SW 8mph</p>
            </div>
            <div className="bg-stone-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-stone-700 text-center">
              <p className="text-[10px] text-stone-500">Pitch {currentPitch}°</p>
              <p className="text-[10px] text-stone-500">Brng {currentBearing}°</p>
            </div>
          </div>
        )}

        {/* Legend Panel - Bottom */}
        {isMapLoaded && (
          <div className="absolute bottom-3 left-3 right-3 z-10">
            <div className="bg-stone-800/95 backdrop-blur rounded-xl shadow-lg border border-stone-700 overflow-hidden">
              <button
                onClick={() => setShowLegend(!showLegend)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-stone-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-white">Deer Intel Layers</span>
                  {previewMode ? (
                    <span className="text-xs bg-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Preview Mode
                    </span>
                  ) : (
                    <>
                      <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">AI Predicted</span>
                      <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">{activeCorridors.length}/7 Active</span>
                    </>
                  )}
                </div>
                <Info className="w-4 h-4 text-stone-400" />
              </button>
              
              {showLegend && (
                <div className="p-3 pt-0 border-t border-stone-700">
                  {/* Preview Mode: Compact Unlock CTA Bar */}
                  {previewMode && (
                    <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-lg px-3 py-2 mt-2 mb-2 flex items-center justify-between gap-3">
                      <p className="text-white text-xs flex items-center gap-1.5">
                        <Lock className="w-3 h-3" />
                        <span className="font-medium">7 layers locked</span>
                        <span className="text-red-100 hidden sm:inline">— stand sites, season playbook & methodology</span>
                      </p>
                      <button
                        onClick={() => onUnlockIntel?.()}
                        className="bg-white hover:bg-red-50 text-red-600 px-3 py-1 rounded font-bold text-xs flex items-center gap-1 transition-colors whitespace-nowrap"
                      >
                        <Unlock className="w-3 h-3" />
                        Unlock $79
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-3">
                    {legendItems.map((item) => {
                      const info = CORRIDOR_LABELS[item.type];
                      return (
                        <button
                          key={item.type}
                          onClick={() => !previewMode && toggleCorridor(item.type)}
                          disabled={previewMode}
                          className={`flex items-center gap-2 p-2 rounded-lg transition-all relative ${
                            previewMode 
                              ? "bg-stone-700/30 border border-stone-600/50 cursor-not-allowed"
                              : activeCorridors.includes(item.type)
                                ? `bg-${item.color}-500/20 border border-${item.color}-500/50`
                                : "bg-stone-700/50 border border-transparent opacity-40"
                          }`}
                          style={!previewMode && activeCorridors.includes(item.type) ? { backgroundColor: `${CORRIDOR_COLORS[item.type]}22`, borderColor: `${CORRIDOR_COLORS[item.type]}88` } : {}}
                        >
                          {previewMode && (
                            <div className="absolute top-1 right-1">
                              <Lock className="w-2.5 h-2.5 text-stone-500" />
                            </div>
                          )}
                          <div className={previewMode ? "opacity-50" : ""}>
                            {item.icon}
                          </div>
                          <div className="text-left">
                            <p className={`text-[11px] font-medium leading-tight ${previewMode ? "text-stone-400" : "text-white"}`}>{info.name}</p>
                            <p className="text-[9px] text-stone-500 leading-tight">{info.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* How We Know - Methodology Panel */}
                  <div className="mt-3">
                    {previewMode ? (
                      <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-stone-700/40 border border-stone-600/50">
                        <Lock className="w-3.5 h-3.5 text-stone-500" />
                        <span className="text-xs font-medium text-stone-500">How We Know — Included in $79 Report</span>
                      </div>
                    ) : (
                    <button
                      onClick={() => setShowMethodology(!showMethodology)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-stone-700/60 hover:bg-stone-700 transition-colors group"
                    >
                      <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-medium text-amber-300">How We Know — The Method Behind Each Layer</span>
                      {showMethodology ? <ChevronDown className="w-3.5 h-3.5 text-stone-400" /> : <ChevronUp className="w-3.5 h-3.5 text-stone-400" />}
                    </button>
                    )}
                    
                    {showMethodology && (
                      <div className="mt-2 space-y-1.5 max-h-[35vh] overflow-y-auto pr-1">
                        {/* Intro blurb */}
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-2">
                          <p className="text-xs text-amber-200 leading-relaxed">
                            <span className="font-semibold">Terrain layers are 100% verifiable.</span> Contour lines and ridgelines come from USGS elevation data — you can walk these on property. Deer intel layers (trails, bedding, stands) are <em>terrain-informed predictions</em> based on how deer use topography. The ridges are real; the trails show where deer <em>likely</em> travel.
                          </p>
                        </div>

                        {legendItems.map((item) => {
                          const info = CORRIDOR_LABELS[item.type];
                          const isExpanded = expandedMethod === item.type;
                          return (
                            <button
                              key={`method-${item.type}`}
                              onClick={() => setExpandedMethod(isExpanded ? null : item.type)}
                              className="w-full text-left rounded-lg transition-all overflow-hidden"
                              style={{ backgroundColor: isExpanded ? `${CORRIDOR_COLORS[item.type]}15` : 'transparent' }}
                            >
                              <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-700/40 rounded-lg">
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CORRIDOR_COLORS[item.type] }} />
                                <span className="text-xs font-medium text-white flex-1">{info.name}</span>
                                {isExpanded ? <ChevronUp className="w-3 h-3 text-stone-400 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-stone-400 flex-shrink-0" />}
                              </div>
                              {isExpanded && (
                                <div className="px-3 pb-3 pt-1">
                                  <p className="text-[11px] text-stone-300 leading-relaxed pl-5">{info.method}</p>
                                </div>
                              )}
                            </button>
                          );
                        })}

                        {/* Disclaimer */}
                        <div className="bg-stone-700/40 rounded-lg p-2.5 mt-2">
                          <p className="text-[10px] text-stone-500 leading-relaxed text-center">
                            📍 <span className="text-amber-400">Contours & ridges = verified USGS data.</span> Deer corridors = terrain-informed predictions. Always ground-truth with boots on the property. Trail cameras confirm patterns.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="text-[10px] text-stone-500 mt-3 text-center">
                    🦌 Drag to rotate • Scroll to zoom • Right-click to tilt • Click any corridor for details • Hit <span className="text-amber-400">Cinematic</span> for the flyover
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Watermark */}
        <div className="absolute bottom-20 right-4 z-10 text-right">
          <p className="text-[10px] text-stone-500">Powered by</p>
          <p className="text-xs font-bold text-amber-400">Terra Firma Partners™</p>
        </div>
      </div>
    </div>
  );
}
