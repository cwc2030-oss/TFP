'use client';

import { Target, ChevronRight } from 'lucide-react';
import type { StandPointProperties } from '@/types/terrain';
import type { StandInputs, StandScore } from '@/lib/scoring/stand-alignment';
import { getStandExplainability, type ReasonChip, type QualityBar, type KeyIndicator } from '@/lib/scoring/stand-explainability';

/** Terrain feature that anchors a stand to defensible ground. */
export type TerrainAnchor = {
  type: 'ridge' | 'saddle' | 'funnel';
  /** Distance in metres to nearest qualifying feature. 0 = inside polygon. */
  distanceM: number;
  featureId?: string;
};

export type AlignedStand = {
  rank: number;
  name: string;
  props: StandPointProperties;
  inputs: StandInputs;
  alignment: StandScore;
  coords: [number, number];
  /** True when stand was placed by the engine but could not be verified inside the parcel boundary. */
  unverified?: boolean;
  /** Phase 2: terrain anchor — the closest qualifying terrain feature justifying this stand. */
  anchorFeature?: TerrainAnchor;
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

/** Indicator color logic — Pressure is inverted (high pressure = bad) */
function indicatorColor(ind: KeyIndicator): { bg: string; text: string } {
  const isPressure = ind.label === 'Pressure';
  if (ind.level === 'high') {
    return isPressure
      ? { bg: 'bg-red-500/15', text: 'text-red-400' }
      : { bg: 'bg-emerald-500/15', text: 'text-emerald-400' };
  }
  if (ind.level === 'low') {
    return isPressure
      ? { bg: 'bg-emerald-500/15', text: 'text-emerald-400' }
      : { bg: 'bg-red-500/15', text: 'text-red-400' };
  }
  return { bg: 'bg-amber-500/10', text: 'text-amber-400' };
}

function IndicatorBadge({ indicator }: { indicator: KeyIndicator }) {
  const c = indicatorColor(indicator);
  return (
    <div className={`flex-1 text-center py-1 px-1 rounded-md ${c.bg}`}>
      <div className="text-[7px] text-stone-500 leading-tight">{indicator.label}</div>
      <div className={`text-[10px] font-semibold leading-tight ${c.text}`}>{indicator.displayLabel}</div>
    </div>
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
          {alignedStands.slice(0, 3).map((stand, standIdx) => {
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
            const SIT_LABELS_PANEL = ["Today's Sit", 'Alternate Sit', 'Backup Sit'] as const;
            const sitLabel = SIT_LABELS_PANEL[standIdx] || `Stand #${standIdx + 1}`;
            const isTodaysSit = standIdx === 0;
            const badgeBg = isTodaysSit ? 'bg-amber-500/20' : standIdx === 1 ? 'bg-sky-500/15' : 'bg-stone-500/15';
            const badgeText = isTodaysSit ? 'text-amber-400' : standIdx === 1 ? 'text-sky-400' : 'text-stone-400';

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
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className={`text-[8px] ${badgeBg} ${badgeText} px-1.5 py-0.5 rounded font-semibold whitespace-nowrap`}>
                        {isTodaysSit ? '★' : `#${standIdx + 1}`} {sitLabel.split(' ').slice(-1)[0].toUpperCase()}
                      </span>
                      <span className="text-white text-sm font-medium truncate block">{stand.name}</span>
                      {stand.unverified && (
                        <span className="text-[7px] bg-amber-700/80 text-amber-100 px-1 py-0.5 rounded font-semibold whitespace-nowrap" title="Engine-placed stand could not be confirmed inside parcel boundary — verify on-site">⚠ VERIFY</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 ml-2">
                      <span className="text-[9px] text-stone-500 uppercase">{tierLabel}</span>
                      <span className="text-white text-[13px] font-bold font-mono">{stand.alignment.score}</span>
                    </div>
                  </div>

                  {/* Row 1b: Terrain anchor */}
                  {stand.anchorFeature && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[8px] text-stone-500">Anchored to:</span>
                      <span className="text-[8px] font-medium text-teal-400">
                        {stand.anchorFeature.type === 'ridge' ? 'Ridge Spine' :
                         stand.anchorFeature.type === 'saddle' ? 'Saddle' :
                         'Funnel'}
                        {' '}
                        ({stand.anchorFeature.distanceM === 0 ? 'inside' : `${stand.anchorFeature.distanceM}m`})
                      </span>
                    </div>
                  )}

                  {/* Row 2: Key Indicators — 3 small badges */}
                  <div className="flex gap-1 mt-1.5">
                    {explain.keyIndicators.map((ind, i) => (
                      <IndicatorBadge key={i} indicator={ind} />
                    ))}
                  </div>

                  {/* Row 3: Reason chips */}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {explain.chips.slice(0, 3).map((chip, i) => (
                      <ChipBadge key={i} chip={chip} />
                    ))}
                  </div>

                  {/* Row 4: One-line rationale */}
                  <p className="text-[9px] text-stone-500 mt-1 italic truncate">
                    {explain.rankRationale}
                  </p>
                </button>

                {/* Inline expanded details — full explanation panel */}
                {isExpanded && (
                  <div className="pl-3 pr-2 pb-2.5 pt-1.5 border-t border-white/5 space-y-2.5">
                    {/* Natural language explanation */}
                    <div className="bg-white/[0.03] rounded-lg px-2.5 py-2 border border-white/[0.04]">
                      <p className="text-[10px] text-stone-400 leading-relaxed">
                        {explain.selectionExplanation}
                      </p>
                    </div>

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
