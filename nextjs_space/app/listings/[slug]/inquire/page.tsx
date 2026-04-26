/**
 * /listings/[slug]/inquire — PUBLIC inquiry form (chunk 4).
 *
 * Server component: validates the listing exists + is PUBLISHED, then
 * renders the <InquiryForm /> client component for submission.
 *
 * OPSEC: only safe summary fields (state/county/acres/lease/grade/price)
 * are shown to the hunter. Listing detail page already enforces this via
 * stripForPublic; we re-apply the same allowlist here.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import Navbar from '@/components/navbar';
import {
  extractIdFromSlugId,
  listingTitleFallback,
  stripForPublic,
  gradeFromScore,
} from '@/lib/listings';
import InquiryForm from './_components/inquiry-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Inquire — Terra Firma Partners',
  description:
    'Send your inquiry directly to a Terra Firma Partners landowner. County-level information only — precise location is shared after contact.',
};

interface Props {
  params: { slug: string };
}

export default async function InquirePage({ params }: Props) {
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
      askingPriceMin: true,
      askingPriceMax: true,
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
  const grade = gradeFromScore(safe.terrainScore);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <Link
          href={`/listings/${params.slug}`}
          className="inline-flex items-center text-stone-500 hover:text-stone-300 text-sm mb-6"
        >
          ← Back to listing
        </Link>

        <div className="rounded-2xl border border-stone-800 bg-gradient-to-br from-stone-900 via-emerald-950/30 to-stone-900 p-6 sm:p-10 mb-6">
          <p className="text-emerald-400 uppercase tracking-widest text-xs font-semibold">
            Inquire about this listing
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-100 mt-2 leading-tight">
            {titleStr}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-3 text-stone-300 text-sm">
            {safe.county && (
              <span>
                {safe.county} County{safe.state ? `, ${safe.state}` : ''}
              </span>
            )}
            {safe.acres != null && (
              <span className="text-stone-500">•</span>
            )}
            {safe.acres != null && (
              <span>{Math.round(safe.acres).toLocaleString('en-US')} acres</span>
            )}
            {grade !== '\u2014' && (
              <>
                <span className="text-stone-500">•</span>
                <span className="text-emerald-300">Grade {grade}</span>
              </>
            )}
          </div>
        </div>

        <InquiryForm
          listingId={listing.id}
          slug={params.slug}
          county={safe.county ?? null}
          state={safe.state ?? null}
        />

        <p className="text-stone-500 text-xs mt-6 leading-relaxed">
          Your inquiry is sent directly to the landowner via email. Replies come from the landowner,
          not from Terra Firma Partners. We don't share your contact info beyond the listing owner
          and our internal records.
        </p>
      </main>
    </div>
  );
}
