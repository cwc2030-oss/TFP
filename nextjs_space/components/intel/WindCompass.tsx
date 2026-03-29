'use client';

import { useEffect, useState, useCallback } from 'react';
import type { WindDirection } from '@/types/terrain';
import type { SeasonProfile } from '@/types/terrain';

const WIND_DIRECTIONS: WindDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export { WIND_DIRECTIONS };

/* ── Geometry helpers ── */
const DIR_ANGLES: Record<WindDirection, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

const SEASON_HINTS: Record<SeasonProfile, string> = {
  early: 'Thermals rise AM — scent lifts off ridges',
  rut:   'Steady winds best — bucks cruise crosswind',
  late:  'Cold fronts push deer to food — hunt downwind',
};

const SEASON_COLORS: Record<SeasonProfile, { accent: string; glow: string }> = {
  early: { accent: '#22c55e', glow: 'rgba(34,197,94,0.25)' },
  rut:   { accent: '#f59e0b', glow: 'rgba(245,158,11,0.25)' },
  late:  { accent: '#60a5fa', glow: 'rgba(96,165,250,0.25)' },
};

interface WindCompassProps {
  windDirection: WindDirection;
  windMinAgo: number;
  onWindChange: (dir: WindDirection) => void;
  season?: SeasonProfile;
}

/**
 * Premium Wind Compass — v3.0
 * SVG compass rose with animated needle, directional glow,
 * and season-aware hunting hints.
 */
export function WindCompass({ windDirection, windMinAgo, onWindChange, season = 'rut' }: WindCompassProps) {
  const [mounted, setMounted] = useState(false);
  const [hoveredDir, setHoveredDir] = useState<WindDirection | null>(null);
  
  useEffect(() => { setMounted(true); }, []);

  const currentAngle = DIR_ANGLES[windDirection];
  const colors = SEASON_COLORS[season];
  const hint = SEASON_HINTS[season];

  /* ── Ring radius and positions ── */
  const cx = 100, cy = 100, ringR = 72;

  const dirButton = useCallback((dir: WindDirection) => {
    const angle = DIR_ANGLES[dir];
    const rad = (angle - 90) * (Math.PI / 180);
    const isCardinal = ['N', 'E', 'S', 'W'].includes(dir);
    const r = isCardinal ? ringR + 2 : ringR;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    const isSelected = windDirection === dir;
    const isHovered = hoveredDir === dir;

    return (
      <g key={dir}>
        {/* Glow behind selected */}
        {isSelected && (
          <circle
            cx={x} cy={y}
            r={isCardinal ? 16 : 13}
            fill={colors.glow}
            className="transition-all duration-500"
          />
        )}
        {/* Hit target */}
        <circle
          cx={x} cy={y}
          r={isCardinal ? 14 : 11}
          fill={isSelected ? 'rgba(255,255,255,0.12)' : isHovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'}
          stroke={isSelected ? colors.accent : isHovered ? 'rgba(255,255,255,0.15)' : 'transparent'}
          strokeWidth={isSelected ? 1.5 : 1}
          className="cursor-pointer transition-all duration-200"
          onClick={() => onWindChange(dir)}
          onMouseEnter={() => setHoveredDir(dir)}
          onMouseLeave={() => setHoveredDir(null)}
        />
        {/* Label */}
        <text
          x={x} y={y}
          textAnchor="middle"
          dominantBaseline="central"
          className="cursor-pointer select-none transition-all duration-200"
          style={{
            fontSize: isCardinal ? '11px' : '9px',
            fontWeight: isSelected ? 700 : isCardinal ? 600 : 500,
            fill: isSelected ? '#ffffff' : isHovered ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)',
            letterSpacing: '0.03em',
          }}
          onClick={() => onWindChange(dir)}
          onMouseEnter={() => setHoveredDir(dir)}
          onMouseLeave={() => setHoveredDir(null)}
        >
          {dir}
        </text>
      </g>
    );
  }, [windDirection, hoveredDir, colors, onWindChange]);

  return (
    <div className="p-3 border-b border-white/[0.06]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: colors.accent,
              boxShadow: `0 0 6px ${colors.glow}`,
            }}
          />
          <span className="text-xs font-medium text-white/90">Wind</span>
          <span
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{
              color: colors.accent,
              backgroundColor: `${colors.accent}15`,
            }}
          >
            {windDirection}
          </span>
        </div>
        <span className="text-[10px] text-stone-500/70">
          {windMinAgo < 1 ? 'Just now' : `${windMinAgo}m ago`}
        </span>
      </div>

      {/* SVG Compass */}
      <div className="relative mx-auto" style={{ width: '100%', maxWidth: 220, aspectRatio: '1' }}>
        <svg
          viewBox="0 0 200 200"
          className="w-full h-full"
          style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))' }}
        >
          <defs>
            {/* Needle gradient */}
            <linearGradient id="needleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={colors.accent} />
              <stop offset="100%" stopColor={colors.accent} stopOpacity="0.3" />
            </linearGradient>
            {/* Tail gradient */}
            <linearGradient id="needleTail" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.03)" />
            </linearGradient>
            {/* Center glow */}
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={colors.accent} stopOpacity="0.15" />
              <stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
            </radialGradient>
            {/* Outer ring gradient */}
            <radialGradient id="ringGrad" cx="50%" cy="50%" r="50%">
              <stop offset="85%" stopColor="transparent" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
            </radialGradient>
          </defs>

          {/* Outer ring */}
          <circle cx={cx} cy={cy} r={ringR - 20} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <circle cx={cx} cy={cy} r={ringR - 8} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />

          {/* Tick marks — fine degree indicators */}
          {Array.from({ length: 36 }).map((_, i) => {
            const angle = i * 10;
            const rad = (angle - 90) * (Math.PI / 180);
            const isMajor = angle % 90 === 0;
            const isMinor = angle % 45 === 0;
            const innerR = isMajor ? ringR - 30 : isMinor ? ringR - 26 : ringR - 22;
            const outerR = ringR - 18;
            return (
              <line
                key={`tick-${i}`}
                x1={cx + innerR * Math.cos(rad)}
                y1={cy + innerR * Math.sin(rad)}
                x2={cx + outerR * Math.cos(rad)}
                y2={cy + outerR * Math.sin(rad)}
                stroke={isMajor ? 'rgba(255,255,255,0.2)' : isMinor ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)'}
                strokeWidth={isMajor ? 1.5 : 0.75}
                strokeLinecap="round"
              />
            );
          })}

          {/* Center glow circle */}
          <circle cx={cx} cy={cy} r="30" fill="url(#centerGlow)" />

          {/* Animated needle group */}
          <g
            style={{
              transform: `rotate(${mounted ? currentAngle : 0}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: mounted ? 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
            }}
          >
            {/* Needle head — points to wind direction */}
            <polygon
              points={`${cx},${cy - 42} ${cx - 5},${cy - 8} ${cx + 5},${cy - 8}`}
              fill="url(#needleGrad)"
              style={{ filter: `drop-shadow(0 0 4px ${colors.glow})` }}
            />
            {/* Needle tail */}
            <polygon
              points={`${cx},${cy + 32} ${cx - 4},${cy + 6} ${cx + 4},${cy + 6}`}
              fill="url(#needleTail)"
            />
            {/* Center pivot */}
            <circle cx={cx} cy={cy} r="4" fill={colors.accent} opacity="0.9" />
            <circle cx={cx} cy={cy} r="2" fill="white" opacity="0.6" />
          </g>

          {/* Direction buttons arranged in a circle */}
          {WIND_DIRECTIONS.map(dirButton)}
        </svg>
      </div>

      {/* Season-aware hunting hint */}
      <div
        className="mt-2 px-2.5 py-2 rounded-lg text-center"
        style={{ backgroundColor: `${colors.accent}08`, borderLeft: `2px solid ${colors.accent}30` }}
      >
        <p className="text-[10px] text-stone-400 leading-relaxed">
          <span style={{ color: colors.accent }} className="font-medium">↗ </span>
          {hint}
        </p>
      </div>
    </div>
  );
}
