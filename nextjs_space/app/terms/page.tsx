import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Terra Firma Partners™",
  description: "Terms of Service for Terra Firma Partners terrain-intelligence and land mapping services.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-stone-50 pt-20 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-stone-800 mb-2">Terms of Service</h1>
        <p className="text-stone-500 mb-2">Last updated: June 28, 2026</p>

        <div className="mb-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          We are in the process of updating these Terms of Service. A revised version will be
          published soon. The terms below reflect our current products and pricing.
        </div>

        <div className="prose prose-stone max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">1. Acceptance of Terms</h2>
            <p className="text-stone-600">
              By accessing and using Terra Firma Partners™ ("Service"), you accept and agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use our Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">2. Description of Service</h2>
            <p className="text-stone-600">
              Terra Firma Partners provides terrain-intelligence software for hunters and landowners, including
              interactive maps and analysis of terrain features such as deer-movement corridors, ridges, funnels,
              bedding areas, and water, along with shareable ScoreCards, sit pins, stand journals, and Hunt Reports.
              We also operate a marketplace that connects hunters seeking leases with landowners offering them.
              Our analysis is generated using data from third-party sources including Regrid, USGS, USDA, and other
              public and commercial providers. The Service is informational only and is not a substitute for a
              professional land survey or title verification.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">3. Payment and Refunds</h2>
            <p className="text-stone-600">
              Terra Firma Partners offers a free tier, a one-time Parcel Unlock ($19) for a single property, and
              recurring subscriptions — Pro ($99/year or $12/month) and Pro Max ($199/year or $24/month). Pricing
              shown at checkout governs your purchase. Payment is processed securely through Stripe. Subscriptions
              renew automatically until cancelled; you may cancel at any time through your account billing portal,
              and cancellation takes effect at the end of your current billing period. Due to the digital nature of
              the Service, all fees are non-refundable, including for periods of non-use, except where required by
              law or provided at our sole discretion. If you experience a technical issue affecting your purchase,
              please contact us and we will work to resolve it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">4. Data Accuracy Disclaimer</h2>
            <p className="text-stone-600">
              While we strive to provide accurate information, Terra Firma Partners does not warrant the accuracy, completeness, 
              or reliability of any data in our reports. Our reports are for informational purposes only and should not be 
              relied upon as legal, surveying, or engineering advice. Users should verify all information with appropriate 
              professionals before making decisions based on our reports.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">5. Intellectual Property</h2>
            <p className="text-stone-600">
              Terra Firma Partners™ and all associated logos, designs, and content are trademarks and copyrighted materials 
              of Terra Firma Partners LLC. Reports purchased may be used for personal or professional purposes but may not 
              be resold or redistributed commercially without written permission.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">6. Limitation of Liability</h2>
            <p className="text-stone-600">
              Terra Firma Partners LLC shall not be liable for any indirect, incidental, special, consequential, or punitive 
              damages resulting from your use of the Service or any data contained in our reports. Our total liability shall 
              not exceed the amount paid for the specific report in question.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">7. Modifications to Terms</h2>
            <p className="text-stone-600">
              We reserve the right to modify these terms at any time. Continued use of the Service after changes constitutes 
              acceptance of the modified terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">8. Contact Information</h2>
            <p className="text-stone-600">
              For questions regarding these Terms of Service, please contact us at info@terrafirmapartners.com.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
