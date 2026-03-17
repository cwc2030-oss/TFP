'use client';

import { Mountain } from 'lucide-react';

export function TerrainWorkModeNotice() {
  return (
    <div className="p-3 border-b border-amber-700/30 bg-amber-900/20">
      <div className="flex items-start gap-2 text-xs text-amber-400/90">
        <Mountain className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Terrain Work Mode</p>
          <p className="text-amber-400/70 mt-1">
            Verifying terrain anatomy. Showing physical structure only — deer interpretation layers disabled.
          </p>
          <div className="mt-2 space-y-1 text-[10px] text-amber-400/60">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500/60" />
              <span>Backbone, Draws, Saddles, Flow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-stone-600" />
              <span>Corridors, Stands, Alignment (paused)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
