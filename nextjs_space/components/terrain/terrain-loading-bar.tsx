'use client';

import { useState, useEffect, useRef } from 'react';

const STATUS_MESSAGES = [
  { text: '⟳ Reading elevation data...', until: 8 },
  { text: '⟳ Mapping ridges and corridors...', until: 16 },
  { text: '⟳ Calculating deer flow...', until: 24 },
  { text: '⟳ Placing stand locations...', until: 30 },
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

  // Determine current status message (cycle through, last one sticks)
  const currentMsg =
    STATUS_MESSAGES.find(m => elapsed < m.until) ??
    STATUS_MESSAGES[STATUS_MESSAGES.length - 1];

  return (
    <div className="w-full px-3 pt-3 pb-2">
      <div className="bg-gray-900/80 border border-teal-500/20 rounded-lg px-3 py-2.5 space-y-2">
        {/* Status text */}
        <p className="text-[11px] text-teal-400 font-medium tracking-wide animate-pulse">
          {currentMsg.text}
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
            This may take ~30 seconds
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
