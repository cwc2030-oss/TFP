/**
 * Geocode an address to lat/lng using Mapbox Geocoding API.
 * Used to normalize address-based queries into lat/lng so the
 * Regrid parcel cache (keyed on lat/lng) can serve them.
 *
 * Projected volume: ~1,500–3,000/month (well within 100k/month free tier).
 */

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    console.warn('[GEOCODE] No Mapbox token, skipping address geocode');
    return null;
  }

  try {
    const encoded = encodeURIComponent(address);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&country=us&limit=1&types=address`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      console.warn('[GEOCODE] Mapbox returned', resp.status);
      return null;
    }

    const data = await resp.json();
    const feature = data.features?.[0];
    if (!feature?.center || feature.center.length < 2) {
      console.log('[GEOCODE] No result for:', address);
      return null;
    }

    // Mapbox returns [lng, lat]
    const [lng, lat] = feature.center;
    console.log(`[GEOCODE] "${address}" → ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    return { lat, lng };
  } catch (err) {
    console.warn('[GEOCODE] Error:', err);
    return null;
  }
}
