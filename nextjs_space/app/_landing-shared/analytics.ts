/**
 * Lightweight client-side analytics for the waitlist landing pages.
 * Wraps gtag without depending on /lib/gtag, since /lib/gtag also
 * fires the FunnelEvent server log which is owned-account only.
 */

function gtag(...args: unknown[]) {
  if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
    (window as any).gtag(...args);
  }
}

export function fireWaitlistJoin(params: {
  side: 'LANDOWNER' | 'HUNTER';
  source: string;
  state?: string;
}) {
  // GA4 conversion event. Custom dims are flat keys.
  gtag('event', 'waitlist_join', {
    side: params.side,
    source: params.source,
    state: params.state ?? '',
  });
}
