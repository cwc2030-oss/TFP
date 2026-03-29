/**
 * Stand Explainability Engine — V4 Step 9
 * 
 * Derives human-readable reason chips, ranking rationale,
 * key indicators, and natural-language explanations from stand scoring data.
 */
import type { StandInputs, StandScore } from './stand-alignment';
import type { StandPointProperties } from '@/types/terrain';

// ========== TYPES ==========

export interface ReasonChip {
  icon: string;       // emoji
  label: string;      // short text
  tone: 'positive' | 'neutral' | 'caution'; // color intent
}

export type IndicatorLevel = 'high' | 'medium' | 'low';

export interface KeyIndicator {
  label: string;          // e.g. "Resilience"
  level: IndicatorLevel;  // high / medium / low
  displayLabel: string;   // e.g. "High", "Moderate", "Low"
}

export interface QualityBar {
  label: string;
  value: number;      // 0-1
  displayLabel: string; // e.g., "Strong", "Weak"
}

export interface StandExplainability {
  chips: ReasonChip[];           // 2-4 concise reason chips
  keyIndicators: KeyIndicator[]; // 3 prominent quality signals
  qualityBars: QualityBar[];     // input quality breakdown
  rankRationale: string;         // 1-sentence natural explanation
  selectionExplanation: string;  // full paragraph when stand is selected
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
  const windOk = 1 - inputs.wind_overlap;
  if (windOk >= 0.75) return { icon: '🌬️', label: 'Leeward Advantage', tone: 'positive' };
  if (windOk >= 0.45) return { icon: '🌬️', label: 'Fair Wind', tone: 'neutral' };
  return { icon: '🌬️', label: 'Risky Wind', tone: 'caution' };
}

function getCorridorChip(props: StandPointProperties): ReasonChip {
  if (props.distToCorridorMeters <= 30) return { icon: '🦌', label: 'Primary Corridor', tone: 'positive' };
  if (props.distToCorridorMeters <= 80) return { icon: '🦌', label: 'Near Corridor', tone: 'positive' };
  if (props.distToCorridorMeters <= 150) return { icon: '🦌', label: 'Corridor Access', tone: 'neutral' };
  return { icon: '🦌', label: 'Off Corridor', tone: 'caution' };
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
  if (props.tpiLandscape < -2) return { icon: '🌲', label: 'Interior Access', tone: 'positive' };
  if (props.tpiLandscape < 1) return { icon: '🌲', label: 'Interior', tone: 'neutral' };
  if (props.tpiLandscape > 3) return { icon: '⛰️', label: 'Ridge Exposed', tone: 'caution' };
  return null;
}

// ========== KEY INDICATORS ==========

function buildKeyIndicators(
  inputs: StandInputs,
  resilience?: { score: number; label: string }
): KeyIndicator[] {
  // Resilience
  const resLevel: IndicatorLevel = resilience
    ? (resilience.score >= 65 ? 'high' : resilience.score >= 35 ? 'medium' : 'low')
    : 'medium';
  const resDisplay = resLevel === 'high' ? 'High' : resLevel === 'medium' ? 'Moderate' : 'Low';

  // Pressure exposure (inverted intrusion)
  const pressVal = inputs.intrusion;
  const pressLevel: IndicatorLevel = pressVal <= 0.25 ? 'low' : pressVal <= 0.55 ? 'medium' : 'high';
  const pressDisplay = pressLevel === 'low' ? 'Low' : pressLevel === 'medium' ? 'Moderate' : 'High';

  // Intercept quality
  const intVal = inputs.movement;
  const intLevel: IndicatorLevel = intVal >= 0.65 ? 'high' : intVal >= 0.35 ? 'medium' : 'low';
  const intDisplay = intLevel === 'high' ? 'Strong' : intLevel === 'medium' ? 'Moderate' : 'Weak';

  return [
    { label: 'Intercept', level: intLevel, displayLabel: intDisplay },
    { label: 'Pressure', level: pressLevel, displayLabel: pressDisplay },
    { label: 'Resilience', level: resLevel, displayLabel: resDisplay },
  ];
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

// ========== NATURAL LANGUAGE RATIONALE ==========

/**
 * Builds a concise, conversational 1-line rationale.
 * Reads like a sentence a hunting guide would say.
 */
function buildRankRationale(
  inputs: StandInputs,
  props: StandPointProperties,
  alignment: StandScore,
  resilience?: { score: number; label: string }
): string {
  // Human-friendly factor names and values (higher = better)
  const factors = [
    { key: 'intercept',  name: 'strong intercept point',  friendlyName: 'intercept quality',  value: inputs.movement },
    { key: 'wind',       name: 'downwind advantage',      friendlyName: 'wind position',       value: 1 - inputs.wind_overlap },
    { key: 'pressure',   name: 'low pressure exposure',   friendlyName: 'low pressure',        value: 1 - inputs.intrusion },
    { key: 'season',     name: 'seasonal timing',         friendlyName: 'season fit',          value: inputs.season_fit },
  ];

  const sorted = [...factors].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const second = sorted[1];

  // Natural language construction
  let rationale = '';
  if (top.value >= 0.65 && second.value >= 0.55) {
    rationale = `Strong ${top.friendlyName} and ${second.friendlyName}`;
  } else if (top.value >= 0.55) {
    rationale = `Favored for ${top.name}`;
  } else {
    rationale = `Best available ${top.friendlyName}`;
  }

  // Corridor proximity adds context
  if (props.distToCorridorMeters <= 40) {
    rationale += ', sits on a primary corridor';
  } else if (props.distToCorridorMeters <= 100) {
    rationale += ', near a travel corridor';
  }

  // Resilience adds confidence
  if (resilience && resilience.score >= 65) {
    rationale += ' with strong resilience';
  }

  return rationale + '.';
}

/**
 * Builds a full natural-language explanation for the selected stand detail view.
 * Answers: "Why does this stand rank where it does?"
 */
function buildSelectionExplanation(
  rank: number,
  inputs: StandInputs,
  props: StandPointProperties,
  alignment: StandScore,
  resilience?: { score: number; label: string }
): string {
  const ordinal = rank === 1 ? '#1' : rank === 2 ? '#2' : rank === 3 ? '#3' : `#${rank}`;

  // Collect strengths (value >= 0.55) and weaknesses (value < 0.35)
  const factorDescriptions = [
    { name: 'sits near a primary travel corridor',   value: inputs.movement,          threshold: 0.55 },
    { name: 'has a strong downwind advantage',        value: 1 - inputs.wind_overlap,  threshold: 0.55 },
    { name: 'has low hunting pressure exposure',      value: 1 - inputs.intrusion,     threshold: 0.55 },
    { name: 'aligns well with the current season',    value: inputs.season_fit,        threshold: 0.55 },
  ];

  const strengths = factorDescriptions.filter(f => f.value >= f.threshold);
  const weaknesses = factorDescriptions.filter(f => f.value < 0.3);

  // Corridor proximity detail
  const corridorDetail = props.distToCorridorMeters <= 40
    ? 'on a primary corridor'
    : props.distToCorridorMeters <= 100
    ? 'near a movement corridor'
    : 'with corridor access';

  let explanation = `This stand ranks ${ordinal} because it ${corridorDetail}`;

  if (strengths.length >= 2) {
    explanation += `, ${strengths[0].name}, and ${strengths[1].name}`;
  } else if (strengths.length === 1) {
    explanation += ` and ${strengths[0].name}`;
  }

  // Resilience context
  if (resilience && resilience.score >= 60) {
    explanation += `. It also shows ${resilience.label.toLowerCase()} resilience — meaning deer use this area consistently`;
  }

  // Interior / terrain context
  if (props.tpiLandscape < -2) {
    explanation += '. The interior position gives extra cover from approach detection';
  } else if (props.tpiLandscape > 3) {
    explanation += '. Note: this ridge position offers visibility but less concealment';
  }

  // Weakness caveat
  if (weaknesses.length > 0) {
    const weakName = weaknesses[0].name.replace('has ', '').replace('sits ', '');
    explanation += `. Watch for: ${weakName} could limit effectiveness`;
  }

  explanation += '.';

  // Clean up double periods
  return explanation.replace(/\.\./g, '.').replace(/\. \./g, '.');
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
    getCorridorChip(props),
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
    keyIndicators: buildKeyIndicators(inputs, resilience),
    qualityBars: buildQualityBars(inputs),
    rankRationale: buildRankRationale(inputs, props, alignment, resilience),
    selectionExplanation: buildSelectionExplanation(props.rank, inputs, props, alignment, resilience),
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

export function renderKeyIndicatorsHTML(indicators: KeyIndicator[]): string {
  return `<div style="display:flex;gap:4px;margin:6px 0;">` +
    indicators.map(ind => {
      const bg = ind.level === 'high'
        ? (ind.label === 'Pressure' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)')
        : ind.level === 'low'
        ? (ind.label === 'Pressure' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)')
        : 'rgba(251,191,36,0.12)';
      const color = ind.level === 'high'
        ? (ind.label === 'Pressure' ? '#f87171' : '#4ade80')
        : ind.level === 'low'
        ? (ind.label === 'Pressure' ? '#4ade80' : '#f87171')
        : '#fbbf24';
      return `<div style="flex:1;text-align:center;padding:4px 2px;background:${bg};border-radius:6px;">
        <div style="font-size:8px;color:#78716c;margin-bottom:1px;">${ind.label}</div>
        <div style="font-size:10px;font-weight:600;color:${color};">${ind.displayLabel}</div>
      </div>`;
    }).join('') +
  `</div>`;
}
