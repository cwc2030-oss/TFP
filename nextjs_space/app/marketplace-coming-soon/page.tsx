/**
 * /marketplace-coming-soon — the launch wall.
 *
 * Where the gated public marketplace surfaces (/find-a-lease, public listing
 * detail, /brokers) send visitors while TFP_MARKETPLACE_OPEN is not "true".
 * Captures early-access interest on both sides (hunter + landowner) via
 * /api/waitlist.
 *
 * Once the marketplace opens, this page forwards to the live browse page so
 * the URL never dead-ends post-launch.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { Target, MapPin, Route } from 'lucide-react';
import { isMarketplaceOpen } from '@/lib/marketplace-gate';
import EarlyAccess from './_form/early-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The Marketplace for Data-Backed Hunt Leases | Terra Firma Partners',
  description:
    'Certified hunt leases are coming. Every listing carries a Flow Score — a terrain-verified deer-movement grade. Get early access as a hunter or a landowner.',
};

const FEATURES = [
  {
    icon: Target,
    title: 'Flow Score on Every Listing',
    blurb: 'Terrain-verified deer movement data, not just a pretty photo.',
  },
  {
    icon: MapPin,
    title: 'Verified Boundaries',
    blurb: "Parcel-level accuracy so you know exactly what you're leasing.",
  },
  {
    icon: Route,
    title: 'Habitat Intel',
    blurb: 'Bedding areas, funnels, and travel corridors mapped for each property.',
  },
];

export default function MarketplaceComingSoonPage() {
  // Post-launch: forward this URL to the live browse page instead of a wall.
  if (isMarketplaceOpen()) {
    redirect('/find-a-lease');
  }

  return (
    <div className="min-h-screen bg-white text-stone-900">
      <Navbar />
      <main className="pt-24 pb-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium px-4 py-1.5 border border-emerald-100">
            <Target className="w-4 h-4" /> Coming Soon
          </span>

          <h1 className="mt-6 text-4xl sm:text-5xl font-bold tracking-tight text-stone-900">
            The Marketplace for{' '}
            <span className="text-emerald-700">Data-Backed</span> Hunt Leases
          </h1>

          <p className="mt-5 text-lg text-stone-600 max-w-2xl mx-auto leading-relaxed">
            Every listing comes with a <span className="font-semibold text-stone-900">Flow Score</span> —
            our proprietary deer-movement rating powered by terrain intelligence. No more
            guessing. Know exactly what you&apos;re leasing before you sign.
          </p>

          {/* Feature trio */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-5 text-left">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-xl border border-stone-200 bg-white p-6"
                >
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-emerald-50 text-emerald-700 mb-4">
                    <Icon className="w-5 h-5" />
                  </span>
                  <h2 className="font-semibold text-stone-900">{f.title}</h2>
                  <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">{f.blurb}</p>
                </div>
              );
            })}
          </div>

          {/* Early access capture */}
          <div className="mt-14 max-w-xl mx-auto rounded-2xl border border-stone-200 bg-stone-50 p-6 sm:p-8">
            <Suspense fallback={<div className="h-40" />}>
              <EarlyAccess />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
