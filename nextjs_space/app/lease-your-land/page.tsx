/**
 * /lease-your-land — paid-traffic landing page for landowners.
 *
 * Server-rendered. Hero IS the form (waitlist capture). Below-fold:
 * how-it-works → why-list → FAQ. Mobile-first.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { CheckCircle, FileText, Send, Inbox, Award, Shield, Users } from 'lucide-react';
import WaitlistForm from './_form/waitlist-form';

export const metadata: Metadata = {
  title: 'List Your Land for the 2026 Season | Terra Firma',
  description:
    'Certified hunt-lease listings, powered by Terra Firma terrain intelligence. Free landowner sign-up for the fall 2026 launch.',
};

export default function LeaseYourLandPage() {
  return (
    <div>
      <Navbar />

      {/* Hero — form lives here for paid-traffic conversion */}
      <section className="relative pt-24 pb-16 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-stone-800 via-emerald-900 to-stone-900">
          <div className="absolute inset-0 opacity-10 bg-[url('/tfp-social.gif')] bg-center bg-no-repeat bg-contain" />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
              List your land for
              <span className="block text-emerald-400 mt-2">the 2026 season</span>
            </h1>
            <p className="text-lg md:text-xl text-stone-200 mt-6 max-w-2xl mx-auto leading-relaxed">
              Certified hunt-lease listings, powered by Terra Firma terrain
              intelligence. Coming in time for fall 2026.
            </p>
          </div>

          {/* The hero IS the form */}
          <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
            <Suspense fallback={<FormFallback />}>
              <WaitlistForm />
            </Suspense>
            <p className="mt-4 text-center text-xs text-stone-500">
              Free listing during the 2026 launch period. No card required.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-stone-50 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-3">How it works</h2>
          <p className="text-stone-600 text-center mb-12 max-w-2xl mx-auto">
            Three steps from sign-up to your first inquiry from a certified hunter.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            <Step
              n={1}
              icon={<FileText className="w-6 h-6" />}
              title="Run a Hunt Report"
              body="Drop a pin on your property. Terra Firma generates a terrain-certified analysis — ridges, funnels, bedding, and an A–F huntability grade."
            />
            <Step
              n={2}
              icon={<Send className="w-6 h-6" />}
              title="Publish your listing"
              body="Set price, season, lease type, and photos. The huntability snapshot is attached automatically. Your address never appears — hunters see county-level only."
            />
            <Step
              n={3}
              icon={<Inbox className="w-6 h-6" />}
              title="Get inquiries"
              body="Hunters who match your county, season, and budget message you through Terra Firma. You stay in control of who tours the property."
            />
          </div>
        </div>
      </section>

      {/* Why list with us */}
      <section className="bg-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-12">
            Why list with Terra Firma
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Why
              icon={<Award className="w-6 h-6 text-emerald-700" />}
              title="Terrain-certified"
              body="Every listing carries a third-party terrain analysis. Hunters know what they're paying for before they ever step on the property."
            />
            <Why
              icon={<Shield className="w-6 h-6 text-emerald-700" />}
              title="A+ huntability scoring"
              body="The same Terrain Brain that powers our $19 hunt reports grades your land from A to F. A-grade ground gets surfaced first."
            />
            <Why
              icon={<Users className="w-6 h-6 text-emerald-700" />}
              title="Pre-qualified hunters"
              body="We match by county, season, and budget. You don't get tire-kickers — you get hunters who've told us they're ready to lease your kind of land."
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
              q="Does it cost anything to list?"
              a="No. Listing is free for the 2026 launch period. We may add a paid premium tier later, but everyone who joins before launch keeps free listings."
            />
            <Faq
              q="When do listings actually go live?"
              a="In time for fall 2026. We're shipping the marketplace in stages. The waitlist locks in your spot to publish the day it opens."
            />
            <Faq
              q="Will my address be public?"
              a="Never. Hunters see your county and a terrain summary — no street address, no exact coordinates, no parcel ID. You decide who gets the precise location."
            />
            <Faq
              q="Who actually sees my listing?"
              a="Verified hunters who match your county, season window, and budget. You can additionally restrict to in-state hunters, group size limits, etc."
            />
            <Faq
              q="Can I withdraw a listing?"
              a="Yes — any time, no penalty. One click takes it offline."
            />
          </div>
          <div className="mt-12 text-center">
            <Link
              href="#hero"
              className="inline-flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <CheckCircle className="w-5 h-5" />
              Ready to join? Scroll back up.
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
