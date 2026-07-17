'use client';

/**
 * TerrainBrainCardVisual — refined card schematic for browse cards.
 *
 * Gold converging corridor arrows + funnel >< pinch glyphs + crosshair
 * intercept targets + bedding ellipses on dark terrain contours.
 *
 * Data-driven element counts:
 *   corridors  2–5  (gold arrow paths converging right)
 *   funnels    0–4  (>< pinch glyphs along corridor mid-points)
 *   intercepts 1–3  (crosshair targets on right side)
 *
 * OPSEC: No coordinates, no satellite imagery, no photos, no map URLs.
 */

interface Props {
  grade: string;
  terrainScore: number | null;
  corridorCount: number | null;
  funnelCount: number | null;
  interceptCount: number | null;
  flowIndex?: number | null;
}

// Corridor path definitions — each is a cubic bezier from left/bottom edge
// converging toward the intercept zone on the right. Up to 5 paths available.
const CORRIDOR_TEMPLATES = [
  // top-left → right-center
  { d: 'M0,150 C170,150 320,178 486,210', startEdge: 'left' },
  // bottom-left → right-center
  { d: 'M0,300 C180,300 350,250 486,214', startEdge: 'left' },
  // bottom-center → right-center
  { d: 'M232,440 C320,378 412,296 500,236', startEdge: 'bottom' },
  // top sweep
  { d: 'M0,90 C160,88 340,140 492,200', startEdge: 'left' },
  // far bottom
  { d: 'M100,440 C200,380 360,310 494,228', startEdge: 'bottom' },
];

// Funnel glyph positions along corridor paths
const FUNNEL_POSITIONS = [
  { x: 312, y: 181 },
  { x: 240, y: 254 },
  { x: 180, y: 168 },
  { x: 360, y: 270 },
];

// Intercept crosshair positions
const INTERCEPT_POSITIONS = [
  { x: 516, y: 212 },
  { x: 564, y: 150 },
  { x: 552, y: 290 },
];

export default function TerrainBrainCardVisual({
  grade,
  terrainScore,
  corridorCount,
  funnelCount,
  interceptCount,
  flowIndex,
}: Props) {
  const c = Math.max(2, Math.min(corridorCount ?? 2, 5));
  const f = Math.max(0, Math.min(funnelCount ?? 0, 4));
  const ip = Math.max(1, Math.min(interceptCount ?? 1, 3));
  // Scale corridor opacity with flowIndex
  const quality = Math.min((flowIndex ?? terrainScore ?? 0) / 100, 1);
  const corridorOpacity = 0.55 + quality * 0.37; // range 0.55 → 0.92
  // ── PHASE 1 KILL-SWITCH (Jul 17 2026) ──
  // The v1 letter grade + "Terrain Certified" badge are non-discriminating
  // fabrications (flat parcels scored the same as confirmed). Hide on public
  // listing cards until the gate-real rebuild (Phase 2) wires the backbone verdict.
  const HIDE_FAB = true;
  const hasCertified = !HIDE_FAB && terrainScore != null && terrainScore > 0;
  // PHASE 2: neutral analysis-run marker. Its EXISTENCE (terrainScore not null)
  // means the parcel was processed by the terrain engine — it is NOT a quality
  // claim, so we show it for every analyzed listing regardless of the (retired) score.
  const hasAnalyzed = terrainScore != null;

  return (
    <div className="relative w-full h-full">
      <svg
        width="100%"
        viewBox="0 0 680 440"
        role="img"
        aria-label={`Terrain schematic: ${c} corridors, ${f} funnels, ${ip} intercepts`}
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <marker
            id="gold-arrow"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M1 1 L9 5 L1 9 Z" fill="#e0a528" />
          </marker>
        </defs>

        {/* Dark terrain background */}
        <rect x="0" y="0" width="680" height="440" rx="14" fill="#0f1714" />

        {/* Terrain contour lines */}
        <path d="M0,118 Q200,82 400,128 T680,108" fill="none" stroke="#21392e" strokeWidth={1.2} />
        <path d="M0,210 Q220,176 430,224 T680,206" fill="none" stroke="#21392e" strokeWidth={1.2} />
        <path d="M0,306 Q200,278 420,322 T680,300" fill="none" stroke="#21392e" strokeWidth={1.2} />

        {/* Bedding ellipses (timber cover) */}
        <ellipse cx="118" cy="298" rx="78" ry="44" fill="#1f4d3a" opacity={0.5} />
        <ellipse cx="150" cy="318" rx="52" ry="30" fill="#1f4d3a" opacity={0.45} />

        {/* Gold corridor arrows — data-driven count */}
        {CORRIDOR_TEMPLATES.slice(0, c).map((tmpl, i) => (
          <path
            key={`corr-${i}`}
            d={tmpl.d}
            fill="none"
            stroke="#e0a528"
            strokeWidth={3}
            opacity={corridorOpacity}
            markerEnd="url(#gold-arrow)"
          />
        ))}

        {/* Funnel pinch glyphs — data-driven count */}
        {FUNNEL_POSITIONS.slice(0, f).map((pos, i) => (
          <g key={`fun-${i}`}>
            <path
              d={`M${pos.x - 12},${pos.y - 13} L${pos.x - 2},${pos.y} L${pos.x - 12},${pos.y + 13}`}
              fill="none"
              stroke="#f2cd80"
              strokeWidth={2.4}
              strokeLinecap="round"
            />
            <path
              d={`M${pos.x + 12},${pos.y - 13} L${pos.x + 2},${pos.y} L${pos.x + 12},${pos.y + 13}`}
              fill="none"
              stroke="#f2cd80"
              strokeWidth={2.4}
              strokeLinecap="round"
            />
          </g>
        ))}

        {/* Intercept crosshair targets — data-driven count */}
        {INTERCEPT_POSITIONS.slice(0, ip).map((pos, i) => (
          <g key={`int-${i}`}>
            {/* Outer ring */}
            <circle cx={pos.x} cy={pos.y} r={30} fill="none" stroke="#e0a528" strokeWidth={2} opacity={0.5} />
            {/* Inner ring */}
            <circle cx={pos.x} cy={pos.y} r={18} fill="none" stroke="#e0a528" strokeWidth={2} />
            {/* Crosshair lines */}
            <line x1={pos.x - 38} y1={pos.y} x2={pos.x - 18} y2={pos.y} stroke="#e0a528" strokeWidth={1.6} />
            <line x1={pos.x + 18} y1={pos.y} x2={pos.x + 38} y2={pos.y} stroke="#e0a528" strokeWidth={1.6} />
            <line x1={pos.x} y1={pos.y - 38} x2={pos.x} y2={pos.y - 18} stroke="#e0a528" strokeWidth={1.6} />
            <line x1={pos.x} y1={pos.y + 18} x2={pos.x} y2={pos.y + 38} stroke="#e0a528" strokeWidth={1.6} />
            {/* Center dot */}
            <circle cx={pos.x} cy={pos.y} r={5.5} fill="#e0a528" />
          </g>
        ))}
      </svg>

      {/* Gradient overlay at bottom for text readability */}
      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0f1714]/90 to-transparent pointer-events-none" />

      {/* Grade badge — top-left */}
      {!HIDE_FAB && grade !== '—' && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border border-amber-300/80 shadow text-emerald-900 font-serif font-bold text-sm tracking-wider">
          {grade}
        </div>
      )}

      {/* Terrain Analyzed marker — top-right (analysis-run, not a quality claim) */}
      {hasAnalyzed && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-950/80 border border-emerald-700/50 shadow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-emerald-400">
            <path
              d="M9 12l2 2 4-4"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 2l2.09 1.22 2.41-.16 1.18 2.1 2.28.84-.16 2.41 1.52 1.88-1.22 2.09.16 2.41-2.1 1.18-.84 2.28-2.41-.16L12 22l-2.09-1.22-2.41.16-1.18-2.1-2.28-.84.16-2.41L2.68 13.7l1.22-2.09-.16-2.41 2.1-1.18.84-2.28 2.41.16L12 2z"
              stroke="currentColor"
              strokeWidth={1.5}
              fill="rgba(52,211,153,0.1)"
            />
          </svg>
          <span className="text-[10px] font-semibold text-emerald-300 tracking-wide uppercase">
            Terrain Analyzed
          </span>
        </div>
      )}

      {/* Terrain Brain label — bottom center */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0f1714]/80 border border-amber-800/30">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-amber-400">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <span className="text-[9px] text-amber-300/70 font-medium tracking-wide">Terrain Brain</span>
      </div>
    </div>
  );
}