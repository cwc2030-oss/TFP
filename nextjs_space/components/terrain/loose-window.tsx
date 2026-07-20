'use client';

/**
 * LooseWindow — the r22 "loose window" intel surface.
 *
 * ONE minimal floating translucent card whose centerpiece is the four measured
 * structural drivers (Bench / Saddle / Ridge / Convergence). Replaces the old
 * multi-panel intel view.
 *
 * Design contract (Clark, Jul 19 — "The Loose Window"):
 *   (A) A situated message that NAMES the leading driver (highest score) in teal
 *       plus a plain "so what". It swaps with real terrain. Flat / no-backbone
 *       country gets a food-and-cover line — never "unhuntable", and never a
 *       promise of flow lines that aren't drawn (gated on flowLinesDrawn).
 *   (B) Four big numbers with % beneath — REAL measured drivers. Leading driver
 *       is the teal hero; the others are ivory; genuinely low ones are muted.
 *       A flat parcel still shows numbers (low + muted), never blank.
 *   (C) Tap-to-teach: tapping a number slides a one-liner card; tap again closes.
 *       One tap deep. Taps never trigger a map drag (gestures are stopped here).
 */

import { useState, useEffect, useRef } from 'react';
import type { StructuralDrivers, StructuralDriverScore } from '@/lib/terrain-story';

// ── r23 odometer roll-in ──
// Animate a number from its current displayed value up/down to the new measured
// target over ~520ms with an eased decelerate. HONESTY: it always lands exactly
// on `target` (the real measured percentage) and never randomizes the reveal —
// it just rolls the last-shown value to the new true value when a fresh read
// lands. On first mount it shows the target immediately (no animation).
function useCountUp(target: number, durationMs = 520): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const from = displayRef.current;
    const to = target;
    if (from === to) return;
    const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic — decelerate onto the value
      const v = Math.round(from + (to - from) * eased);
      displayRef.current = v;
      setDisplay(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = to; // guarantee we land on the true measured value
        setDisplay(to);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, durationMs]);
  return display;
}

// ── Palette (Clark-specified) ──
const TEAL = '#34D3B7';   // leading driver hero
const IVORY = '#EDE6D6';  // present, non-leading
const MUTED = '#9fb3a6';  // genuinely low / flat

type DriverKey = 'bench' | 'saddle' | 'ridge' | 'convergence';

// Verbatim tap-to-teach copy (do not reword).
const TEACH: Record<DriverKey, string> = {
  bench: 'Where they walk without working.',
  saddle: 'The gap they were always going to use.',
  ridge: 'The spine the whole property hangs on.',
  convergence: 'Where the deer runs are forced to become one.',
};

const SHORT: Record<DriverKey, string> = {
  bench: 'BENCH',
  saddle: 'SADDLE',
  ridge: 'RIDGE',
  convergence: 'CONVERGENCE',
};

// Situated "so what" per leading driver. These describe terrain structure only —
// they never reference flow lines drawn on the map (honesty gate lives below).
const LEADS: Record<DriverKey, { name: string; rest: string }> = {
  convergence: { name: 'Convergence', rest: ' is doing the work here — runs forced into one crossing. Set up where they collapse together.' },
  saddle: { name: 'Saddle', rest: ' is the story here — the gap they were always going to use.' },
  ridge: { name: 'Ridge', rest: ' backbone runs this parcel — deer travel the leeward side.' },
  bench: { name: 'Bench', rest: ' carries the movement here — a shelf they walk without working. Hunt the bench edge.' },
};

const LOW_THRESHOLD = 12; // percentage below which a driver reads as "genuinely low"

interface LooseWindowProps {
  drivers: StructuralDrivers | null;
  terrainState: 'confirmed' | 'marginal' | 'flat' | null;
  genuineFlat: boolean;
  flowLinesDrawn: boolean;
  isLoading: boolean;
  hasError: boolean;
  onReload: () => void;
}

function pct(d: StructuralDriverScore | undefined): number {
  if (!d) return 0;
  return Math.max(0, Math.min(100, Math.round(d.score * 100)));
}

export function LooseWindow({
  drivers,
  terrainState,
  genuineFlat,
  flowLinesDrawn,
  isLoading,
  hasError,
  onReload,
}: LooseWindowProps) {
  const [openKey, setOpenKey] = useState<DriverKey | null>(null);

  // ── r23: measured percentages (hooks must run before any early return) ──
  const benchPct = pct(drivers?.benchSupport);
  const saddlePct = pct(drivers?.saddleInfluence);
  const ridgePct = pct(drivers?.ridgeSpineSupport);
  const convPct = pct(drivers?.convergenceDensity);
  const benchAnim = useCountUp(benchPct);
  const saddleAnim = useCountUp(saddlePct);
  const ridgeAnim = useCountUp(ridgePct);
  const convAnim = useCountUp(convPct);
  const animFor: Record<DriverKey, number> = {
    bench: benchAnim, saddle: saddleAnim, ridge: ridgeAnim, convergence: convAnim,
  };

  // One-beat teal pulse on the leading driver when a fresh read lands. Fires
  // ~520ms after the measured values change (i.e. as the roll-in settles).
  const [pulseNonce, setPulseNonce] = useState(0);
  useEffect(() => {
    if (!drivers) return;
    const t = setTimeout(() => setPulseNonce((n) => n + 1), 520);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchPct, saddlePct, ridgePct, convPct]);

  // Stop every gesture at the card so tapping a number never drags the map.
  const swallow = {
    onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(),
    onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
    onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
    onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  };

  const shell =
    'pointer-events-auto w-[92vw] max-w-[380px] rounded-2xl border border-white/[0.10] ' +
    'bg-black/45 backdrop-blur-2xl shadow-[0_8px_40px_rgba(0,0,0,0.45)] px-5 py-4';

  // ── Compute-failure: honest retry, never a fake flat ──
  if (hasError) {
    return (
      <div className={shell} {...swallow}>
        <p className="text-[13px] text-amber-200/90 font-medium leading-snug">
          The terrain read didn&apos;t finish.
        </p>
        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
          This isn&apos;t a &quot;no structure&quot; result — the analysis stopped short. Run it again.
        </p>
        <button
          onClick={(e) => { e.stopPropagation(); onReload(); }}
          className="mt-3 w-full bg-amber-400 hover:bg-amber-300 text-black font-semibold text-[12px] py-2 rounded-lg transition-colors"
        >
          Re-read terrain
        </button>
      </div>
    );
  }

  // ── Loading: quiet, honest ──
  if (isLoading || !drivers) {
    return (
      <div className={shell} {...swallow}>
        <p className="text-[13px] text-white/70 font-medium leading-snug">Reading the terrain…</p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {(['bench', 'saddle', 'ridge', 'convergence'] as DriverKey[]).map((k) => (
            <div key={k} className="flex flex-col items-center">
              <div className="h-7 w-10 rounded bg-white/[0.06] animate-pulse" />
              <span className="mt-1 text-[8px] tracking-[0.15em] text-white/25">{SHORT[k]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Driver rows in fixed display order ──
  const rows: { key: DriverKey; d: StructuralDriverScore }[] = [
    { key: 'bench', d: drivers.benchSupport },
    { key: 'saddle', d: drivers.saddleInfluence },
    { key: 'ridge', d: drivers.ridgeSpineSupport },
    { key: 'convergence', d: drivers.convergenceDensity },
  ];

  // Leading driver = highest score (only meaningful when NOT genuinely flat).
  let leaderKey: DriverKey = rows[0].key;
  let leaderScore = rows[0].d?.score ?? 0;
  for (const r of rows) {
    if ((r.d?.score ?? 0) > leaderScore) {
      leaderScore = r.d?.score ?? 0;
      leaderKey = r.key;
    }
  }

  const colorFor = (key: DriverKey, percentage: number): string => {
    if (genuineFlat) return MUTED;
    if (key === leaderKey && percentage > 0) return TEAL;
    if (percentage < LOW_THRESHOLD) return MUTED;
    return IVORY;
  };

  // ── Situated message ──
  // Flat / no-backbone -> food-and-cover, never "unhuntable".
  const flat = genuineFlat || terrainState === 'flat';

  return (
    <div className={shell} {...swallow}>
      {/* (A) Situated message */}
      {flat ? (
        <p className="text-[13.5px] leading-relaxed text-white/80">
          No spine to organize movement — <span style={{ color: IVORY }}>food-and-cover country</span>. Hunt sign and food, not terrain.
        </p>
      ) : (
        <p className="text-[13.5px] leading-relaxed text-white/80">
          <span style={{ color: TEAL }} className="font-semibold">{LEADS[leaderKey].name}</span>
          {LEADS[leaderKey].rest}
        </p>
      )}

      {/* (B) Four measured numbers */}
      <div className="mt-4 grid grid-cols-4 gap-1">
        {rows.map(({ key, d }) => {
          const percentage = pct(d);
          const color = colorFor(key, percentage);
          const isOpen = openKey === key;
          return (
            <button
              key={key}
              onClick={(e) => { e.stopPropagation(); setOpenKey(isOpen ? null : key); }}
              className={`flex flex-col items-center rounded-lg py-1.5 transition-colors ${isOpen ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}
              aria-expanded={isOpen}
            >
              <span
                key={key === leaderKey && !flat ? `n-${key}-${pulseNonce}` : `n-${key}`}
                className={`text-[26px] leading-none font-semibold tabular-nums ${key === leaderKey && !flat ? 'tfp-teal-beat' : ''}`}
                style={{ color }}
              >
                {animFor[key]}
              </span>
              <span className="mt-1 text-[8px] tracking-[0.14em]" style={{ color, opacity: 0.7 }}>
                {SHORT[key]}
              </span>
              <span className="text-[8px] text-white/30 leading-none">%</span>
            </button>
          );
        })}
      </div>

      {/* (C) Tap-to-teach one-liner (one tap deep) */}
      {openKey && (
        <div className="mt-3 border-t border-white/[0.08] pt-3">
          <p className="text-[8px] tracking-[0.18em] text-white/35 mb-1">{SHORT[openKey]}</p>
          <p className="text-[12.5px] text-white/75 leading-snug italic">{TEACH[openKey]}</p>
        </div>
      )}
    </div>
  );
}

export default LooseWindow;
