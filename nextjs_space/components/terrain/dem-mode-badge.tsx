/**
 * DEM Mode Status Badge
 * 
 * Shows the current data source mode for terrain flow analysis:
 * - real_dem: Using actual DEM elevation data
 * - terrain_driven: Using terrain structure from corridors
 * - synthetic: Using parcel-based estimation
 * - error: Analysis failed
 */

'use client';

import React, { useState } from 'react';
import { Database, Mountain, Box, AlertTriangle, ChevronDown, ChevronUp, Info } from 'lucide-react';
import type { FlowMode, TerrainFlowMetadata } from '@/types/terrain-flow';

interface DEMModeBadgeProps {
  mode: FlowMode;
  metadata?: TerrainFlowMetadata | null;
  showExpanded?: boolean;
}

const MODE_CONFIG: Record<FlowMode, {
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ElementType;
  bgColor: string;
  textColor: string;
  borderColor: string;
}> = {
  real_dem: {
    label: 'Real DEM',
    shortLabel: 'DEM',
    description: 'Using actual elevation data from USGS 3DEP',
    icon: Database,
    bgColor: 'bg-emerald-900/50',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-700/50',
  },
  terrain_driven: {
    label: 'Terrain-Driven',
    shortLabel: 'TERRAIN',
    description: 'Using terrain structure from corridor analysis',
    icon: Mountain,
    bgColor: 'bg-cyan-900/50',
    textColor: 'text-cyan-400',
    borderColor: 'border-cyan-700/50',
  },
  synthetic: {
    label: 'Synthetic',
    shortLabel: 'EST.',
    description: 'Estimated from parcel geometry (no terrain data)',
    icon: Box,
    bgColor: 'bg-amber-900/50',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-700/50',
  },
  error: {
    label: 'Error',
    shortLabel: 'ERR',
    description: 'Analysis failed - using fallback',
    icon: AlertTriangle,
    bgColor: 'bg-red-900/50',
    textColor: 'text-red-400',
    borderColor: 'border-red-700/50',
  },
};

export default function DEMModeBadge({
  mode,
  metadata,
  showExpanded = false,
}: DEMModeBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(showExpanded);
  const config = MODE_CONFIG[mode] || MODE_CONFIG.error;
  const Icon = config.icon;
  
  return (
    <div className={`rounded-lg border ${config.borderColor} ${config.bgColor} overflow-hidden`}>
      {/* Badge Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${config.textColor}`} />
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.textColor}`}>
            {config.shortLabel}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-3 w-3 text-stone-500" />
        ) : (
          <ChevronDown className="h-3 w-3 text-stone-500" />
        )}
      </button>
      
      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-2.5 pb-2 space-y-2 border-t border-white/5">
          <div className="pt-2">
            <div className={`text-xs font-medium ${config.textColor}`}>{config.label}</div>
            <p className="text-[10px] text-stone-400 mt-0.5">{config.description}</p>
          </div>
          
          {metadata && (
            <div className="space-y-1 text-[9px]">
              {metadata.dem_source && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Source</span>
                  <span className="text-stone-300">{metadata.dem_source}</span>
                </div>
              )}
              {metadata.resolution_m && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Resolution</span>
                  <span className="text-stone-300">{metadata.resolution_m}m</span>
                </div>
              )}
              {metadata.buffer_m && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Buffer</span>
                  <span className="text-stone-300">{metadata.buffer_m}m</span>
                </div>
              )}
              {metadata.processing_time_seconds && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Process Time</span>
                  <span className="text-stone-300">{metadata.processing_time_seconds.toFixed(2)}s</span>
                </div>
              )}
              {metadata.fallback_reason && (
                <div className="mt-1 p-1.5 bg-amber-900/30 rounded text-amber-300/80 flex items-start gap-1">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>{metadata.fallback_reason}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Compact inline version for the layer panel
export function DEMModeBadgeInline({ mode }: { mode: FlowMode }) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.error;
  const Icon = config.icon;
  
  return (
    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${config.bgColor} ${config.borderColor} border`}>
      <Icon className={`h-2.5 w-2.5 ${config.textColor}`} />
      <span className={`text-[8px] font-semibold uppercase tracking-wider ${config.textColor}`}>
        {config.shortLabel}
      </span>
    </div>
  );
}
