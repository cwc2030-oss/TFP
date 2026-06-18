'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  Loader2,
  Search,
  ArrowRight,
  Lock,
  CheckCircle2,
  Bell,
  Crosshair,
  TreePine,
  Mountain,
  Crown,
  Sparkles,
} from 'lucide-react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { trackAddressSearch, trackCheckoutInitiated } from '@/lib/gtag';

/* ─── lazy-load the 3-D map (SSR-unsafe) ────────────────────────── */
const Terrain3DView = dynamic(
  () => import('@/components/map/terrain-3d-view').then((m) => m.default),
  { ssr: false, loading: () => <MapSkeleton /> },
);

function MapSkeleton() {
  return (
    <div className="w-full aspect-[16/9] bg-stone-900 rounded-2xl flex items-center justify-center">
      <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
    </div>
  );
}

/* ─── stage type ─────────────────────────────────────────────── */
type Stage = 'search' | 'preview' | 'email' | 'offer';

interface ParcelInfo {
  address: string;
  county: string;
  state: string;
  acreage: number;
  lat: number;
  lng: number;
  bounds?: { lat: number; lng: number }[];
}

/* ─── inner component (uses searchParams) ───────────────────── */
function FlowScoreContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession() || {};

  /* Pre-fill from URL query params (entry via nav / CTA) */
  const urlLat = parseFloat(searchParams.get('lat') || '') || 0;
  const urlLng = parseFloat(searchParams.get('lng') || '') || 0;
  const urlAddress = searchParams.get('address') || '';

  const [stage, setStage] = useState<Stage>(urlLat && urlLng ? 'preview' : 'search');
  const [address, setAddress] = useState(urlAddress);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [parcel, setParcel] = useState<ParcelInfo | null>(null);
  const [parcelLoading, setParcelLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [alertCounty, setAlertCounty] = useState(true);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [leadId, setLeadId] = useState<string | null>(null);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [proCheckoutLoading, setProCheckoutLoading] = useState(false);

  /* Subscription tier — hide upsells from paying users */
  const subStatus = (session?.user as any)?.subscriptionStatus || 'free';
  const isPro = subStatus === 'pro';
  const isProMax = subStatus === 'promax';
  const isSubscribed = isPro || isProMax;

  /* ────────────── autocomplete ───────────────────────────────── */
  const fetchSuggestions = useCallback(async (input: string) => {
    if (input.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/places-autocomplete?input=${encodeURIComponent(input)}`,
      );
      const data = await res.json();
      if (data.predictions) {
        setSuggestions(data.predictions.slice(0, 5));
        setShowSuggestions(true);
      }
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchSuggestions(address), 300);
    return () => clearTimeout(t);
  }, [address, fetchSuggestions]);

  /* ────────────── select suggestion → parcel lookup ──────────── */
  const selectAddress = useCallback(
    async (addr: string, lat?: number, lng?: number) => {
      setAddress(addr);
      setShowSuggestions(false);
      setIsSearching(true);
      setSearchError('');
      trackAddressSearch(addr);

      let effectiveLat = lat || 0;
      let effectiveLng = lng || 0;

      if (!effectiveLat || !effectiveLng) {
        try {
          const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
          const geoRes = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
              addr,
            )}.json?access_token=${mapboxToken}&country=us&limit=1`,
          );
          const geoData = await geoRes.json();
          if (geoData.features?.[0]) {
            [effectiveLng, effectiveLat] = geoData.features[0].center;
          }
        } catch {
          /* fall through */
        }
      }

      if (!effectiveLat || !effectiveLng) {
        setSearchError('Could not locate that address. Try including city and state.');
        setIsSearching(false);
        return;
      }

      await loadParcel(addr, effectiveLat, effectiveLng);
      setIsSearching(false);
    },
    [],
  );

  /* ────────────── parcel lookup ────────────────────────────── */
  const loadParcel = useCallback(
    async (addr: string, lat: number, lng: number) => {
      setParcelLoading(true);
      try {
        const res = await fetch(`/api/parcels?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        const p = data.parcels?.[0];

        let countyName = '';
        let stateName = '';
        let acreage = 0;
        let bounds: { lat: number; lng: number }[] | undefined;

        if (p) {
          countyName = p.county
            ? p.county.charAt(0).toUpperCase() + p.county.slice(1).toLowerCase()
            : '';
          stateName = p.state || '';
          acreage = p.acreage || 0;

          // Extract bounds
          if (p.coordinates && Array.isArray(p.coordinates)) {
            try {
              let coords: number[][] = [];
              if (p.geometryType === 'MultiPolygon') {
                const mp = p.coordinates as number[][][][];
                mp.forEach((polygon: number[][][]) => {
                  if (polygon[0]) coords = coords.concat(polygon[0]);
                });
              } else {
                const ring = p.coordinates[0];
                if (Array.isArray(ring) && ring.length > 0) {
                  coords = ring.filter(
                    (coord: any) => Array.isArray(coord) && coord.length >= 2,
                  );
                }
              }
              if (coords.length > 0) {
                bounds = coords.map((c: any) => ({ lng: c[0], lat: c[1] }));
              }
            } catch {
              /* ignore */
            }
          }
        }

        let displayAddress = p?.siteAddress || addr;
        if (displayAddress.toLowerCase().includes('no situs')) {
          displayAddress = addr || 'Rural Property';
        }

        setParcel({
          address: displayAddress,
          county: countyName,
          state: stateName,
          acreage,
          lat: p?.lat || lat,
          lng: p?.lng || lng,
          bounds,
        });
        setStage('preview');
      } catch {
        setParcel({
          address: addr,
          county: '',
          state: '',
          acreage: 0,
          lat,
          lng,
        });
        setStage('preview');
      }
      setParcelLoading(false);
    },
    [],
  );

  /* If URL has lat/lng, load parcel on mount */
  useEffect(() => {
    if (urlLat && urlLng && !parcel) {
      loadParcel(urlAddress, urlLat, urlLng);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ────────────── email gate ─────────────────────────────────── */
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setEmailError('Please enter a valid email.');
      return;
    }
    setEmailSubmitting(true);
    setEmailError('');
    try {
      const res = await fetch('/api/flow-score/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          address: parcel?.address || address,
          lat: parcel?.lat,
          lng: parcel?.lng,
          county: parcel?.county || null,
          state: parcel?.state || null,
          teaserScore: null, // we don't have a score at this stage
          alertCounty,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailError(data.error || 'Something went wrong.');
        setEmailSubmitting(false);
        return;
      }
      setLeadId(data.leadId);
      setStage('offer');
    } catch {
      setEmailError('Network error — please try again.');
    }
    setEmailSubmitting(false);
  };

  /* ────────────── $19 parcel unlock checkout ─────────────────── */
  const handleCheckout = async () => {
    if (!session?.user) {
      const cb = `/flow-score?lat=${parcel?.lat}&lng=${parcel?.lng}&address=${encodeURIComponent(
        parcel?.address || '',
      )}`;
      router.push(`/login?callbackUrl=${encodeURIComponent(cb)}`);
      return;
    }

    trackCheckoutInitiated('parcel_unlock', parcel?.address || '', 19);
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/parcels/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: parcel?.lat,
          lng: parcel?.lng,
          address: parcel?.address,
          acreage: parcel?.acreage,
          leadId: leadId || undefined,
        }),
      });
      const data = await res.json();

      if (data.alreadyPurchased) {
        router.push(
          `/intel?lat=${parcel?.lat}&lng=${parcel?.lng}&address=${encodeURIComponent(
            parcel?.address || '',
          )}&acreage=${parcel?.acreage || 80}`,
        );
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutLoading(false);
      }
    } catch {
      setCheckoutLoading(false);
    }
  };

  /* ────────────── Pro ($99/yr) subscription checkout ─────────── */
  const handleProCheckout = async () => {
    if (!session?.user) {
      // Login redirect with autoUpgrade intent — resumes Pro checkout after sign-in
      const cb = `/flow-score?lat=${parcel?.lat}&lng=${parcel?.lng}&address=${encodeURIComponent(
        parcel?.address || '',
      )}&autoUpgrade=pro_annual`;
      router.push(`/login?callbackUrl=${encodeURIComponent(cb)}`);
      return;
    }

    trackCheckoutInitiated('pro', parcel?.address || '', 99);
    setProCheckoutLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'annual', tier: 'pro' }),
      });
      const data = await res.json();

      if (data.alreadySubscribed) {
        router.push(
          `/intel?lat=${parcel?.lat}&lng=${parcel?.lng}&address=${encodeURIComponent(
            parcel?.address || '',
          )}&acreage=${parcel?.acreage || 80}`,
        );
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        setProCheckoutLoading(false);
      }
    } catch {
      setProCheckoutLoading(false);
    }
  };

  /* ────────────── Auto-resume Pro checkout after login ───────── */
  useEffect(() => {
    if (!session?.user) return;
    const params = new URLSearchParams(window.location.search);
    const autoUp = params.get('autoUpgrade');
    if (autoUp === 'pro_annual') {
      // Clean the URL param, then fire checkout
      const url = new URL(window.location.href);
      url.searchParams.delete('autoUpgrade');
      window.history.replaceState({}, '', url.toString());
      handleProCheckout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user]);

  /* ────────────── form submit (search) ──────────────────────── */
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    selectAddress(address.trim());
  };

  /* ─── Render ─────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />

      <main className="pt-20 pb-16">
        {/* ═══ STAGE: SEARCH ══════════════════════════════════ */}
        {stage === 'search' && (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 text-emerald-400 text-sm font-medium mb-4">
                <Crosshair className="w-4 h-4" />
                Free Parcel Analysis
              </div>
              <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-4">
                How does your land score
                <br className="hidden sm:block" />
                <span className="text-emerald-400"> for whitetail?</span>
              </h1>
              <p className="text-stone-400 text-lg max-w-xl mx-auto">
                Enter any address or coordinates. We'll show you the terrain,
                identify the parcel, and tell you what the Terrain Brain sees.
              </p>
            </div>

            <form onSubmit={handleSearchSubmit} className="relative">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-500" />
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Enter an address, county, or coordinates…"
                  className="w-full pl-12 pr-4 py-4 rounded-xl bg-stone-800 border border-stone-700 text-stone-100 placeholder:text-stone-500 text-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-600 transition"
                  autoFocus
                />
              </div>

              {/* Autocomplete suggestions */}
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-20 w-full mt-1 bg-stone-800 border border-stone-700 rounded-xl overflow-hidden shadow-2xl">
                  {suggestions.map((s: any) => (
                    <li key={s.place_id}>
                      <button
                        type="button"
                        onClick={() => selectAddress(s.description, s.lat, s.lng)}
                        className="w-full text-left px-4 py-3 text-stone-200 hover:bg-stone-700/60 transition text-sm"
                      >
                        {s.description}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {searchError && (
                <p className="text-red-400 text-sm mt-2">{searchError}</p>
              )}

              <button
                type="submit"
                disabled={isSearching || !address.trim()}
                className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white px-8 py-3.5 rounded-xl font-medium transition-colors text-lg"
              >
                {isSearching || parcelLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    View in 3D <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            {/* Trust signals */}
            <div className="mt-12 grid grid-cols-3 gap-6 max-w-md mx-auto">
              {[
                { icon: TreePine, label: 'AI terrain analysis' },
                { icon: Mountain, label: '3D parcel preview' },
                { icon: Crosshair, label: 'Deer flow mapping' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="text-center">
                  <Icon className="w-6 h-6 text-emerald-500 mx-auto mb-1.5" />
                  <span className="text-stone-500 text-xs">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ STAGE: PREVIEW (3D parcel view + "Continue" CTA) ═══ */}
        {stage === 'preview' && parcel && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            {/* Parcel header */}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <button
                  onClick={() => {
                    setStage('search');
                    setParcel(null);
                  }}
                  className="text-stone-500 hover:text-stone-300 text-sm mb-1 inline-flex items-center gap-1"
                >
                  ← Search another address
                </button>
                <h2 className="text-white text-xl sm:text-2xl font-semibold">
                  {parcel.address}
                </h2>
                <p className="text-stone-400 text-sm mt-0.5">
                  {parcel.county ? `${parcel.county} County` : ''}
                  {parcel.county && parcel.state ? ', ' : ''}
                  {parcel.state}
                  {parcel.acreage > 0 && ` — ${Math.round(parcel.acreage)} acres`}
                </p>
              </div>
            </div>

            {/* 3D Map */}
            <div className="rounded-2xl overflow-hidden border border-stone-800 shadow-2xl mb-6">
              <div className="aspect-[16/9] relative">
                <Terrain3DView
                  isOpen={true}
                  onClose={() => setStage('search')}
                  parcelCenter={{ lat: parcel.lat, lng: parcel.lng }}
                  parcelBounds={parcel.bounds}
                  parcelAddress={parcel.address}
                  acreage={parcel.acreage}
                  previewMode={true}
                  onUnlockIntel={() => {
                    if (isSubscribed && parcel) {
                      router.push(`/intel?lat=${parcel.lat}&lng=${parcel.lng}&address=${encodeURIComponent(parcel.address || '')}&acreage=${parcel.acreage || 80}`);
                    } else {
                      setStage('email');
                    }
                  }}
                />
              </div>
            </div>

            {/* Teaser stats + email CTA */}
            <div className="rounded-2xl border border-amber-800/40 bg-gradient-to-br from-stone-900 via-amber-950/20 to-stone-900 p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row items-start gap-6">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-stone-100 mb-2">
                    Your parcel has been identified
                  </h3>
                  <p className="text-stone-400 text-sm leading-relaxed">
                    {isSubscribed
                      ? `Your Pro subscription includes full Terrain Brain analysis for this ${parcel.acreage > 0 ? `${Math.round(parcel.acreage)}-acre` : ''} parcel — open it now.`
                      : `The Terrain Brain can analyze this ${parcel.acreage > 0 ? `${Math.round(parcel.acreage)}-acre` : ''} parcel for deer movement corridors, funnel points, and optimal stand locations. Enter your email to continue.`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (isSubscribed && parcel) {
                      router.push(`/intel?lat=${parcel.lat}&lng=${parcel.lng}&address=${encodeURIComponent(parcel.address || '')}&acreage=${parcel.acreage || 80}`);
                    } else {
                      setStage('email');
                    }
                  }}
                  className="shrink-0 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  {isSubscribed ? 'Open Terrain Brain' : 'Continue'} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ STAGE: EMAIL GATE ═════════════════════════════════ */}
        {stage === 'email' && parcel && (
          <div className="max-w-lg mx-auto px-4 sm:px-6 pt-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-full bg-emerald-900/60 border border-emerald-700/50 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-7 h-7 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Almost there
              </h2>
              <p className="text-stone-400">
                Enter your email to see what the Terrain Brain can do with this parcel.
              </p>
            </div>

            <div className="rounded-xl border border-stone-700 bg-stone-800/60 p-1.5 mb-4">
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-stone-300 text-sm truncate">
                  {parcel.address}
                </span>
                {parcel.acreage > 0 && (
                  <span className="text-stone-500 text-xs ml-auto shrink-0">
                    {Math.round(parcel.acreage)} ac
                  </span>
                )}
              </div>
            </div>

            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full px-4 py-3.5 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-600 transition"
                autoFocus
              />

              {/* County alert opt-in */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={alertCounty}
                  onChange={(e) => setAlertCounty(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-stone-600 bg-stone-800 text-emerald-500 focus:ring-emerald-500/40"
                />
                <span className="text-stone-400 text-sm leading-snug group-hover:text-stone-300 transition">
                  <Bell className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
                  Notify me about new hunt leases in{' '}
                  <strong className="text-stone-300">
                    {parcel.county ? `${parcel.county} County` : 'my area'}
                  </strong>
                </span>
              </label>

              {emailError && (
                <p className="text-red-400 text-sm">{emailError}</p>
              )}

              <button
                type="submit"
                disabled={emailSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white px-6 py-3.5 rounded-lg font-medium transition-colors"
              >
                {emailSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>Continue</>  
                )}
              </button>
            </form>

            <p className="text-stone-600 text-xs text-center mt-4">
              We'll never spam you. Unsubscribe anytime.
            </p>
          </div>
        )}

        {/* ═══ STAGE: OFFER ($19 CTA) ═══════════════════════════ */}
        {stage === 'offer' && parcel && (
          <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8">
            {/* Success check */}
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-full bg-emerald-900/60 border border-emerald-700/50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">You're in</h2>
              <p className="text-stone-400 text-sm">
                {email} — you'll hear from us when new leases drop{' '}
                {parcel.county ? `in ${parcel.county} County` : 'near you'}.
              </p>
            </div>

            {/* Parcel recap */}
            <div className="rounded-xl border border-stone-700 bg-stone-800/40 p-5 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-stone-100 font-semibold">{parcel.address}</h3>
                  <p className="text-stone-500 text-sm">
                    {parcel.county ? `${parcel.county} County` : ''}
                    {parcel.county && parcel.state ? ', ' : ''}
                    {parcel.state}
                    {parcel.acreage > 0 && ` — ${Math.round(parcel.acreage)} ac`}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-amber-900/40 border border-amber-700/40 flex items-center justify-center">
                  <Crosshair className="w-5 h-5 text-amber-400" />
                </div>
              </div>
            </div>

            {/* ═══ TWO-OPTION UNLOCK CARD ═══ */}
            <div className="space-y-4 mb-6">

              {/* ── PRO OPTION — best value, highlighted ── */}
              <div className="relative rounded-2xl border-2 border-amber-500/70 bg-gradient-to-br from-stone-900 via-amber-950/20 to-stone-900 p-6 sm:p-8">
                {/* Best-value ribbon */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-amber-500 text-stone-950 text-xs font-bold px-4 py-1 rounded-full shadow-lg">
                  <Sparkles className="w-3.5 h-3.5" />
                  Where most hunters land
                </div>

                <div className="flex items-start gap-4 mb-5 mt-2">
                  <div className="w-12 h-12 rounded-xl bg-amber-900/60 border border-amber-600/50 flex items-center justify-center shrink-0">
                    <Crown className="w-6 h-6 text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xl font-bold text-white">Pro</h3>
                    <p className="text-stone-400 text-sm mt-0.5">
                      Every parcel, Territory Mode, unlimited reports.
                    </p>
                  </div>
                  <div className="ml-auto text-right shrink-0">
                    <span className="text-3xl font-bold text-amber-400">$99</span>
                    <span className="block text-stone-500 text-xs">/year</span>
                  </div>
                </div>

                <ul className="space-y-2 mb-6 text-sm">
                  {[
                    'Every parcel unlocked — analyze any property',
                    'Territory Mode — deer flow across property lines',
                    'Up to 25 parcels per territory',
                    'Unlimited downloadable hunt reports (PDF)',
                    'AI-analyzed corridors, funnels & stand sites',
                    'Interactive satellite map with all layers',
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2.5 text-stone-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={handleProCheckout}
                  disabled={proCheckoutLoading || checkoutLoading}
                  className="w-full inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-stone-700 text-stone-950 px-8 py-4 rounded-xl font-bold text-lg transition-colors"
                >
                  {proCheckoutLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Go Pro — $99/yr
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>

              {/* ── $19 PARCEL UNLOCK OPTION (hidden for Pro / ProMax) ── */}
              {!isSubscribed && <div className="rounded-2xl border border-stone-700 bg-stone-800/40 p-5 sm:p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-stone-700/60 border border-stone-600/50 flex items-center justify-center shrink-0">
                    <Mountain className="w-5 h-5 text-stone-400" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-stone-200">This Parcel Only</h3>
                    <p className="text-stone-500 text-xs">
                      One-time purchase — this parcel, forever.
                    </p>
                  </div>
                  <div className="ml-auto text-right shrink-0">
                    <span className="text-2xl font-bold text-stone-300">$19</span>
                    <span className="block text-stone-500 text-xs">one-time</span>
                  </div>
                </div>

                <ul className="space-y-1.5 mb-5 text-sm">
                  {[
                    'AI-analyzed corridors & stand sites',
                    'Interactive map with all layers',
                    'Downloadable hunt report (PDF)',
                    'Never expires — access anytime',
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-stone-400">
                      <CheckCircle2 className="w-3.5 h-3.5 text-stone-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={handleCheckout}
                  disabled={checkoutLoading || proCheckoutLoading}
                  className="w-full inline-flex items-center justify-center gap-2 border-2 border-emerald-600 bg-transparent hover:bg-emerald-900/30 disabled:border-stone-700 disabled:text-stone-600 text-emerald-400 px-6 py-3 rounded-xl font-semibold text-sm transition-colors"
                >
                  {checkoutLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      Unlock This Parcel — $19
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>}

              <p className="text-stone-600 text-xs text-center">
                Secure checkout via Stripe. No card data touches our servers.
              </p>
            </div>

            {/* Browse leases CTA */}
            <div className="text-center">
              <p className="text-stone-500 text-sm mb-2">Looking to lease, not buy intel?</p>
              <Link
                href="/find-a-lease"
                className="text-emerald-400 hover:text-emerald-300 text-sm font-medium underline-offset-4 hover:underline transition"
              >
                Browse terrain-certified hunt leases →
              </Link>
            </div>
          </div>
        )}
      </main>

      {stage === 'search' && <Footer />}
    </div>
  );
}

export default function FlowScorePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-950 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
        </div>
      }
    >
      <FlowScoreContent />
    </Suspense>
  );
}
