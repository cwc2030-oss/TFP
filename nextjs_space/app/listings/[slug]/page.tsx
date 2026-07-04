/**
 * /listings/[slug] — PUBLIC detail page.
 *
 * Slug format: "<state>-<county>-<acres>ac-<grade>-<lease-type>-<id>"
 * The id is the canonical lookup key. Anything else is cosmetic / SEO.
 *
 * OPSEC:
 *   - Looks up only PUBLISHED listings; everything else 404s.
 *   - Selects an explicit allowlist of safe columns.
 *   - Runs through stripForPublic() before rendering.
 *   - No savedProperty include, no parcel/lat/lng anywhere on the page.
 */
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import Navbar from '@/components/navbar';
import {
  extractIdFromSlugId,
  listingSlug,
  listingTitleFallback,
  stripForPublic,
  gradeFromScore,
} from '@/lib/listings';
import { lookupCentroid } from '@/lib/county-centroids';
import { isMarketplaceOpen, COMING_SOON_PATH } from '@/lib/marketplace-gate';
import GradeBadge from './_components/grade-badge';
import CountyMap from './_components/county-map';
import PhotoGallery from './_components/photo-gallery';
import TerrainBrainTeaser from './_components/terrain-brain-teaser';
import DeerFlowPreview from './_components/deer-flow-preview';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Props {
  params: { slug: string };
}

async function loadPublished(id: string) {
  return prisma.listing.findFirst({
    where: { id, status: 'PUBLISHED' },
    select: {
      id: true,
      ownerUserId: true,
      title: true,
      description: true,
      state: true,
      county: true,
      acres: true,
      terrainScore: true,
      primaryMovement: true,
      bedAcres: true,
      funnelCount: true,
      corridorCount: true,
      interceptCount: true,
      askingPriceMin: true,
      askingPriceMax: true,
      leaseType: true,
      huntersMax: true,
      seasonAvailability: true,
      amenities: true,
      photos: true,
      publishedAt: true,
      savedPropertyUpdatedAt: true,
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = extractIdFromSlugId(params.slug);
  if (!id) return { title: 'Listing not found — Terra Firma Partners' };
  const l = await loadPublished(id);
  if (!l) return { title: 'Listing not found — Terra Firma Partners' };
  const title = listingTitleFallback({
    title: l.title,
    acres: l.acres,
    county: l.county,
    state: l.state,
  });
  const grade = gradeFromScore(l.terrainScore);
  const description = l.description
    ? l.description.slice(0, 240)
    : `Terrain grade ${grade} hunt-lease in ${l.county ?? ''}${l.county ? ', ' : ''}${
        l.state ?? ''
      }. Anchored to a Terra Firma Partners hunt-report.`;
  const ogImage = l.photos?.[0];
  return {
    title: `${title} — Terra Firma Partners`,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function PublicListingDetail({ params }: Props) {
  if (!isMarketplaceOpen()) {
    redirect(COMING_SOON_PATH);
  }
  const id = extractIdFromSlugId(params.slug);
  if (!id) notFound();

  const listing = await loadPublished(id);
  if (!listing) notFound();

  // Canonical-redirect cosmetic-slug drift
  const canonical = `${listingSlug({
    state: listing.state,
    county: listing.county,
    acres: listing.acres,
    terrainScore: listing.terrainScore,
    leaseType: listing.leaseType,
  })}-${listing.id}`;
  if (params.slug !== canonical) {
    redirect(`/listings/${canonical}`);
  }

  // Determine if caller gets full Terrain Brain (owner or accepted lessee)
  const session = await getServerSession(authOptions);
  const callerId = session?.user?.id ?? null;
  const isOwner = !!callerId && listing.ownerUserId === callerId;
  let hasFullAccess = isOwner;
  if (!hasFullAccess && callerId) {
    const accepted = await prisma.inquiry.findFirst({
      where: {
        listingId: listing.id,
        userId: callerId,
        status: 'ACCEPTED',
      },
      select: { id: true },
    });
    hasFullAccess = !!accepted;
  }

  // OPSEC defense in depth — strip any forbidden key names.
  const safe = stripForPublic(listing) as typeof listing;
  const titleStr = listingTitleFallback({
    title: safe.title,
    acres: safe.acres,
    county: safe.county,
    state: safe.state,
  });
  const centroid = lookupCentroid(safe.state, safe.county);
  const grade = gradeFromScore(safe.terrainScore);
  const amenities = (safe.amenities as Record<string, boolean> | null) ?? null;
  const seasons = safe.seasonAvailability ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link
          href="/listings"
          className="inline-flex items-center text-stone-500 hover:text-stone-300 text-sm mb-6"
        >
          ← All listings
        </Link>

        {/* Hero */}
        <section className="rounded-2xl border border-stone-800 bg-gradient-to-br from-stone-800 via-emerald-950/40 to-stone-900 p-6 sm:p-10 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="min-w-0">
              <p className="text-emerald-400 uppercase tracking-widest text-xs font-semibold">
                {safe.county ? `${safe.county} County, ` : ''}
                {safe.state ?? ''}
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-stone-100 mt-2 leading-tight">
                {titleStr}
              </h1>
              <div className="flex flex-wrap items-center gap-4 mt-4 text-stone-300">
                {safe.acres != null && (
                  <span>
                    <strong>{Math.round(safe.acres).toLocaleString('en-US')}</strong> acres
                  </span>
                )}
                {safe.leaseType && (
                  <span className="text-xs px-2 py-0.5 rounded bg-stone-900 border border-stone-700 text-stone-300 uppercase tracking-wide">
                    {safe.leaseType.replace('_', ' ')}
                  </span>
                )}
                {grade !== '—' && (
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700 text-emerald-200 uppercase tracking-wide">
                    Grade {grade}
                  </span>
                )}
              </div>
              <div className="mt-6">
                <Link
                  href={`/listings/${canonical}/inquire`}
                  className="inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  Inquire about this listing →
                </Link>
              </div>
            </div>
            <div className="shrink-0">
              <GradeBadge score={safe.terrainScore ?? null} size="lg" />
            </div>
          </div>
        </section>

        {/* Photos */}
        <PhotoGallery photos={safe.photos ?? []} title={titleStr} />

        {/* Full Terrain Brain for owner + accepted lessee; teaser for everyone else */}
        {hasFullAccess ? (
          <DeerFlowPreview listingId={listing.id} grade={grade} />
        ) : (
          <TerrainBrainTeaser
            grade={grade}
            terrainScore={safe.terrainScore ?? null}
            corridorCount={(safe as any).corridorCount ?? null}
            funnelCount={safe.funnelCount ?? null}
            interceptCount={(safe as any).interceptCount ?? null}
            seasonAvailability={seasons}
            acres={safe.acres ?? null}
            askingPriceMin={safe.askingPriceMin ?? null}
            askingPriceMax={safe.askingPriceMax ?? null}
            primaryMovement={safe.primaryMovement ?? null}
            bedAcres={safe.bedAcres as number | null}
            inquireHref={`/listings/${canonical}/inquire`}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Description */}
          <div className="lg:col-span-2 space-y-6">
            {safe.description && (
              <section className="rounded-xl border border-stone-800 bg-stone-900/60 p-6">
                <h2 className="text-stone-100 text-lg font-semibold mb-3">About this property</h2>
                <p className="text-stone-300 whitespace-pre-wrap leading-relaxed">
                  {safe.description}
                </p>
              </section>
            )}

            <section className="rounded-xl border border-stone-800 bg-stone-900/60 p-6">
              <h2 className="text-stone-100 text-lg font-semibold mb-4">Terrain intelligence</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Stat label="Terrain grade" value={grade} />
                <Stat
                  label="Score"
                  value={safe.terrainScore != null ? `${safe.terrainScore} / 100` : '—'}
                />
                <Stat label="Primary movement" value={safe.primaryMovement ?? '—'} />
                <Stat
                  label="Bedding"
                  value={
                    safe.bedAcres != null
                      ? `${(safe.bedAcres as number).toFixed(1)} ac`
                      : '—'
                  }
                />
                <Stat
                  label="Funnels detected"
                  value={safe.funnelCount != null ? String(safe.funnelCount) : '—'}
                />
                <Stat
                  label="Acres"
                  value={safe.acres != null ? Math.round(safe.acres).toLocaleString('en-US') : '—'}
                />
              </dl>
              <p className="text-stone-500 text-xs mt-4">
                Terrain analysis from a Terra Firma Partners hunt-report. Updated{' '}
                {safe.savedPropertyUpdatedAt
                  ? new Date(safe.savedPropertyUpdatedAt as Date).toLocaleDateString()
                  : 'recently'}
                .
              </p>
            </section>

            {(amenities || seasons.length > 0) && (
              <section className="rounded-xl border border-stone-800 bg-stone-900/60 p-6">
                <h2 className="text-stone-100 text-lg font-semibold mb-4">What's included</h2>
                {seasons.length > 0 && (
                  <div className="mb-4">
                    <div className="text-stone-500 text-xs uppercase tracking-wide mb-2">
                      Seasons available
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {seasons.map((s) => (
                        <span
                          key={s}
                          className="text-sm px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-200 capitalize"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {amenities && Object.values(amenities).some(Boolean) && (
                  <div>
                    <div className="text-stone-500 text-xs uppercase tracking-wide mb-2">Amenities</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 text-stone-300">
                      {Object.entries(amenities)
                        .filter(([, on]) => !!on)
                        .map(([k]) => (
                          <div key={k} className="flex items-center gap-2 text-sm capitalize">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-emerald-400">
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                            {k.replace(/([A-Z])/g, ' $1').trim()}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Right rail */}
          <aside className="space-y-6">
            <section className="rounded-xl border border-stone-800 bg-stone-900/60 p-6">
              <h2 className="text-stone-100 text-lg font-semibold mb-3">Lease terms</h2>
              <dl className="space-y-3">
                <Stat
                  label="Asking price"
                  value={priceLabel(safe.askingPriceMin, safe.askingPriceMax) ?? 'Inquire'}
                />
                <Stat
                  label="Lease type"
                  value={safe.leaseType ? safe.leaseType.replace('_', ' ') : '—'}
                />
                <Stat
                  label="Max hunters"
                  value={safe.huntersMax != null ? String(safe.huntersMax) : '—'}
                />
              </dl>
              <Link
                href={`/listings/${canonical}/inquire`}
                className="inline-flex w-full items-center justify-center mt-5 bg-emerald-500 hover:bg-emerald-400 text-white px-5 py-2.5 rounded-md font-medium"
              >
                Inquire →
              </Link>
            </section>

            <CountyMap centroid={centroid} state={safe.state ?? null} county={safe.county ?? null} />

            <section className="rounded-xl border border-stone-800 bg-stone-900/60 p-5 text-stone-400 text-xs leading-relaxed">
              <p>
                <strong className="text-stone-300">Why no exact location?</strong> Terra Firma Partners
                listings only display county-level information until you inquire. This protects landowners
                and prevents trespassers from scouting properties online.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function priceLabel(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => `$${n.toLocaleString('en-US')}/yr`;
  if (min != null && max != null) {
    return min === max ? fmt(min) : `${fmt(min).replace('/yr', '')} – ${fmt(max)}`;
  }
  return fmt((min ?? max) as number);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-stone-500 text-xs uppercase tracking-wide">{label}</dt>
      <dd className="text-stone-100 mt-0.5">{value}</dd>
    </div>
  );
}
