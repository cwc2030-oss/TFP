/**
 * /dashboard/inquiries — owner-scoped inbox of inquiries.
 *
 * Server component. Auth-gated via NextAuth. Lists every inquiry whose
 * underlying listing is owned by the current user, newest first.
 *
 * Row actions live in <InquiryRowActions /> (client component) and POST
 * to /api/dashboard/inquiries/[id]/status.
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import Navbar from '@/components/navbar';
import InquiryRowActions from './_components/inquiry-row-actions';
import InquiryMessageDisclosure from './_components/inquiry-message-disclosure';
import { listingSlug } from '@/lib/listings';

export const dynamic = 'force-dynamic';

function StatusBadge({ status }: { status: 'NEW' | 'REPLIED' | 'CLOSED' }) {
  const styles =
    status === 'NEW'
      ? 'bg-emerald-900/60 border-emerald-700 text-emerald-200'
      : status === 'REPLIED'
      ? 'bg-stone-800 border-stone-600 text-stone-200'
      : 'bg-stone-900 border-stone-700 text-stone-500';
  return (
    <span
      className={`inline-flex items-center text-[11px] tracking-wide uppercase font-semibold px-2 py-0.5 rounded border ${styles}`}
    >
      {status}
    </span>
  );
}

export default async function InquiriesIndexPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=%2Fdashboard%2Finquiries');
  }
  const userId = session.user.id;

  const inquiries = await prisma.inquiry.findMany({
    where: { listing: { ownerUserId: userId } },
    orderBy: { createdAt: 'desc' },
    include: {
      listing: {
        select: {
          id: true,
          state: true,
          county: true,
          acres: true,
          terrainScore: true,
          leaseType: true,
          status: true,
        },
      },
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-stone-100">Inquiries</h1>
            <p className="text-stone-400 mt-2">
              Hunters who reached out through your listings. Reply directly via email — mark each
              one Replied or Closed once you've responded.
            </p>
          </div>
          <Link
            href="/dashboard/listings"
            className="inline-flex items-center justify-center bg-stone-800 hover:bg-stone-700 text-stone-200 px-4 py-2 rounded-md font-medium"
          >
            ← My Listings
          </Link>
        </div>

        {inquiries.length === 0 ? (
          <div className="rounded-xl border border-stone-800 bg-stone-900/60 p-10 text-center">
            <p className="text-stone-300 text-lg font-medium">No inquiries yet</p>
            <p className="text-stone-500 mt-2">
              Once a listing is published, hunter inquiries will appear here.
            </p>
            <Link
              href="/dashboard/listings"
              className="inline-flex items-center justify-center mt-5 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-md font-medium"
            >
              Go to my listings
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-900 text-stone-400 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Date</th>
                    <th className="px-4 py-3 text-left font-semibold">Listing</th>
                    <th className="px-4 py-3 text-left font-semibold">Hunter</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800">
                  {inquiries.map((inq) => {
                    const slug = listingSlug({
                      state: inq.listing.state,
                      county: inq.listing.county,
                      acres: inq.listing.acres,
                      terrainScore: inq.listing.terrainScore,
                      leaseType: inq.listing.leaseType,
                    });
                    const slugId = `${slug}-${inq.listing.id}`;
                    const acres =
                      inq.listing.acres != null
                        ? `${Math.round(inq.listing.acres)} ac`
                        : '—';
                    const where =
                      [inq.listing.county, inq.listing.state].filter(Boolean).join(', ') || '—';
                    return (
                      <tr key={inq.id} className="align-top hover:bg-stone-900/80">
                        <td className="px-4 py-3 text-stone-300 whitespace-nowrap">
                          {new Date(inq.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                          <div className="text-stone-500 text-xs">
                            {new Date(inq.createdAt).toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-stone-200">
                          <Link
                            href={`/listings/${slugId}`}
                            className="text-emerald-300 hover:text-emerald-200 font-medium"
                          >
                            {where}
                          </Link>
                          <div className="text-stone-500 text-xs mt-0.5">{acres}</div>
                        </td>
                        <td className="px-4 py-3 text-stone-200">
                          <div className="font-medium">{inq.hunterName}</div>
                          <a
                            href={`mailto:${inq.hunterEmail}`}
                            className="text-emerald-300 hover:text-emerald-200 text-xs"
                          >
                            {inq.hunterEmail}
                          </a>
                          {inq.hunterPhone && (
                            <div className="text-stone-500 text-xs mt-0.5">{inq.hunterPhone}</div>
                          )}
                          <div className="text-stone-500 text-xs mt-1">
                            Party of {inq.partySize}
                            {inq.preferredDates ? ` • ${inq.preferredDates}` : ''}
                          </div>
                          <InquiryMessageDisclosure message={inq.message} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={inq.status} />
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <InquiryRowActions inquiryId={inq.id} status={inq.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
