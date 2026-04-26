/**
 * Waitlist helpers + zod schemas.
 *
 * Used by:
 *   - app/api/waitlist/route.ts        (POST validation + idempotent upsert)
 *   - app/lease-your-land/_form/...    (LANDOWNER side)
 *   - app/find-a-lease/_form/...       (HUNTER side)
 *   - __tests__/waitlist-validation.test.ts
 *   - __tests__/waitlist-api.test.ts
 */
import { z } from 'zod';

export const WAITLIST_SIDES = ['LANDOWNER', 'HUNTER'] as const;
export type WaitlistSide = (typeof WAITLIST_SIDES)[number];

export const SEASON_OPTIONS = ['bow', 'rifle', 'muzzleloader', 'youth'] as const;
export type SeasonOption = (typeof SEASON_OPTIONS)[number];

// 2-letter US state code (uppercase).
const stateCode = z
  .string()
  .trim()
  .length(2, 'State must be a 2-letter code')
  .regex(/^[A-Za-z]{2}$/u, 'State must be a 2-letter code')
  .transform((s) => s.toUpperCase());

// Email: trimmed, lowercased, RFC-ish.
const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Invalid email address')
  .max(254, 'Email is too long')
  .transform((s) => s.toLowerCase());

// Convert empty strings (from form submission) to undefined so optional()
// passes. Without this, an empty <input> sends "" which Zod treats as a
// real value and rejects against numeric/length constraints.
const emptyToUndef = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), s);

// Numeric coercion that tolerates form-submitted strings.
const posInt = emptyToUndef(
  z.coerce.number().int().positive().optional(),
);
const posFloat = emptyToUndef(
  z.coerce.number().positive().optional(),
);

export const waitlistInputSchema = z
  .object({
    side: z.enum(WAITLIST_SIDES),
    email,
    name: emptyToUndef(z.string().trim().min(1).max(120).optional()),

    // landowner-only
    state: emptyToUndef(stateCode.optional()),
    acres: posFloat,

    // hunter-only
    states: z
      .array(stateCode)
      .max(10, 'At most 10 states')
      .optional()
      .default([]),
    maxBudgetUsd: posInt,
    seasonInterest: z
      .array(z.enum(SEASON_OPTIONS))
      .max(SEASON_OPTIONS.length, 'Invalid season selection')
      .optional()
      .default([]),
    groupSize: posInt,

    // tracking
    source: emptyToUndef(z.string().trim().max(100).optional()),
    utmSource: emptyToUndef(z.string().trim().max(200).optional()),
    utmMedium: emptyToUndef(z.string().trim().max(200).optional()),
    utmCampaign: emptyToUndef(z.string().trim().max(200).optional()),

    notes: emptyToUndef(z.string().trim().max(2000).optional()),
  })
  .strict();

export type WaitlistInput = z.infer<typeof waitlistInputSchema>;

/**
 * Build a `data` payload for `prisma.waitlist.update()` that only includes
 * fields whose new value is non-empty/non-null. We use this on the
 * idempotent (email, side) re-submit path so we never overwrite a value
 * the user previously provided with a now-blank one.
 */
export function nonNullDelta(input: WaitlistInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'side' || k === 'email') continue;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}
