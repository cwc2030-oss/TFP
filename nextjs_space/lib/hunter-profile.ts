/**
 * Brick 1 — Hunter Trust Profile: shared types, validation, and the HONEST
 * label/badge logic.
 *
 * THE CENTRAL GUARDRAIL LIVES HERE. Badge copy is a pure function of the
 * stored CredentialLevel and nothing else. There is deliberately no code path
 * that renders "verified", "screened", or "background-checked" for MVP,
 * because the CredentialLevel enum has no VERIFIED member. When a real
 * third-party check is added later, extend CRED_BADGE with the new level —
 * that is the only change required.
 */
import { z } from 'zod';

// Mirror the Prisma enums as plain string unions so client components can
// import these without pulling in the Prisma client.
export type Footprint = 'DAY_HUNT' | 'TENT' | 'TRAILER' | 'RV';
export type CredentialLevel = 'NONE' | 'SELF_ATTESTED' | 'DOCUMENT_ON_FILE';

export const FOOTPRINTS: { value: Footprint; label: string; blurb: string }[] = [
  { value: 'DAY_HUNT', label: 'Day hunt only', blurb: 'In and out — no overnight setup' },
  { value: 'TENT', label: 'Tent camp', blurb: 'Primitive overnight, low footprint' },
  { value: 'TRAILER', label: 'Camper / trailer', blurb: 'Towable camper on site' },
  { value: 'RV', label: 'RV', blurb: 'Full RV — may need hookups' },
];

export function footprintLabel(f: Footprint | null | undefined): string {
  return FOOTPRINTS.find((x) => x.value === f)?.label ?? 'Not provided';
}

// Credentials shown on the profile, in display order.
export const CREDENTIAL_FIELDS = [
  { key: 'huntingLicense', label: 'Hunting license' },
  { key: 'hunterEd', label: 'Hunter education' },
  { key: 'liabilityInsurance', label: 'Liability insurance' },
  { key: 'mdcPermits', label: 'MDC permits' },
] as const;

export type CredentialKey = (typeof CREDENTIAL_FIELDS)[number]['key'];

/**
 * HONEST badge copy for a credential level. Never implies third-party
 * verification. `tone` drives styling only.
 *
 * NOTE: 'DOCUMENT_ON_FILE' is intentionally handled here for the future, but
 * in Brick 1 there is no uploader, so this level is UNREACHABLE and never
 * produced. It is kept only so the seam is ready.
 */
export function credentialBadge(level: CredentialLevel): {
  text: string;
  tone: 'muted' | 'attested' | 'onfile';
} {
  switch (level) {
    case 'SELF_ATTESTED':
      return { text: 'Self-attested', tone: 'attested' };
    case 'DOCUMENT_ON_FILE':
      return { text: 'Document on file (unverified)', tone: 'onfile' };
    case 'NONE':
    default:
      return { text: 'Not provided', tone: 'muted' };
  }
}

/**
 * Firearm-violation attestation label. This is ALWAYS phrased as a
 * self-attestation and NEVER as a background check.
 */
export function firearmAttestationLabel(attested: boolean): string {
  return attested
    ? 'Self-attested — no third-party background check'
    : 'Not attested';
}

/**
 * Reputation shell. Brick 1 has no review engine, so every profile with zero
 * completed leases reads "New — unproven". There is NO numeric score, ever.
 */
export function reputationLabel(completedLeaseCount: number): {
  headline: string;
  sub: string;
} {
  if (completedLeaseCount > 0) {
    // Future review engine will refine this; for now just an honest count.
    return {
      headline: `${completedLeaseCount} completed ${
        completedLeaseCount === 1 ? 'lease' : 'leases'
      } through TFP`,
      sub: 'Reviews coming soon.',
    };
  }
  return {
    headline: 'New — unproven',
    sub: 'No completed leases through TFP yet.',
  };
}

// ─── Validation for the create/edit form / save API ────────────────────────

// For MVP the form only offers NONE or SELF_ATTESTED (no uploader). We accept
// DOCUMENT_ON_FILE in the schema for forward-compat but the form never sends
// it.
const credentialLevelSchema = z.enum(['NONE', 'SELF_ATTESTED', 'DOCUMENT_ON_FILE']);

export const hunterReferenceSchema = z.object({
  name: z.string().trim().max(120).optional().or(z.literal('')),
  relationship: z.string().trim().max(120).optional().or(z.literal('')),
  contact: z.string().trim().max(200).optional().or(z.literal('')),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

export const hunterProfileSchema = z.object({
  // Disclosure
  groupSize: z.number().int().min(1).max(50).nullable().optional(),
  hasKidsFamily: z.boolean().nullable().optional(),
  footprint: z.enum(['DAY_HUNT', 'TENT', 'TRAILER', 'RV']).nullable().optional(),
  needsPowerHookup: z.boolean().nullable().optional(),
  needsWaterHookup: z.boolean().nullable().optional(),
  hasATV: z.boolean().nullable().optional(),

  // Credentials
  huntingLicense: credentialLevelSchema.optional(),
  hunterEd: credentialLevelSchema.optional(),
  liabilityInsurance: credentialLevelSchema.optional(),
  mdcPermits: credentialLevelSchema.optional(),

  // Safety gate
  firearmAttestation: z.boolean().optional(),

  // References (optional)
  references: z.array(hunterReferenceSchema).max(5).optional(),

  // Bio
  bio: z.string().trim().max(2000).optional().or(z.literal('')),

  // Visibility
  visible: z.boolean().optional(),
});

export type HunterProfileInput = z.infer<typeof hunterProfileSchema>;

/**
 * A profile is eligible to appear in owner browse ONLY when the hunter has
 * chosen to be visible AND affirmatively self-attested the firearm-violation
 * item (the affirmative-claim hard gate, per Brick 1 requirement #1).
 */
export function isBrowseEligible(p: {
  visible: boolean;
  firearmAttestation: boolean;
}): boolean {
  return p.visible === true && p.firearmAttestation === true;
}
