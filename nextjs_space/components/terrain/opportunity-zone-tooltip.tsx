/**
 * Opportunity Zone Tooltip
 * 
 * When hovering/clicking on an opportunity zone, shows a "Why Here?" tooltip
 * explaining the upstream factors driving this high-value location.
 */

'use client';

import React from 'react';
import { X, Sparkles, TrendingUp, GitMerge, Mountain, Droplets } from 'lucide-react';
import type { OpportunityZoneProperties } from '@/types/terrain-flow';

interface OpportunityZoneTooltipProps {
  properties: OpportunityZoneProperties | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function OpportunityZoneTooltip({
  properties,
  position,
  onClose,
}: OpportunityZoneTooltipProps) {
  if (!properties || !position) return null;
  
  // Calculate factors driving this opportunity
  const factors: { label: string; value: number; icon: React.ElementType; color: string }[] = [];
  
  if (properties.flowIntensity > 0.3) {
    factors.push({
      label: 'High flow intensity',
      value: properties.flowIntensity,
      icon: TrendingUp,
      color: '#22d3ee',
    });
  }
  
  if (properties.convergenceBonus > 0.2) {
    factors.push({
      label: 'Flow convergence',
      value: properties.convergenceBonus,
      icon: GitMerge,
      color: '#fbbf24',
    });
  }
  
  if (properties.benchBonus > 0.2) {
    factors.push({
      label: 'Bench terrain bonus',
      value: properties.benchBonus,
      icon: Mountain,
      color: '#a78bfa',
    });
  }
  
  if (properties.saddleBonus > 0.2) {
    factors.push({
      label: 'Saddle proximity',
      value: properties.saddleBonus,
      icon: Droplets,
      color: '#f97316',
    });
  }
  
  // Position tooltip near click, but keep on screen
  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x + 15, window.innerWidth - 260),
    top: Math.min(position.y - 80, window.innerHeight - 300),
    zIndex: 1000,
  };
  
  return (
    <div
      className="w-56 bg-amber-950/95 backdrop-blur-md border border-amber-700/50 rounded-lg shadow-2xl overflow-hidden"
      style={tooltipStyle}
    >
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-amber-800/50 to-amber-950/50 border-b border-amber-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-100">Why Here?</span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-amber-800/50 transition-colors"
        >
          <X className="h-3.5 w-3.5 text-amber-400" />
        </button>
      </div>
      
      {/* Score */}
      <div className="px-3 py-2 border-b border-amber-700/30">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-amber-300/80 uppercase tracking-wide">Opportunity Score</span>
          <span className="text-lg font-bold text-amber-300">{(properties.score * 100).toFixed(0)}%</span>
        </div>
      </div>
      
      {/* Factors */}
      <div className="px-3 py-2 space-y-2">
        <div className="text-[9px] text-amber-400/70 uppercase tracking-wider font-medium">
          Driving Factors
        </div>
        
        {factors.length > 0 ? (
          factors.map((factor, i) => (
            <div key={i} className="flex items-center gap-2">
              <factor.icon className="h-3.5 w-3.5" style={{ color: factor.color }} />
              <span className="text-[11px] text-amber-100 flex-1">{factor.label}</span>
              <span className="text-[10px] font-medium" style={{ color: factor.color }}>
                +{(factor.value * 100).toFixed(0)}%
              </span>
            </div>
          ))
        ) : (
          <div className="text-[11px] text-amber-300/60 italic">
            Multiple terrain factors combine here
          </div>
        )}
      </div>
      
      {/* Radius info */}
      <div className="px-3 py-1.5 bg-amber-900/30 border-t border-amber-700/30">
        <div className="text-[9px] text-amber-400/60 text-center">
          Effective radius: {properties.radiusM?.toFixed(0) || '~50'}m
        </div>
      </div>
    </div>
  );
}
