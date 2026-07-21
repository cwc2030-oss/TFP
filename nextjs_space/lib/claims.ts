/**
 * Landowner claim — soft owner-name matching.
 *
 * When a user claims a parcel we compare their account name against the Regrid
 * owner-of-record. This is a LIGHT, honest soft-verification only — never a
 * legal/hard check. It decides between two states:
 *
 *   MATCHED  — the names line up with reasonable confidence. The parcel becomes
 *              the user's own ground: always free to read + flagged listable.
 *   PENDING  — anything less than a confident personal-name match, INCLUDING
 *              every entity owner (LLC / trust / estate / church / county / etc.).
 *              We never silently grant free/listable; the UI says "pending
 *              verification" and a human/hard check resolves it before any money.
 *
 * Honesty discipline (mirrors CredentialLevel): we never claim more than we
 * checked. A soft match is NOT "Verified Owner."
 */

export type OwnerMatch = 'MATCHED' | 'PENDING';

// Tokens that mark an owner-of-record as a non-person entity. Entities can NEVER
// soft-match to a personal name — they always go PENDING for a human hard-check
// (is this claimant a member/trustee/officer of the entity?).
const ENTITY_TOKENS = [
  'LLC', 'L L C', 'INC', 'CORP', 'CO', 'COMPANY', 'LP', 'LLP', 'LTD',
  'TRUST', 'TRUSTEE', 'TRUSTEES', 'TR', 'ESTATE', 'EST', 'REVOCABLE', 'LIVING',
  'FAMILY', 'FARMS', 'FARM', 'RANCH', 'PROPERTIES', 'PROPERTY', 'HOLDINGS',
  'PARTNERSHIP', 'PARTNERS', 'ASSOCIATION', 'ASSN', 'CHURCH', 'MINISTRIES',
  'COUNTY', 'CITY', 'STATE', 'FEDERAL', 'USA', 'CONSERVATION', 'DEPARTMENT',
  'DEPT', 'DISTRICT', 'BANK', 'ENTERPRISES', 'GROUP', 'INVESTMENTS', 'FUND',
];

// Noise tokens stripped before comparing personal names.
const NOISE_TOKENS = new Set([
  'ET', 'AL', 'ETAL', 'ETUX', 'ETVIR', 'JR', 'SR', 'II', 'III', 'IV',
  'MR', 'MRS', 'MS', 'DR', 'AND', 'THE', 'OR',
]);

function normalize(raw: string): string {
  return (raw || '')
    .toUpperCase()
    .replace(/[.,;:'"`]/g, ' ')
    .replace(/[^A-Z0-9 &-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isEntityOwner(owner: string): boolean {
  const norm = normalize(owner);
  if (!norm) return false;
  const tokens = new Set(norm.split(' '));
  return ENTITY_TOKENS.some((t) => tokens.has(t));
}

function nameTokens(raw: string): string[] {
  return normalize(raw)
    .split(' ')
    .filter((t) => t.length >= 2 && !NOISE_TOKENS.has(t) && !/^\d+$/.test(t));
}

/**
 * Decide MATCHED vs PENDING for a claim.
 *
 * Rules (conservative — bias to PENDING when unsure):
 *  - Missing claimant name or owner-of-record  -> PENDING.
 *  - Owner-of-record is an entity (LLC/trust/…) -> PENDING (needs hard check).
 *  - Personal name match: the claimant's SURNAME must appear among the owner
 *    tokens AND at least one more claimant token (given name/initial) must also
 *    appear. Handles "LAST FIRST" and "FIRST LAST" orderings since we compare
 *    token sets. Otherwise -> PENDING.
 */
export function matchOwnerName(
  claimantName: string | null | undefined,
  ownerOfRecord: string | null | undefined,
): OwnerMatch {
  const claimant = (claimantName || '').trim();
  const owner = (ownerOfRecord || '').trim();
  if (!claimant || !owner) return 'PENDING';
  if (owner.toUpperCase() === 'UNKNOWN' || owner.toUpperCase() === 'UNKNOWN OWNER') return 'PENDING';
  if (isEntityOwner(owner)) return 'PENDING';

  const cTokens = nameTokens(claimant);
  const oTokens = new Set(nameTokens(owner));
  if (cTokens.length < 2 || oTokens.size < 2) return 'PENDING';

  const overlap = cTokens.filter((t) => oTokens.has(t));
  // Require at least two overlapping name tokens (typically surname + given).
  return overlap.length >= 2 ? 'MATCHED' : 'PENDING';
}
