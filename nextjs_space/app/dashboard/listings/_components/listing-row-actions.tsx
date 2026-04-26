'use client';

/**
 * Status-aware action buttons for owner's listings dashboard.
 *
 * DRAFT          → Edit, Publish, Discard (withdraw)
 * PENDING_REVIEW → Withdraw
 * PUBLISHED      → View public, Mark leased, Withdraw
 * LEASED         → Relist
 * WITHDRAWN      → (no actions; record is read-only)
 */
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useTransition } from 'react';

type Status = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'LEASED' | 'WITHDRAWN' | 'EXPIRED';

interface Props {
  listingId: string;
  status: Status;
  publicSlug: string | null;
}

export default function ListingRowActions({ listingId, status, publicSlug }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function callAction(
    action: 'publish' | 'withdraw' | 'lease' | 'relist',
    confirmMsg?: string,
  ) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const detail = j?.details?.fieldErrors
          ? Object.entries(j.details.fieldErrors)
              .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`)
              .join('; ')
          : null;
        throw new Error(j?.error ? `${j.error}${detail ? ` — ${detail}` : ''}` : `HTTP ${res.status}`);
      }
      // Refresh the server component
      startTransition(() => {
        router.refresh();
      });
    } catch (e: any) {
      setError(e.message ?? 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'DRAFT' && (
        <>
          <Link
            href={`/dashboard/listings/${listingId}/edit`}
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 transition-colors"
          >
            Edit
          </Link>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              callAction(
                'publish',
                'Publish this listing? Hunters will be able to find it on the marketplace.',
              )
            }
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
          >
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              callAction(
                'withdraw',
                'Discard this draft? The listing will be marked withdrawn and can no longer be edited.',
              )
            }
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-stone-400 border border-stone-800 transition-colors"
          >
            Discard
          </button>
        </>
      )}

      {status === 'PENDING_REVIEW' && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => callAction('withdraw', 'Withdraw this listing from review?')}
          className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-200 transition-colors"
        >
          {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
        </button>
      )}

      {status === 'PUBLISHED' && (
        <>
          {publicSlug && (
            <Link
              href={`/listings/${publicSlug}`}
              target="_blank"
              className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
            >
              View public ↗
            </Link>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              callAction(
                'lease',
                'Mark this listing as LEASED? It will disappear from the public marketplace.',
              )
            }
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-blue-50 transition-colors"
          >
            {busy === 'lease' ? 'Marking…' : 'Mark leased'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              callAction(
                'withdraw',
                'Withdraw this listing from the public marketplace? You can relist later.',
              )
            }
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-200 transition-colors"
          >
            {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
          </button>
        </>
      )}

      {status === 'LEASED' && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => callAction('relist', 'Relist this listing? It will reappear on the public marketplace.')}
          className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
        >
          {busy === 'relist' ? 'Relisting…' : 'Relist'}
        </button>
      )}

      {error && (
        <span className="basis-full text-sm text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
