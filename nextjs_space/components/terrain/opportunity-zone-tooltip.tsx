/**
 * Opportunity Zone Tooltip
 * 
 * When hovering/clicking on an opportunity zone, shows a "Why Here?" tooltip
 * explaining the 4 structural drivers behind this high-value location.
 */

'use client';

import React from 'react';
import { X, Sparkles, TrendingUp, GitMerge, Mountain, Milestone } from 'lucide-react';
import type { OpportunityZoneProperties } from '@/types/terrain-flow';

interface OpportunityZoneTooltipProps {
  properties: OpportunityZoneProperties | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

// Score bar with visual fill
function DriverBar({ 
  label, 
  value, 
  icon: Icon, 
  color 
}: { 
  label: string; 
  value: number; 
  icon: React.ElementType;
  color: string;
}) {
  const percentage = Math.min(100, Math.round(value * 100));
  const barColor = percentage >= 50 ? color : percentage >= 25 ? '#64748b' : '#374151';
  
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: barColor }} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-0.5">
          <span className="text-[10px] text-amber-200/80">{label}</span>
          <span className="text-[10px] font-semibold" style={{ color: barColor }}>
            {percentage}%
          </span>
        </div>
        <div className="h-1.5 bg-amber-950/80 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${percentage}%`,
              background: `linear-gradient(90deg, ${barColor}60 0%, ${barColor} 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function OpportunityZoneTooltip({
  properties,
  position,
  onClose,
}: OpportunityZoneTooltipProps) {
  if (!properties || !position) return null;
  
  // The 4 structural drivers
  const drivers = [
    { 
      label: 'Bench Support', 
      value: properties.benchBonus || 0, 
      icon: Milestone, 
      color: '#a78bfa' // Purple
    },
    { 
      label: 'Saddle Influence', 
      value: properties.saddleBonus || 0, 
      icon: Mountain, 
      color: '#f97316' // Orange
    },
    { 
      label: 'Ridge/Spine', 
      value: properties.flowIntensity * 0.6 || 0, // Derived from flow
      icon: TrendingUp, 
      color: '#22d3ee' // Cyan
    },
    { 
      label: 'Convergence', 
      value: properties.convergenceBonus || 0, 
      icon: GitMerge, 
      color: '#fbbf24' // Amber
    },
  ];
  
  // Determine dominant driver for summary
  const sortedDrivers = [...drivers].sort((a, b) => b.value - a.value);
  const dominant = sortedDrivers[0];
  const secondary = sortedDrivers[1];
  
  // Generate why-here summary
  let summary = 'Multiple terrain factors combine here';
  if (dominant.value >= 0.3) {
    if (secondary.value >= 0.2) {
      summary = `${dominant.label} + ${secondary.label}`;
    } else {
      summary = `Strong ${dominant.label.toLowerCase()}`;
    }
  }
  
  // Position tooltip near click, but keep on screen
  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x + 15, window.innerWidth - 280),
    top: Math.min(position.y - 100, window.innerHeight - 380),
    zIndex: 1000,
  };
  
  return (
    <div
      className="w-64 bg-amber-950/95 backdrop-blur-md border border-amber-700/50 rounded-xl shadow-2xl overflow-hidden"
      style={tooltipStyle}
    >
      {/* Header */}
      <div className="px-3 py-2.5 bg-gradient-to-r from-amber-800/50 to-amber-950/50 border-b border-amber-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-100">Why Here?</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-amber-800/50 transition-colors"
        >
          <X className="h-4 w-4 text-amber-400" />
        </button>
      </div>
      
      {/* Score + Summary */}
      <div className="px-3 py-2.5 border-b border-amber-700/30 bg-amber-900/20">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-amber-300/70 uppercase tracking-wide">
            Opportunity Score
          </span>
          <span className="text-xl font-bold text-amber-300">
            {(properties.score * 100).toFixed(0)}%
          </span>
        </div>
        <p className="text-[11px] text-amber-200/80 italic">{summary}</p>
      </div>
      
      {/* 4 Structural Drivers */}
      <div className="px-3 py-3 space-y-2.5">
        <div className="text-[9px] text-amber-400/70 uppercase tracking-wider font-medium mb-2">
          Structural Drivers
        </div>
        
        {drivers.map((driver, i) => (
          <DriverBar
            key={i}
            label={driver.label}
            value={driver.value}
            icon={driver.icon}
            color={driver.color}
          />
        ))}
      </div>
      
      {/* Radius + tip */}
      <div className="px-3 py-2 bg-amber-900/30 border-t border-amber-700/30">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-amber-400/60">
            Radius: {properties.radiusM?.toFixed(0) || '~50'}m
          </span>
          <span className="text-[9px] text-amber-400/60 italic">
            Click flow lines to inspect
          </span>
        </div>
      </div>
    </div>
  );
}
