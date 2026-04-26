/**
 * /listings/[slug]/inquire — placeholder for chunk 4 inquiry flow.
 *
 * Validates that the listing is real (PUBLISHED) and returns a friendly
 * "Inquiries open soon" page. Inquiry data capture lands in chunk 4.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import Navbar from '@/components/navbar';
import {
  extractIdFromSlugId,
  listingTitleFallback,
  stripForPublic,
} from '@/lib/listings';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Inquire — Terra Firma Partners',
  description:
    'Inquire about a Terra Firma Partners hunt-lease listing. Inquiries are routed to the landowner.',
};

export default async function InquirePage({ params }: { params: { slug: string } }) {
  const id = extractIdFromSlugId(params.slug);
  if (!id) notFound();

  const listing = await prisma.listing.findFirst({
    where: { id, status: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      state: true,
      county: true,
      acres: true,
      terrainScore: true,
      leaseType: true,
    },
  });
  if (!listing) notFound();

  const safe = stripForPublic(listing) as typeof listing;
  const titleStr = listingTitleFallback({
    title: safe.title,
    acres: safe.acres,
    county: safe.county,
    state: safe.state,
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <Link
          href={`/listings/${params.slug}`}
          className="inline-flex items-center text-stone-500 hover:text-stone-300 text-sm mb-6"
        >
          ← Back to listing
        </Link>

        <div className="rounded-2xl border border-stone-800 bg-gradient-to-br from-stone-900 via-emerald-950/30 to-stone-900 p-8 sm:p-12">
          <p className="text-emerald-400 uppercase tracking-widest text-xs font-semibold">
            Inquiries open soon
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-stone-100 mt-2">
            We're polishing the inquiry flow.
          </h1>
          <p className="text-stone-400 mt-4 text-base sm:text-lg">
            You're inquiring about{' '}
            <span className="text-stone-200 font-medium">{titleStr}</span>. Email-relayed
            messaging launches in the next release. In the meantime, hop on the early
            access list and we'll wire you up the moment it goes live.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link
              href="/find-a-lease"
              className="inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Get on the hunter waitlist →
            </Link>
            <Link
              href={`/listings/${params.slug}`}
              className="inline-flex items-center justify-center bg-stone-800 hover:bg-stone-700 text-stone-200 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Back to listing
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
