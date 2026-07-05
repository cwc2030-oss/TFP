/**
 * /deer-flow — public "flow-by-area" view.
 *
 * Ranks counties by an aggregated Deer Flow Index (rolled up from per-parcel
 * Terrain Brain analysis). Each county offers a free flow-alert email capture,
 * converting Facebook traffic into an owned list before the marketplace opens.
 *
 * OPSEC: county is the finest geographic grain shown. No lat/lng/parcel data.
 */
import type { Metadata } from 'next';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { prisma } from '@/lib/db';
import { Activity, MapPin, Bell } from 'lucide-react';
import { LAUNCH_STATES } from '@/lib/county-flow';
import FlowByArea, { type CountyRow } from './_view/flow-by-area';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Deer Flow by County | Terra Firma Partners',
  description:
    'See which counties rate highest for deer movement. County-level Deer Flow grades derived from Terra Firma terrain intelligence — and get free alerts when a high-flow parcel lists for lease.',
};

async function getData(): Promise<{ counties: CountyRow[]; states: string[] }> {
  try {
    const rows = await prisma.countyFlowRating.findMany({
      // Public view is scoped to launch states only. A stray analyzed parcel
      // in a non-launch state (e.g. a single WY county) never leaks here.
      where: { state: { in: [...LAUNCH_STATES] } },
      orderBy: [{ adjustedFlowIndex: 'desc' }, { parcelCount: 'desc' }],
      take: 300,
      select: {
        state: true,
        county: true,
        parcelCount: true,
        avgFlowIndex: true,
        adjustedFlowIndex: true,
        limitedData: true,
        grade: true,
        avgFunnelCount: true,
        avgBedAcres: true,
        avgTopStand: true,
        highFlowCount: true,
      },
    });
    // Always expose all launch states in the filter, in launch order — even
    // ones with zero rated counties yet (Iowa), so a launch state is never
    // silently missing. The view renders a "coming soon" state for empties.
    return { counties: rows, states: [...LAUNCH_STATES] };
  } catch (e) {
    console.error('[deer-flow] getData error:', e);
    return { counties: [], states: [...LAUNCH_STATES] };
  }
}

export default async function DeerFlowPage() {
  const { counties, states } = await getData();
  const totalParcels = counties.reduce((s, c) => s + c.parcelCount, 0);

  return (
    <div className="bg-stone-50 min-h-screen">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-24 pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-stone-900 via-emerald-950 to-stone-900">
          <div className="absolute inset-0 opacity-10 bg-[url('/tfp-social.gif')] bg-center bg-no-repeat bg-contain" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-4 py-1.5 text-emerald-300 text-sm font-semibold mb-5">
            <Activity className="w-4 h-4" />
            Deer Flow · by county
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
            Where the deer <span className="text-emerald-400">actually move</span>
          </h1>
          <p className="text-lg md:text-xl text-stone-200 mt-6 max-w-2xl mx-auto leading-relaxed">
            We rated every county we&apos;ve analyzed on a single Deer Flow Index — blending
            terrain quality, travel corridors, funnels, and intercept zones from Terrain Brain.
            Find the hottest ground, then get a free alert the moment a high-flow parcel lists.
          </p>
          {totalParcels > 0 && (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-stone-300 text-sm">
              <span className="inline-flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                {counties.length} counties rated
              </span>
              <span className="inline-flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                {totalParcels.toLocaleString()} parcels analyzed
              </span>
              <span className="inline-flex items-center gap-2">
                <Bell className="w-4 h-4 text-emerald-400" />
                Free county alerts
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Body */}
      {counties.length === 0 ? (
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="bg-white rounded-2xl shadow-lg p-8 -mt-12 relative z-10">
            <h2 className="text-2xl font-bold text-stone-900 mb-2">Ratings coming online</h2>
            <p className="text-stone-600">
              County Deer Flow ratings are being computed. Check back shortly.
            </p>
          </div>
        </div>
      ) : (
        <FlowByArea counties={counties} states={states} />
      )}

      {/* Method note */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="bg-white rounded-2xl border border-stone-200 p-6">
          <h3 className="text-lg font-bold text-stone-900 mb-2">How the Deer Flow Index works</h3>
          <p className="text-stone-600 text-sm leading-relaxed">
            Each analyzed parcel earns a 0–100 Deer Flow Index — 50% terrain/huntability score,
            20% travel-corridor density, 20% funnel density, and 10% intercept-zone density. We roll
            those parcels up to a county tier on our Green / Blue / Black scale — Elite and Premium counties
            earn the black-diamond mark, while the 0–100 index stays visible on every card. To keep the leaderboard honest, counties
            with only a handful of analyzed parcels are pulled toward the statewide average and
            flagged <span className="font-semibold text-stone-700">Limited data</span> — so a county
            can&apos;t top the board on the strength of a single parcel. The more ground we&apos;ve
            actually run through Terrain Brain in a county, the more its own score stands on its own.
            County is the finest location we ever publish — exact parcels stay private.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
