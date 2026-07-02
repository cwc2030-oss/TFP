'use client';

import { useMemo, useState } from 'react';
import { MapPin, Activity, Bell, CheckCircle, Search, TrendingUp, X, Info } from 'lucide-react';
import { flowGradeColor } from '@/lib/county-flow';

export interface CountyRow {
  state: string;
  county: string;
  parcelCount: number;
  avgFlowIndex: number;
  adjustedFlowIndex: number;
  limitedData: boolean;
  grade: string;
  avgFunnelCount: number;
  avgBedAcres: number;
  avgTopStand: number;
  highFlowCount: number;
}

// Grade floors, high to low. We only render the ones that actually have
// matching counties so the filter never shows an empty preset.
const GRADE_FLOORS: { label: string; min: number }[] = [
  { label: 'A-', min: 80 },
  { label: 'B', min: 70 },
  { label: 'B-', min: 65 },
  { label: 'C+', min: 60 },
  { label: 'C', min: 55 },
];
type SortKey = 'flow' | 'highflow';

export default function FlowByArea({
  counties,
  states,
}: {
  counties: CountyRow[];
  states: string[];
}) {
  const [stateFilter, setStateFilter] = useState<string>('All');
  const [gradeFilter, setGradeFilter] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortKey>('flow');
  const [query, setQuery] = useState('');
  const [alertTarget, setAlertTarget] = useState<CountyRow | null>(null);

  const gradeFloor: Record<string, number> = Object.fromEntries(
    GRADE_FLOORS.map((g) => [g.label, g.min]),
  );

  // Only offer grade floors that at least one county actually reaches.
  const availableGrades = useMemo(() => {
    const maxAdj = counties.reduce((m, c) => Math.max(m, c.adjustedFlowIndex), 0);
    return ['All', ...GRADE_FLOORS.filter((g) => maxAdj >= g.min).map((g) => g.label)];
  }, [counties]);

  const filtered = useMemo(() => {
    const rows = counties.filter((c) => {
      if (stateFilter !== 'All' && c.state !== stateFilter) return false;
      if (gradeFilter !== 'All' && c.adjustedFlowIndex < (gradeFloor[gradeFilter] ?? 0)) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (!`${c.county} ${c.state}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      if (sortBy === 'highflow') {
        if (b.highFlowCount !== a.highFlowCount) return b.highFlowCount - a.highFlowCount;
        return b.adjustedFlowIndex - a.adjustedFlowIndex;
      }
      if (b.adjustedFlowIndex !== a.adjustedFlowIndex)
        return b.adjustedFlowIndex - a.adjustedFlowIndex;
      return b.parcelCount - a.parcelCount;
    });
    return rows;
  }, [counties, stateFilter, gradeFilter, query, sortBy]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 -mt-12 relative z-10 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">
              Search county
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Jefferson"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-stone-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none text-stone-800"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">
              State
            </label>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-stone-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none text-stone-800 bg-white"
            >
              <option value="All">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">
              Minimum flow grade
            </label>
            <div className="flex gap-1.5">
              {availableGrades.map((g) => (
                <button
                  key={g}
                  onClick={() => setGradeFilter(g)}
                  className={`flex-1 px-2 py-2.5 rounded-lg text-sm font-semibold border transition ${
                    gradeFilter === g
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-stone-600 border-stone-300 hover:border-emerald-400'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-stone-500">
            {filtered.length} {filtered.length === 1 ? 'county' : 'counties'} rated
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide mr-1">
              Sort by
            </span>
            <button
              onClick={() => setSortBy('flow')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${
                sortBy === 'flow'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-stone-600 border-stone-300 hover:border-emerald-400'
              }`}
            >
              Flow Index
            </button>
            <button
              onClick={() => setSortBy('highflow')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${
                sortBy === 'highflow'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-stone-600 border-stone-300 hover:border-emerald-400'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              High-flow parcels
            </button>
          </div>
        </div>
      </div>

      {/* County cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-500">
          No counties match your filters yet. Try widening the grade or state.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-16">
          {filtered.map((c, i) => (
            <div
              key={`${c.state}-${c.county}`}
              className="bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-stone-500 text-xs font-medium mb-1">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-stone-100 text-stone-600 font-bold">
                      {i + 1}
                    </span>
                    <MapPin className="w-3.5 h-3.5" />
                    {c.state}
                  </div>
                  <h3 className="text-xl font-bold text-stone-900 truncate">
                    {c.county} County
                  </h3>
                  {c.limitedData && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-stone-100 border border-stone-200 px-2 py-0.5 text-[10px] font-semibold text-stone-500 uppercase tracking-wide">
                      <Info className="w-3 h-3" />
                      Limited data · {c.parcelCount} {c.parcelCount === 1 ? 'parcel' : 'parcels'}
                    </span>
                  )}
                </div>
                <div
                  className={`flex flex-col items-center justify-center rounded-lg border px-3 py-2 ${flowGradeColor(
                    c.grade,
                  )}`}
                >
                  <span className="text-2xl font-black leading-none">{c.grade}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide mt-0.5">
                    {c.adjustedFlowIndex}/100
                  </span>
                </div>
              </div>

              {/* Flow meter */}
              <div className="mt-4">
                <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 via-emerald-400 to-emerald-600"
                    style={{ width: `${Math.max(4, c.adjustedFlowIndex)}%` }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Parcels" value={c.parcelCount} icon={<MapPin className="w-3.5 h-3.5" />} />
                <Stat
                  label="Avg funnels"
                  value={c.avgFunnelCount}
                  icon={<Activity className="w-3.5 h-3.5" />}
                />
                <Stat
                  label="High-flow"
                  value={c.highFlowCount}
                  icon={<TrendingUp className="w-3.5 h-3.5" />}
                />
              </div>

              <button
                onClick={() => setAlertTarget(c)}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-stone-900 hover:bg-emerald-700 text-white font-semibold py-2.5 transition"
              >
                <Bell className="w-4 h-4" />
                Alert me on new {c.county} listings
              </button>
            </div>
          ))}
        </div>
      )}

      {alertTarget && (
        <AlertModal county={alertTarget} onClose={() => setAlertTarget(null)} />
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-stone-50 py-2">
      <div className="flex items-center justify-center gap-1 text-emerald-700 font-bold">
        {icon}
        <span>{value}</span>
      </div>
      <div className="text-[10px] uppercase tracking-wide text-stone-500 mt-0.5">{label}</div>
    </div>
  );
}

function AlertModal({ county, onClose }: { county: CountyRow; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) {
      setStatus('error');
      setMsg('Enter a valid email.');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch('/api/county-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          county: county.county,
          state: county.state,
          source: 'deer_flow_page',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setStatus('done');
      setMsg(
        data.alreadySubscribed
          ? `You're already on the list for ${county.county} County.`
          : `Done. We'll email you the moment a high-flow parcel lists in ${county.county} County.`,
      );
    } catch (err: any) {
      setStatus('error');
      setMsg(err.message || 'Something went wrong. Try again.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-400 hover:text-stone-700"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {status === 'done' ? (
          <div className="text-center py-4">
            <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-stone-900 mb-2">You're on the list</h3>
            <p className="text-stone-600">{msg}</p>
            <button
              onClick={onClose}
              className="mt-5 rounded-lg bg-stone-900 text-white font-semibold px-5 py-2.5 hover:bg-stone-800"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-emerald-700 mb-2">
              <Bell className="w-5 h-5" />
              <span className="text-sm font-semibold uppercase tracking-wide">Free flow alert</span>
            </div>
            <h3 className="text-2xl font-bold text-stone-900">
              {county.county} County, {county.state}
            </h3>
            <p className="text-stone-600 mt-2">
              Get an email the moment a{' '}
              <span className="font-semibold text-stone-800">high-flow parcel</span> lists for lease
              in {county.county} County. No spam, unsubscribe anytime.
            </p>
            <form onSubmit={submit} className="mt-5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full px-4 py-3 rounded-lg border border-stone-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none text-stone-800"
                autoFocus
              />
              {status === 'error' && <p className="mt-2 text-sm text-red-600">{msg}</p>}
              <button
                type="submit"
                disabled={status === 'loading'}
                className="mt-3 w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 transition"
              >
                {status === 'loading' ? 'Signing you up…' : 'Notify me'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
