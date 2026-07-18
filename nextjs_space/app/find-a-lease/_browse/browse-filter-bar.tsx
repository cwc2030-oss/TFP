'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { US_STATES } from '@/app/_landing-shared/states';

// Real terrain verdict floor (replaces the retired v1 letter-grade filter).
const BACKBONE_OPTIONS = [
  { value: 'confirmed', label: 'Confirmed backbone' },
  { value: 'marginal', label: 'Marginal or better' },
] as const;
const LEASE_TYPE_OPTIONS = [
  'ANNUAL',
  'SEASON_FULL',
  'RIFLE_ONLY',
  'BOW_ONLY',
  'YOUTH',
  'OTHER',
] as const;
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'deerFlow', label: 'Deer flow (high → low)' },
  { value: 'backbone', label: 'Strongest backbone' },
  { value: 'lowPrice', label: 'Lowest price' },
  { value: 'largestAcres', label: 'Largest acres' },
] as const;

function leaseTypeLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

interface Props {
  onApply: (params: URLSearchParams) => void;
}

export default function BrowseFilterBar({ onApply }: Props) {
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const [state, setState] = useState(params?.get('state') ?? '');
  const [county, setCounty] = useState(params?.get('county') ?? '');
  const [backbone, setBackbone] = useState(params?.get('backbone') ?? '');
  const [leaseType, setLeaseType] = useState(params?.get('leaseType') ?? '');
  const [acresMin, setAcresMin] = useState(params?.get('acresMin') ?? '');
  const [acresMax, setAcresMax] = useState(params?.get('acresMax') ?? '');
  const [priceMin, setPriceMin] = useState(params?.get('priceMin') ?? '');
  const [priceMax, setPriceMax] = useState(params?.get('priceMax') ?? '');
  const [flowMin, setFlowMin] = useState(params?.get('flowMin') ?? '');
  const [sort, setSort] = useState(params?.get('sort') ?? 'newest');

  function buildParams(): URLSearchParams {
    const next = new URLSearchParams();
    if (state) next.set('state', state);
    if (county.trim()) next.set('county', county.trim());
    if (backbone) next.set('backbone', backbone);
    if (leaseType) next.set('leaseType', leaseType);
    if (acresMin) next.set('acresMin', acresMin);
    if (acresMax) next.set('acresMax', acresMax);
    if (priceMin) next.set('priceMin', priceMin);
    if (priceMax) next.set('priceMax', priceMax);
    if (flowMin) next.set('flowMin', flowMin);
    if (sort && sort !== 'newest') next.set('sort', sort);
    return next;
  }

  function apply() {
    onApply(buildParams());
  }

  function reset() {
    setState('');
    setCounty('');
    setBackbone('');
    setLeaseType('');
    setAcresMin('');
    setAcresMax('');
    setPriceMin('');
    setPriceMax('');
    setFlowMin('');
    setSort('newest');
    onApply(new URLSearchParams());
  }

  function handleSortChange(value: string) {
    setSort(value);
    const next = buildParams();
    if (value === 'newest') next.delete('sort');
    else next.set('sort', value);
    onApply(next);
  }

  const activeCount = [state, county, backbone, leaseType, acresMin, acresMax, priceMin, priceMax, flowMin].filter(Boolean).length;

  const selectClass =
    'w-full bg-stone-950 border border-stone-700 rounded-md px-2 py-1.5 text-stone-100 text-sm focus:border-emerald-500 focus:outline-none';
  const inputClass = selectClass;

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
            onChange={(e) => handleSortChange(e.target.value)}
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
              <select value={state} onChange={(e) => setState(e.target.value)} className={selectClass}>
                <option value="">Any</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">County</label>
              <input
                type="text"
                placeholder="e.g. Cass"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Terrain backbone</label>
              <select value={backbone} onChange={(e) => setBackbone(e.target.value)} className={selectClass}>
                <option value="">Any</option>
                {BACKBONE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Lease type</label>
              <select value={leaseType} onChange={(e) => setLeaseType(e.target.value)} className={selectClass}>
                <option value="">Any</option>
                {LEASE_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {leaseTypeLabel(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <div>
                <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Acres min</label>
                <input type="number" min={0} value={acresMin} onChange={(e) => setAcresMin(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Acres max</label>
                <input type="number" min={0} value={acresMax} onChange={(e) => setAcresMax(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Min deer flow</label>
              <select value={flowMin} onChange={(e) => setFlowMin(e.target.value)} className={selectClass}>
                <option value="">Any</option>
                {[1, 2, 3, 4, 5].map((s) => (
                  <option key={s} value={String(s)}>
                    {'\u2588'.repeat(s)}{'\u2591'.repeat(5 - s)} {s}/5
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <div>
                <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Price min ($/yr)</label>
                <input type="number" min={0} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1 uppercase tracking-wide">Price max ($/yr)</label>
                <input type="number" min={0} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} className={inputClass} />
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
