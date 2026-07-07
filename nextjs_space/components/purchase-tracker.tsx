'use client';

import { useEffect } from 'react';
import { trackPurchase } from '@/lib/gtag';

/**
 * Fires the GA4 `purchase` event exactly once per completed Stripe checkout
 * session. Both Stripe success returns land on /intel:
 *   - subscription:   /intel?upgrade=success&session_id=cs_...
 *   - parcel unlock:  /intel?parcel_unlocked=true&lat=&lng=&session_id=cs_...
 *
 * The real confirmed amount is read server-side from Stripe via
 * /api/stripe/session-summary (never hardcoded). Dedupe is keyed to the
 * session id in localStorage so a refresh or back-button can't double-count.
 * Renders nothing.
 */
export default function PurchaseTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const isUpgrade = params.get('upgrade') === 'success';
    const isUnlock = params.get('parcel_unlocked') === 'true';

    if (!sessionId || (!isUpgrade && !isUnlock)) return;

    const dedupeKey = `ga_purchase_${sessionId}`;
    try {
      if (localStorage.getItem(dedupeKey)) return; // already counted
    } catch {
      // localStorage unavailable — continue without dedupe rather than skip
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/stripe/session-summary?session_id=${encodeURIComponent(sessionId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (!data?.paid || !data?.transactionId || !data?.value) return;

        trackPurchase({
          transactionId: data.transactionId,
          value: data.value,
          currency: data.currency || 'USD',
          tier: data.tier || 'unknown',
        });

        try {
          localStorage.setItem(dedupeKey, String(Date.now()));
        } catch {
          // ignore
        }
      } catch {
        // swallow — analytics must never break the page
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
