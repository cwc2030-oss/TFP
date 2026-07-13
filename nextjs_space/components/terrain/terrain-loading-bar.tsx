'use client';

import { useState, useEffect, useRef } from 'react';

const STATUS_MESSAGES = [
  { text: 'Terrain Brain · reading terrain…', until: 8 },
  { text: 'Terrain Brain · mapping ridges & funnels…', until: 16 },
  { text: 'Terrain Brain · mapping deer flow…', until: 24 },
  { text: 'Terrain Brain · marking convergence zones…', until: 30 },
];
const ROLLOVER_MESSAGES = [
  'Terrain Brain · refining deer flow…',
  'Terrain Brain · merging terrain features…',
  'Terrain Brain · crunching the big picture…',
];

interface TerrainLoadingBarProps {
  visible: boolean;
}

export default function TerrainLoadingBar({ visible }: TerrainLoadingBarProps) {
  const [elapsed, setElapsed] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const hasShownHintRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset elapsed when visibility toggles on
  useEffect(() => {
    if (visible) {
      setElapsed(0);
      if (!hasShownHintRef.current) {
        setShowHint(true);
        hasShownHintRef.current = true;
      }
      intervalRef.current = setInterval(() => {
        setElapsed(prev => prev + 0.5);
      }, 500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible]);

  if (!visible) return null;

  // Determine current status message: scripted through 30s, then cycle rollover messages
  const scripted = STATUS_MESSAGES.find(m => elapsed < m.until);
  const currentText = scripted
    ? scripted.text
    : ROLLOVER_MESSAGES[Math.floor((elapsed - 30) / 4) % ROLLOVER_MESSAGES.length];

  return (
    <div className="w-full px-3 pt-3 pb-2">
      <div className="bg-gray-900/80 border border-teal-500/20 rounded-lg px-3 py-2.5 space-y-2">
        {/* Status text */}
        <p className="text-[11px] text-teal-400 font-medium tracking-wide animate-pulse">
          {currentText}
        </p>

        {/* Indeterminate progress bar */}
        <div className="w-full h-1.5 bg-gray-800/80 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              background: 'linear-gradient(90deg, #0d9488, #2dd4bf, #0d9488)',
              backgroundSize: '200% 100%',
              animation: 'terrain-loading-sweep 1.8s ease-in-out infinite',
              width: '100%',
            }}
          />
        </div>

        {/* First-time hint */}
        {showHint && (
          <p className="text-[9px] text-stone-500 leading-relaxed">
            {elapsed < 30
              ? 'A single parcel takes ~30 seconds'
              : 'Large area — this can take a minute or two'}
          </p>
        )}
      </div>

      {/* Keyframes injected via style tag */}
      <style jsx>{`
        @keyframes terrain-loading-sweep {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}
