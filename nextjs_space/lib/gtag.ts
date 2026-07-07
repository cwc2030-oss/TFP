// Google Analytics helper + server-side funnel logging
// GA fires via gtag in the browser; events are also logged to FunnelEvent table
// for the weekly email report.

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';

// Safely call gtag (no-ops if GA isn't loaded)
function gtag(...args: unknown[]) {
  if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
    (window as any).gtag(...args);
  }
}

// Generic event helper
export function trackEvent(eventName: string, params?: Record<string, string | number | boolean>) {
  gtag('event', eventName, params);
}

// Fire-and-forget server-side funnel log (never blocks UI)
function logFunnelEvent(event: string, address?: string, metadata?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    fetch('/api/funnel-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, address, metadata }),
    }).catch(() => {}); // swallow errors
  } catch {
    // ignore
  }
}

// --- Funnel Events ---

/** User enters an address on the homepage */
export function trackAddressSearch(address: string) {
  trackEvent('address_search', { search_term: address });
  logFunnelEvent('address_search', address);
}

/** User opens the Terrain Analyzer (intel page) */
export function trackTerrainAnalyzerOpened(address: string, lat: number, lng: number) {
  trackEvent('terrain_analyzer_opened', { address, lat, lng });
  logFunnelEvent('terrain_analyzer_opened', address, { lat, lng });
}

/** User views the pricing page */
export function trackPricingPageViewed() {
  trackEvent('pricing_page_viewed');
  logFunnelEvent('pricing_page_viewed');
}

/**
 * @deprecated checkout_initiated is now logged SERVER-SIDE in the Stripe
 * checkout-session-creation API routes (/api/stripe/checkout and
 * /api/parcels/purchase). Do NOT call this client-side — it would
 * double-count. Kept for GA event only (no FunnelEvent write).
 */
export function trackCheckoutInitiated(productType: string, address: string, price: number) {
  trackEvent('checkout_initiated', { product_type: productType, address, value: price, currency: 'USD' });
  // FunnelEvent is recorded server-side only — do not log here
}

/**
 * Fire the GA4 ecommerce `purchase` event with the REAL confirmed amount
 * read from the Stripe checkout session (never a hardcoded map — if the
 * price changes in Stripe, GA4 revenue follows automatically).
 *
 * Call this exactly once per completed Stripe session on the browser
 * success return. Callers MUST dedupe by transactionId (session id) so a
 * refresh / back-button can't double-count. This is INDEPENDENT of the
 * server-side `purchase_completed` funnel-table write in the Stripe
 * webhook — GA4 and the internal report are two separate ledgers.
 *
 * Payload: { transaction_id, value, currency:'USD', items:[{ item_id: tier }] }
 */
export function trackPurchase(params: {
  transactionId: string;
  value: number;
  currency?: string;
  tier: string;
}) {
  gtag('event', 'purchase', {
    transaction_id: params.transactionId,
    value: params.value,
    currency: params.currency || 'USD',
    items: [{ item_id: params.tier }],
  });
  // No FunnelEvent write — purchase_completed is recorded server-side in the webhook.
}

/**
 * Fire the GA4 `listing_created` event on a CONFIRMED successful publish.
 * The real publish happens server-side (/api/listings/[id]/publish); this
 * fires client-side on the success response back in the browser.
 *
 * NO PII — never pass address, owner name, or coordinates.
 * Payload: { acres, state, county, tier }  (tier = owner's account tier)
 */
export function trackListingCreated(params: {
  acres?: number | null;
  state?: string | null;
  county?: string | null;
  tier?: string | null;
}) {
  trackEvent('listing_created', {
    acres: typeof params.acres === 'number' ? Math.round(params.acres) : 0,
    state: params.state || '',
    county: params.county || '',
    tier: params.tier || 'free',
  });
}

/** Territory teaser rendered for a free user */
export function trackTerritoryTeaserShown(address: string, lat: number, lng: number) {
  trackEvent('territory_teaser_shown', { address, lat, lng });
  logFunnelEvent('territory_teaser_shown', address, { lat, lng });
}

/**
 * Territory teaser CTA clicked — uses sendBeacon / keepalive:true
 * so the event fires reliably before the redirect to checkout.
 */
export function trackTerritoryTeaserClicked(address: string, lat: number, lng: number) {
  trackEvent('territory_teaser_clicked', { address, lat, lng });
  // Use sendBeacon for reliability before redirect
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const payload = JSON.stringify({
      event: 'territory_teaser_clicked',
      address,
      metadata: { lat, lng },
    });
    navigator.sendBeacon('/api/funnel-event', new Blob([payload], { type: 'application/json' }));
  } else {
    // Fallback: keepalive fetch
    try {
      fetch('/api/funnel-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'territory_teaser_clicked', address, metadata: { lat, lng } }),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }
}
