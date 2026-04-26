/**
 * Client-side inquiry submission form for /listings/[slug]/inquire.
 *
 * - Posts to /api/listings/{listingId}/inquire
 * - Fields: hunterName, hunterEmail, hunterPhone (optional), preferredDates,
 *   partySize, message, plus a hidden honeypot "website".
 * - Surfaces inline success / error UI.
 * - Fires GA4 "listing_inquiry" via lib/gtag trackEvent on success.
 * - Forwards UTMs from the URL (utm_source / utm_medium / utm_campaign).
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trackEvent } from '@/lib/gtag';

interface Props {
  listingId: string;
  slug: string;
  county: string | null;
  state: string | null;
}

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'success'; idempotent: boolean };

export default function InquiryForm({ listingId, slug, county, state }: Props) {
  const [form, setForm] = useState<FormState>({ status: 'idle' });
  const formRef = useRef<HTMLFormElement | null>(null);

  // Pull UTMs once on mount.
  const utms = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const sp = new URLSearchParams(window.location.search);
    return {
      utmSource: sp.get('utm_source') || undefined,
      utmMedium: sp.get('utm_medium') || undefined,
      utmCampaign: sp.get('utm_campaign') || undefined,
    };
  }, []);

  // Make sure repeat submissions reset error
  useEffect(() => {
    if (form.status === 'success' && formRef.current) {
      formRef.current.reset();
    }
  }, [form.status]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (form.status === 'submitting') return;

    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      hunterName: String(fd.get('hunterName') ?? '').trim(),
      hunterEmail: String(fd.get('hunterEmail') ?? '').trim(),
      hunterPhone: optional(fd.get('hunterPhone')),
      preferredDates: optional(fd.get('preferredDates')),
      partySize: Number(fd.get('partySize')) || 1,
      message: String(fd.get('message') ?? '').trim(),
      source: 'listing_detail',
      website: String(fd.get('website') ?? ''), // honeypot
    };
    if (utms?.utmSource) payload.utmSource = utms.utmSource;
    if (utms?.utmMedium) payload.utmMedium = utms.utmMedium;
    if (utms?.utmCampaign) payload.utmCampaign = utms.utmCampaign;

    setForm({ status: 'submitting' });

    let res: Response;
    try {
      res = await fetch(`/api/listings/${listingId}/inquire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setForm({
        status: 'error',
        message: 'Network error. Please try again.',
      });
      return;
    }

    if (res.status === 429) {
      setForm({
        status: 'error',
        message: "You've sent several inquiries recently. Please try again in an hour.",
      });
      return;
    }
    if (res.status === 404) {
      setForm({
        status: 'error',
        message: 'This listing is no longer available.',
      });
      return;
    }
    if (!res.ok) {
      let detail: string | null = null;
      try {
        const body = await res.json();
        if (body?.details?.fieldErrors) {
          const fe = body.details.fieldErrors as Record<string, string[]>;
          detail =
            Object.entries(fe)
              .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`)
              .join(' • ') || null;
        }
      } catch {
        /* ignore */
      }
      setForm({
        status: 'error',
        message: detail ?? 'Something went wrong. Please double-check the form and try again.',
      });
      return;
    }

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }

    trackEvent('listing_inquiry', {
      listing_slug: slug,
      listing_county: county ?? '',
      listing_state: state ?? '',
      idempotent: !!body?.idempotent,
    });

    setForm({ status: 'success', idempotent: !!body?.idempotent });
  }

  if (form.status === 'success') {
    return (
      <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/40 p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className="text-emerald-400 shrink-0 mt-1"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
          <div>
            <p className="text-emerald-200 font-semibold text-lg">
              {form.idempotent ? 'Already received' : 'Inquiry sent'}
            </p>
            <p className="text-stone-300 mt-2 text-sm leading-relaxed">
              {form.idempotent
                ? "We already had a recent inquiry from this email on this listing. The landowner has it — you'll hear back soon."
                : "We've forwarded your inquiry to the landowner. Replies come directly from them, typically within 24\u201372 hours. Check your inbox for a confirmation."}
            </p>
            <p className="text-stone-500 text-xs mt-4">
              Need to reach out about a different property? Browse more{' '}
              <a
                href="/listings"
                className="text-emerald-300 hover:text-emerald-200 underline underline-offset-4"
              >
                listings
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border border-stone-800 bg-stone-900/60 p-6 sm:p-8"
      noValidate
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Your name" htmlFor="hunterName">
          <input
            id="hunterName"
            name="hunterName"
            type="text"
            required
            maxLength={120}
            autoComplete="name"
            className="w-full rounded-md bg-stone-950 border border-stone-700 focus:border-emerald-500 outline-none px-3 py-2 text-stone-100 placeholder:text-stone-500"
            placeholder="Jane Hunter"
          />
        </Field>
        <Field label="Email" htmlFor="hunterEmail">
          <input
            id="hunterEmail"
            name="hunterEmail"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            className="w-full rounded-md bg-stone-950 border border-stone-700 focus:border-emerald-500 outline-none px-3 py-2 text-stone-100 placeholder:text-stone-500"
            placeholder="jane@example.com"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Phone (optional)" htmlFor="hunterPhone">
          <input
            id="hunterPhone"
            name="hunterPhone"
            type="tel"
            maxLength={32}
            autoComplete="tel"
            className="w-full rounded-md bg-stone-950 border border-stone-700 focus:border-emerald-500 outline-none px-3 py-2 text-stone-100 placeholder:text-stone-500"
            placeholder="(555) 555-1234"
          />
        </Field>
        <Field label="Party size" htmlFor="partySize">
          <input
            id="partySize"
            name="partySize"
            type="number"
            min={1}
            max={50}
            defaultValue={1}
            required
            className="w-full rounded-md bg-stone-950 border border-stone-700 focus:border-emerald-500 outline-none px-3 py-2 text-stone-100"
          />
        </Field>
      </div>

      <Field label="Preferred dates (optional)" htmlFor="preferredDates">
        <input
          id="preferredDates"
          name="preferredDates"
          type="text"
          maxLength={200}
          className="w-full rounded-md bg-stone-950 border border-stone-700 focus:border-emerald-500 outline-none px-3 py-2 text-stone-100 placeholder:text-stone-500"
          placeholder="e.g. first two weeks of November"
        />
      </Field>

      <Field label="Message" htmlFor="message" hint="20–2000 characters">
        <textarea
          id="message"
          name="message"
          required
          minLength={20}
          maxLength={2000}
          rows={6}
          className="w-full rounded-md bg-stone-950 border border-stone-700 focus:border-emerald-500 outline-none px-3 py-2 text-stone-100 placeholder:text-stone-500 resize-y"
          placeholder="Tell the landowner about your group, hunting style, weapons, and anything that would help them say yes."
        />
      </Field>

      {/* Honeypot — hidden from real users via aria + tabindex + visual offset */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-10000px',
          top: 'auto',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
        }}
      >
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      {form.status === 'error' && (
        <div
          role="alert"
          className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200"
        >
          {form.message}
        </div>
      )}

      <button
        type="submit"
        disabled={form.status === 'submitting'}
        className="w-full inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors"
      >
        {form.status === 'submitting' ? 'Sending\u2026' : 'Send inquiry'}
      </button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-stone-300 text-sm font-medium mb-1.5"
      >
        {label}
        {hint && <span className="text-stone-500 font-normal ml-2">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function optional(v: FormDataEntryValue | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}
