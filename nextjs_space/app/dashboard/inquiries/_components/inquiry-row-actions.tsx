/**
 * Owner-side action buttons for an Inquiry row.
 *
 *  - NEW    → "Mark Replied" + "Close"
 *  - REPLIED → "Close"
 *  - CLOSED  → (none, just status badge)
 *
 * Posts to /api/dashboard/inquiries/[id]/status with { status }. Refreshes
 * the page on success.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  inquiryId: string;
  status: 'NEW' | 'REPLIED' | 'CLOSED';
}

export default function InquiryRowActions({ inquiryId, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'REPLIED' | 'CLOSED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: 'REPLIED' | 'CLOSED') {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/inquiries/${inquiryId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        let msg = 'Failed to update status';
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          /* ignore */
        }
        setError(msg);
        setBusy(null);
        return;
      }
      router.refresh();
    } catch {
      setError('Network error');
    }
    setBusy(null);
  }

  if (status === 'CLOSED') {
    return <span className="text-stone-600 text-xs">No actions</span>;
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-2 justify-end">
      {status === 'NEW' && (
        <button
          type="button"
          onClick={() => setStatus('REPLIED')}
          disabled={busy != null}
          className="text-xs font-medium px-3 py-1.5 rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-50"
        >
          {busy === 'REPLIED' ? 'Saving\u2026' : 'Mark Replied'}
        </button>
      )}
      <button
        type="button"
        onClick={() => setStatus('CLOSED')}
        disabled={busy != null}
        className="text-xs font-medium px-3 py-1.5 rounded border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-50"
      >
        {busy === 'CLOSED' ? 'Saving\u2026' : 'Close'}
      </button>
      {error && (
        <span className="text-red-300 text-xs ml-1" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
