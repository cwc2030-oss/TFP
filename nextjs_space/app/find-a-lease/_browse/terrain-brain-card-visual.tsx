'use client';

/**
 * TerrainBrainCardVisual — stylized card visual for browse cards.
 *
 * Renders a corridor→funnel→intercept schematic (abstract SVG) with
 * huntability grade badge and optional "Terrain Certified" badge.
 *
 * OPSEC: No coordinates, no satellite imagery, no photos, no map URLs.
 */

interface Props {
  grade: string;
  terrainScore: number | null;
  corridorCount: number | null;
  funnelCount: number | null;
  interceptCount: number | null;
}

export default function TerrainBrainCardVisual({
  grade,
  terrainScore,
  corridorCount,
  funnelCount,
  interceptCount,
}: Props) {
  const c = Math.min(corridorCount || 1, 8);
  const f = Math.min(funnelCount || 1, 4);
  const ip = Math.min(interceptCount || 1, 6);
  const quality = Math.min((terrainScore ?? 0) / 100, 1);
  const hasCertified = terrainScore != null && terrainScore > 0;

  // Corridor paths (left → center convergence)
  const corridorPaths: JSX.Element[] = [];
  for (let i = 0; i < c; i++) {
    const startY = 25 + (i * 190) / Math.max(c - 1, 1);
    const midY = 90 + (i % 2 === 0 ? -12 : 12) * (i / c);
    const endX = 175 + (i % 3) * 18;
    const endY = 95 + (i - c / 2) * 11;
    corridorPaths.push(
      <path
        key={`c-${i}`}
        d={`M 15 ${startY} C 70 ${startY}, 125 ${midY}, ${endX} ${endY}`}
        stroke={`rgba(45, 106, 79, ${0.25 + quality * 0.5})`}
        strokeWidth={1.2 + quality * 0.6}
        fill="none"
        strokeLinecap="round"
      />,
    );
  }

  // Funnel pinch shapes (center)
  const funnelShapes: JSX.Element[] = [];
  for (let i = 0; i < f; i++) {
    const cx = 175 + i * 30;
    const cy = 88 + (i - f / 2) * 26;
    funnelShapes.push(
      <g key={`f-${i}`}>
        <path
          d={`M ${cx - 14} ${cy - 16} L ${cx} ${cy} L ${cx - 14} ${cy + 16}`}
          stroke="rgba(201, 168, 76, 0.45)"
          strokeWidth={1.2}
          fill="rgba(201, 168, 76, 0.06)"
          strokeLinejoin="round"
        />
        <path
          d={`M ${cx + 14} ${cy - 16} L ${cx} ${cy} L ${cx + 14} ${cy + 16}`}
          stroke="rgba(201, 168, 76, 0.45)"
          strokeWidth={1.2}
          fill="rgba(201, 168, 76, 0.06)"
          strokeLinejoin="round"
        />
      </g>,
    );
  }

  // Intercept dots (convergence zones, right side)
  const interceptDots: JSX.Element[] = [];
  for (let i = 0; i < ip; i++) {
    const angle = (i / ip) * Math.PI * 2 - Math.PI / 2;
    const r = 20 + (i % 2) * 12;
    const cx = 290 + Math.cos(angle) * r;
    const cy = 100 + Math.sin(angle) * r;
    interceptDots.push(
      <g key={`i-${i}`}>
        <circle
          cx={cx}
          cy={cy}
          r={6.5}
          fill="rgba(201, 168, 76, 0.12)"
          stroke="rgba(201, 168, 76, 0.35)"
          strokeWidth={0.8}
        />
        <circle cx={cx} cy={cy} r={2.5} fill="rgba(201, 168, 76, 0.6)" />
      </g>,
    );
  }

  // Connector dashes center → intercept
  const connectors: JSX.Element[] = [];
  for (let i = 0; i < Math.min(ip, f); i++) {
    const startX = 175 + i * 30;
    const startY = 88 + (i - f / 2) * 26;
    const angle = (i / ip) * Math.PI * 2 - Math.PI / 2;
    const endX = 290 + Math.cos(angle) * (20 + (i % 2) * 12);
    const endY = 100 + Math.sin(angle) * (20 + (i % 2) * 12);
    connectors.push(
      <path
        key={`conn-${i}`}
        d={`M ${startX} ${startY} Q ${(startX + endX) / 2} ${(startY + endY) / 2 - 8}, ${endX} ${endY}`}
        stroke="rgba(45, 106, 79, 0.2)"
        strokeWidth={0.8}
        fill="none"
        strokeDasharray="3 2.5"
      />,
    );
  }

  return (
    <div className="relative w-full h-full bg-stone-950">
      {/* SVG schematic */}
      <svg
        viewBox="0 0 350 200"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {/* Background texture grid */}
        {[50, 100, 150].map((y) => (
          <line
            key={`g-${y}`}
            x1={8}
            y1={y}
            x2={342}
            y2={y}
            stroke="rgba(120,113,108,0.06)"
            strokeWidth={0.5}
          />
        ))}
        {[87, 175, 262].map((x) => (
          <line
            key={`gv-${x}`}
            x1={x}
            y1={8}
            x2={x}
            y2={192}
            stroke="rgba(120,113,108,0.06)"
            strokeWidth={0.5}
          />
        ))}

        {corridorPaths}
        {connectors}
        {funnelShapes}
        {interceptDots}

        {/* Labels */}
        <text x={12} y={14} fill="rgba(168,162,158,0.4)" fontSize={7.5} fontFamily="sans-serif">
          Corridors
        </text>
        <text x={165} y={14} fill="rgba(168,162,158,0.4)" fontSize={7.5} fontFamily="sans-serif">
          Pinch Points
        </text>
        <text x={270} y={14} fill="rgba(168,162,158,0.4)" fontSize={7.5} fontFamily="sans-serif">
          Intercepts
        </text>
      </svg>

      {/* Gradient overlay at bottom */}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-stone-950/90 to-transparent pointer-events-none" />

      {/* Grade badge — top-left */}
      {grade !== '\u2014' && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border border-amber-300/80 shadow text-emerald-900 font-serif font-bold text-sm tracking-wider">
          {grade}
        </div>
      )}

      {/* Terrain Certified badge — top-right */}
      {hasCertified && (
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
            Terrain Certified
          </span>
        </div>
      )}

      {/* Terrain Brain label — bottom center */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-900/80 border border-amber-800/30">
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
