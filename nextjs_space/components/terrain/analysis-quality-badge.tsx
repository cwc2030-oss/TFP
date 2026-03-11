/**
 * Analysis Quality Badge
 * 
 * Compact label showing confidence level of terrain analysis:
 * - High confidence: DEM-derived (real elevation data)
 * - Medium confidence: terrain-driven proxy (corridor structure)
 * - Low confidence: synthetic fallback (parcel geometry only)
 */

'use client';

import React from 'react';
import { Database, Mountain, Box, AlertTriangle, Info } from 'lucide-react';
import type { FlowMode } from '@/types/terrain-flow';

interface AnalysisQualityBadgeProps {
  mode: FlowMode;
  compact?: boolean;
}

const QUALITY_CONFIG: Record<FlowMode, {
  level: 'high' | 'medium' | 'low';
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ElementType;
  bgColor: string;
  textColor: string;
  borderColor: string;
  dotColor: string;
}> = {
  real_dem: {
    level: 'high',
    label: 'High confidence',
    shortLabel: 'DEM-derived',
    description: 'Analysis uses real USGS elevation data',
    icon: Database,
    bgColor: 'bg-emerald-950/80',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-700/50',
    dotColor: 'bg-emerald-500',
  },
  terrain_driven: {
    level: 'medium',
    label: 'Medium confidence',
    shortLabel: 'terrain-driven proxy',
    description: 'Analysis uses terrain structure from corridors',
    icon: Mountain,
    bgColor: 'bg-cyan-950/80',
    textColor: 'text-cyan-400',
    borderColor: 'border-cyan-700/50',
    dotColor: 'bg-cyan-500',
  },
  synthetic: {
    level: 'low',
    label: 'Low confidence',
    shortLabel: 'synthetic fallback',
    description: 'Estimated from parcel geometry only',
    icon: Box,
    bgColor: 'bg-amber-950/80',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-700/50',
    dotColor: 'bg-amber-500',
  },
  error: {
    level: 'low',
    label: 'Error',
    shortLabel: 'fallback',
    description: 'Analysis failed - using estimated data',
    icon: AlertTriangle,
    bgColor: 'bg-red-950/80',
    textColor: 'text-red-400',
    borderColor: 'border-red-700/50',
    dotColor: 'bg-red-500',
  },
};

export default function AnalysisQualityBadge({ mode, compact = false }: AnalysisQualityBadgeProps) {
  const config = QUALITY_CONFIG[mode] || QUALITY_CONFIG.error;
  const Icon = config.icon;
  
  if (compact) {
    return (
      <div 
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${config.bgColor} ${config.borderColor} border`}
        title={`${config.label}: ${config.description}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} />
        <span className={`text-[9px] font-medium ${config.textColor}`}>
          {config.label}
        </span>
      </div>
    );
  }
  
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${config.bgColor} ${config.borderColor} border`}>
      <span className={`w-2 h-2 rounded-full ${config.dotColor} animate-pulse`} />
      <div className="flex-1 min-w-0">
        <div className={`text-[10px] font-semibold ${config.textColor}`}>
          {config.label}
        </div>
        <div className="text-[9px] text-stone-500">
          {config.shortLabel}
        </div>
      </div>
      <button
        className="p-0.5 hover:bg-white/10 rounded transition-colors"
        title={config.description}
      >
        <Info className="h-3 w-3 text-stone-500" />
      </button>
    </div>
  );
}

// Inline version for tight spaces
export function AnalysisQualityInline({ mode }: { mode: FlowMode }) {
  const config = QUALITY_CONFIG[mode] || QUALITY_CONFIG.error;
  
  return (
    <span 
      className={`inline-flex items-center gap-1 text-[9px] ${config.textColor}`}
      title={config.description}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </span>
  );
}
