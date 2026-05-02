/**
 * Terrain Reasons Panel v3.6.0
 * 
 * When "Show Terrain Reasons" toggle is enabled, clicking on stands, corridors,
 * or convergence nodes reveals a side panel explaining the key terrain factors
 * that produced that feature.
 * 
 * Terrain Factors:
 *   - Saddle proximity: crossing point between ridges
 *   - Bench-supported travel: sidehill flat enabling contour travel
 *   - Concave terrain funnel: convergent topography funneling movement
 *   - Corridor intersection: multiple travel paths crossing
 *   - Ridge wrap pinch: ridge narrowing creating bottleneck
 *   - Leeward setup: wind-sheltered position
 */

'use client';

import React from 'react';
import { 
  X, MapPin, Mountain, GitMerge, Wind, Milestone, 
  TrendingDown, Navigation, Target, TreePine, Compass
} from 'lucide-react';

export type TerrainFeatureType = 'stand' | 'corridor' | 'convergence' | 'bedding_zone';

export interface TerrainReason {
  key: string;
  label: string;
  value: number;  // 0-1 strength
  description: string;
}

export interface TerrainReasonData {
  featureType: TerrainFeatureType;
  featureId?: string | number;
  score?: number;
  position: { lng: number; lat: number };
  reasons: TerrainReason[];
  summary: string;
}

interface TerrainReasonsPanelProps {
  data: TerrainReasonData | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

// Icon mapping for terrain reason types
const REASON_ICONS: Record<string, React.ElementType> = {
  saddle_proximity: Mountain,
  bench_support: Milestone,
  concave_funnel: TrendingDown,
  corridor_intersection: GitMerge,
  ridge_wrap_pinch: Navigation,
  leeward_setup: Wind,
  ridge_distance: MapPin,
  ridge_alignment: Mountain,  // Dual-pipeline confirmation
  slope_suitability: Compass,
  terrain_shelter: TreePine,
  corridor_offset: Target,
};

// Color mapping for terrain reason types
const REASON_COLORS: Record<string, string> = {
  saddle_proximity: '#f97316',      // Orange
  bench_support: '#a78bfa',         // Purple
  concave_funnel: '#22d3ee',        // Cyan
  corridor_intersection: '#fbbf24', // Amber
  ridge_wrap_pinch: '#ec4899',      // Pink
  leeward_setup: '#10b981',         // Emerald
  ridge_distance: '#6366f1',        // Indigo
  ridge_alignment: '#c9a84c',       // Gold — dual-pipeline confirmation
  slope_suitability: '#84cc16',     // Lime
  terrain_shelter: '#22c55e',       // Green
  corridor_offset: '#f59e0b',       // Amber
};

// Feature type labels and colors
const FEATURE_LABELS: Record<TerrainFeatureType, { label: string; color: string; bg: string }> = {
  stand: { label: 'Prime Stand Site', color: 'text-amber-300', bg: 'bg-amber-900/30' },
  corridor: { label: 'Travel Corridor', color: 'text-cyan-300', bg: 'bg-cyan-900/30' },
  convergence: { label: 'Convergence Node', color: 'text-pink-300', bg: 'bg-pink-900/30' },
  bedding_zone: { label: 'Bedding Zone', color: 'text-purple-300', bg: 'bg-purple-900/30' },
};

// Reason bar component
function ReasonBar({ reason }: { reason: TerrainReason }) {
  const Icon = REASON_ICONS[reason.key] || MapPin;
  const color = REASON_COLORS[reason.key] || '#94a3b8';
  const percentage = Math.round(reason.value * 100);
  const barOpacity = percentage >= 50 ? 1 : percentage >= 25 ? 0.7 : 0.4;

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
        <span className="text-[11px] text-stone-300 flex-1">{reason.label}</span>
        <span className="text-[10px] font-semibold" style={{ color, opacity: barOpacity }}>
          {percentage}%
        </span>
      </div>
      <div className="h-1.5 bg-stone-800/60 rounded-full overflow-hidden ml-5">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${percentage}%`,
            background: `linear-gradient(90deg, ${color}50 0%, ${color} 100%)`,
            opacity: barOpacity,
          }}
        />
      </div>
      <p className="text-[9px] text-stone-500 mt-0.5 ml-5 leading-tight">
        {reason.description}
      </p>
    </div>
  );
}

export default function TerrainReasonsPanel({
  data,
  position,
  onClose,
}: TerrainReasonsPanelProps) {
  if (!data || !position) return null;

  const featureConfig = FEATURE_LABELS[data.featureType];
  
  // Sort reasons by value (strongest first)
  const sortedReasons = [...data.reasons].sort((a, b) => b.value - a.value);
  const topReasons = sortedReasons.filter(r => r.value >= 0.1).slice(0, 5);

  // Position panel near click, but keep on screen
  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x + 15, window.innerWidth - 300),
    top: Math.min(Math.max(position.y - 120, 10), window.innerHeight - 450),
    zIndex: 1000,
  };

  return (
    <div
      className="w-72 bg-stone-950/95 backdrop-blur-md border border-stone-700/50 rounded-xl shadow-2xl overflow-hidden"
      style={panelStyle}
    >
      {/* Header */}
      <div className={`px-3 py-2.5 ${featureConfig.bg} border-b border-stone-700/50 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <MapPin className={`h-4 w-4 ${featureConfig.color}`} />
          <span className={`text-sm font-semibold ${featureConfig.color}`}>
            {featureConfig.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-stone-800/50 transition-colors"
        >
          <X className="h-4 w-4 text-stone-400" />
        </button>
      </div>

      {/* Summary */}
      <div className="px-3 py-2.5 border-b border-stone-800/50 bg-stone-900/30">
        {data.score !== undefined && (
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-stone-500 uppercase tracking-wide">
              Feature Score
            </span>
            <span className="text-lg font-bold text-white">
              {(data.score * 100).toFixed(0)}%
            </span>
          </div>
        )}
        <p className="text-[11px] text-stone-300 italic leading-relaxed">
          {data.summary}
        </p>
      </div>

      {/* Terrain Reasons */}
      <div className="px-3 py-3">
        <div className="text-[9px] text-stone-500 uppercase tracking-wider font-medium mb-2">
          Terrain Factors
        </div>
        {topReasons.length > 0 ? (
          <div className="space-y-1">
            {topReasons.map((reason, i) => (
              <ReasonBar key={reason.key} reason={reason} />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-stone-600 italic py-2">
            No significant terrain factors detected
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 bg-stone-900/50 border-t border-stone-800/50">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-stone-600">
            {data.position.lat.toFixed(5)}, {data.position.lng.toFixed(5)}
          </span>
          <span className="text-[9px] text-stone-500 italic">
            v3.6 Terrain AI
          </span>
        </div>
      </div>
    </div>
  );
}

// ========== HELPER: Extract reasons from opportunity/convergence properties ==========

export function extractStandReasons(
  props: Record<string, any>,
  position: { lng: number; lat: number }
): TerrainReasonData {
  const reasons: TerrainReason[] = [];
  
  // Map properties to terrain reasons
  if (props.benchBonus > 0.05) {
    reasons.push({
      key: 'bench_support',
      label: 'Bench-Supported Travel',
      value: props.benchBonus,
      description: 'Sidehill flat enables contour movement—deer prefer these natural lanes.',
    });
  }
  
  if (props.saddleBonus > 0.05) {
    reasons.push({
      key: 'saddle_proximity',
      label: 'Saddle Proximity',
      value: props.saddleBonus,
      description: 'Low point between ridges—natural crossing funnel.',
    });
  }
  
  if (props.convergenceBonus > 0.1) {
    reasons.push({
      key: 'corridor_intersection',
      label: 'Corridor Intersection',
      value: props.convergenceBonus,
      description: 'Multiple travel paths converge here—high traffic potential.',
    });
  }
  
  if (props.flowIntensity > 0.3) {
    reasons.push({
      key: 'ridge_wrap_pinch',
      label: 'Ridge/Terrain Pinch',
      value: props.flowIntensity * 0.8,
      description: 'Terrain compression focuses movement through this zone.',
    });
  }

  // Derive summary from top reasons
  const sortedReasons = [...reasons].sort((a, b) => b.value - a.value);
  let summary = 'Multiple terrain factors combine at this location.';
  if (sortedReasons.length >= 2 && sortedReasons[0].value >= 0.2 && sortedReasons[1].value >= 0.15) {
    summary = `${sortedReasons[0].label} combined with ${sortedReasons[1].label.toLowerCase()}.`;
  } else if (sortedReasons.length >= 1 && sortedReasons[0].value >= 0.25) {
    summary = `Strong ${sortedReasons[0].label.toLowerCase()} drives stand placement here.`;
  }

  return {
    featureType: 'stand',
    score: props.score,
    position,
    reasons,
    summary,
  };
}

export function extractCorridorReasons(
  props: Record<string, any>,
  position: { lng: number; lat: number }
): TerrainReasonData {
  const reasons: TerrainReason[] = [];
  
  if (props.bench_likelihood > 0.1) {
    reasons.push({
      key: 'bench_support',
      label: 'Bench-Supported',
      value: props.bench_likelihood,
      description: 'Travel along sidehill bench—low-energy contour movement.',
    });
  }
  
  if (props.slope_preference > 0.2) {
    reasons.push({
      key: 'slope_suitability',
      label: 'Slope Suitability',
      value: props.slope_preference,
      description: 'Moderate slope grade ideal for deer travel.',
    });
  }
  
  if (props.saddle_proximity > 0.1) {
    reasons.push({
      key: 'saddle_proximity',
      label: 'Saddle Connection',
      value: props.saddle_proximity,
      description: 'Routes through or near terrain saddle crossing.',
    });
  }
  
  if (props.terrain_convergence > 0.15) {
    reasons.push({
      key: 'concave_funnel',
      label: 'Terrain Funnel',
      value: props.terrain_convergence,
      description: 'Concave topography naturally channels movement.',
    });
  }
  
  if (props.spine_proximity > 0.2) {
    reasons.push({
      key: 'ridge_distance',
      label: 'Ridge Proximity',
      value: props.spine_proximity,
      description: 'Following ridge spine for efficient travel.',
    });
  }

  // Ridge-alignment confirmation (independent pipeline agreement)
  if (props.ridgeAligned) {
    reasons.push({
      key: 'ridge_alignment',
      label: 'Ridge-Aligned Seam',
      value: Math.min(1, (props.ridgeAlignmentScore || 0.5) + (props.ridgeConfidenceBoost || 0)),
      description: props.ridgeAlignmentReason
        || 'Ridge-aligned movement seam — both elevation spine and corridor model agree.',
    });
  }

  const sortedReasons = [...reasons].sort((a, b) => b.value - a.value);
  let summary = 'Terrain structure supports deer travel along this path.';
  // Ridge-aligned corridors get a stronger summary
  if (props.ridgeAligned && props.source === 'real_dem') {
    summary = 'Independent DEM pipelines confirm this as a terrain movement seam.';
  } else if (sortedReasons.length >= 1 && sortedReasons[0].value >= 0.3) {
    summary = `Primarily driven by ${sortedReasons[0].label.toLowerCase()}.`;
  }

  return {
    featureType: 'corridor',
    score: props.likelihood || props.corridorScore,
    position,
    reasons,
    summary,
  };
}

export function extractConvergenceReasons(
  props: Record<string, any>,
  position: { lng: number; lat: number }
): TerrainReasonData {
  const reasons: TerrainReason[] = [];
  
  if (props.corridorIntersection > 0.1) {
    reasons.push({
      key: 'corridor_intersection',
      label: 'Corridor Intersection',
      value: props.corridorIntersection || 0.5,
      description: '2+ travel corridors meet at this point.',
    });
  }
  
  if (props.saddleProximity || props.nearSaddle) {
    reasons.push({
      key: 'saddle_proximity',
      label: 'Saddle Crossing',
      value: props.saddleProximity || 0.4,
      description: 'Low terrain crossing funnels movement through here.',
    });
  }
  
  if (props.drawProximity || props.nearDraw) {
    reasons.push({
      key: 'concave_funnel',
      label: 'Draw Funnel',
      value: props.drawProximity || 0.35,
      description: 'Drainage/draw creates natural movement channel.',
    });
  }
  
  if (props.ridgeWrap || props.corridorNarrowing) {
    reasons.push({
      key: 'ridge_wrap_pinch',
      label: 'Ridge Wrap Pinch',
      value: props.ridgeWrap || props.corridorNarrowing || 0.3,
      description: 'Ridge bends or narrows, compressing travel.',
    });
  }
  
  if (props.terrainCurvature > 0.2) {
    reasons.push({
      key: 'concave_funnel',
      label: 'Concave Terrain',
      value: props.terrainCurvature,
      description: 'Bowl-shaped terrain funnels movement inward.',
    });
  }

  const sortedReasons = [...reasons].sort((a, b) => b.value - a.value);
  let summary = 'Multiple structural signals overlap at this convergence point.';
  if (sortedReasons.length >= 2) {
    summary = `${sortedReasons[0].label} + ${sortedReasons[1].label.toLowerCase()} create pinch.`;
  }

  return {
    featureType: 'convergence',
    score: props.intensity || props.score,
    position,
    reasons,
    summary,
  };
}

export function extractBeddingReasons(
  props: Record<string, any>,
  position: { lng: number; lat: number }
): TerrainReasonData {
  const reasons: TerrainReason[] = [];
  
  if (props.upperSlope > 0.1) {
    reasons.push({
      key: 'ridge_distance',
      label: 'Upper-Slope Position',
      value: props.upperSlope,
      description: 'Elevated position with good vantage—deer prefer bedding high.',
    });
  }
  
  if (props.solarAspect > 0.1) {
    reasons.push({
      key: 'solar_aspect',
      label: 'Solar Aspect',
      value: props.solarAspect,
      description: 'South/SE-facing slope holds thermal warmth—November advantage.',
    });
  }
  
  if (props.humanPressure > 0.1) {
    reasons.push({
      key: 'human_pressure',
      label: 'Human Pressure Distance',
      value: props.humanPressure,
      description: 'Well away from structures and human activity zones.',
    });
  }
  
  if (props.terrainShelter > 0.1) {
    reasons.push({
      key: 'terrain_shelter',
      label: 'Terrain Shelter',
      value: props.terrainShelter,
      description: 'Concave terrain provides wind/weather protection.',
    });
  }
  
  if (props.slopeSuitability > 0.1) {
    reasons.push({
      key: 'slope_suitability',
      label: 'Moderate Slope',
      value: props.slopeSuitability,
      description: 'Comfortable slope angle for bedding (not too steep).',
    });
  }
  
  if (props.corridorOffset > 0.1) {
    reasons.push({
      key: 'corridor_offset',
      label: 'Corridor Offset',
      value: props.corridorOffset,
      description: 'Slight distance from main travel routes—security.',
    });
  }

  const sortedReasons = [...reasons].sort((a, b) => b.value - a.value);
  let summary = 'DEM signals suggest this area is favorable for deer bedding.';
  if (sortedReasons.length >= 1 && sortedReasons[0].value >= 0.3) {
    summary = `${sortedReasons[0].label} makes this a likely bedding area.`;
  }

  return {
    featureType: 'bedding_zone',
    score: props.beddingScore || props.score,
    position,
    reasons,
    summary,
  };
}
