'use client';

import { Calendar } from 'lucide-react';
import type { SeasonProfile } from '@/types/terrain';

const SEASONS: { value: SeasonProfile; label: string; dates: string; icon: string }[] = [
  { value: 'early', label: 'Early Season', dates: 'Sept–Oct', icon: '🌿' },
  { value: 'rut', label: 'Rut', dates: 'Nov', icon: '🦌' },
  { value: 'late', label: 'Late Season', dates: 'Dec–Jan', icon: '❄️' },
];

export { SEASONS };

interface SeasonPanelProps {
  season: SeasonProfile;
  onSeasonChange: (s: SeasonProfile) => void;
}

export function SeasonPanel({ season, onSeasonChange }: SeasonPanelProps) {
  return (
    <div className="p-3 border-b border-white/[0.06]">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium text-white/90">Season Profile</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {SEASONS.map((s) => (
          <button
            key={s.value}
            onClick={() => onSeasonChange(s.value)}
            className={`
              p-2 rounded-lg text-center transition-all duration-150
              ${season === s.value
                ? 'bg-amber-500/20 border border-amber-500/50 text-white shadow-sm'
                : 'bg-white/[0.03] border border-transparent text-white/60 hover:bg-white/[0.06] hover:text-white/80'}
            `}
          >
            <span className="text-base block">{s.icon}</span>
            <span className="text-[11px] font-medium block mt-1">{s.label}</span>
            <span className="text-[9px] text-white/40 block">{s.dates}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
