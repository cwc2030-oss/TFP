/**
 * /find-a-lease — paid-traffic landing page for hunters.
 *
 * Server-rendered. Hero IS the form. Below: 'what certified means' →
 * how-it-works → FAQ. Mobile-first.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { CheckCircle, Bookmark, Bell, MessageSquare, Award, Brain, Mountain } from 'lucide-react';
import SearchForm from './_form/search-form';

export const metadata: Metadata = {
  title: 'Find a Hunt Lease for Fall 2026 | Terra Firma',
  description:
    'Certified hunt leases. Save your search and get pre-launch early access to new properties — 30 days before public listings open.',
};

export default function FindALeasePage() {
  return (
    <div>
      <Navbar />

      <section className="relative pt-24 pb-16 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-stone-800 via-emerald-900 to-stone-900">
          <div className="absolute inset-0 opacity-10 bg-[url('/tfp-social.gif')] bg-center bg-no-repeat bg-contain" />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
              Certified hunt leases.
              <span className="block text-emerald-400 mt-2">Coming for fall 2026.</span>
            </h1>
            <p className="text-lg md:text-xl text-stone-200 mt-6 max-w-2xl mx-auto leading-relaxed">
              Save your search. Pre-launch members get 30-day early access
              before public listings open.
            </p>
          </div>

          <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
            <Suspense fallback={<FormFallback />}>
              <SearchForm />
            </Suspense>
            <p className="mt-4 text-center text-xs text-stone-500">
              No charge to browse. We email you when matching parcels list.
            </p>
          </div>
        </div>
      </section>

      {/* What 'certified' means */}
      <section className="bg-stone-50 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-3">
            What &lsquo;certified&rsquo; means
          </h2>
          <p className="text-stone-600 text-center mb-12 max-w-2xl mx-auto">
            Every Terra Firma listing is backed by a third-party terrain
            analysis — the same one our $19 hunt-report customers buy.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            <Why
              icon={<Brain className="w-6 h-6 text-emerald-700" />}
              title="The Terrain Brain"
              body="Reads ridgelines, draws, saddles, and bedding pockets. Every parcel gets a deer-flow vector — not just a satellite snapshot."
            />
            <Why
              icon={<Award className="w-6 h-6 text-emerald-700" />}
              title="A–F huntability grade"
              body="Composite score for habitat density, pinch-point structure, neighboring pressure, and water access. A means top-tier; F means skip it."
            />
            <Why
              icon={<Mountain className="w-6 h-6 text-emerald-700" />}
              title="Real terrain data"
              body="Sourced from USGS LiDAR. The certification you see on the listing is the same engine our paid users trust to plan their hunts."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-12">How it works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Step
              n={1}
              icon={<Bookmark className="w-6 h-6" />}
              title="Save your search"
              body="Pick states, season, budget, and group size. Save once — we'll watch every new listing for you."
            />
            <Step
              n={2}
              icon={<Bell className="w-6 h-6" />}
              title="Get notified"
              body="Email the moment a parcel goes live that matches your criteria. Pre-launch members get 30-day early access before public listings open."
            />
            <Step
              n={3}
              icon={<MessageSquare className="w-6 h-6" />}
              title="Inquire directly"
              body="Message the landowner from the listing page. No middlemen, no listing agents — just the terrain data and the contact."
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-stone-50 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-10">
            Frequently asked
          </h2>
          <div className="space-y-6">
            <Faq
              q="Does it cost anything to browse?"
              a="Browsing is free. The lease itself is paid directly to the landowner — we don't charge a marketplace fee at launch."
            />
            <Faq
              q="When do listings actually open?"
              a="In time for fall 2026. Pre-launch waitlist members get a 30-day head-start before public listings open."
            />
            <Faq
              q="How are properties verified?"
              a="Every listing carries a Terra Firma terrain analysis with an A–F huntability grade. We run that engine — the landowner can't fake it."
            />
            <Faq
              q="Can I message the landowner directly?"
              a="Yes. Once you find a parcel you like, you contact the landowner through the listing page — no agents, no middlemen."
            />
            <Faq
              q="Do I need a Terra Firma subscription?"
              a="Not to find a lease. A free account is all you need to message landowners. Subscribers get advanced filters and saved-search history."
            />
          </div>
          <div className="mt-12 text-center">
            <Link
              href="#hero"
              className="inline-flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <CheckCircle className="w-5 h-5" />
              Ready to save your search? Scroll back up.
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function FormFallback() {
  return <div className="h-72 animate-pulse bg-stone-100 rounded-xl" />;
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
          {icon}
        </div>
        <span className="text-sm font-semibold uppercase tracking-wider text-emerald-700">
          Step {n}
        </span>
      </div>
      <h3 className="text-xl font-bold text-stone-900 mb-2">{title}</h3>
      <p className="text-stone-600 leading-relaxed">{body}</p>
    </div>
  );
}

function Why({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-50 rounded-full mb-4">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-stone-900 mb-2">{title}</h3>
      <p className="text-stone-600 leading-relaxed">{body}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="bg-white rounded-lg border border-stone-200 p-5 group">
      <summary className="font-semibold text-stone-900 cursor-pointer list-none flex items-center justify-between">
        <span>{q}</span>
        <span className="text-emerald-700 text-xl group-open:rotate-45 transition-transform">+</span>
      </summary>
      <p className="mt-3 text-stone-600 leading-relaxed">{a}</p>
    </details>
  );
}
