/**
 * Brick 1 — the hunter's OWN trust profile: read + upsert.
 *
 * GATED behind TFP_HUNTER_PROFILES_OPEN. Auth-required. A user manages only
 * their own profile (keyed on session userId — never a body/URL id).
 *
 * The firearm attestation is stored as a self-attestation with a timestamp.
 * It is NEVER treated as a background check anywhere.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { areHunterProfilesOpen } from '@/lib/hunter-profiles-gate';
import { hunterProfileSchema } from '@/lib/hunter-profile';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!areHunterProfilesOpen()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const profile = await prisma.hunterProfile.findUnique({ where: { userId } });
  return NextResponse.json({ profile });
}

export async function PUT(req: Request) {
  if (!areHunterProfilesOpen()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = hunterProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const d = parsed.data;

  // Existing profile (to preserve firearmAttestationAt when the attestation
  // was already made).
  const existing = await prisma.hunterProfile.findUnique({ where: { userId } });

  const attested = d.firearmAttestation === true;
  const firearmAttestationAt = attested
    ? existing?.firearmAttestation
      ? existing.firearmAttestationAt ?? new Date()
      : new Date()
    : null;

  // Normalize references: drop fully-empty rows.
  const references = (d.references ?? [])
    .map((r) => ({
      name: (r.name ?? '').trim(),
      relationship: (r.relationship ?? '').trim(),
      contact: (r.contact ?? '').trim(),
      note: (r.note ?? '').trim(),
    }))
    .filter((r) => r.name || r.relationship || r.contact || r.note);

  const data = {
    groupSize: d.groupSize ?? null,
    hasKidsFamily: d.hasKidsFamily ?? null,
    footprint: d.footprint ?? null,
    needsPowerHookup: d.needsPowerHookup ?? null,
    needsWaterHookup: d.needsWaterHookup ?? null,
    hasATV: d.hasATV ?? null,
    huntingLicense: d.huntingLicense ?? 'NONE',
    hunterEd: d.hunterEd ?? 'NONE',
    liabilityInsurance: d.liabilityInsurance ?? 'NONE',
    mdcPermits: d.mdcPermits ?? 'NONE',
    firearmAttestation: attested,
    firearmAttestationAt,
    references: references.length > 0 ? references : undefined,
    bio: (d.bio ?? '').trim() || null,
    visible: d.visible ?? true,
  };

  const profile = await prisma.hunterProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return NextResponse.json({ profile });
}
