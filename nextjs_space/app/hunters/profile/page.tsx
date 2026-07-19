/**
 * /hunters/profile — the hunter's create/edit trust profile form (Brick 1).
 *
 * GATED behind TFP_HUNTER_PROFILES_OPEN. Auth-required. Server component:
 * checks the gate + session, loads any existing profile, and hands it to the
 * client form.
 */
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import Navbar from '@/components/navbar';
import {
  areHunterProfilesOpen,
  HUNTER_PROFILES_COMING_SOON_PATH,
} from '@/lib/hunter-profiles-gate';
import ProfileForm from './_form/profile-form';

export const dynamic = 'force-dynamic';

export default async function HunterProfilePage() {
  if (!areHunterProfilesOpen()) {
    redirect(HUNTER_PROFILES_COMING_SOON_PATH);
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=%2Fhunters%2Fprofile');
  }

  const profile = await prisma.hunterProfile.findUnique({
    where: { userId: session.user.id },
  });

  // Serialize to a plain object the client form can hydrate from.
  const initial = profile
    ? {
        groupSize: profile.groupSize,
        hasKidsFamily: profile.hasKidsFamily,
        footprint: profile.footprint,
        needsPowerHookup: profile.needsPowerHookup,
        needsWaterHookup: profile.needsWaterHookup,
        hasATV: profile.hasATV,
        huntingLicense: profile.huntingLicense,
        hunterEd: profile.hunterEd,
        liabilityInsurance: profile.liabilityInsurance,
        mdcPermits: profile.mdcPermits,
        firearmAttestation: profile.firearmAttestation,
        references: Array.isArray(profile.references) ? profile.references : [],
        bio: profile.bio,
        visible: profile.visible,
      }
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-stone-100">
            Your Hunter Profile
          </h1>
          <p className="text-stone-400 mt-2 leading-relaxed">
            This is how landowners get to know you before they choose who hunts
            their ground. Be straight about how you hunt — honesty is the whole
            point. Everything here is either something you disclose or something
            you self-attest. We don&apos;t background-check or verify these for
            you.
          </p>
        </div>
        <ProfileForm initial={initial as any} />
      </main>
    </div>
  );
}
