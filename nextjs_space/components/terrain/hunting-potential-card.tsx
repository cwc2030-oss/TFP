/**
 * Hunting Potential Card
 * 
 * The PRIMARY UI element answering: "Does this parcel have hunting potential, and why?"
 * 
 * Shows:
 * - Clear HIGH / MODERATE / LOW rating
 * - 4 key terrain drivers with their scores
 * - Top opportunity areas (1-3)
 * - One-line story summary
 */

import React from 'react';
import { Target, Mountain, ArrowDownRight, Layers, MapPin, Sparkles, AlertTriangle, CheckCircle, Minus } from 'lucide-react';
import type { TerrainFlowResponse } from '@/types/terrain-flow';
import { computeStructuralDrivers, type StructuralDrivers } from '@/lib/terrain-story';

// ========== TYPES ==========

export type HuntingPotential = 'high' | 'moderate' | 'low' | 'minimal';

export interface HuntingPotentialScore {
  rating: HuntingPotential;
  score: number;              // 0-100
  confidence: number;         // 0-1
  drivers: StructuralDrivers;
  topOpportunities: Array<{
    id: string;
    label: string;
    score: number;
    reason: string;
  }>;
  headline: string;
}

// ========== SCORING ==========

export function computeHuntingPotential(
  flowData: TerrainFlowResponse | null,
  acreage?: number
): HuntingPotentialScore {
  if (!flowData || !flowData.success) {
    return {
      rating: 'minimal',
      score: 0,
      confidence: 0,
      drivers: computeStructuralDrivers(null),
      topOpportunities: [],
      headline: 'Insufficient data to assess hunting potential',
    };
  }
  
  const drivers = computeStructuralDrivers(flowData);
  
  // Weighted score from drivers (sum to 100)
  // Bench: 30%, Saddle: 25%, Ridge: 25%, Convergence: 20%
  const driverScore = (
    drivers.benchSupport.score * 30 +
    drivers.saddleInfluence.score * 25 +
    drivers.ridgeSpineSupport.score * 25 +
    drivers.convergenceDensity.score * 20
  );
  
  // Bonus for opportunity zones
  const oppCount = flowData.opportunity_zones.features.length;
  const oppBonus = Math.min(10, oppCount * 3);
  
  // Bonus for flow structure
  const primaryFlows = flowData.flow_primary.features.length;
  const structureBonus = Math.min(10, primaryFlows * 2.5);
  
  // Pattern bonus (V3 pattern classification)
  const patternType = flowData.metadata.pattern?.type;
  let patternBonus = 0;
  if (patternType === 'funnel' || patternType === 'crossroads') patternBonus = 8;
  else if (patternType === 'linear' || patternType === 'bench') patternBonus = 5;
  else if (patternType === 'sparse') patternBonus = -5;
  else if (patternType === 'none') patternBonus = -10;
  
  // Acreage consideration (larger parcels have more opportunity)
  let acreageModifier = 1.0;
  if (acreage) {
    if (acreage >= 200) acreageModifier = 1.1;
    else if (acreage >= 80) acreageModifier = 1.0;
    else if (acreage >= 40) acreageModifier = 0.95;
    else if (acreage < 20) acreageModifier = 0.85;
  }
  
  const rawScore = (driverScore + oppBonus + structureBonus + patternBonus) * acreageModifier;
  const score = Math.max(0, Math.min(100, rawScore));
  
  // Determine rating
  let rating: HuntingPotential;
  if (score >= 70) rating = 'high';
  else if (score >= 45) rating = 'moderate';
  else if (score >= 20) rating = 'low';
  else rating = 'minimal';
  
  // Build opportunity list
  const topOpportunities = flowData.opportunity_zones.features
    .slice(0, 3)
    .map((opp, i) => {
      const props = opp.properties;
      const coord = opp.geometry.coordinates as [number, number];
      
      // Determine reason based on bonuses
      let reason = 'Terrain convergence point';
      if (props.saddleBonus > 0.08) reason = 'Saddle crossing area';
      else if (props.benchBonus > 0.08) reason = 'Bench travel zone';
      else if (props.convergenceBonus > 0.12) reason = 'Multiple flow convergence';
      
      return {
        id: props.id || `opp_${i}`,
        label: `Opportunity ${i + 1}`,
        score: Math.round(props.score * 100),
        reason,
      };
    });
  
  // Confidence based on data quality
  const mode = flowData.metadata.mode;
  let confidence = 0.6;
  if (mode === 'real_dem') confidence = 0.9;
  else if (mode === 'terrain_driven') confidence = 0.75;
  else if (mode === 'synthetic') confidence = 0.5;
  
  // Generate headline
  const headline = generateHeadline(rating, drivers, topOpportunities.length, patternType);
  
  return {
    rating,
    score: Math.round(score),
    confidence,
    drivers,
    topOpportunities,
    headline,
  };
}

function generateHeadline(
  rating: HuntingPotential,
  drivers: StructuralDrivers,
  oppCount: number,
  patternType?: string
): string {
  // Find strongest driver
  const driverScores = [
    { name: 'bench support', score: drivers.benchSupport.score },
    { name: 'saddle influence', score: drivers.saddleInfluence.score },
    { name: 'ridge structure', score: drivers.ridgeSpineSupport.score },
    { name: 'convergence', score: drivers.convergenceDensity.score },
  ].sort((a, b) => b.score - a.score);
  
  const top = driverScores[0];
  
  if (rating === 'high') {
    if (oppCount >= 2) return `Strong terrain structure with ${oppCount} key opportunity zones`;
    return `Excellent ${top.name} creates prime hunting terrain`;
  } else if (rating === 'moderate') {
    return `Moderate potential driven by ${top.name}`;
  } else if (rating === 'low') {
    if (patternType === 'sparse') return 'Limited terrain structure detected';
    return 'Some terrain features present but limited concentration';
  } else {
    return 'Minimal hunting structure detected on this parcel';
  }
}

// ========== COMPONENT ==========

interface HuntingPotentialCardProps {
  flowData: TerrainFlowResponse | null;
  acreage?: number;
  isLoading?: boolean;
  onHighlightOpportunity?: (oppId: string | null) => void;
  compact?: boolean;
}

export default function HuntingPotentialCard({
  flowData,
  acreage,
  isLoading,
  onHighlightOpportunity,
  compact = false,
}: HuntingPotentialCardProps) {
  const potential = computeHuntingPotential(flowData, acreage);
  
  if (isLoading) {
    return (
      <div className="bg-slate-900/95 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-slate-700 animate-pulse" />
          <div className="flex-1">
            <div className="h-5 w-32 bg-slate-700 rounded animate-pulse mb-2" />
            <div className="h-4 w-48 bg-slate-700/50 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }
  
  const ratingConfig = getRatingConfig(potential.rating);
  
  if (compact) {
    return (
      <div className="bg-slate-900/95 backdrop-blur-sm rounded-lg border border-slate-700/50 p-3">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${ratingConfig.bgClass}`}>
            <Target className={`h-5 w-5 ${ratingConfig.iconClass}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold uppercase tracking-wide ${ratingConfig.textClass}`}>
                {potential.rating}
              </span>
              <span className="text-slate-400 text-xs">
                {potential.score}/100
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate">{potential.headline}</p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-slate-900/95 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header with Rating */}
      <div className={`px-4 py-3 ${ratingConfig.headerBg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-12 w-12 rounded-full flex items-center justify-center ${ratingConfig.bgClass}`}>
              <Target className={`h-6 w-6 ${ratingConfig.iconClass}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold uppercase tracking-wide ${ratingConfig.textClass}`}>
                  {potential.rating} Potential
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <span className="font-semibold">{potential.score}</span>
                <span className="text-slate-500">/100</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400 text-xs">
                  {Math.round(potential.confidence * 100)}% confidence
                </span>
              </div>
            </div>
          </div>
          <ratingConfig.Icon className={`h-8 w-8 ${ratingConfig.iconClass} opacity-50`} />
        </div>
      </div>
      
      {/* Headline */}
      <div className="px-4 py-3 border-b border-slate-700/50">
        <p className="text-sm text-slate-200">{potential.headline}</p>
      </div>
      
      {/* Key Drivers Grid */}
      <div className="px-4 py-3 border-b border-slate-700/50">
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Key Terrain Drivers
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <DriverBadge 
            label="Bench" 
            score={potential.drivers.benchSupport.score}
            icon={<Layers className="h-3.5 w-3.5" />}
          />
          <DriverBadge 
            label="Saddle" 
            score={potential.drivers.saddleInfluence.score}
            icon={<ArrowDownRight className="h-3.5 w-3.5" />}
          />
          <DriverBadge 
            label="Ridge" 
            score={potential.drivers.ridgeSpineSupport.score}
            icon={<Mountain className="h-3.5 w-3.5" />}
          />
          <DriverBadge 
            label="Convergence" 
            score={potential.drivers.convergenceDensity.score}
            icon={<Target className="h-3.5 w-3.5" />}
          />
        </div>
      </div>
      
      {/* Opportunity Zones */}
      {potential.topOpportunities.length > 0 && (
        <div className="px-4 py-3">
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Key Opportunity Areas
          </h4>
          <div className="space-y-2">
            {potential.topOpportunities.map((opp, i) => (
              <button
                key={opp.id}
                className="w-full flex items-center gap-3 p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors text-left group"
                onMouseEnter={() => onHighlightOpportunity?.(opp.id)}
                onMouseLeave={() => onHighlightOpportunity?.(null)}
              >
                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  i === 0 ? 'bg-amber-500/20 text-amber-400' :
                  i === 1 ? 'bg-emerald-500/20 text-emerald-400' :
                  'bg-cyan-500/20 text-cyan-400'
                }`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 font-medium">{opp.reason}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      opp.score >= 80 ? 'bg-emerald-500/20 text-emerald-400' :
                      opp.score >= 60 ? 'bg-cyan-500/20 text-cyan-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>
                      {opp.score}%
                    </span>
                  </div>
                </div>
                <MapPin className="h-4 w-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}
      
      {potential.topOpportunities.length === 0 && (
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-slate-500">No concentrated opportunity zones detected</p>
        </div>
      )}
    </div>
  );
}

// ========== SUB-COMPONENTS ==========

function DriverBadge({ label, score, icon }: { label: string; score: number; icon: React.ReactNode }) {
  const level = score >= 0.7 ? 'high' : score >= 0.4 ? 'moderate' : 'low';
  const config = {
    high: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', bar: 'bg-emerald-500' },
    moderate: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', bar: 'bg-cyan-500' },
    low: { bg: 'bg-slate-500/20', text: 'text-slate-400', bar: 'bg-slate-500' },
  }[level];
  
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${config.bg}`}>
      <div className={config.text}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs text-slate-300">{label}</span>
          <span className={`text-xs font-medium ${config.text}`}>
            {Math.round(score * 100)}%
          </span>
        </div>
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all ${config.bar}`}
            style={{ width: `${score * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function getRatingConfig(rating: HuntingPotential) {
  switch (rating) {
    case 'high':
      return {
        bgClass: 'bg-emerald-500/20',
        textClass: 'text-emerald-400',
        iconClass: 'text-emerald-400',
        headerBg: 'bg-emerald-950/50',
        Icon: CheckCircle,
      };
    case 'moderate':
      return {
        bgClass: 'bg-cyan-500/20',
        textClass: 'text-cyan-400',
        iconClass: 'text-cyan-400',
        headerBg: 'bg-cyan-950/50',
        Icon: Sparkles,
      };
    case 'low':
      return {
        bgClass: 'bg-amber-500/20',
        textClass: 'text-amber-400',
        iconClass: 'text-amber-400',
        headerBg: 'bg-amber-950/50',
        Icon: Minus,
      };
    case 'minimal':
    default:
      return {
        bgClass: 'bg-slate-500/20',
        textClass: 'text-slate-400',
        iconClass: 'text-slate-400',
        headerBg: 'bg-slate-800/50',
        Icon: AlertTriangle,
      };
  }
}

// Types and functions already exported at definition
