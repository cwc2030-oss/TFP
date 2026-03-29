'use client';

import { Target, ChevronRight } from 'lucide-react';
import type { StandPointProperties } from '@/types/terrain';
import type { StandInputs, StandScore } from '@/lib/scoring/stand-alignment';
import { getStandExplainability, type ReasonChip, type QualityBar } from '@/lib/scoring/stand-explainability';

export type AlignedStand = {
  rank: number;
  name: string;
  props: StandPointProperties;
  inputs: StandInputs;
  alignment: StandScore;
  coords: [number, number];
  resilience?: {
    score: number;
    corridorCount: number;
    corridorCountScore: number;
    angularSpread: number;
    angularSpreadScore: number;
    centralityDist: number;
    centralityScore: number;
    reentryPaths: number;
    reentryScore: number;
    downwindDirs: number;
    downwindScore: number;
    label: string;
  };
};

interface StandAlignmentPanelProps {
  alignedStands: AlignedStand[];
  highlightedStandRank: number | null;
  selectedStand: number | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onStandClick: (stand: AlignedStand) => void;
}

// Chip color mapping
const chipStyles: Record<ReasonChip['tone'], { bg: string; text: string }> = {
  positive: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  neutral:  { bg: 'bg-stone-500/10', text: 'text-stone-400' },
  caution:  { bg: 'bg-red-500/15', text: 'text-red-400' },
};

function ChipBadge({ chip }: { chip: ReasonChip }) {
  const style = chipStyles[chip.tone];
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${style.bg} ${style.text} whitespace-nowrap`}>
      {chip.icon} {chip.label}
    </span>
  );
}

function QualityBarRow({ bar }: { bar: QualityBar }) {
  const pct = Math.round(bar.value * 100);
  const barColor = bar.value >= 0.65 ? 'bg-emerald-400' : bar.value >= 0.4 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[50px] text-[9px] text-stone-500">{bar.label}</span>
      <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-[32px] text-right text-[8px] text-stone-500">{bar.displayLabel}</span>
    </div>
  );
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

            // Explainability
            const explain = getStandExplainability(stand.inputs, stand.props, stand.alignment, stand.resilience);

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
                  {/* Row 1: Name + Score */}
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-sm font-medium truncate block">{stand.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2">
                      <span className="text-[9px] text-stone-500 uppercase">{tierLabel}</span>
                      <span className="text-white text-[13px] font-bold font-mono">{stand.alignment.score}</span>
                    </div>
                  </div>

                  {/* Row 2: Reason chips */}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {explain.chips.slice(0, 3).map((chip, i) => (
                      <ChipBadge key={i} chip={chip} />
                    ))}
                    {stand.resilience && (
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap ${
                        stand.resilience.score >= 70 ? 'bg-emerald-500/15 text-emerald-400' :
                        stand.resilience.score >= 40 ? 'bg-amber-500/15 text-amber-400' :
                        'bg-red-500/15 text-red-400'
                      }`}>
                        🛡️ {stand.resilience.label}
                      </span>
                    )}
                  </div>

                  {/* Row 3: One-line rationale */}
                  <p className="text-[9px] text-stone-500 mt-1 italic truncate">
                    {explain.rankRationale}
                  </p>
                </button>

                {/* Inline expanded details */}
                {isExpanded && (
                  <div className="pl-3 pr-2 pb-2.5 pt-1 border-t border-white/5 space-y-2">
                    {/* Quality bars */}
                    <div className="space-y-0.5">
                      {explain.qualityBars.map((bar, i) => (
                        <QualityBarRow key={i} bar={bar} />
                      ))}
                    </div>

                    {/* Key stats */}
                    <div className="grid grid-cols-3 gap-1 text-[9px]">
                      <div className="bg-white/[0.04] rounded px-1.5 py-1 text-center">
                        <span className="text-stone-500 block">Wind</span>
                        <span className="text-white font-medium">{stand.props.windOk[0] || 'N'}</span>
                      </div>
                      <div className="bg-white/[0.04] rounded px-1.5 py-1 text-center">
                        <span className="text-stone-500 block">Corridor</span>
                        <span className="text-white font-medium">{stand.props.distToCorridorMeters}m</span>
                      </div>
                      <div className="bg-white/[0.04] rounded px-1.5 py-1 text-center">
                        <span className="text-stone-500 block">Access</span>
                        <span className={`font-medium capitalize ${
                          stand.props.approachRisk === 'low' ? 'text-emerald-400' :
                          stand.props.approachRisk === 'medium' ? 'text-amber-400' :
                          'text-red-400'
                        }`}>{stand.props.approachRisk}</span>
                      </div>
                    </div>
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
