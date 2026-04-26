/**
 * /listings/new — Step 1 of the wizard.
 *
 * Server component. Lists the user's SavedProperty rows. On submit:
 *  1. Create draft via POST /api/listings
 *  2. Redirect to /listings/[id]/edit?step=2
 *
 * Auth-gated. Requires ≥1 SavedProperty; otherwise redirects to /listings
 * (the index page handles the empty-state messaging).
 */
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import Navbar from '@/components/navbar';
import { getListingPrefillForOwner } from '@/lib/listing-prefill';
import StepHeader from './_components/step-header';
import SavedPropertyPickerForm from './_components/saved-property-picker-form';
import ListingCtaArrivalTracker from './_components/listing-cta-arrival-tracker';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams?: { savedPropertyId?: string; cta?: string };
}

export default async function NewListingPage({ searchParams = {} }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=%2Fdashboard%2Flistings%2Fnew');
  }
  const userId = session.user.id;
  const requestedSavedPropertyId = searchParams.savedPropertyId?.trim() || null;
  const prefill = requestedSavedPropertyId
    ? await getListingPrefillForOwner(requestedSavedPropertyId, userId)
    : null;
  if (requestedSavedPropertyId && !prefill) {
    notFound();
  }

  const savedProperties = await prisma.savedProperty.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      totalAcres: true,
      terrainScore: true,
      primaryMovement: true,
      updatedAt: true,
    },
  });

  if (savedProperties.length === 0) {
    redirect('/dashboard/listings');
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <StepHeader currentStep={1} />
        <h1 className="text-3xl font-bold text-stone-100 mt-6">
          Pick which Saved Property this listing is based on
        </h1>
        <p className="text-stone-400 mt-2 mb-8">
          Listings are anchored to a Saved Property. Its certified terrain
          score and metadata are what makes the listing trustworthy.
        </p>

        <ListingCtaArrivalTracker
          savedPropertyId={requestedSavedPropertyId}
          cta={searchParams.cta ?? null}
        />
        <SavedPropertyPickerForm
          savedProperties={savedProperties}
          initialSelectedId={requestedSavedPropertyId}
          prefill={prefill}
        />

        <div className="mt-8">
          <Link href="/dashboard/listings" className="text-stone-500 hover:text-stone-400 text-sm">
            ← Back to my listings
          </Link>
        </div>
      </main>
    </div>
  );
}
