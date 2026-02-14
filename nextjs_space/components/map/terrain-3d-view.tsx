"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, RotateCcw, Compass, Mountain, Target, Info, ZoomIn, ZoomOut, Maximize2, Wind, Camera, Play, Pause, HelpCircle, ChevronDown, ChevronUp, Lock, Unlock } from "lucide-react";
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

const CORRIDOR_LABELS: Record<string, { name: string; desc: string; method: string }> = {
  primary: { name: "Primary Travel", desc: "Main movement paths", method: "We trace the highest ridgelines connecting timber to food sources. Deer prefer ridge tops because they can see, smell, and hear danger from above. Elevation data shows us where those ridges run on your property." },
  secondary: { name: "Secondary Routes", desc: "Edge transitions & saddles", method: "Where timber meets open field, deer travel the edge — it's cover and food in one step. We map every timber/field boundary and find the low saddle points between ridges where deer cross with minimal exposure." },
  water: { name: "Water Sources", desc: "Creeks, ponds & drainage", method: "Elevation data reveals every drainage, creek bottom, and low spot that holds water. Deer visit water 1–3 times daily, especially in early season. If there's a crease in the terrain, water collects there." },
  bedding: { name: "Bedding Areas", desc: "Likely bedding zones", method: "Deer bed on south-facing slopes (warmth) with thick cover and escape routes downhill. We find slopes facing 135°–225° with nearby timber and at least two exit paths. The steeper the better — they watch their backtrail from above." },
  funnel: { name: "Terrain Funnels", desc: "Pinch points & bottlenecks", method: "Where a creek, ridge, or fence forces deer through a narrow gap — that's a funnel. We measure the distance between terrain obstacles and flag any gap under 80 yards. These are the spots mature bucks can't avoid." },
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

  const checkWebGLSupport = (): boolean => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  };

  // ═══ TERRAIN-AWARE CORRIDOR GENERATION ═══
  // Uses parcel geometry to place water features realistically and routes corridors AROUND water
  const generateDeerCorridors = useCallback((): DeerCorridor[] => {
    const { lat, lng } = parcelCenter;
    const offset = acreage ? Math.sqrt(acreage / 640) * 0.01 : 0.005;
    
    // Seeded random for consistent but parcel-unique placement
    let seed = (Math.abs(lat * 10000) + Math.abs(lng * 10000)) % 1000;
    const seededRandom = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    
    // ═══ TERRAIN LOGIC ═══
    // Water flows downhill. In Missouri, creeks typically run SE/S direction.
    // We place water in the "low" quadrant and route corridors to avoid crossing it.
    
    // Determine water zone quadrant based on parcel coordinates (deterministic per-parcel)
    const waterQuadrant = seededRandom() > 0.5 ? 'SE' : 'SW'; // Creek typically runs through SE or SW
    const waterOffsetX = waterQuadrant === 'SE' ? 0.4 : -0.4;
    const waterOffsetY = -0.35; // Water is in the "southern" (lower) part
    
    // High ground (bedding) is OPPOSITE water
    const highGroundX = -waterOffsetX * 0.8;
    const highGroundY = 0.5; // Northern ridge
    
    // ═══ WATER FEATURES — placed in low terrain ═══
    // Creek runs along the low ground, NOT through travel corridors
    const creekStart: [number, number] = [lng + offset * (waterOffsetX - 0.6), lat + offset * (waterOffsetY + 0.4)];
    const creekEnd: [number, number] = [lng + offset * (waterOffsetX + 0.6), lat + offset * (waterOffsetY - 0.3)];
    
    // Pond sits in a low depression near creek
    const pondCenter: [number, number] = [lng + offset * waterOffsetX * 0.8, lat + offset * (waterOffsetY - 0.15)];
    
    // ═══ CORRIDORS — route AROUND water, not through it ═══
    // Primary corridors connect bedding (high ground) to food sources, skirting water
    
    const corridors: DeerCorridor[] = [
      // PRIMARY TRAVEL — Ridge to feed, AROUND water
      {
        id: "primary-1",
        type: "primary",
        label: "Primary Travel Corridor",
        description: "Main deer movement — ridge to feeding area. Routes around water. High traffic dawn & dusk.",
        coordinates: smoothTrailPath([
          // Start from high ground (bedding area)
          [lng + offset * highGroundX * 1.1, lat + offset * 0.75],
          [lng + offset * highGroundX * 0.9, lat + offset * 0.55],
          [lng + offset * highGroundX * 0.6, lat + offset * 0.35],
          // Curve AWAY from water zone
          [lng + offset * (highGroundX > 0 ? 0.1 : -0.1), lat + offset * 0.15],
          [lng + offset * (highGroundX > 0 ? -0.15 : 0.15), lat - offset * 0.05],
          // End at food source on opposite side from water
          [lng + offset * (-waterOffsetX * 0.6), lat - offset * 0.45],
          [lng + offset * (-waterOffsetX * 0.8), lat - offset * 0.65],
        ], 0.18),
      },
      {
        id: "primary-2",
        type: "primary",
        label: "Ridge Connector",
        description: "Secondary travel along ridge spine — avoids low ground. Mature bucks during rut.",
        coordinates: smoothTrailPath([
          [lng + offset * 0.85, lat + offset * 0.7],
          [lng + offset * 0.6, lat + offset * 0.55],
          [lng + offset * 0.3, lat + offset * 0.4],
          [lng, lat + offset * 0.25],
          [lng - offset * 0.3, lat + offset * 0.3],
          [lng - offset * 0.6, lat + offset * 0.45],
          [lng - offset * 0.85, lat + offset * 0.55],
        ], 0.15),
      },
      // SECONDARY — Field edges, staying on high ground
      {
        id: "secondary-1",
        type: "secondary",
        label: "Timber Edge Trail",
        description: "Edge transition — does & yearlings travel this frequently. Stays above creek bottom.",
        coordinates: smoothTrailPath([
          [lng + offset * (-waterOffsetX * 0.9), lat + offset * 0.6],
          [lng + offset * (-waterOffsetX * 0.7), lat + offset * 0.4],
          [lng + offset * (-waterOffsetX * 0.5), lat + offset * 0.2],
          [lng + offset * (-waterOffsetX * 0.3), lat],
          [lng + offset * (-waterOffsetX * 0.2), lat - offset * 0.25],
        ], 0.2),
      },
      {
        id: "secondary-2",
        type: "secondary",
        label: "Water Approach Trail",
        description: "Approach to water source — deer travel TO creek, not across it.",
        coordinates: smoothTrailPath([
          // Start from higher ground
          [lng + offset * (waterOffsetX * 0.3), lat + offset * 0.35],
          [lng + offset * (waterOffsetX * 0.4), lat + offset * 0.15],
          [lng + offset * (waterOffsetX * 0.5), lat - offset * 0.05],
          // TERMINATE at water — don't cross
          [lng + offset * (waterOffsetX * 0.55), lat + offset * waterOffsetY * 0.8],
        ], 0.18),
      },
      // WATER — Creek follows low terrain
      {
        id: "water-1",
        type: "water",
        label: "Primary Creek Bottom",
        description: "Seasonal drainage follows terrain low point. Deer visit for water, don't cross here.",
        coordinates: smoothTrailPath([
          creekStart,
          [creekStart[0] + (creekEnd[0] - creekStart[0]) * 0.25, creekStart[1] + (creekEnd[1] - creekStart[1]) * 0.2 + offset * 0.08],
          [creekStart[0] + (creekEnd[0] - creekStart[0]) * 0.5, creekStart[1] + (creekEnd[1] - creekStart[1]) * 0.45],
          [creekStart[0] + (creekEnd[0] - creekStart[0]) * 0.75, creekStart[1] + (creekEnd[1] - creekStart[1]) * 0.7 - offset * 0.05],
          creekEnd,
        ], 0.25),
      },
      {
        id: "water-2",
        type: "water",
        label: "Stock Pond",
        description: "Year-round water — high traffic staging area. Deer approach from uphill side.",
        coordinates: [
          [pondCenter[0] - offset * 0.08, pondCenter[1] + offset * 0.05],
          [pondCenter[0] - offset * 0.02, pondCenter[1] + offset * 0.09],
          [pondCenter[0] + offset * 0.06, pondCenter[1] + offset * 0.08],
          [pondCenter[0] + offset * 0.1, pondCenter[1] + offset * 0.03],
          [pondCenter[0] + offset * 0.09, pondCenter[1] - offset * 0.04],
          [pondCenter[0] + offset * 0.03, pondCenter[1] - offset * 0.07],
          [pondCenter[0] - offset * 0.05, pondCenter[1] - offset * 0.05],
          [pondCenter[0] - offset * 0.08, pondCenter[1]],
          [pondCenter[0] - offset * 0.08, pondCenter[1] + offset * 0.05],
        ],
      },
      // BEDDING — on high ground, opposite water
      {
        id: "bedding-1",
        type: "bedding",
        label: "Primary Bedding — Ridge Top",
        description: "High ground with 270° visibility. Mature bucks bed here — escape routes downhill.",
        coordinates: [
          [lng + offset * highGroundX * 0.7, lat + offset * 0.6],
          [lng + offset * highGroundX * 0.85, lat + offset * 0.68],
          [lng + offset * highGroundX * 1.0, lat + offset * 0.72],
          [lng + offset * highGroundX * 1.1, lat + offset * 0.68],
          [lng + offset * highGroundX * 1.15, lat + offset * 0.58],
          [lng + offset * highGroundX * 1.05, lat + offset * 0.5],
          [lng + offset * highGroundX * 0.9, lat + offset * 0.5],
          [lng + offset * highGroundX * 0.75, lat + offset * 0.54],
          [lng + offset * highGroundX * 0.7, lat + offset * 0.6],
        ],
      },
      {
        id: "bedding-2",
        type: "bedding",
        label: "Secondary Bedding — Thermal Cover",
        description: "Dense cedar thicket on north-facing slope. Wind protection, close to water.",
        coordinates: [
          [lng + offset * (waterOffsetX * 0.2), lat + offset * 0.15],
          [lng + offset * (waterOffsetX * 0.35), lat + offset * 0.22],
          [lng + offset * (waterOffsetX * 0.5), lat + offset * 0.2],
          [lng + offset * (waterOffsetX * 0.55), lat + offset * 0.1],
          [lng + offset * (waterOffsetX * 0.48), lat + offset * 0.02],
          [lng + offset * (waterOffsetX * 0.32), lat + offset * 0.02],
          [lng + offset * (waterOffsetX * 0.2), lat + offset * 0.08],
          [lng + offset * (waterOffsetX * 0.2), lat + offset * 0.15],
        ],
      },
      // FUNNELS — at terrain pinch points AWAY from water
      {
        id: "funnel-1",
        type: "funnel",
        label: "Ridge Pinch Point",
        description: "Terrain bottleneck on high ground — forces deer through narrow gap. PRIME stand location.",
        coordinates: smoothTrailPath([
          [lng + offset * (highGroundX * 0.4), lat + offset * 0.3],
          [lng + offset * (highGroundX * 0.2), lat + offset * 0.15],
          [lng, lat],
        ], 0.1),
      },
      {
        id: "funnel-2",
        type: "funnel",
        label: "Creek Crossing Funnel",
        description: "Only safe crossing point — deer funnel here to avoid deep water.",
        coordinates: smoothTrailPath([
          [lng + offset * (waterOffsetX * 0.3), lat + offset * (waterOffsetY + 0.2)],
          [lng + offset * (waterOffsetX * 0.35), lat + offset * waterOffsetY],
          [lng + offset * (waterOffsetX * 0.4), lat + offset * (waterOffsetY - 0.15)],
        ], 0.08),
      },
      // FOOD PLOTS — ALWAYS on high ground, NEVER near water
      // Rule: Food plots go on the OPPOSITE side from water, on ridges/benches
      {
        id: "food-1",
        type: "food_plot",
        label: "Kill Plot — Clover/Brassica",
        description: "¼-acre kill plot on ridge bench. Well-drained upland soil. Screened by timber.",
        coordinates: [
          // Place on HIGH GROUND side (opposite from water), in UPPER portion of parcel
          [lng + offset * (highGroundX * 0.6), lat + offset * 0.1],
          [lng + offset * (highGroundX * 0.7), lat + offset * 0.16],
          [lng + offset * (highGroundX * 0.82), lat + offset * 0.14],
          [lng + offset * (highGroundX * 0.85), lat + offset * 0.06],
          [lng + offset * (highGroundX * 0.78), lat - offset * 0.02],
          [lng + offset * (highGroundX * 0.65), lat - offset * 0.01],
          [lng + offset * (highGroundX * 0.58), lat + offset * 0.04],
          [lng + offset * (highGroundX * 0.6), lat + offset * 0.1],
        ],
      },
      {
        id: "food-2",
        type: "food_plot",
        label: "Staging Plot — Soybeans",
        description: "½-acre destination plot between bedding and timber edge. High & dry.",
        coordinates: [
          // Place near bedding area on high ground, well above water zone
          [lng + offset * (highGroundX * 0.4), lat + offset * 0.42],
          [lng + offset * (highGroundX * 0.5), lat + offset * 0.48],
          [lng + offset * (highGroundX * 0.62), lat + offset * 0.46],
          [lng + offset * (highGroundX * 0.65), lat + offset * 0.38],
          [lng + offset * (highGroundX * 0.58), lat + offset * 0.3],
          [lng + offset * (highGroundX * 0.45), lat + offset * 0.32],
          [lng + offset * (highGroundX * 0.38), lat + offset * 0.36],
          [lng + offset * (highGroundX * 0.4), lat + offset * 0.42],
        ],
      },
      // STAND SITES — positioned for wind & corridor coverage
      {
        id: "stand-1",
        type: "stand",
        label: "#1 Stand — Ridge Funnel",
        description: "20ft hang-on at pinch point on high ground. SW wind. All-day rut sit.",
        coordinates: [
          [lng + offset * 0.02, lat + offset * 0.04],
          [lng + offset * 0.06, lat + offset * 0.08],
          [lng + offset * 0.1, lat + offset * 0.04],
          [lng + offset * 0.06, lat],
          [lng + offset * 0.02, lat + offset * 0.04],
        ],
      },
      {
        id: "stand-2",
        type: "stand",
        label: "#2 Stand — Water Approach",
        description: "Ladder stand watching trail TO water (not crossing). NW wind. Evening hunts.",
        coordinates: [
          [lng + offset * (waterOffsetX * 0.45), lat + offset * (waterOffsetY + 0.25)],
          [lng + offset * (waterOffsetX * 0.49), lat + offset * (waterOffsetY + 0.29)],
          [lng + offset * (waterOffsetX * 0.53), lat + offset * (waterOffsetY + 0.25)],
          [lng + offset * (waterOffsetX * 0.49), lat + offset * (waterOffsetY + 0.21)],
          [lng + offset * (waterOffsetX * 0.45), lat + offset * (waterOffsetY + 0.25)],
        ],
      },
      {
        id: "stand-3",
        type: "stand",
        label: "#3 Stand — Kill Plot Edge",
        description: "Ground blind on downwind edge of kill plot. S/SE wind. Evening sits.",
        coordinates: [
          // Position near the kill plot on high ground
          [lng + offset * (highGroundX * 0.82), lat + offset * 0.02],
          [lng + offset * (highGroundX * 0.86), lat + offset * 0.06],
          [lng + offset * (highGroundX * 0.9), lat + offset * 0.02],
          [lng + offset * (highGroundX * 0.86), lat - offset * 0.02],
          [lng + offset * (highGroundX * 0.82), lat + offset * 0.02],
        ],
      },
    ];

    return corridors;
  }, [parcelCenter, acreage]);

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

    map.on("error", (e: any) => {
      console.error("Mapbox error:", e);
    });

    // Faster timeout — show whatever we have after 3s
    let hasLoaded = false;
    const loadTimeout = setTimeout(() => {
      if (!hasLoaded) {
        console.log("Terrain load timeout - showing map anyway");
        hasLoaded = true;
        setIsMapLoaded(true);
        setLoadPhase("done");
      }
    }, 3000);

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

      // Parcel boundary
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

        map.addLayer({ id: "parcel-glow", type: "line", source: "parcel-boundary", paint: { "line-color": "#f59e0b", "line-width": 8, "line-opacity": 0.3, "line-blur": 4 } });
        map.addLayer({ id: "parcel-outline", type: "line", source: "parcel-boundary", paint: { "line-color": "#f59e0b", "line-width": 3, "line-dasharray": [3, 2] } });
        map.addLayer({ id: "parcel-fill", type: "fill", source: "parcel-boundary", paint: { "fill-color": "#f59e0b", "fill-opacity": 0.08 } });

        const cornerFeatures = parcelBounds.map((p) => ({
          type: "Feature" as const, properties: {},
          geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        }));
        map.addSource("parcel-corners", { type: "geojson", data: { type: "FeatureCollection", features: cornerFeatures } });
        map.addLayer({ id: "parcel-corner-dots", type: "circle", source: "parcel-corners", paint: { "circle-radius": 4, "circle-color": "#f59e0b", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
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
                            <span className="font-semibold">Every layer is terrain-derived.</span> We analyze LiDAR elevation data, slope aspect, drainage patterns, and land cover to predict where deer eat, sleep, drink, and travel. No guesswork — just what the ground tells us.
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
                            🧠 AI predictions based on terrain analysis. Always ground-truth with boots on the property. Trail cameras recommended to verify patterns during season.
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
