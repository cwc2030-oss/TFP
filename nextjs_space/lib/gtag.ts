// Google Analytics helper — fires custom events via gtag
// Measurement ID is loaded in layout.tsx; this just provides typed helpers

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

// ─── Funnel Events ──────────────────────────────────────────

/** User enters an address on the homepage */
export function trackAddressSearch(address: string) {
  trackEvent('address_search', {
    search_term: address,
  });
}

/** User opens the Terrain Analyzer (intel page) */
export function trackTerrainAnalyzerOpened(address: string, lat: number, lng: number) {
  trackEvent('terrain_analyzer_opened', {
    address,
    lat,
    lng,
  });
}

/** User views the pricing page */
export function trackPricingPageViewed() {
  trackEvent('pricing_page_viewed');
}

/** User initiates checkout (clicks "Get Report" on map page) */
export function trackCheckoutInitiated(productType: string, address: string, price: number) {
  trackEvent('checkout_initiated', {
    product_type: productType,
    address,
    value: price,
    currency: 'USD',
  });
}

/** User completes a purchase (reaches success page) */
export function trackPurchaseCompleted(orderId: string, productType: string, address: string) {
  trackEvent('purchase', {
    transaction_id: orderId,
    product_type: productType,
    address,
  });
}
