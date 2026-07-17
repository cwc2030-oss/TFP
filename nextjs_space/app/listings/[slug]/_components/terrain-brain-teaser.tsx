/**
 * TerrainBrainTeaser — Public-safe abstract deer-flow teaser.
 *
 * Shows huntability stats (grade, score, corridors, funnels, intercepts,
 * season grades, acreage, price) alongside a stylized SVG schematic that
 * communicates deer-flow quality WITHOUT revealing real geography.
 *
 * OPSEC: No coordinates, no satellite imagery, no road/place names.
 */

import Link from 'next/link';

interface Props {
  grade: string;
  terrainScore: number | null;
  corridorCount: number | null;
  funnelCount: number | null;
  interceptCount: number | null;
  seasonAvailability: string[];
  acres: number | null;
  askingPriceMin: number | null;
  askingPriceMax: number | null;
  primaryMovement: string | null;
  bedAcres: number | null;
  inquireHref: string;
}

/* ─── season → letter grade (cosmetic, based on season desirability) ───── */
function seasonGrade(s: string): string {
  switch (s.toLowerCase()) {
    case 'rifle':       return 'A';
    case 'bow':         return 'A-';
    case 'muzzleloader': return 'B+';
    case 'youth':       return 'B';
    default:            return 'B';
  }
}

function priceLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Inquire';
  const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;
  if (min != null && max != null) {
    return min === max ? `${fmt(min)}/yr` : `${fmt(min)} – ${fmt(max)}/yr`;
  }
  return `${fmt((min ?? max) as number)}/yr`;
}

/* ─── Abstract Flow Schematic (SVG) ──────────────────────────────────────
 *
 * Generates a non-geographic diagram where:
 *   - Left side: origin lines (count = corridor count, capped at 8)
 *   - Center: converging funnel shapes (count = funnel count, capped at 4)
 *   - Right side: intercept/convergence dots (count = intercept count)
 *
 * The graphic scales with the counts but never reveals real locations.
 * ──────────────────────────────────────────────────────────────────────── */
function FlowSchematic({
  corridors,
  funnels,
  intercepts,
  score,
}: {
  corridors: number;
  funnels: number;
  intercepts: number;
  score: number;
}) {
  const c = Math.min(corridors || 1, 8);
  const f = Math.min(funnels || 1, 4);
  const ip = Math.min(intercepts || 1, 6);
  // Opacity reflects overall terrain quality
  const quality = Math.min(score / 100, 1);

  // Generate corridor paths (left→center convergence)
  const corridorPaths: JSX.Element[] = [];
  for (let i = 0; i < c; i++) {
    const startY = 30 + (i * 220) / Math.max(c - 1, 1);
    const midY = 100 + (i % 2 === 0 ? -15 : 15) * (i / c);
    const endX = 200 + (i % 3) * 20;
    const endY = 110 + (i - c / 2) * 12;
    corridorPaths.push(
      <path
        key={`c-${i}`}
        d={`M 20 ${startY} C 80 ${startY}, 140 ${midY}, ${endX} ${endY}`}
        stroke={`rgba(45, 106, 79, ${0.3 + quality * 0.5})`}
        strokeWidth={1.5 + quality}
        fill="none"
        strokeLinecap="round"
      />,
    );
  }

  // Generate funnel pinch shapes (center)
  const funnelShapes: JSX.Element[] = [];
  for (let i = 0; i < f; i++) {
    const cx = 200 + i * 35;
    const cy = 100 + (i - f / 2) * 30;
    funnelShapes.push(
      <g key={`f-${i}`}>
        <path
          d={`M ${cx - 18} ${cy - 20} L ${cx} ${cy} L ${cx - 18} ${cy + 20}`}
          stroke="rgba(201, 168, 76, 0.5)"
          strokeWidth={1.5}
          fill="rgba(201, 168, 76, 0.08)"
          strokeLinejoin="round"
        />
        <path
          d={`M ${cx + 18} ${cy - 20} L ${cx} ${cy} L ${cx + 18} ${cy + 20}`}
          stroke="rgba(201, 168, 76, 0.5)"
          strokeWidth={1.5}
          fill="rgba(201, 168, 76, 0.08)"
          strokeLinejoin="round"
        />
      </g>,
    );
  }

  // Generate intercept dots (convergence zones, right side)
  const interceptDots: JSX.Element[] = [];
  for (let i = 0; i < ip; i++) {
    const angle = (i / ip) * Math.PI * 2 - Math.PI / 2;
    const r = 25 + (i % 2) * 15;
    const cx = 330 + Math.cos(angle) * r;
    const cy = 120 + Math.sin(angle) * r;
    interceptDots.push(
      <g key={`i-${i}`}>
        <circle
          cx={cx}
          cy={cy}
          r={8}
          fill="rgba(201, 168, 76, 0.15)"
          stroke="rgba(201, 168, 76, 0.4)"
          strokeWidth={1}
        />
        <circle cx={cx} cy={cy} r={3} fill="rgba(201, 168, 76, 0.7)" />
      </g>,
    );
  }

  // Connector lines from center to intercept zone
  const connectors: JSX.Element[] = [];
  for (let i = 0; i < Math.min(ip, f); i++) {
    const startX = 200 + i * 35;
    const startY = 100 + (i - f / 2) * 30;
    const angle = (i / ip) * Math.PI * 2 - Math.PI / 2;
    const endX = 330 + Math.cos(angle) * (25 + (i % 2) * 15);
    const endY = 120 + Math.sin(angle) * (25 + (i % 2) * 15);
    connectors.push(
      <path
        key={`conn-${i}`}
        d={`M ${startX} ${startY} Q ${(startX + endX) / 2} ${(startY + endY) / 2 - 10}, ${endX} ${endY}`}
        stroke="rgba(45, 106, 79, 0.25)"
        strokeWidth={1}
        fill="none"
        strokeDasharray="4 3"
      />,
    );
  }

  return (
    <svg
      viewBox="0 0 400 240"
      className="w-full h-full"
      aria-hidden="true"
    >
      {/* Background grid lines for texture */}
      {[60, 120, 180].map((y) => (
        <line
          key={`g-${y}`}
          x1={10}
          y1={y}
          x2={390}
          y2={y}
          stroke="rgba(120,113,108,0.08)"
          strokeWidth={0.5}
        />
      ))}
      {[100, 200, 300].map((x) => (
        <line
          key={`gv-${x}`}
          x1={x}
          y1={10}
          x2={x}
          y2={230}
          stroke="rgba(120,113,108,0.08)"
          strokeWidth={0.5}
        />
      ))}

      {/* Flow corridor lines */}
      {corridorPaths}

      {/* Connector dashes */}
      {connectors}

      {/* Funnel pinch points */}
      {funnelShapes}

      {/* Intercept convergence zones */}
      {interceptDots}

      {/* Labels */}
      <text x={15} y={20} fill="currentColor" style={{ color: '#e7e5e4' }} fontSize={13} fontWeight={700} fontFamily="sans-serif">
        Corridors
      </text>
      <text x={180} y={20} fill="currentColor" style={{ color: '#e7e5e4' }} fontSize={13} fontWeight={700} fontFamily="sans-serif">
        Pinch Points
      </text>
      <text x={310} y={20} fill="currentColor" style={{ color: '#e7e5e4' }} fontSize={13} fontWeight={700} fontFamily="sans-serif">
        Intercepts
      </text>
    </svg>
  );
}

export default function TerrainBrainTeaser(props: Props) {
  const {
    grade,
    terrainScore,
    corridorCount,
    funnelCount,
    interceptCount,
    seasonAvailability,
    acres,
    askingPriceMin,
    askingPriceMax,
    primaryMovement,
    bedAcres,
    inquireHref,
  } = props;

  const price = priceLabel(askingPriceMin, askingPriceMax);
  const seasons = seasonAvailability ?? [];

  return (
    <section className="rounded-2xl border border-amber-800/40 bg-gradient-to-br from-stone-900 via-amber-950/20 to-stone-900 overflow-hidden mb-8">
      {/* Header */}
      <div className="px-6 py-4 border-b border-amber-900/30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-900/60 border border-amber-700/50 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-amber-400">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </div>
          <div>
            <h3 className="text-stone-100 font-semibold text-sm">Terrain Brain Preview</h3>
            <p className="text-stone-500 text-xs">Deer-flow quality summary — what, not where</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
        {/* Left: abstract schematic */}
        <div className="relative aspect-[5/3] md:aspect-auto bg-stone-950/60 border-b md:border-b-0 md:border-r border-amber-900/20">
          <FlowSchematic
            corridors={corridorCount ?? 0}
            funnels={funnelCount ?? 0}
            intercepts={interceptCount ?? 0}
            score={terrainScore ?? 0}
          />

          {/* Locked overlay */}
          <div className="absolute inset-0 flex items-end justify-center pb-4 bg-gradient-to-t from-stone-950/80 via-transparent to-transparent">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-stone-900/90 border border-amber-700/40 text-amber-300 text-xs font-medium">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Abstract schematic — not the real map
            </div>
          </div>
        </div>

        {/* Right: stats grid */}
        <div className="p-5 space-y-4">
          {/* Top stats row */}
          <div className="grid grid-cols-3 gap-3">
            <StatBox
              label="Huntability"
              value={grade !== '—' ? `Grade ${grade}` : '—'}
              sub={terrainScore != null ? `${terrainScore}/100` : undefined}
              accent
            />
            <StatBox
              label="Corridors"
              value={corridorCount != null ? String(corridorCount) : '—'}
              sub="flow paths"
            />
            <StatBox
              label="Funnels"
              value={funnelCount != null ? String(funnelCount) : '—'}
              sub="pinch points"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatBox
              label="Intercepts"
              value={interceptCount != null ? String(interceptCount) : '—'}
              sub="convergence zones"
            />
            <StatBox
              label="Acreage"
              value={acres != null ? Math.round(acres).toLocaleString('en-US') : '—'}
              sub="total acres"
            />
            <StatBox
              label="Lease Price"
              value={price}
            />
          </div>

          {/* Additional context */}
          {primaryMovement && (
            <div className="text-xs text-stone-400">
              <span className="text-stone-500">Primary movement:</span>{' '}
              <span className="text-stone-300">{primaryMovement}</span>
            </div>
          )}
          {bedAcres != null && bedAcres > 0 && (
            <div className="text-xs text-stone-400">
              <span className="text-stone-500">Bedding area:</span>{' '}
              <span className="text-stone-300">{bedAcres.toFixed(1)} ac</span>
            </div>
          )}

          {/* Season grades */}
          {seasons.length > 0 && (
            <div>
              <div className="text-stone-500 text-xs uppercase tracking-wide mb-1.5">
                Season grades
              </div>
              <div className="flex flex-wrap gap-1.5">
                {seasons.map((s) => (
                  <span
                    key={s}
                    className="text-xs px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/40 text-emerald-300 capitalize"
                  >
                    {s}: {seasonGrade(s)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Locked CTA footer */}
      <div className="px-6 py-5 border-t border-amber-900/30 bg-stone-950/40">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 text-amber-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="font-semibold text-sm">Full Terrain Brain</span>
          </div>
          <p className="text-stone-400 text-xs leading-relaxed flex-1">
            Stand locations, wind strategy &amp; interactive map — unlocks when you lease this parcel.
          </p>
          <Link
            href={inquireHref}
            className="shrink-0 inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Inquire to lease →
          </Link>
        </div>
      </div>
    </section>
  );
}

function StatBox({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg bg-stone-800/40 border border-stone-700/30 p-2.5 text-center">
      <div className="text-stone-500 text-[10px] uppercase tracking-wide mb-0.5">{label}</div>
      <div
        className={`font-semibold text-sm ${
          accent ? 'text-amber-300' : 'text-stone-100'
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-stone-500 text-[10px] mt-0.5">{sub}</div>}
    </div>
  );
}
