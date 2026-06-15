/**
 * /listings/[id]/edit — resume the wizard at step 2 or 3.
 *
 * Server component, auth-gated, owner-scoped.
 * `?step=2|3` controls which form is rendered. If no step is provided,
 * heuristically resume at the first incomplete step.
 */
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import Navbar from '@/components/navbar';
import { gradeFromScore, getStepFromQuery } from '@/lib/listings';
import StepHeader from '../../new/_components/step-header';
import LeaseTermsForm from './_components/lease-terms-form';
import ContentContactForm from './_components/content-contact-form';

export const dynamic = 'force-dynamic';

interface Props {
  params: { id: string };
  searchParams: { step?: string };
}

export default async function EditListingPage({ params, searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/dashboard/listings/${params.id}/edit`);
  }

  const listing = await prisma.listing.findFirst({
    where: { id: params.id, ownerUserId: session.user.id },
    include: {
      savedProperty: {
        select: {
          id: true,
          name: true,
          totalAcres: true,
          terrainScore: true,
          primaryMovement: true,
          bedAcres: true,
          funnelCount: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!listing) notFound();

  // Non-DRAFT listings can only access step 3 (photos). All other steps
  // are DRAFT-only. (Lifecycle transitions use the dedicated POST routes.)
  const isPublished = listing.status !== 'DRAFT';
  if (isPublished && getStepFromQuery(searchParams.step) !== 3) {
    redirect(`/dashboard/listings/${params.id}/edit?step=3`);
  }

  const step = getStepFromQuery(searchParams.step);
  const sp = listing.savedProperty;

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <StepHeader currentStep={step} />

        {/* Read-only snapshot of the anchored property's parcel facts.
            OPSEC: we deliberately do NOT display lat/lng — only what's
            safe to surface on the public listing later. */}
        <section className="mt-6 rounded-lg border border-stone-800 bg-stone-900/50 p-5">
          <h2 className="text-stone-300 text-sm uppercase tracking-wide mb-3">
            Anchored property
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Property" value={sp.name} />
            <Stat
              label="Acres"
              value={sp.totalAcres != null ? Math.round(sp.totalAcres).toString() : '\u2014'}
            />
            <Stat
              label="Terrain score"
              value={
                sp.terrainScore != null
                  ? `${sp.terrainScore} (${gradeFromScore(sp.terrainScore)})`
                  : '\u2014'
              }
            />
            <Stat label="Primary movement" value={sp.primaryMovement ?? '\u2014'} />
          </div>
        </section>

        {step === 2 && (
          <>
            <h1 className="text-2xl font-bold text-stone-100 mt-8">Lease terms</h1>
            <p className="text-stone-400 mt-2 mb-6">
              All fields are optional at the DRAFT stage. You can save and
              come back later.
            </p>
            <LeaseTermsForm
              listingId={listing.id}
              initial={{
                state: listing.state,
                county: listing.county,
                askingPriceMin: listing.askingPriceMin,
                askingPriceMax: listing.askingPriceMax,
                leaseType: listing.leaseType,
                huntersMax: listing.huntersMax,
                seasonAvailability: listing.seasonAvailability ?? [],
                amenities: (listing.amenities as Record<string, boolean> | null) ?? null,
              }}
            />
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-2xl font-bold text-stone-100 mt-8">
              {isPublished ? 'Manage photos' : 'Photos, description & contact'}
            </h1>
            <p className="text-stone-400 mt-2 mb-6">
              {isPublished
                ? 'Add, remove, or reorder photos on your published listing.'
                : 'All fields optional at DRAFT. Up to 6 photos.'}
            </p>
            <ContentContactForm
              listingId={listing.id}
              isPublished={isPublished}
              initial={{
                title: listing.title,
                description: listing.description,
                photos: listing.photos ?? [],
                contactMethod: listing.contactMethod,
                contactEmail: listing.contactEmail,
                contactPhone: listing.contactPhone,
              }}
            />
          </>
        )}

        {step === 1 && (
          <div className="mt-8 rounded-lg border border-stone-800 bg-stone-900/50 p-5">
            <p className="text-stone-300">
              This listing is anchored to{' '}
              <span className="font-semibold text-stone-100">{sp.name}</span>.
              You can’t change the anchor on a draft — if you want a
              different property, create a new listing instead.
            </p>
            <Link
              href={`/dashboard/listings/${listing.id}/edit?step=2`}
              className="inline-flex items-center justify-center mt-4 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2 rounded-lg font-medium transition-colors"
            >
              Continue →
            </Link>
          </div>
        )}

        <div className="mt-10">
          <Link href="/dashboard/listings" className="text-stone-500 hover:text-stone-400 text-sm">
            ← Back to my listings
          </Link>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-stone-500 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-stone-100 mt-1">{value}</div>
    </div>
  );
}
