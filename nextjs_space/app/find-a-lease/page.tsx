/**
 * /find-a-lease — public browse page for PUBLISHED hunt leases.
 *
 * Server component that fetches listings via the /api/listings/browse
 * endpoint with OPSEC-safe field selection + stripForPublic.
 * Filters drive URL search params.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import BrowseContent from './_browse/browse-content';

export const metadata: Metadata = {
  title: 'Find a Hunt Lease | Terra Firma Partners',
  description:
    'Browse certified hunt leases. Filter by state, county, acreage, and price. Every property is terrain-graded by Terra Firma Partners.',
};

export default function FindALeasePage() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <Navbar />
      <main className="pt-24 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-white">
              Find a Hunt Lease
            </h1>
            <p className="mt-3 text-stone-400 text-lg max-w-xl mx-auto">
              Browse terrain-certified properties. Every listing is anchored to a
              Terra Firma hunt report.
            </p>
          </div>
          <Suspense fallback={<LoadingSkeleton />}>
            <BrowseContent />
          </Suspense>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-14 rounded-xl bg-stone-900/60 animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-xl bg-stone-900/60 animate-pulse">
            <div className="aspect-[4/3] bg-stone-800/50 rounded-t-xl" />
            <div className="p-4 space-y-3">
              <div className="h-5 bg-stone-800/50 rounded w-3/4" />
              <div className="h-4 bg-stone-800/50 rounded w-1/2" />
              <div className="h-4 bg-stone-800/50 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
