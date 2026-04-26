/**
 * Certificate-style grade badge — mirrors the A+ block on page 7 of the
 * Terra Firma Partners Hunt Report. Large gold/dark-emerald serif on a
 * cream card with a thin gold border.
 */
import { gradeFromScore } from '@/lib/listings';

export default function GradeBadge({
  score,
  size = 'lg',
}: {
  score: number | null;
  size?: 'lg' | 'md';
}) {
  const grade = gradeFromScore(score);
  if (grade === '—') return null;
  const dimsClass =
    size === 'lg'
      ? 'w-32 h-32 sm:w-40 sm:h-40 text-5xl sm:text-6xl'
      : 'w-24 h-24 text-4xl';
  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border-2 border-amber-400/80 shadow-xl ${dimsClass}`}
    >
      <div className="absolute inset-1 border border-amber-300/70 rounded"></div>
      <div className="relative flex flex-col items-center justify-center text-emerald-900 font-serif font-bold leading-none">
        <div className="text-xs uppercase tracking-widest text-emerald-800/80 mb-1">
          Terrain
        </div>
        <div className="drop-shadow-sm">{grade}</div>
        {score != null && (
          <div className="text-xs mt-1 font-sans font-medium text-emerald-800/80">
            score {score}
          </div>
        )}
      </div>
    </div>
  );
}
