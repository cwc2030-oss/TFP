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

function getInsideCornerChip(inputs: StandInputs): ReasonChip | null {
  const ic = inputs.inside_corner;
  // null/undefined = parcel has no inside corners → no chip.
  if (ic === null || ic === undefined) return null;
  if (ic >= 0.7) return { icon: '🎯', label: 'Inside Corner', tone: 'positive' };
  if (ic >= 0.45) return { icon: '🎯', label: 'Near Inside Corner', tone: 'positive' };
  return null; // far from any corner → don't clutter with a weak chip
}

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
    getInsideCornerChip(inputs),
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

// ========== PER-STAND TACTICAL NARRATIVE (V4 Step 10) ==========
// Replaces the old anchor-keyed canned template. Every sentence is composed
// from THIS stand's real data (corridor distance, wind alignment for the
// current wind, interior TPI, and the scoring input vector) so that no two
// stands — even two that share an anchor type — read identically.

export interface StandNarrativeCtx {
  weapon: 'bow' | 'gun';        // effective weapon this narrative is written for
  anchor?: string;             // anchorFeature.type
  isSidehillBench?: boolean;
  season: 'early' | 'rut' | 'late';
  windDirection: string;       // current wind, e.g. 'NW'
  windAligned: boolean;        // current wind is in this stand's windOk set
  bearingLabel?: string;       // compass label toward the open field side
}

export function buildStandNarrative(
  inputs: StandInputs,
  props: StandPointProperties,
  _alignment: StandScore,
  ctx: StandNarrativeCtx,
  resilience?: { score: number; label: string }
): string {
  const dist = props.distToCorridorMeters ?? 999;
  const distR = Math.round(dist);
  const bearing = ctx.bearingLabel || 'adjacent';
  const tpi = props.tpiLandscape ?? 0;
  const sentences: string[] = [];

  // ── 1. Tactical opener — hunting voice, keyed on weapon + this stand's feature.
  //    Each feature carries 2-3 phrasings; a per-stand seed (score + corridor
  //    distance) picks one deterministically so two same-type stands don't open
  //    with the identical sentence. ──
  const seed = Math.round(
    (_alignment?.score ?? 0) * 2 +
    distR +
    tpi * 7 +
    inputs.movement * 31 +
    inputs.wind_overlap * 53 +
    inputs.intrusion * 17
  );
  const pick = (arr: string[]) => arr[Math.abs(seed) % arr.length];
  let opener: string;
  if (ctx.weapon === 'bow') {
    if (ctx.isSidehillBench) {
      opener = pick([
        `Sidehill bench — a flat shelf caught between the ridge and the draw. Hang 20 ft in the biggest oak on the downhill edge; deer traversing the slope thread this shelf to keep from skylining.`,
        `This is a bench set — deer working the sidehill hold to this flat shelf instead of topping out. Get 20 ft up on the downhill lip and let them walk the contour to you.`,
      ]);
    } else if (ctx.anchor === 'saddle') {
      opener = pick([
        `Set 20–25 ft on the downwind side of this saddle — the low gap gathers every cruising deer into one gate. Slip in from the low side and never cross the spine.`,
        `Saddle stand — the dip in the ridge is the path of least resistance and deer pour through it. Hang the downwind shoulder and keep your approach below the crest.`,
        `Hunt the low side of this saddle. Anything crossing the ridge necks down through the gap here; a downwind hang puts them in your lap without pegging you.`,
      ]);
    } else if (ctx.anchor === 'funnel') {
      opener = pick([
        `Draw intersection where trails knot together. Get in tight; morning thermal lift carries your scent up and off the travel lane below.`,
        `This funnel squeezes several trails into one lane through the draw. Hang close and let the first-light thermal pull your wind uphill and away.`,
      ]);
    } else if (ctx.anchor === 'ridge') {
      opener = pick([
        `Hang on the downwind lip of this ridge finger. Deer sliding off the bench have one lane past your tree — a close, quartering-away look.`,
        `Ridge-finger set — deer spilling off the high ground follow the spine down and thread right past this point. Hang the leeward edge for a tight shot.`,
        `Get up on the downwind side of this spine. The finger points deer straight through the shooting lane as they drop off the top — expect them close.`,
      ]);
    } else if (ctx.anchor === 'convergence') {
      opener = pick([
        `Several travel lanes braid together here; hang where the timber thickens and deer commit to a single line inside bow range. Scout two exit routes before season.`,
        `Convergence stand — multiple trails collapse into one at this knot. Hang in the heavier cover so deer settle onto a single lane within range.`,
      ]);
    } else {
      opener = pick([
        `Timber-corridor set — hang 20 ft in the largest tree on the downwind edge of the trail and let deer pass close.`,
        `This is a travel-corridor hang. Pick the biggest tree on the downwind side of the trail and stay high; deer file through within easy range.`,
      ]);
    }
  } else {
    if (ctx.isSidehillBench) {
      opener = pick([
        `Sidehill bench with a long broadside lane across the slope. Sit the uphill edge with the wind quartering downhill and glass the contour at first light.`,
        `Bench set for the rifle — deer working the contour give you a steady broadside across the slope. Take the uphill edge and glass the shelf early.`,
      ]);
    } else if (ctx.anchor === 'inside_corner') {
      opener = pick([
        `Inside corner of the ${bearing} field — deer stepping out at last light pour through this pinch. A long poke to the far timber edge; park on the nearest lane and walk in quiet.`,
        `Play the inside corner on the ${bearing} field. Deer edging out to feed cut this notch first; you've got the whole opening to the far timber for a shot.`,
        `This is the ${bearing}-field inside corner — the last-light staging spot. Set where the two edges meet and cover the open ground out to the tree line.`,
      ]);
    } else if (ctx.anchor === 'field_edge') {
      opener = pick([
        `Timber edge over the ${bearing} opening. Deer pushed off neighboring ground cross this gap early and late — be settled well before shooting light.`,
        `Field-edge seat on the ${bearing} opening. Watch the whole gap; deer bumped from adjacent ground spill across it at first and last light.`,
      ]);
    } else if (ctx.anchor === 'field_saddle_combo') {
      opener = pick([
        `Saddle riding just above the field edge — a long shot into the open or a close one back in the timber, whichever the deer hands you.`,
        `This combo sits where a saddle drops onto the field edge. You can reach across the opening or catch one tight in the timber — cover both.`,
      ]);
    } else {
      opener = pick([
        `Field-edge set with open shooting lanes. Sit the timber line with the field downwind; first light and last light are the movement windows.`,
        `Open-country stand along the field edge. Keep the field to your downwind, settle into the tree line, and hunt the first and last light windows.`,
      ]);
    }
  }
  sentences.push(opener);
  // ── 2. Corridor-distance read (a real per-stand number) ──
  if (dist <= 40) {
    sentences.push(`You're right on the primary trail — about ${distR} m — so encounters come fast; stay drawn-ready.`);
  } else if (dist <= 120) {
    sentences.push(`The main corridor runs roughly ${distR} m off, close enough that deer filter into range as they work it.`);
  } else if (dist < 900) {
    sentences.push(`Heaviest travel sits about ${distR} m out — treat this as a cutoff and let deer commit before you shift.`);
  }

  // ── 3. Wind read for the ACTUAL current wind ──
  if (ctx.windAligned) {
    sentences.push(`Today's ${ctx.windDirection} wind runs clean off this stand — your scent drifts away from where deer travel.`);
  } else {
    sentences.push(`Mind the wind: a ${ctx.windDirection} today edges toward the deer's side, so lean on the morning thermal and keep motion to nothing.`);
  }

  // ── 4. Interior / elevation context from real TPI ──
  if (tpi < -2) {
    sentences.push(`The interior, low-lying position hides your approach and settles scent toward the ground.`);
  } else if (tpi > 3) {
    sentences.push(`The elevated seat buys visibility but costs cover — move only when every head is down.`);
  }

  // ── 5. What earns the score — strongest factors for THIS stand's input vector ──
  const factors: { key: string; pos: string; neg: string; v: number }[] = [
    { key: 'movement', pos: 'sits tight to deer movement',        neg: 'sits a step off the main movement',            v: inputs.movement },
    { key: 'wind',     pos: 'holds a clean downwind edge',        neg: 'lives with fickle wind',                       v: 1 - inputs.wind_overlap },
    { key: 'intrusion',pos: 'stays off the pressure map',          neg: 'carries some pressure exposure',               v: 1 - inputs.intrusion },
    { key: 'season',   pos: 'fits the current season pattern',     neg: `runs a touch out of phase for ${ctx.season === 'early' ? 'early season' : ctx.season === 'rut' ? 'the rut' : 'late season'}`, v: inputs.season_fit },
  ];
  const strong = factors.filter(f => f.v >= 0.6).sort((a, b) => b.v - a.v);
  const weak = factors.filter(f => f.v < 0.32).sort((a, b) => a.v - b.v);
  if (strong.length >= 2) {
    sentences.push(`It earns its rank because it ${strong[0].pos} and ${strong[1].pos}.`);
  } else if (strong.length === 1) {
    sentences.push(`Its edge: it ${strong[0].pos}.`);
  }
  if (resilience && resilience.score >= 60) {
    sentences.push(`Resilience reads ${resilience.label.toLowerCase()} — deer lean on this ground across conditions, not just one setup.`);
  }
  if (weak.length > 0) {
    sentences.push(`Soft spot to respect: it ${weak[0].neg}.`);
  }

  return sentences.join(' ');
}