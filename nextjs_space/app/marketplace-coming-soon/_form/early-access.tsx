'use client';

/**
 * "Get Early Access" capture for the marketplace coming-soon wall.
 *
 * Two paths — hunter ("notify me when leases go live") and landowner
 * ("list your ground, be first in line"). Both post to /api/waitlist with
 * the matching side, then swap to an inline thank-you state.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Target, Trees, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';
import { US_STATES } from '../../_landing-shared/states';
import { fireWaitlistJoin } from '../../_landing-shared/analytics';

const SOURCE = 'marketplace_coming_soon';

type Side = 'HUNTER' | 'LANDOWNER';

const PATHS: Record<
  Side,
  { icon: typeof Target; title: string; blurb: string; cta: string; done: string }
> = {
  HUNTER: {
    icon: Target,
    title: "I'm a Hunter",
    blurb: 'Notify me when leases go live',
    cta: 'Notify me at launch',
    done: "You're on the list. We'll email you the moment certified leases go live.",
  },
  LANDOWNER: {
    icon: Trees,
    title: 'I Own Land',
    blurb: 'List your ground — be first in line',
    cta: 'Reserve my spot',
    done: "You're on the list. We'll reach out with your free landowner listing tools.",
  },
};

export default function EarlyAccess() {
  const sp = useSearchParams();
  const [side, setSide] = useState<Side | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!side) return;
    setError(null);
    setSubmitting(true);

    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      side,
      source: SOURCE,
      email: String(fd.get('email') ?? ''),
      name: String(fd.get('name') ?? '') || undefined,
      state: String(fd.get('state') ?? '') || undefined,
      utmSource: sp?.get('utm_source') || undefined,
      utmMedium: sp?.get('utm_medium') || undefined,
      utmCampaign: sp?.get('utm_campaign') || undefined,
    };

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 200 || res.status === 201) {
        fireWaitlistJoin({
          side,
          source: SOURCE,
          state: payload.state as string | undefined,
        });
        setSubmitted(true);
        return;
      }
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        setError(data?.details?.formErrors?.[0] ?? 'Please check the form and try again.');
        return;
      }
      throw new Error(`Unexpected status ${res.status}`);
    } catch (err) {
      console.error('[marketplace-coming-soon] submit failed', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted && side) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/15 mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <h3 className="text-2xl font-bold text-stone-50">You&apos;re on the list.</h3>
        <p className="mt-3 text-stone-300 max-w-md mx-auto">{PATHS[side].done}</p>
      </div>
    );
  }

  // Path picker
  if (!side) {
    return (
      <div>
        <div className="text-center">
          <h3 className="text-xl font-bold text-stone-50">Get Early Access</h3>
          <p className="mt-1 text-stone-400">Choose your path below</p>
        </div>
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(Object.keys(PATHS) as Side[]).map((key) => {
            const p = PATHS[key];
            const Icon = p.icon;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSide(key)}
                className="text-left rounded-xl border border-stone-700 bg-stone-800 p-5 hover:border-emerald-500 hover:bg-stone-800/70 transition-colors group"
              >
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 mb-3 group-hover:bg-emerald-500/20">
                  <Icon className="w-5 h-5" />
                </span>
                <p className="font-semibold text-stone-100">{p.title}</p>
                <p className="text-sm text-stone-400 mt-0.5">{p.blurb}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Email capture for the chosen path
  const p = PATHS[side];
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setSide(null);
          setError(null);
        }}
        className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-stone-100 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h3 className="text-xl font-bold text-stone-50">{p.title}</h3>
      <p className="text-stone-400 mt-0.5">{p.blurb}</p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        <input
          name="name"
          type="text"
          placeholder="First name"
          autoComplete="given-name"
          className="w-full rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-stone-100 placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="Email address"
          autoComplete="email"
          className="w-full rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-stone-100 placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
        />
        <select
          name="state"
          defaultValue=""
          className="w-full rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-stone-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
        >
          <option value="" disabled>
            State (optional)
          </option>
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold px-6 py-3 transition-colors"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Submitting…' : p.cta}
        </button>
      </form>
    </div>
  );
}
