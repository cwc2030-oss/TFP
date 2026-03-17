'use client';

import { Calendar } from 'lucide-react';
import type { SeasonProfile } from '@/types/terrain';

const SEASONS: { value: SeasonProfile; label: string; dates: string; icon: string }[] = [
  { value: 'early', label: 'Early Season', dates: 'Sept-Oct', icon: '🌿' },
  { value: 'rut', label: 'Rut', dates: 'Nov', icon: '🦌' },
  { value: 'late', label: 'Late Season', dates: 'Dec-Jan', icon: '❄️' },
];

export { SEASONS };

interface SeasonPanelProps {
  season: SeasonProfile;
  onSeasonChange: (s: SeasonProfile) => void;
}

export function SeasonPanel({ season, onSeasonChange }: SeasonPanelProps) {
  return (
    <div className="p-4 border-b border-white/10">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium text-white">Season Profile</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SEASONS.map((s) => (
          <button
            key={s.value}
            onClick={() => onSeasonChange(s.value)}
            className={`
              p-2 rounded-lg text-center transition-colors duration-150
              ${season === s.value
                ? 'bg-amber-500/30 border-2 border-amber-500 text-white'
                : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'}
            `}
          >
            <span className="text-lg block">{s.icon}</span>
            <span className="text-xs font-medium block mt-1">{s.label}</span>
            <span className="text-[10px] text-white/50 block">{s.dates}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
