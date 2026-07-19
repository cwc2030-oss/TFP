/**
 * /hunters/browse — owner browse-and-choose view (Brick 1).
 *
 * GATED behind TFP_HUNTER_PROFILES_OPEN. Auth-required AND restricted to
 * LANDOWNERS (own >=1 Listing, or admin) per requirement #2. A non-landowner
 * is sent to their listings dashboard with a note — they can't browse the
 * hunter pool.
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import Navbar from '@/components/navbar';
import {
  areHunterProfilesOpen,
  HUNTER_PROFILES_COMING_SOON_PATH,
} from '@/lib/hunter-profiles-gate';
import { isLandowner } from '@/lib/landowner';
import BrowseClient from './_browse/browse-client';

export const dynamic = 'force-dynamic';

export default async function HunterBrowsePage() {
  if (!areHunterProfilesOpen()) {
    redirect(HUNTER_PROFILES_COMING_SOON_PATH);
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=%2Fhunters%2Fbrowse');
  }
  const role = (session.user as any)?.role as string | undefined;
  const landowner = await isLandowner(session.user.id, role);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-stone-100">
            Find Your Hunters
          </h1>
          <p className="text-stone-400 mt-2 leading-relaxed">
            Browse hunters who&apos;ve put an honest profile forward. Everything
            you see is disclosed by the hunter or self-attested — nothing here
            is verified or background-checked by TFP. Shortlist the ones that
            fit your ground.
          </p>
        </div>

        {landowner ? (
          <BrowseClient />
        ) : (
          <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-8 text-center">
            <h2 className="text-xl font-semibold text-stone-100">
              Browsing hunters is for landowners
            </h2>
            <p className="text-stone-400 mt-2 max-w-md mx-auto">
              The hunter pool is available to members who have land listed with
              us. Create a listing for your property and you&apos;ll be able to
              browse and shortlist hunters here.
            </p>
            <Link
              href="/dashboard/listings"
              className="inline-flex items-center justify-center mt-5 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Go to my listings
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
