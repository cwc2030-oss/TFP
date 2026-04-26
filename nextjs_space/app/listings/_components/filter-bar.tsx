'use client';

/**
 * <FilterBar /> — client-side filter UI for the public marketplace.
 *
 * Drives navigation via Next router. All filters are encoded in the URL
 * search params so deep-links + back/forward work.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { US_STATES } from '@/app/_landing-shared/states';

const GRADE_OPTIONS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+'] as const;
const LEASE_TYPE_OPTIONS = [
  'ANNUAL',
  'SEASON_FULL',
  'RIFLE_ONLY',
  'BOW_ONLY',
  'YOUTH',
  'OTHER',
] as const;
const SEASON_OPTIONS = ['bow', 'rifle', 'muzzleloader', 'youth'] as const;
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'highScore', label: 'Highest grade' },
  { value: 'lowPrice', label: 'Lowest price' },
  { value: 'largestAcres', label: 'Largest acres' },
] as const;

export default function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [open, setOpen] = useState(false);

  const [state, setState] = useState(params.get('state') ?? '');
  const [grade, setGrade] = useState(params.get('grade') ?? '');
  const [leaseType, setLeaseType] = useState(params.get('leaseType') ?? '');
  const [season, setSeason] = useState(params.get('season') ?? '');
  const [acresMin, setAcresMin] = useState(params.get('acresMin') ?? '');
  const [acresMax, setAcresMax] = useState(params.get('acresMax') ?? '');
  const [priceMin, setPriceMin] = useState(params.get('priceMin') ?? '');
  const [priceMax, setPriceMax] = useState(params.get('priceMax') ?? '');
  const [sort, setSort] = useState(params.get('sort') ?? 'newest');

  function apply() {
    const next = new URLSearchParams();
    if (state) next.set('state', state);
    if (grade) next.set('grade', grade);
    if (leaseType) next.set('leaseType', leaseType);
    if (season) next.set('season', season);
    if (acresMin) next.set('acresMin', acresMin);
    if (acresMax) next.set('acresMax', acresMax);
    if (priceMin) next.set('priceMin', priceMin);
    if (priceMax) next.set('priceMax', priceMax);
    if (sort && sort !== 'newest') next.set('sort', sort);
    startTransition(() => {
      router.push(`/listings?${next.toString()}`);
    });
  }

  function reset() {
    setState('');
    setGrade('');
    setLeaseType('');
    setSeason('');
    setAcresMin('');
    setAcresMax('');
    setPriceMin('');
    setPriceMax('');
    setSort('newest');
    startTransition(() => {
      router.push('/listings');
    });
  }

  const activeCount =
    [state, grade, leaseType, season, acresMin, acresMax, priceMin, priceMax].filter(Boolean).length;

  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/60 mb-8">
      <div className="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 text-stone-200 font-medium"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M3 6h18M6 12h12M10 18h4" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-emerald-600 text-white text-xs">
              {activeCount}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          <label className="text-stone-400 text-sm hidden sm:block">Sort</label>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              const next = new URLSearchParams(params.toString());
              if (e.target.value === 'newest') next.delete('sort');
              else next.set('sort', e.target.value);
              startTransition(() => {
                router.push(`/listings?${next.toString()}`);
              });
            }}
            className="bg-stone-950 border border-stone-700 rounded-md px-2 py-1 text-stone-100 text-sm focus:border-emerald-500 focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {open && (
        <div className="border-t border-stone-800 px-4 py-4 sm:px-5 sm:py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">State</label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm"
              >
                <option value="">Any</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Min grade</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm"
              >
                <option value="">Any</option>
                {GRADE_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g} or better
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Lease type</label>
              <select
                value={leaseType}
                onChange={(e) => setLeaseType(e.target.value)}
                className="w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm"
              >
                <option value="">Any</option>
                {LEASE_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Season</label>
              <select
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm"
              >
                <option value="">Any</option>
                {SEASON_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <div>
                <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Acres min</label>
                <input
                  type="number"
                  min={0}
                  value={acresMin}
                  onChange={(e) => setAcresMin(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Acres max</label>
                <input
                  type="number"
                  min={0}
                  value={acresMax}
                  onChange={(e) => setAcresMax(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <div>
                <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Price min ($/yr)</label>
                <input
                  type="number"
                  min={0}
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Price max ($/yr)</label>
                <input
                  type="number"
                  min={0}
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm"
                />
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={apply}
              className="inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2 rounded-md font-medium text-sm"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center bg-stone-800 hover:bg-stone-700 text-stone-200 px-5 py-2 rounded-md font-medium text-sm"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
