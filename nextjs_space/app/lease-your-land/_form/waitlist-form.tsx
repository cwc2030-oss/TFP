'use client';

/**
 * Landowner-side waitlist form. Posts to /api/waitlist with side=LANDOWNER.
 * Reads UTM params from current URL and includes them as hidden fields.
 * Swaps to inline thank-you state on success.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { US_STATES } from '../../_landing-shared/states';
import { fireWaitlistJoin } from '../../_landing-shared/analytics';

const SOURCE = 'lease_your_land_landing';

export default function WaitlistForm() {
  const sp = useSearchParams();
  const utmSource = sp?.get('utm_source') ?? '';
  const utmMedium = sp?.get('utm_medium') ?? '';
  const utmCampaign = sp?.get('utm_campaign') ?? '';

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      side: 'LANDOWNER',
      source: SOURCE,
      email: String(fd.get('email') ?? ''),
      name: String(fd.get('name') ?? '') || undefined,
      state: String(fd.get('state') ?? '') || undefined,
      acres: String(fd.get('acres') ?? '') || undefined,
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
          side: 'LANDOWNER',
          source: SOURCE,
          state: payload.state as string | undefined,
        });
        setSubmitted(true);
        return;
      }
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        setFieldErrors(data?.details?.fieldErrors ?? {});
        setError(data?.details?.formErrors?.[0] ?? 'Please check the form and try again.');
        return;
      }
      throw new Error(`Unexpected status ${res.status}`);
    } catch (err) {
      console.error('[lease-your-land] submit failed', err);
      setError("Something went wrong. Please try again.");
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
          We'll email you when launch is ready and your free landowner tools open up.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FieldEmail error={fieldErrors.email?.[0]} />
      <FieldName error={fieldErrors.name?.[0]} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="state" className="block text-sm font-medium text-stone-700 mb-1">
            State
          </label>
          <select
            id="state"
            name="state"
            defaultValue=""
            className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-stone-900 bg-white"
          >
            <option value="">Select…</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          {fieldErrors.state?.[0] && (
            <p className="text-xs text-red-600 mt-1">{fieldErrors.state[0]}</p>
          )}
        </div>
        <div>
          <label htmlFor="acres" className="block text-sm font-medium text-stone-700 mb-1">
            Approximate acres
          </label>
          <input
            id="acres"
            name="acres"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 120"
            className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-stone-900"
          />
          {fieldErrors.acres?.[0] && (
            <p className="text-xs text-red-600 mt-1">{fieldErrors.acres[0]}</p>
          )}
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
            Joining…
          </>
        ) : (
          'Join the launch list'
        )}
      </button>
    </form>
  );
}

function FieldEmail({ error }: { error?: string }) {
  return (
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
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function FieldName({ error }: { error?: string }) {
  return (
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
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
