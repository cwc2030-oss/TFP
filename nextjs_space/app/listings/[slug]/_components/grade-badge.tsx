/**
 * Terrain verdict badge — certificate-style block on the public listing page.
 *
 * HONEST RANKING: this renders the REAL backbone verdict from the honest
 * engine (confirmed / marginal / flat), NOT the legacy v1 terrainScore letter
 * grade. A property the engine reads as flat/low-relief no longer shows a
 * fabricated "A+". If no real verdict has been computed yet, the badge shows a
 * neutral "Terrain Analyzed" state rather than inventing a grade.
 */
import { backboneStateLabel } from '@/lib/listing-backbone';

type Size = 'lg' | 'md';

function styleFor(state: string | null | undefined) {
  switch (state) {
    case 'confirmed':
      return {
        card: 'from-amber-50 to-amber-100 border-amber-400/80',
        inner: 'border-amber-300/70',
        text: 'text-emerald-900',
        sub: 'text-emerald-800/80',
        headline: 'Confirmed',
        detail: 'Backbone',
      };
    case 'marginal':
      return {
        card: 'from-amber-50 to-yellow-100 border-amber-300/70',
        inner: 'border-amber-200/70',
        text: 'text-amber-900',
        sub: 'text-amber-800/80',
        headline: 'Marginal',
        detail: 'Backbone',
      };
    case 'flat':
      return {
        card: 'from-slate-50 to-slate-100 border-slate-300/80',
        inner: 'border-slate-200/80',
        text: 'text-slate-700',
        sub: 'text-slate-500',
        headline: 'Flat',
        detail: 'Low-relief',
      };
    default:
      return {
        card: 'from-slate-50 to-slate-100 border-slate-300/70',
        inner: 'border-slate-200/70',
        text: 'text-slate-700',
        sub: 'text-slate-500',
        headline: 'Terrain',
        detail: 'Analyzed',
      };
  }
}

export default function GradeBadge({
  backboneState,
  size = 'lg',
}: {
  backboneState: string | null | undefined;
  size?: Size;
}) {
  const s = styleFor(backboneState);
  const dimsClass =
    size === 'lg'
      ? 'w-32 h-32 sm:w-40 sm:h-40'
      : 'w-24 h-24';
  const headlineClass =
    size === 'lg' ? 'text-2xl sm:text-3xl' : 'text-xl';
  return (
    <div
      title={backboneStateLabel(backboneState as any)}
      className={`relative inline-flex items-center justify-center rounded-md bg-gradient-to-b ${s.card} border-2 shadow-xl ${dimsClass}`}
    >
      <div className={`absolute inset-1 border ${s.inner} rounded`}></div>
      <div className={`relative flex flex-col items-center justify-center ${s.text} font-serif font-bold leading-tight text-center px-2`}>
        <div className={`text-[10px] uppercase tracking-widest ${s.sub} mb-1 font-sans`}>
          Terrain
        </div>
        <div className={`drop-shadow-sm ${headlineClass}`}>{s.headline}</div>
        <div className={`text-xs mt-1 font-sans font-medium ${s.sub}`}>
          {s.detail}
        </div>
      </div>
    </div>
  );
}
