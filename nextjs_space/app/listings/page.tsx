/**
 * /listings — owner-scoped index of the current user's listings.
 *
 * Server component. Auth-gated. Shows "Create Listing" CTA only when the
 * user has at least one SavedProperty.
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { listingTitleFallback, gradeFromScore } from '@/lib/listings';
import Navbar from '@/components/navbar';

export const dynamic = 'force-dynamic';

export default async function ListingsIndexPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=%2Flistings');
  }
  const userId = session.user.id;

  const [listings, savedPropertyCount] = await Promise.all([
    prisma.listing.findMany({
      where: { ownerUserId: userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        savedProperty: {
          select: { name: true, totalAcres: true, terrainScore: true },
        },
      },
    }),
    prisma.savedProperty.count({ where: { userId } }),
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-stone-100">My Listings</h1>
            <p className="text-stone-400 mt-2">
              Hunt-lease listings anchored to your certified Saved Properties.
            </p>
          </div>
          {savedPropertyCount > 0 ? (
            <Link
              href="/listings/new"
              className="inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              + New Listing
            </Link>
          ) : (
            <div className="text-sm text-stone-400 max-w-xs sm:text-right">
              You need at least one Saved Property before you can create a listing.
              <Link
                href="/properties"
                className="block text-emerald-400 hover:text-emerald-300 underline mt-1"
              >
                Open Saved Properties →
              </Link>
            </div>
          )}
        </div>

        {listings.length === 0 ? (
          <div className="rounded-lg border border-stone-800 bg-stone-900/50 p-10 text-center">
            <p className="text-stone-300 text-lg">No listings yet.</p>
            <p className="text-stone-500 mt-2 text-sm">
              Create your first DRAFT listing to get started.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4">
            {listings.map((l) => {
              const titleStr = listingTitleFallback({
                title: l.title,
                acres: l.acres,
                county: l.county,
                state: l.state,
              });
              return (
                <li
                  key={l.id}
                  className="rounded-lg border border-stone-800 bg-stone-900/50 hover:bg-stone-900/80 transition-colors"
                >
                  <Link
                    href={`/listings/${l.id}/edit`}
                    className="block px-5 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <h2 className="text-stone-100 font-semibold text-lg truncate">
                            {titleStr}
                          </h2>
                          <StatusBadge status={l.status} />
                        </div>
                        <p className="text-stone-500 text-sm mt-1">
                          Anchored to:{' '}
                          <span className="text-stone-300">
                            {l.savedProperty?.name ?? 'unknown'}
                          </span>
                          {l.savedProperty?.totalAcres != null && (
                            <>
                              {' '}
                              · {Math.round(l.savedProperty.totalAcres)} ac
                            </>
                          )}
                          {l.savedProperty?.terrainScore != null && (
                            <>
                              {' '}
                              · grade {gradeFromScore(l.savedProperty.terrainScore)}
                            </>
                          )}
                        </p>
                      </div>
                      <div className="text-right text-stone-500 text-xs whitespace-nowrap">
                        Updated {new Date(l.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-stone-700 text-stone-200',
    PENDING_REVIEW: 'bg-amber-700 text-amber-100',
    PUBLISHED: 'bg-emerald-700 text-emerald-100',
    LEASED: 'bg-blue-700 text-blue-100',
    EXPIRED: 'bg-stone-800 text-stone-400',
    WITHDRAWN: 'bg-red-900 text-red-200',
  };
  const cls = map[status] ?? 'bg-stone-700 text-stone-200';
  return (
    <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wide ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
