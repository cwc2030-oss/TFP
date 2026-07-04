import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { MapPin, FileText, Clock, Users, CheckCircle, Phone, ArrowRight } from 'lucide-react';
import { isMarketplaceOpen } from '@/lib/marketplace-gate';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'For Land Brokers | Terra Firma Partners™',
  description: 'Professional land analysis reports for rural real estate agents. Help out-of-state buyers understand Missouri land with verified data on boundaries, flood zones, CWD status, and more.',
  keywords: 'land broker tools, rural real estate, Missouri land listings, land analysis for realtors, property due diligence',
};

export default function BrokersPage() {
  if (!isMarketplaceOpen()) {
    redirect('/');
  }
  const benefits = [
    {
      icon: Users,
      title: 'Educate Out-of-State Buyers',
      description: 'Your buyers from Kansas City, St. Louis, or out of state don\'t know local soil types, CWD zones, or flood risks. We translate the data they need to make confident decisions.'
    },
    {
      icon: Clock,
      title: 'Close Deals Faster',
      description: 'Answer due diligence questions before they\'re asked. No more back-and-forth emails about acreage verification, zoning, or road access.'
    },
    {
      icon: FileText,
      title: 'Professional Listing Packages',
      description: 'Attach a branded land analysis to every listing. Stand out from agents who just post photos and acreage.'
    },
    {
      icon: MapPin,
      title: 'Deal-Killer Detection',
      description: 'Flood zones, landlocked parcels, CWD management areas—know the issues upfront so there are no surprises at closing.'
    }
  ];

  const reportIncludes = [
    'Verified acreage & legal boundaries',
    'FEMA flood zone mapping',
    'CWD status & hunting regulations',
    'Soil types & buildability assessment',
    'Road frontage & access verification',
    'School district information',
    'Nearby city distances',
    'County contact information'
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-green-900 via-green-800 to-stone-900 text-white">
        <div className="absolute inset-0 bg-[url('/og-image.png')] bg-cover bg-center opacity-10" />
        <div className="relative max-w-6xl mx-auto px-4 py-20 md:py-28">
          <div className="max-w-3xl">
            <p className="text-green-300 font-medium mb-4 tracking-wide uppercase text-sm">
              For Rural Land Brokers & Agents
            </p>
            <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
              Your Listings Deserve More Than Just Photos and Acreage
            </h1>
            <p className="text-xl text-stone-200 mb-8 leading-relaxed">
              Professional land analysis reports that help your buyers understand what they're really getting—and help you close deals faster.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-stone-900 font-semibold px-8 py-4 rounded-lg transition-colors text-lg"
              >
                See Plans &amp; Pricing
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="/map"
                className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold px-8 py-4 rounded-lg transition-colors text-lg border border-white/20"
              >
                Explore the Map
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Statement */}
      <section className="py-16 bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-stone-800 mb-6">
            The Challenge with Out-of-State Buyers
          </h2>
          <p className="text-lg text-stone-600 leading-relaxed">
            You know this land like the back of your hand. But your buyer from Chicago or Denver? 
            They don't know a CWD zone from a flood plain. They've got questions—lots of them—and 
            every unanswered question is another day your listing sits. <strong>Terra Firma reports 
            give your buyers the confidence to move forward.</strong>
          </p>
        </div>
      </section>

      {/* Benefits Grid */}
      <section className="py-20 bg-stone-50">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-stone-800 mb-4 text-center">
            Why Brokers Use Terra Firma
          </h2>
          <p className="text-stone-600 text-center mb-12 max-w-2xl mx-auto">
            We handle the data. You handle the relationship.
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            {benefits.map((benefit, index) => (
              <div key={index} className="bg-white p-8 rounded-xl shadow-sm border border-stone-200 hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <benefit.icon className="w-6 h-6 text-green-700" />
                </div>
                <h3 className="text-xl font-semibold text-stone-800 mb-3">{benefit.title}</h3>
                <p className="text-stone-600 leading-relaxed">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's Included */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-stone-800 mb-6">
                Every Report Includes
              </h2>
              <p className="text-stone-600 mb-8">
                Nine pages of verified data your buyers need to make an informed decision. 
                No fluff—just the facts that matter for rural Missouri land.
              </p>
              <ul className="space-y-3">
                {reportIncludes.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <span className="text-stone-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-stone-100 rounded-xl p-8">
              <div className="bg-white rounded-lg shadow-lg p-6 border border-stone-200">
                <p className="text-sm text-stone-500 uppercase tracking-wide mb-2">Full Land Analysis</p>
                <p className="text-4xl font-bold text-stone-800 mb-4">$350</p>
                <p className="text-stone-600 mb-6">Per parcel • 9-page PDF • Instant delivery</p>
                <Link
                  href="/map?product=full_report"
                  className="block w-full text-center bg-green-700 hover:bg-green-600 text-white font-semibold py-3 rounded-lg transition-colors"
                >
                  Generate Report
                </Link>
                <p className="text-sm text-stone-500 mt-4 text-center">
                  Volume pricing available for agencies
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-stone-800 text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-6">
            Ready to Elevate Your Listings?
          </h2>
          <p className="text-stone-300 text-lg mb-8 max-w-2xl mx-auto">
            Join the rural land professionals who trust Terra Firma for accurate, 
            comprehensive property data. Your buyers will thank you.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-stone-900 font-semibold px-8 py-4 rounded-lg transition-colors text-lg"
            >
              See Plans &amp; Pricing
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <div className="flex items-center justify-center gap-2 text-stone-400">
            <Phone className="w-5 h-5" />
            <span>Questions? Call Clark at <a href="tel:+16603622797" className="text-amber-400 hover:text-amber-300">(660) 362-2797</a></span>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
