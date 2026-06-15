'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ListingPrefillResponse } from '@/lib/listing-prefill';

interface SavedPropertyOption {
  id: string;
  name: string;
  totalAcres: number;
  terrainScore: number | null;
  primaryMovement: string | null;
  updatedAt: Date;
}

export default function SavedPropertyPickerForm({
  savedProperties,
  initialSelectedId,
  prefill,
}: {
  savedProperties: SavedPropertyOption[];
  initialSelectedId?: string | null;
  prefill?: ListingPrefillResponse | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(
    initialSelectedId ?? savedProperties[0]?.id ?? null,
  );
  const [stateCode, setStateCode] = useState(prefill?.state ?? '');
  const [county, setCounty] = useState(prefill?.county ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!prefill || selected !== prefill.savedPropertyId) return;
    setStateCode(prefill.state ?? '');
    setCounty(prefill.county ?? '');
  }, [prefill, selected]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ savedPropertyId: selected }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const listingId = data.listing.id;
      if (selected === prefill?.savedPropertyId && (stateCode.trim() || county.trim())) {
        const patchRes = await fetch(`/api/listings/${listingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: stateCode.trim() || null,
            county: county.trim() || null,
          }),
        });
        if (!patchRes.ok) {
          const j = await patchRes.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${patchRes.status}`);
        }
      }
      router.push(`/dashboard/listings/${listingId}/edit?step=2`);
    } catch (e: any) {
      setErr(e.message ?? 'Failed to create listing');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {prefill && selected === prefill.savedPropertyId && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 mb-4">
          <div className="text-amber-200 font-semibold mb-1">What&apos;s next?</div>
          <p className="text-stone-300 text-sm mb-4">
            We prefilled the safe county-level listing facts from your report. Review and edit anything below before creating the draft.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <Metric label="Acres" value={prefill.acres != null ? Math.round(prefill.acres).toString() : '—'} />
            <Metric label="Terrain score" value={prefill.terrainScore != null ? String(prefill.terrainScore) : '—'} />
            <Metric label="Intercept points" value={prefill.standCount != null ? String(prefill.standCount) : '—'} />
            <Metric label="Corridors" value={prefill.funnelCount != null ? String(prefill.funnelCount) : '—'} />
            <Metric label="Bedding acres" value={prefill.bedAcres != null ? prefill.bedAcres.toFixed(1) : '—'} />
            <Metric label="Est. Lease $/acre/yr" value={prefill.leaseEstimate ?? '—'} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-stone-400 text-sm mb-1">State</span>
              <input
                name="state"
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value.toUpperCase().slice(0, 2))}
                maxLength={2}
                placeholder="MO"
                className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-stone-400 text-sm mb-1">County</span>
              <input
                name="county"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                maxLength={80}
                placeholder="e.g. Howard"
                className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>
        </div>
      )}

      {savedProperties.map((sp) => (
        <label
          key={sp.id}
          className={
            'block rounded-lg border p-4 cursor-pointer transition-colors ' +
            (selected === sp.id
              ? 'border-emerald-500 bg-emerald-950/30'
              : 'border-stone-800 bg-stone-900/50 hover:bg-stone-900/80')
          }
        >
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="savedPropertyId"
              value={sp.id}
              checked={selected === sp.id}
              onChange={() => setSelected(sp.id)}
              className="mt-1.5 accent-emerald-500"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <span className="text-stone-100 font-semibold">{sp.name}</span>
                <span className="text-stone-500 text-sm">
                  {Math.round(sp.totalAcres)} ac
                </span>
                {sp.terrainScore != null && (
                  <span className="text-emerald-400 text-sm">
                    Score {sp.terrainScore}
                  </span>
                )}
              </div>
              {sp.primaryMovement && (
                <p className="text-stone-400 text-sm mt-1">
                  Primary movement: {sp.primaryMovement}
                </p>
              )}
            </div>
          </div>
        </label>
      ))}

      {err && <p className="text-red-400 text-sm">{err}</p>}

      <button
        type="submit"
        disabled={submitting || !selected}
        className="mt-4 inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors"
      >
        {submitting ? 'Creating draft…' : 'Continue to lease terms →'}
      </button>
    </form>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-stone-950/70 border border-stone-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-stone-100 font-semibold mt-0.5">{value}</div>
    </div>
  );
}