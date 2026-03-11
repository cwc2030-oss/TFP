/**
 * Flow Segment Inspector Panel
 * 
 * When a user clicks on a flow segment, this panel opens to show:
 * - Overall likelihood score
 * - Component scores (slope, bench, saddle, spine, convergence)
 * - Penalties (steep slope, drainage)
 * - Plain-English explanation of why this flow path exists
 */

'use client';

import React from 'react';
import { X, TrendingUp, Mountain, MapPin, GitMerge, AlertTriangle, Activity, Info } from 'lucide-react';
import type { FlowSegmentScoreResponse, FlowSegmentComponentScores } from '@/types/terrain-flow';

interface FlowSegmentInspectorProps {
  data: FlowSegmentScoreResponse | null;
  isLoading: boolean;
  onClose: () => void;
  position?: { x: number; y: number } | null;
}

// Score bar with color gradient based on value
function ScoreBar({ label, value, color, icon: Icon, isNegative = false }: {
  label: string;
  value: number;
  color: string;
  icon?: React.ElementType;
  isNegative?: boolean;
}) {
  const percentage = Math.min(100, Math.max(0, value * 100));
  const displayValue = (value * 100).toFixed(0);
  
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="h-3.5 w-3.5 text-stone-400 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-0.5">
          <span className="text-[10px] text-stone-400 truncate">{label}</span>
          <span className={`text-[10px] font-medium ${isNegative ? 'text-red-400' : 'text-white'}`}>
            {isNegative ? '-' : ''}{displayValue}%
          </span>
        </div>
        <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${percentage}%`,
              background: isNegative 
                ? `linear-gradient(90deg, rgba(239,68,68,0.3) 0%, rgba(239,68,68,0.8) 100%)`
                : `linear-gradient(90deg, ${color}40 0%, ${color} 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// Confidence badge based on total likelihood
function ConfidenceBadge({ likelihood }: { likelihood: number }) {
  let label: string;
  let bgColor: string;
  let textColor: string;
  
  if (likelihood >= 0.7) {
    label = 'Strong terrain support';
    bgColor = 'bg-emerald-900/50';
    textColor = 'text-emerald-400';
  } else if (likelihood >= 0.5) {
    label = 'Moderate terrain support';
    bgColor = 'bg-amber-900/50';
    textColor = 'text-amber-400';
  } else {
    label = 'Weak terrain support';
    bgColor = 'bg-red-900/40';
    textColor = 'text-red-400';
  }
  
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${bgColor}`}>
      <Activity className={`h-3 w-3 ${textColor}`} />
      <span className={`text-[10px] font-medium ${textColor}`}>{label}</span>
    </div>
  );
}

export default function FlowSegmentInspector({
  data,
  isLoading,
  onClose,
  position,
}: FlowSegmentInspectorProps) {
  if (!data && !isLoading) return null;
  
  const scores = data?.scores;
  
  // Position calculation - either floating near click or fixed panel
  const panelStyle: React.CSSProperties = position
    ? {
        position: 'fixed',
        left: Math.min(position.x + 20, window.innerWidth - 320),
        top: Math.min(position.y - 100, window.innerHeight - 400),
        zIndex: 1000,
      }
    : {};
  
  return (
    <div
      className="w-72 bg-stone-900/95 backdrop-blur-md border border-stone-700/50 rounded-xl shadow-2xl overflow-hidden"
      style={panelStyle}
    >
      {/* Header */}
      <div className="px-3 py-2.5 bg-gradient-to-r from-cyan-900/50 to-stone-900/50 border-b border-stone-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Flow Segment Analysis</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-stone-700/50 transition-colors"
        >
          <X className="h-4 w-4 text-stone-400" />
        </button>
      </div>
      
      {/* Content */}
      <div className="p-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400" />
            <span className="ml-2 text-sm text-stone-400">Analyzing segment...</span>
          </div>
        ) : scores ? (
          <>
            {/* Overall Likelihood Score */}
            <div className="text-center pb-2 border-b border-stone-700/50">
              <div className="text-3xl font-bold text-white mb-1">
                {(scores.total_likelihood * 100).toFixed(0)}%
              </div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wide mb-2">
                Overall Likelihood
              </div>
              <ConfidenceBadge likelihood={scores.total_likelihood} />
            </div>
            
            {/* Component Scores */}
            <div className="space-y-2">
              <div className="text-[9px] uppercase tracking-wider text-stone-500 font-medium">
                Terrain Components
              </div>
              
              <ScoreBar
                label="Slope Preference"
                value={scores.slope_preference}
                color="#22d3ee"
                icon={TrendingUp}
              />
              
              <ScoreBar
                label="Bench Likelihood"
                value={scores.bench_likelihood}
                color="#a78bfa"
                icon={Mountain}
              />
              
              <ScoreBar
                label="Saddle Proximity"
                value={scores.saddle_proximity}
                color="#f97316"
                icon={MapPin}
              />
              
              <ScoreBar
                label="Spine/Ridge Proximity"
                value={scores.spine_proximity}
                color="#84cc16"
                icon={Mountain}
              />
              
              <ScoreBar
                label="Terrain Convergence"
                value={scores.terrain_convergence}
                color="#fbbf24"
                icon={GitMerge}
              />
            </div>
            
            {/* Penalties */}
            {(scores.extreme_slope_penalty > 0.1 || scores.cut_penalty > 0.1) && (
              <div className="space-y-2 pt-2 border-t border-stone-700/50">
                <div className="text-[9px] uppercase tracking-wider text-red-400/80 font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Penalties Applied
                </div>
                
                {scores.extreme_slope_penalty > 0.1 && (
                  <ScoreBar
                    label="Steep Slope Penalty"
                    value={scores.extreme_slope_penalty}
                    color="#ef4444"
                    isNegative
                  />
                )}
                
                {scores.cut_penalty > 0.1 && (
                  <ScoreBar
                    label="Drainage Cut Penalty"
                    value={scores.cut_penalty}
                    color="#ef4444"
                    isNegative
                  />
                )}
              </div>
            )}
            
            {/* Explanation */}
            {data?.explanation && (
              <div className="pt-2 border-t border-stone-700/50">
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-stone-500 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-stone-300 leading-relaxed whitespace-pre-line">
                    {data.explanation}
                  </p>
                </div>
              </div>
            )}
            
            {/* Point count */}
            {data?.pointScores && (
              <div className="text-[9px] text-stone-600 text-center pt-1">
                Analyzed {data.pointScores.length} points along segment
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4 text-stone-500 text-sm">
            No data available
          </div>
        )}
      </div>
    </div>
  );
}
