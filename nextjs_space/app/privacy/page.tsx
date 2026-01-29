import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Terra Firma Partners™",
  description: "Privacy Policy for Terra Firma Partners land analysis reports and mapping services.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-stone-50 pt-20 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-stone-800 mb-2">Privacy Policy</h1>
        <p className="text-stone-500 mb-8">Last updated: January 24, 2026</p>

        <div className="prose prose-stone max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">1. Information We Collect</h2>
            <p className="text-stone-600">
              We collect information you provide directly to us, including:
            </p>
            <ul className="list-disc list-inside text-stone-600 mt-2 space-y-1">
              <li>Name and email address when creating an account</li>
              <li>Payment information (processed securely by Stripe)</li>
              <li>Property addresses you search for or purchase reports on</li>
              <li>Communications you send to us</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">2. How We Use Your Information</h2>
            <p className="text-stone-600">
              We use the information we collect to:
            </p>
            <ul className="list-disc list-inside text-stone-600 mt-2 space-y-1">
              <li>Provide, maintain, and improve our services</li>
              <li>Process transactions and send related information</li>
              <li>Send you technical notices and support messages</li>
              <li>Respond to your comments and questions</li>
              <li>Communicate about products, services, and events</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">3. Information Sharing</h2>
            <p className="text-stone-600">
              We do not sell, trade, or rent your personal information to third parties. We may share information with:
            </p>
            <ul className="list-disc list-inside text-stone-600 mt-2 space-y-1">
              <li>Service providers who assist in our operations (e.g., Stripe for payments)</li>
              <li>Professional advisors as required by law</li>
              <li>Law enforcement when required by legal process</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">4. Data Security</h2>
            <p className="text-stone-600">
              We implement appropriate technical and organizational measures to protect your personal information. 
              Payment information is processed through Stripe's secure, PCI-compliant platform and is never stored 
              on our servers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">5. Cookies and Tracking</h2>
            <p className="text-stone-600">
              We use cookies and similar technologies to maintain your session, remember your preferences, and 
              understand how you use our service. You can control cookies through your browser settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">6. Third-Party Services</h2>
            <p className="text-stone-600">
              Our service integrates with third-party services including Google Maps and Regrid for mapping and 
              parcel data. These services have their own privacy policies governing the use of your information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">7. Your Rights</h2>
            <p className="text-stone-600">
              You have the right to access, correct, or delete your personal information. To exercise these rights, 
              please contact us at info@terrafirmapartners.com.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">8. Children's Privacy</h2>
            <p className="text-stone-600">
              Our service is not intended for children under 18. We do not knowingly collect information from 
              children under 18.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">9. Changes to This Policy</h2>
            <p className="text-stone-600">
              We may update this privacy policy from time to time. We will notify you of changes by posting the 
              new policy on this page and updating the "Last updated" date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">10. Contact Us</h2>
            <p className="text-stone-600">
              If you have questions about this Privacy Policy, please contact us at info@terrafirmapartners.com.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
