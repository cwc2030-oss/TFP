import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Terra Firma Partners™",
  description: "Terms of Service for Terra Firma Partners land analysis reports and mapping services.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-stone-50 pt-20 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-stone-800 mb-2">Terms of Service</h1>
        <p className="text-stone-500 mb-8">Last updated: January 24, 2026</p>

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
              Terra Firma Partners provides land parcel analysis reports including but not limited to: parcel boundaries, 
              ownership information, flood zone data, topography, soil types, and zoning information. Reports are generated 
              using data from third-party sources including Regrid, FEMA, USGS, and local government agencies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">3. Payment and Refunds</h2>
            <p className="text-stone-600">
              Land Analysis Reports are priced at $99 per report. Payment is processed securely through Stripe. 
              Due to the digital nature of our reports, all sales are final once a report has been generated and delivered. 
              If you experience technical issues preventing report delivery, please contact us within 7 days for resolution.
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
