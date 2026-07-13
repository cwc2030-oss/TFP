/**
 * Terrain Story Panel
 * 
 * Displays a concise summary of the terrain's structural drivers
 * and movement story. Designed for brokers and land buyers to
 * quickly understand "why this land matters."
 */

'use client';

import React from 'react';
import { 
  Mountain, 
  Milestone, 
  TrendingUp, 
  GitMerge, 
  ChevronDown, 
  ChevronUp,
  Sparkles,
  MapPin,
  Info
} from 'lucide-react';
import type { TerrainStorySummary, StructuralDrivers, StructuralDriverScore } from '@/lib/terrain-story';
import { getDriverColor, formatDriverScore } from '@/lib/terrain-story';

// ========== DRIVER ICONS ==========

const DRIVER_ICONS: Record<string, React.ElementType> = {
  bench: Milestone,
  saddle: Mountain,
  ridge: TrendingUp,
  convergence: GitMerge,
};

// ========== DRIVER BAR ==========

function DriverBar({ 
  driver, 
  compact = false 
}: { 
  driver: StructuralDriverScore; 
  compact?: boolean;
}) {
  const Icon = DRIVER_ICONS[driver.icon] || Mountain;
  const color = getDriverColor(driver.score);
  const percentage = Math.round(driver.score * 100);
  
  // Phase 1 honesty guard: Bench/Ridge are still constant-blended (not measured).
  // Mark them so we never present an estimate as measured structure.
  const isEstimate = !!driver.estimated && driver.score > 0;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <div className="flex-1 min-w-0">
          <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${percentage}%`, background: color }}
            />
          </div>
        </div>
        <span className="text-[10px] font-medium text-right whitespace-nowrap" style={{ color }}>
          {isEstimate ? `~${percentage}%` : `${percentage}%`}
        </span>
      </div>
    );
  }
  
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" style={{ color }} />
          <span className="text-xs font-medium text-white">{driver.shortLabel}</span>
          {isEstimate && (
            <span className="text-[8px] uppercase tracking-wider text-stone-500 border border-stone-600/60 rounded px-1 py-px leading-none">
              est
            </span>
          )}
        </div>
        <span className="text-xs font-semibold" style={{ color }}>
          {isEstimate ? `~${percentage}%` : `${percentage}%`}
        </span>
      </div>
      <div className="h-2 bg-stone-800 rounded-full overflow-hidden mb-1">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ 
            width: `${percentage}%`, 
            background: `linear-gradient(90deg, ${color}80 0%, ${color} 100%)` 
          }}
        />
      </div>
      <p className="text-[10px] text-stone-400 leading-tight">
        {driver.description}
      </p>
    </div>
  );
}

// ========== STRUCTURAL DRIVERS GRID ==========

export function StructuralDriversGrid({ 
  drivers,
  compact = false,
  showLabels = true 
}: { 
  drivers: StructuralDrivers;
  compact?: boolean;
  showLabels?: boolean;
}) {
  // PHASE 1 honesty guard: hide estimated (constant-blended) drivers entirely.
  // Bench & Ridge are not yet per-parcel measured, so we never render them.
  // Only real, measured/derived drivers (Saddle, Convergence) are shown until
  // Phase 2a derives Bench & Ridge from the parcel DEM (then estimated=false).
  const driverList = [
    { key: 'benchSupport', driver: drivers.benchSupport },
    { key: 'saddleInfluence', driver: drivers.saddleInfluence },
    { key: 'ridgeSpineSupport', driver: drivers.ridgeSpineSupport },
    { key: 'convergenceDensity', driver: drivers.convergenceDensity },
  ].filter(({ driver }) => !driver.estimated);
  
  if (compact) {
    return (
      <div className="space-y-2">
        {driverList.map(({ key, driver }) => (
          <div key={key} className="flex items-center gap-2">
            {showLabels && (
              <span className="text-[10px] text-stone-400 w-20 truncate">
                {driver.shortLabel}
              </span>
            )}
            <DriverBar driver={driver} compact />
          </div>
        ))}
      </div>
    );
  }
  
  return (
    <div className="grid grid-cols-2 gap-3">
      {driverList.map(({ key, driver }) => (
        <DriverBar key={key} driver={driver} />
      ))}
    </div>
  );
}

// ========== KEY OPPORTUNITY BADGE ==========

function KeyOpportunityBadge({ 
  opportunity 
}: { 
  opportunity: TerrainStorySummary['keyOpportunity'];
}) {
  if (!opportunity) return null;
  
  return (
    <div className="bg-amber-900/30 border border-amber-700/40 rounded-lg p-2.5">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] uppercase tracking-wider text-amber-400/80 font-medium">
              Key Opportunity
            </span>
            <span className="text-xs font-bold text-amber-300">
              {Math.round(opportunity.score * 100)}%
            </span>
          </div>
          <p className="text-xs text-amber-100 font-medium capitalize">
            {opportunity.location}
          </p>
          <p className="text-[10px] text-amber-300/70 mt-0.5">
            {opportunity.reason}
          </p>
        </div>
      </div>
    </div>
  );
}

// ========== MOVEMENT DRIVER BADGES ==========

function MovementDriverBadges({ 
  story 
}: { 
  story: TerrainStorySummary;
}) {
  const confidenceColors = {
    high: 'bg-emerald-900/40 border-emerald-700/40 text-emerald-300',
    medium: 'bg-cyan-900/40 border-cyan-700/40 text-cyan-300',
    low: 'bg-stone-800/60 border-stone-700/40 text-stone-400',
  };
  
  return (
    <div className="space-y-1.5">
      {/* Primary Driver */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-wider text-stone-500 w-16">Primary</span>
        <div className={`flex-1 px-2 py-1 rounded border ${confidenceColors[story.primaryDriver.confidence >= 0.6 ? 'high' : story.primaryDriver.confidence >= 0.4 ? 'medium' : 'low']}`}>
          <span className="text-[11px] font-medium">{story.primaryDriver.label}</span>
        </div>
      </div>
      
      {/* Secondary Driver */}
      {story.secondaryDriver && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-stone-500 w-16">Secondary</span>
          <div className={`flex-1 px-2 py-1 rounded border ${confidenceColors[story.secondaryDriver.confidence >= 0.5 ? 'medium' : 'low']}`}>
            <span className="text-[11px] font-medium">{story.secondaryDriver.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== MAIN TERRAIN STORY PANEL ==========

interface TerrainStoryPanelProps {
  story: TerrainStorySummary | null;
  isLoading?: boolean;
  defaultExpanded?: boolean;
  showNarrative?: boolean;
  compact?: boolean;
}

export default function TerrainStoryPanel({
  story,
  isLoading = false,
  defaultExpanded = true,
  showNarrative = true,
  compact = false,
}: TerrainStoryPanelProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  
  if (isLoading) {
    return (
      <div className="bg-stone-900/90 border border-stone-700/50 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-cyan-400" />
          <span className="text-xs text-stone-400">Analyzing terrain story...</span>
        </div>
      </div>
    );
  }
  
  if (!story) {
    return (
      <div className="bg-stone-900/90 border border-stone-700/50 rounded-lg p-3">
        <div className="flex items-center gap-2 text-stone-500">
          <Info className="h-4 w-4" />
          <span className="text-xs">Select a parcel to view terrain story</span>
        </div>
      </div>
    );
  }
  
  const confidenceBadge = {
    high: { label: 'High confidence', color: 'text-emerald-400 bg-emerald-900/40' },
    medium: { label: 'Medium confidence', color: 'text-cyan-400 bg-cyan-900/40' },
    low: { label: 'Low confidence', color: 'text-stone-400 bg-stone-800/60' },
  }[story.confidence];
  
  if (compact) {
    return (
      <div className="bg-stone-900/90 border border-stone-700/50 rounded-lg overflow-hidden">
        {/* Compact Header */}
        <div className="px-3 py-2 border-b border-stone-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-semibold text-white">Terrain Story</span>
            </div>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${confidenceBadge.color}`}>
              {confidenceBadge.label}
            </span>
          </div>
          <p className="text-[11px] text-stone-300 mt-1">{story.headline}</p>
        </div>
        
        {/* Compact Drivers */}
        <div className="p-3">
          <StructuralDriversGrid drivers={story.drivers} compact showLabels />
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-stone-900/90 border border-stone-700/50 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-stone-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Terrain Story</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${confidenceBadge.color}`}>
            {confidenceBadge.label}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-stone-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-stone-400" />
        )}
      </button>
      
      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Headline */}
          <div className="bg-gradient-to-r from-cyan-900/30 to-stone-900/30 rounded-lg px-3 py-2">
            <p className="text-sm text-cyan-100 font-medium">{story.headline}</p>
          </div>
          
          {/* Movement Drivers */}
          <div>
            <h4 className="text-[9px] uppercase tracking-wider text-stone-500 font-medium mb-2">
              Movement Drivers
            </h4>
            <MovementDriverBadges story={story} />
          </div>
          
          {/* Structural Drivers */}
          <div>
            <h4 className="text-[9px] uppercase tracking-wider text-stone-500 font-medium mb-2">
              Structural Support
            </h4>
            <StructuralDriversGrid drivers={story.drivers} />
          </div>
          
          {/* Key Opportunity */}
          {story.keyOpportunity && (
            <KeyOpportunityBadge opportunity={story.keyOpportunity} />
          )}
          
          {/* Narrative */}
          {showNarrative && (
            <div className="bg-stone-800/50 rounded-lg p-2.5">
              <p className="text-[11px] text-stone-300 leading-relaxed">
                {story.narrative}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ========== EXPORT LEGEND VERSION ==========

export function TerrainStoryExportLegend({ 
  story 
}: { 
  story: TerrainStorySummary | null;
}) {
  if (!story) return null;
  
  // PHASE 1 honesty guard: hide estimated (constant-blended) drivers entirely.
  const driverList = [
    { driver: story.drivers.benchSupport, label: 'Bench Support' },
    { driver: story.drivers.saddleInfluence, label: 'Saddle Influence' },
    { driver: story.drivers.ridgeSpineSupport, label: 'Ridge/Spine' },
    { driver: story.drivers.convergenceDensity, label: 'Convergence' },
  ].filter(({ driver }) => !driver.estimated);
  
  return (
    <div className="bg-stone-900/95 border border-stone-700/50 rounded-xl p-4 max-w-sm">
      {/* Title */}
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="h-5 w-5 text-cyan-400" />
        <h3 className="text-base font-bold text-white">Terrain Story</h3>
      </div>
      
      {/* Headline */}
      <p className="text-sm text-cyan-200 font-medium mb-4 leading-snug">
        {story.headline}
      </p>
      
      {/* Drivers Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
        {driverList.map(({ driver, label }, i) => {
          const Icon = DRIVER_ICONS[driver.icon];
          const color = getDriverColor(driver.score);
          const isEstimate = !!driver.estimated && driver.score > 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <Icon className="h-4 w-4 flex-shrink-0" style={{ color }} />
              <span className="text-xs text-white flex-1">{label}</span>
              <span className="text-xs font-bold" style={{ color }}>
                {isEstimate ? '~' : ''}{Math.round(driver.score * 100)}%
              </span>
            </div>
          );
        })}
      </div>
      
      {/* Primary Movement */}
      <div className="border-t border-stone-700/50 pt-3 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-stone-500 w-16">Primary:</span>
          <span className="text-xs text-emerald-300 font-medium">
            {story.primaryDriver.label}
          </span>
        </div>
        {story.secondaryDriver && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-stone-500 w-16">Secondary:</span>
            <span className="text-xs text-cyan-300 font-medium">
              {story.secondaryDriver.label}
            </span>
          </div>
        )}
        {story.keyOpportunity && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-stone-500 w-16">Key Zone:</span>
            <span className="text-xs text-amber-300 font-medium capitalize">
              {story.keyOpportunity.location}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
