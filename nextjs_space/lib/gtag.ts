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
 * @deprecated purchase_completed is now logged SERVER-SIDE in the Stripe
 * webhook (/api/stripe-webhook) when payment is confirmed. Do NOT call
 * this client-side — it would double-count. Kept for GA event only
 * (no FunnelEvent write).
 */
export function trackPurchaseCompleted(orderId: string, productType: string, address: string) {
  trackEvent('purchase', { transaction_id: orderId, product_type: productType, address });
  // FunnelEvent is recorded server-side only — do not log here
}
