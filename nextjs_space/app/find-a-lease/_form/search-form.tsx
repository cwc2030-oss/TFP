'use client';

/**
 * Hunter-side waitlist form. Posts to /api/waitlist with side=HUNTER.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { US_STATES } from '../../_landing-shared/states';
import { fireWaitlistJoin } from '../../_landing-shared/analytics';

const SOURCE = 'find_a_lease_landing';
const SEASON_OPTIONS = [
  { value: 'bow', label: 'Bow' },
  { value: 'rifle', label: 'Rifle' },
  { value: 'muzzleloader', label: 'Muzzleloader' },
  { value: 'youth', label: 'Youth' },
] as const;

export default function SearchForm() {
  const sp = useSearchParams();
  const utmSource = sp?.get('utm_source') ?? '';
  const utmMedium = sp?.get('utm_medium') ?? '';
  const utmCampaign = sp?.get('utm_campaign') ?? '';

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [seasonInterest, setSeasonInterest] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);

  function toggleSeason(value: string) {
    setSeasonInterest((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function toggleState(value: string) {
    setStates((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      side: 'HUNTER',
      source: SOURCE,
      email: String(fd.get('email') ?? ''),
      name: String(fd.get('name') ?? '') || undefined,
      states,
      maxBudgetUsd: String(fd.get('maxBudgetUsd') ?? '') || undefined,
      seasonInterest,
      groupSize: String(fd.get('groupSize') ?? '') || undefined,
      utmSource: utmSource || undefined,
      utmMedium: utmMedium || undefined,
      utmCampaign: utmCampaign || undefined,
    };

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 200 || res.status === 201) {
        fireWaitlistJoin({
          side: 'HUNTER',
          source: SOURCE,
          state: states[0],
        });
        setSubmitted(true);
        return;
      }
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        setFieldErrors(data?.details?.fieldErrors ?? {});
        setError(
          data?.details?.formErrors?.[0] ?? 'Please check the form and try again.',
        );
        return;
      }
      throw new Error(`Unexpected status ${res.status}`);
    } catch (err) {
      console.error('[find-a-lease] submit failed', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="text-center py-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-700" />
        </div>
        <h2 className="text-2xl font-bold text-stone-900">You're on the list.</h2>
        <p className="mt-3 text-stone-600 max-w-md mx-auto">
          We'll email you when early access opens — 30 days before public
          listings go live.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1">
          Email <span className="text-red-600">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-stone-900"
        />
        {fieldErrors.email?.[0] && (
          <p className="text-xs text-red-600 mt-1">{fieldErrors.email[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="First and last name"
          className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-stone-900"
        />
      </div>

      <div>
        <p className="block text-sm font-medium text-stone-700 mb-1">
          States of interest
        </p>
        <details className="border border-stone-300 rounded-lg bg-white">
          <summary className="px-3 py-2 cursor-pointer text-sm text-stone-700">
            {states.length === 0
              ? 'Pick one or more states…'
              : `${states.length} selected: ${states.join(', ')}`}
          </summary>
          <div className="max-h-40 overflow-y-auto p-2 grid grid-cols-3 gap-1 border-t border-stone-200">
            {US_STATES.map((s) => {
              const checked = states.includes(s.code);
              return (
                <label
                  key={s.code}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded cursor-pointer ${
                    checked ? 'bg-emerald-100 text-emerald-800' : 'hover:bg-stone-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleState(s.code)}
                  />
                  {s.code}
                </label>
              );
            })}
          </div>
        </details>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="maxBudgetUsd"
            className="block text-sm font-medium text-stone-700 mb-1"
          >
            Max budget (USD/year)
          </label>
          <input
            id="maxBudgetUsd"
            name="maxBudgetUsd"
            type="number"
            min={0}
            step={100}
            inputMode="numeric"
            placeholder="e.g. 3000"
            className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-stone-900"
          />
        </div>
        <div>
          <label htmlFor="groupSize" className="block text-sm font-medium text-stone-700 mb-1">
            Group size
          </label>
          <input
            id="groupSize"
            name="groupSize"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 4"
            className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-stone-900"
          />
        </div>
      </div>

      <div>
        <p className="block text-sm font-medium text-stone-700 mb-1">Season interest</p>
        <div className="flex flex-wrap gap-2">
          {SEASON_OPTIONS.map((opt) => {
            const active = seasonInterest.includes(opt.value);
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => toggleSeason(opt.value)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  active
                    ? 'bg-emerald-700 border-emerald-700 text-white'
                    : 'bg-white border-stone-300 text-stone-700 hover:border-emerald-500'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Saving…
          </>
        ) : (
          'Save my search'
        )}
      </button>
    </form>
  );
}
