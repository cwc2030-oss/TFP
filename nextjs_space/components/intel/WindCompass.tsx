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
    <div className="p-3 border-b border-white/10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Wind className="h-4 w-4 text-stone-400" />
          <span className="text-sm font-medium text-white">Wind: {windDirection}</span>
        </div>
        <span className="text-xs text-stone-500">
          {windMinAgo} min ago
        </span>
      </div>
      {/* Compact compass selector */}
      <div className="flex flex-wrap gap-1 justify-center">
        {WIND_DIRECTIONS.map((dir) => {
          const isSelected = windDirection === dir;
          return (
            <button
              key={dir}
              onClick={() => onWindChange(dir)}
              className={`
                w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors duration-150
                ${isSelected
                  ? 'bg-stone-600 text-white'
                  : 'bg-stone-800/50 text-stone-400 hover:bg-stone-700 hover:text-white'}
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
