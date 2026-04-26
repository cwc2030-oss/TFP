'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  LEASE_TYPES,
  SEASON_OPTIONS,
  AMENITY_KEYS,
} from '@/lib/listings';

type Amenities = Record<string, boolean>;

interface Initial {
  askingPriceMin: number | null;
  askingPriceMax: number | null;
  leaseType: string | null;
  huntersMax: number | null;
  seasonAvailability: string[];
  amenities: Amenities | null;
}

export default function LeaseTermsForm({
  listingId,
  initial,
}: {
  listingId: string;
  initial: Initial;
}) {
  const router = useRouter();
  const [askingPriceMin, setAskingPriceMin] = useState(
    initial.askingPriceMin?.toString() ?? '',
  );
  const [askingPriceMax, setAskingPriceMax] = useState(
    initial.askingPriceMax?.toString() ?? '',
  );
  const [leaseType, setLeaseType] = useState<string>(initial.leaseType ?? '');
  const [huntersMax, setHuntersMax] = useState(
    initial.huntersMax?.toString() ?? '',
  );
  const [seasons, setSeasons] = useState<string[]>(initial.seasonAvailability);
  const [amenities, setAmenities] = useState<Amenities>(initial.amenities ?? {});

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleSeason(s: string) {
    setSeasons((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }
  function toggleAmenity(k: string) {
    setAmenities((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  async function save(nextStep: number | 'index') {
    setSubmitting(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        askingPriceMin: askingPriceMin ? Number(askingPriceMin) : null,
        askingPriceMax: askingPriceMax ? Number(askingPriceMax) : null,
        leaseType: leaseType || null,
        huntersMax: huntersMax ? Number(huntersMax) : null,
        seasonAvailability: seasons,
        amenities: Object.values(amenities).some(Boolean) ? amenities : null,
      };
      const res = await fetch(`/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      if (nextStep === 'index') {
        router.push('/listings');
      } else {
        router.push(`/listings/${listingId}/edit?step=${nextStep}`);
      }
    } catch (e: any) {
      setErr(e.message ?? 'Save failed');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(3);
      }}
      className="space-y-6"
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Asking price min ($/yr)">
          <input
            type="number"
            min={0}
            value={askingPriceMin}
            onChange={(e) => setAskingPriceMin(e.target.value)}
            className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
          />
        </Field>
        <Field label="Asking price max ($/yr)">
          <input
            type="number"
            min={0}
            value={askingPriceMax}
            onChange={(e) => setAskingPriceMax(e.target.value)}
            className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Lease type">
          <select
            value={leaseType}
            onChange={(e) => setLeaseType(e.target.value)}
            className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">—</option>
            {LEASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Max hunters">
          <input
            type="number"
            min={1}
            max={50}
            value={huntersMax}
            onChange={(e) => setHuntersMax(e.target.value)}
            className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
          />
        </Field>
      </div>

      <Field label="Seasons available">
        <div className="flex flex-wrap gap-2 mt-1">
          {SEASON_OPTIONS.map((s) => {
            const on = seasons.includes(s);
            return (
              <button
                type="button"
                key={s}
                onClick={() => toggleSeason(s)}
                className={
                  'px-3 py-1.5 rounded-full border text-sm transition-colors capitalize ' +
                  (on
                    ? 'border-emerald-500 bg-emerald-950/50 text-emerald-200'
                    : 'border-stone-700 bg-stone-900 text-stone-400 hover:border-stone-600')
                }
              >
                {s}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Amenities">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
          {AMENITY_KEYS.map((k) => (
            <label
              key={k}
              className="flex items-center gap-2 text-stone-300 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={!!amenities[k]}
                onChange={() => toggleAmenity(k)}
                className="accent-emerald-500"
              />
              <span className="capitalize">
                {k.replace(/([A-Z])/g, ' $1').trim()}
              </span>
            </label>
          ))}
        </div>
      </Field>

      {err && <p className="text-red-400 text-sm">{err}</p>}

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium transition-colors"
        >
          {submitting ? 'Saving…' : 'Save and continue →'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => save('index')}
          className="inline-flex items-center justify-center bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-200 px-6 py-3 rounded-lg font-medium transition-colors"
        >
          Save and exit
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-stone-400 text-sm mb-1">{label}</span>
      {children}
    </label>
  );
}
