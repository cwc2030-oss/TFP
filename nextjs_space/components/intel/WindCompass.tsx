'use client';

import { Wind } from 'lucide-react';
import type { WindDirection } from '@/types/terrain';

const WIND_DIRECTIONS: WindDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export { WIND_DIRECTIONS };

interface WindCompassProps {
  windDirection: WindDirection;
  windMinAgo: number;
  onWindChange: (dir: WindDirection) => void;
}

/**
 * Wind compass selector — v1.2.
 * Removed ref-based `debouncing` prop that could silently swallow clicks
 * because refs don't trigger re-renders when cleared. Every click now
 * fires immediately; downstream effects debounce themselves as needed.
 */
export function WindCompass({ windDirection, windMinAgo, onWindChange }: WindCompassProps) {
  return (
    <div className="p-3 border-b border-white/[0.06]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wind className="h-3.5 w-3.5 text-stone-400" />
          <span className="text-xs font-medium text-white/90">Wind: {windDirection}</span>
        </div>
        <span className="text-[10px] text-stone-500/70">
          {windMinAgo} min ago
        </span>
      </div>
      {/* Compact compass selector */}
      <div className="flex flex-wrap gap-1.5 justify-center">
        {WIND_DIRECTIONS.map((dir) => {
          const isSelected = windDirection === dir;
          return (
            <button
              key={dir}
              onClick={() => onWindChange(dir)}
              className={`
                w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-medium transition-all duration-150
                ${isSelected
                  ? 'bg-white/[0.12] border border-white/[0.15] text-white shadow-sm'
                  : 'bg-white/[0.03] border border-transparent text-stone-500 hover:bg-white/[0.06] hover:text-white/70'}
              `}
            >
              {dir}
            </button>
          );
        })}
      </div>
    </div>
  );
}
