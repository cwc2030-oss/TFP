'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { trackListingCreated } from '@/lib/gtag';

interface Listing {
  id: string;
  savedPropertyId: string | null;
  state: string | null;
  county: string | null;
  acres: number | null;
  askingPriceMin: number | null;
  askingPriceMax: number | null;
  leaseType: string | null;
  huntersMax: number | null;
  seasonAvailability: string[] | null;
  description: string | null;
  photos: string[] | null;
  contactMethod: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

interface CheckItem {
  key: string;
  label: string;
  ok: boolean;
  message: string; // shown when NOT ok
  fixStep: number;
}

function buildChecklist(l: Listing): CheckItem[] {
  const items: CheckItem[] = [
    {
      key: 'savedPropertyId',
      label: 'Anchored property',
      ok: !!l.savedPropertyId,
      message: 'Listing must be anchored to a Saved Property.',
      fixStep: 1,
    },
    {
      key: 'state',
      label: 'State',
      ok: !!l.state,
      message: 'Select a state.',
      fixStep: 2,
    },
    {
      key: 'county',
      label: 'County',
      ok: !!l.county,
      message: 'Enter the county.',
      fixStep: 2,
    },
    {
      key: 'askingPriceMin',
      label: 'Asking price (min)',
      ok: l.askingPriceMin != null && l.askingPriceMin > 0,
      message: 'Set a minimum asking price greater than $0.',
      fixStep: 2,
    },
    {
      key: 'askingPriceMax',
      label: 'Asking price (max)',
      ok: l.askingPriceMax != null && l.askingPriceMax > 0 &&
        (l.askingPriceMin == null || l.askingPriceMax >= l.askingPriceMin),
      message: l.askingPriceMax != null && l.askingPriceMin != null && l.askingPriceMax < l.askingPriceMin
        ? 'Max price must be ≥ min price.'
        : 'Set a maximum asking price greater than $0.',
      fixStep: 2,
    },
    {
      key: 'leaseType',
      label: 'Lease type',
      ok: !!l.leaseType,
      message: 'Select a lease type (Annual, Rifle Only, etc.).',
      fixStep: 2,
    },
    {
      key: 'huntersMax',
      label: 'Max hunters',
      ok: l.huntersMax != null && l.huntersMax > 0,
      message: 'Set max number of hunters (at least 1).',
      fixStep: 2,
    },
    {
      key: 'seasonAvailability',
      label: 'Seasons',
      ok: Array.isArray(l.seasonAvailability) && l.seasonAvailability.length > 0,
      message: 'Select at least one season (bow, rifle, etc.).',
      fixStep: 2,
    },
    {
      key: 'description',
      label: 'Description',
      ok: !!l.description && l.description.trim().length >= 30,
      message: 'Write a description (at least 30 characters).',
      fixStep: 3,
    },
    {
      key: 'photos',
      label: 'Photos',
      ok: Array.isArray(l.photos) && l.photos.length > 0,
      message: 'Upload at least one photo.',
      fixStep: 3,
    },
    {
      key: 'contactMethod',
      label: 'Contact method',
      ok: !!l.contactMethod,
      message: 'Choose how hunters can reach you (email, phone, or both).',
      fixStep: 3,
    },
  ];

  // Conditional contact info checks
  if (l.contactMethod === 'EMAIL_RELAY' || l.contactMethod === 'BOTH') {
    items.push({
      key: 'contactEmail',
      label: 'Contact email',
      ok: !!l.contactEmail,
      message: 'Provide a contact email for your chosen contact method.',
      fixStep: 3,
    });
  }
  if (l.contactMethod === 'PHONE' || l.contactMethod === 'BOTH') {
    items.push({
      key: 'contactPhone',
      label: 'Contact phone',
      ok: !!l.contactPhone,
      message: 'Provide a phone number for your chosen contact method.',
      fixStep: 3,
    });
  }

  return items;
}

export default function ReviewPublish({ listing }: { listing: Listing }) {
  const router = useRouter();
  const { data: session } = useSession() || {};
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const checklist = buildChecklist(listing);
  const allPassed = checklist.every((c) => c.ok);
  const failCount = checklist.filter((c) => !c.ok).length;

  async function handlePublish() {
    if (!allPassed) return;
    if (!window.confirm('Submit this listing for review? Our team gives it a quick look before it goes live on the marketplace.')) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/listings/${listing.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // Parse field-level errors from publish endpoint
        if (Array.isArray(j?.errors) && j.errors.length > 0) {
          const detail = j.errors.map((e: { field: string; message: string }) => e.message).join(' • ');
          throw new Error(detail);
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      // Success — fire GA4 listing_created (confirmed publish). No PII.
      // acres comes from the fresh server snapshot; state/county from the
      // owner-supplied listing; tier = owner's account tier.
      const published = await res.json().catch(() => ({} as any));
      trackListingCreated({
        acres: published?.listing?.acres ?? listing.acres,
        state: listing.state,
        county: listing.county,
        tier: (session?.user as any)?.subscriptionStatus || 'free',
      });
      // Go to listings dashboard
      startTransition(() => {
        router.push('/dashboard/listings');
        router.refresh();
      });
    } catch (e: any) {
      setError(e.message ?? 'Publish failed');
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="rounded-lg border border-stone-700 bg-stone-900/50 p-5">
        <h3 className="text-stone-100 font-semibold text-lg mb-1">Submission checklist</h3>
        <p className="text-stone-400 text-sm mb-4">
          {allPassed
            ? 'All requirements met — submit your listing for review and it goes live once approved.'
            : `${failCount} item${failCount === 1 ? '' : 's'} still needed before you can submit.`}
        </p>

        <ul className="space-y-2">
          {checklist.map((item) => (
            <li
              key={item.key}
              className={`flex items-start gap-3 rounded-md px-3 py-2 text-sm ${
                item.ok
                  ? 'bg-emerald-950/30 border border-emerald-800/30'
                  : 'bg-red-950/20 border border-red-800/30'
              }`}
            >
              <span className="mt-0.5 text-base leading-none flex-shrink-0">
                {item.ok ? '✅' : '❌'}
              </span>
              <div className="flex-1 min-w-0">
                <span className={item.ok ? 'text-emerald-200' : 'text-red-200 font-medium'}>
                  {item.label}
                </span>
                {!item.ok && (
                  <span className="text-red-400 ml-1">— {item.message}</span>
                )}
              </div>
              {!item.ok && (
                <Link
                  href={`/dashboard/listings/${listing.id}/edit?step=${item.fixStep}`}
                  className="flex-shrink-0 text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                >
                  Fix →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Error from server */}
      {error && (
        <div className="rounded-md border border-red-800/40 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href={`/dashboard/listings/${listing.id}/edit?step=3`}
          className="inline-flex items-center justify-center bg-stone-800 hover:bg-stone-700 text-stone-200 px-6 py-3 rounded-lg font-medium transition-colors"
        >
          ← Back to photos & contact
        </Link>
        <button
          type="button"
          disabled={!allPassed || publishing}
          onClick={handlePublish}
          className={
            'inline-flex items-center justify-center px-6 py-3 rounded-lg font-medium transition-colors ' +
            (allPassed
              ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
              : 'bg-stone-700 text-stone-500 cursor-not-allowed')
          }
        >
          {publishing ? 'Submitting…' : allPassed ? 'Submit for review' : `${failCount} item${failCount === 1 ? '' : 's'} remaining`}
        </button>
      </div>

      {!allPassed && (
        <p className="text-stone-500 text-xs">
          Fill in all required fields above, then return here to submit for review.
        </p>
      )}
    </div>
  );
}
