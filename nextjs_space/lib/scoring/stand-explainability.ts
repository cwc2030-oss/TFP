/**
 * Stand Explainability Engine
 * 
 * Derives human-readable reason chips, ranking rationale,
 * and quality indicators from stand scoring data.
 */
import type { StandInputs, StandScore } from './stand-alignment';
import type { StandPointProperties } from '@/types/terrain';

// ========== TYPES ==========

export interface ReasonChip {
  icon: string;       // emoji
  label: string;      // short text
  tone: 'positive' | 'neutral' | 'caution'; // color intent
}

export interface QualityBar {
  label: string;
  value: number;      // 0-1
  displayLabel: string; // e.g., "Strong", "Weak"
}

export interface StandExplainability {
  chips: ReasonChip[];           // 2-4 concise reason chips
  qualityBars: QualityBar[];     // input quality breakdown
  rankRationale: string;         // 1-sentence explanation of ranking
  strengthLabel: string;         // primary strength in 2-3 words
  weaknessLabel: string | null;  // primary weakness (or null if none)
}

// ========== CHIP GENERATORS ==========

function getInterceptChip(inputs: StandInputs): ReasonChip {
  if (inputs.movement >= 0.75) return { icon: '🎯', label: 'Prime Intercept', tone: 'positive' };
  if (inputs.movement >= 0.5)  return { icon: '🎯', label: 'Good Intercept', tone: 'positive' };
  if (inputs.movement >= 0.3)  return { icon: '🎯', label: 'Moderate Intercept', tone: 'neutral' };
  return { icon: '🎯', label: 'Weak Intercept', tone: 'caution' };
}

function getPressureChip(inputs: StandInputs): ReasonChip {
  const pressure = inputs.intrusion;
  if (pressure <= 0.2) return { icon: '🛡️', label: 'Low Pressure', tone: 'positive' };
  if (pressure <= 0.5) return { icon: '🛡️', label: 'Moderate Pressure', tone: 'neutral' };
  return { icon: '⚠️', label: 'High Pressure', tone: 'caution' };
}

function getWindChip(inputs: StandInputs): ReasonChip {
  const windOk = 1 - inputs.wind_overlap; // invert: lower overlap = better
  if (windOk >= 0.75) return { icon: '🌬️', label: 'Clean Wind', tone: 'positive' };
  if (windOk >= 0.45) return { icon: '🌬️', label: 'Fair Wind', tone: 'neutral' };
  return { icon: '🌬️', label: 'Risky Wind', tone: 'caution' };
}

function getResilienceChip(resilience?: { score: number; label: string }): ReasonChip | null {
  if (!resilience) return null;
  if (resilience.score >= 70) return { icon: '🏔️', label: 'High Resilience', tone: 'positive' };
  if (resilience.score >= 40) return { icon: '🏔️', label: 'Moderate Resilience', tone: 'neutral' };
  return { icon: '🏔️', label: 'Low Resilience', tone: 'caution' };
}

function getAccessChip(props: StandPointProperties): ReasonChip {
  if (props.approachRisk === 'low') return { icon: '🚶', label: 'Easy Access', tone: 'positive' };
  if (props.approachRisk === 'medium') return { icon: '🚶', label: 'Moderate Access', tone: 'neutral' };
  return { icon: '🚶', label: 'Difficult Access', tone: 'caution' };
}

function getInteriorChip(props: StandPointProperties): ReasonChip | null {
  // Interior vs edge: high TPI landscape = ridge/exposed, low = interior/protected
  if (props.tpiLandscape < -2) return { icon: '🌲', label: 'Deep Interior', tone: 'positive' };
  if (props.tpiLandscape < 1) return { icon: '🌲', label: 'Interior', tone: 'neutral' };
  if (props.tpiLandscape > 3) return { icon: '⛰️', label: 'Ridge Exposed', tone: 'caution' };
  return null;
}

// ========== QUALITY BARS ==========

function buildQualityBars(inputs: StandInputs): QualityBar[] {
  const scoreLabel = (v: number, invert = false): string => {
    const val = invert ? 1 - v : v;
    if (val >= 0.75) return 'Strong';
    if (val >= 0.5) return 'Good';
    if (val >= 0.3) return 'Fair';
    return 'Weak';
  };

  return [
    { label: 'Intercept', value: inputs.movement, displayLabel: scoreLabel(inputs.movement) },
    { label: 'Wind', value: 1 - inputs.wind_overlap, displayLabel: scoreLabel(inputs.wind_overlap, true) },
    { label: 'Pressure', value: 1 - inputs.intrusion, displayLabel: scoreLabel(inputs.intrusion, true) },
    { label: 'Season', value: inputs.season_fit, displayLabel: scoreLabel(inputs.season_fit) },
  ];
}

// ========== RATIONALE ==========

function buildRankRationale(
  inputs: StandInputs,
  props: StandPointProperties,
  alignment: StandScore,
  resilience?: { score: number; label: string }
): string {
  // Find the strongest and weakest inputs
  const factors: { name: string; value: number; isInverted?: boolean }[] = [
    { name: 'intercept quality', value: inputs.movement },
    { name: 'wind position', value: 1 - inputs.wind_overlap, isInverted: true },
    { name: 'low pressure', value: 1 - inputs.intrusion, isInverted: true },
    { name: 'season fit', value: inputs.season_fit },
  ];

  const sorted = [...factors].sort((a, b) => b.value - a.value);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  let rationale = `Ranked by ${strongest.name}`;

  // Add resilience context
  if (resilience && resilience.score >= 60) {
    rationale += ` with ${resilience.label.toLowerCase()} resilience`;
  }

  // Add weakness caveat if significant
  if (weakest.value < 0.35) {
    rationale += `, limited by ${weakest.name}`;
  }

  return rationale + '.';
}

function findStrengthLabel(inputs: StandInputs): string {
  const factors: { name: string; value: number }[] = [
    { name: 'Intercept', value: inputs.movement },
    { name: 'Wind', value: 1 - inputs.wind_overlap },
    { name: 'Cover', value: 1 - inputs.intrusion },
    { name: 'Season', value: inputs.season_fit },
  ];
  const top = factors.sort((a, b) => b.value - a.value)[0];
  return `${top.name} ${top.value >= 0.7 ? 'Advantage' : 'Favorable'}`;
}

function findWeaknessLabel(inputs: StandInputs): string | null {
  const factors: { name: string; value: number }[] = [
    { name: 'Intercept', value: inputs.movement },
    { name: 'Wind', value: 1 - inputs.wind_overlap },
    { name: 'Pressure', value: 1 - inputs.intrusion },
    { name: 'Season', value: inputs.season_fit },
  ];
  const bottom = factors.sort((a, b) => a.value - b.value)[0];
  if (bottom.value < 0.35) return `Weak ${bottom.name}`;
  return null;
}

// ========== MAIN EXPORT ==========

export function getStandExplainability(
  inputs: StandInputs,
  props: StandPointProperties,
  alignment: StandScore,
  resilience?: { score: number; label: string }
): StandExplainability {
  // Build chips — pick the most relevant 3-4
  const allChips: (ReasonChip | null)[] = [
    getInterceptChip(inputs),
    getWindChip(inputs),
    getPressureChip(inputs),
    getResilienceChip(resilience),
    getAccessChip(props),
    getInteriorChip(props),
  ];

  // Filter nulls, then pick top 4 (prefer positive, then neutral, then caution)
  const validChips = allChips.filter((c): c is ReasonChip => c !== null);
  const sorted = validChips.sort((a, b) => {
    const order = { positive: 0, neutral: 1, caution: 2 };
    return order[a.tone] - order[b.tone];
  });
  const chips = sorted.slice(0, 4);

  return {
    chips,
    qualityBars: buildQualityBars(inputs),
    rankRationale: buildRankRationale(inputs, props, alignment, resilience),
    strengthLabel: findStrengthLabel(inputs),
    weaknessLabel: findWeaknessLabel(inputs),
  };
}

// ========== HTML CHIP RENDERER (for map tooltips/popups) ==========

export function renderChipsHTML(chips: ReasonChip[]): string {
  return chips.map(c => {
    const bg = c.tone === 'positive' ? 'rgba(34,197,94,0.15)' :
               c.tone === 'caution' ? 'rgba(239,68,68,0.15)' :
               'rgba(255,255,255,0.08)';
    const color = c.tone === 'positive' ? '#4ade80' :
                  c.tone === 'caution' ? '#f87171' :
                  '#a8a29e';
    return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;font-size:10px;background:${bg};color:${color};white-space:nowrap;">${c.icon} ${c.label}</span>`;
  }).join(' ');
}

export function renderQualityBarsHTML(bars: QualityBar[]): string {
  return bars.map(b => {
    const pct = Math.round(b.value * 100);
    const barColor = b.value >= 0.65 ? '#4ade80' : b.value >= 0.4 ? '#fbbf24' : '#f87171';
    return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
      <span style="width:60px;font-size:10px;color:#78716c;">${b.label}</span>
      <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${barColor};border-radius:2px;"></div>
      </div>
      <span style="width:36px;text-align:right;font-size:9px;color:#a8a29e;">${b.displayLabel}</span>
    </div>`;
  }).join('');
}
