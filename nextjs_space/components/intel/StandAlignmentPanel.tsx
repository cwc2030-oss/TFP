'use client';

import { Target, ChevronRight } from 'lucide-react';
import type { StandPointProperties } from '@/types/terrain';
import type { StandInputs, StandScore } from '@/lib/scoring/stand-alignment';

export type AlignedStand = {
  rank: number;
  name: string;
  props: StandPointProperties;
  inputs: StandInputs;
  alignment: StandScore;
  coords: [number, number];
};

interface StandAlignmentPanelProps {
  alignedStands: AlignedStand[];
  highlightedStandRank: number | null;
  selectedStand: number | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onStandClick: (stand: AlignedStand) => void;
}

export function StandAlignmentPanel({
  alignedStands,
  highlightedStandRank,
  selectedStand,
  expanded,
  onToggleExpanded,
  onStandClick,
}: StandAlignmentPanelProps) {
  // Check if top two stands are within ≤3 pts (comparable)
  const isComparable = alignedStands.length >= 2 &&
    Math.abs(alignedStands[0].alignment.score - alignedStands[1].alignment.score) <= 3;
  const headerTitle = isComparable ? 'Comparable Alignment Today' : 'Stand Alignment';
  const collapsedSummary = alignedStands.length > 0
    ? alignedStands[0].name
    : 'Stand Alignment';

  return (
    <div className="border-b border-white/10">
      {/* Header — always visible */}
      <button
        onClick={onToggleExpanded}
        className="w-full p-3 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-stone-400" />
          <span className="font-medium text-white text-sm">
            {expanded ? headerTitle : collapsedSummary}
          </span>
        </div>
        <ChevronRight
          className={`h-4 w-4 text-white/50 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* Expanded content — top 3 stands */}
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {alignedStands.slice(0, 3).map((stand) => {
            const isHighlighted = highlightedStandRank === stand.rank;
            const isExpanded = selectedStand === stand.rank;

            const tierLabel = stand.alignment.label === 'Open Ground' ? 'Field Stone' : stand.alignment.label;
            const accentColors: Record<string, string> = {
              'Deep Moss': '#4a7c59',
              'Weathered Oak': '#8b7355',
              'Field Stone': '#708090',
            };
            const accentColor = accentColors[tierLabel] || '#708090';

            return (
              <div
                key={stand.rank}
                className={`
                  relative rounded-lg overflow-hidden transition-colors
                  ${isHighlighted ? 'bg-stone-800/60' : 'bg-stone-900/40 hover:bg-stone-800/40'}
                `}
              >
                {/* Thin left accent bar */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
                  style={{ background: accentColor }}
                />

                {/* Main card content */}
                <button
                  onClick={() => onStandClick(stand)}
                  className="w-full pl-3 pr-2 py-2 text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-sm font-medium truncate block">{stand.name}</span>
                      <span className="text-stone-500 text-xs">{tierLabel}</span>
                    </div>
                    <span className="text-stone-600 text-[11px] font-mono ml-2">{stand.alignment.score}</span>
                  </div>
                </button>

                {/* Inline expanded details */}
                {isExpanded && (
                  <div className="pl-3 pr-2 pb-2 pt-1 border-t border-white/5 text-xs text-stone-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Face:</span>
                      <span className="text-white">{stand.props.windOk[0] || 'N'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Intrusion:</span>
                      <span className="text-white capitalize">{stand.props.approachRisk}</span>
                    </div>
                    {stand.props.distToCorridorMeters > 0 && (
                      <div className="flex justify-between">
                        <span>To corridor:</span>
                        <span className="text-white">{stand.props.distToCorridorMeters}m</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
