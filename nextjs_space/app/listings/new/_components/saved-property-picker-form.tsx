'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
}: {
  savedProperties: SavedPropertyOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(
    savedProperties[0]?.id ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      router.push(`/listings/${data.listing.id}/edit?step=2`);
    } catch (e: any) {
      setErr(e.message ?? 'Failed to create listing');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
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
