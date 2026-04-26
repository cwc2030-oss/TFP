/**
 * Listing utilities.
 *
 * Chunk 1 scope:
 *  - Zod schemas for DRAFT-level validation
 *  - Helpers for the 3-step wizard
 *  - OPSEC-clean snapshot stub (NEVER reads centroidLat/centroidLng)
 *
 * OPSEC: The snapshot helper below is intentionally narrow. It is the ONE
 * place where SavedProperty data flows onto a Listing row, so it is also
 * where we MUST guarantee no precise-location field can leak.
 */
import { z } from 'zod';
import type { Listing, SavedProperty } from '@prisma/client';

// ---------------------------------------------------------------------------
// Wizard step typing
// ---------------------------------------------------------------------------
export type WizardStep = 1 | 2 | 3;

export const WIZARD_STEPS = [1, 2, 3] as const;

export function getStepFromQuery(stepParam: string | string[] | undefined): WizardStep {
  const raw = Array.isArray(stepParam) ? stepParam[0] : stepParam;
  const n = Number(raw);
  if (n === 2 || n === 3) return n;
  return 1;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// DRAFT-level: only savedPropertyId required (ownerUserId comes from session).
// All wizard step inputs are optional at DRAFT — full required-field validation
// runs at PENDING_REVIEW (chunk 3).
export const createListingSchema = z.object({
  savedPropertyId: z.string().min(1, 'savedPropertyId required'),
});

export const LEASE_TYPES = [
  'ANNUAL',
  'SEASON_FULL',
  'RIFLE_ONLY',
  'BOW_ONLY',
  'YOUTH',
  'OTHER',
] as const;

export const CONTACT_METHODS = ['EMAIL_RELAY', 'PHONE', 'BOTH'] as const;

export const SEASON_OPTIONS = ['bow', 'rifle', 'muzzleloader', 'youth'] as const;

export const AMENITY_KEYS = [
  'water',
  'foodPlots',
  'parking',
  'lodging',
  'atvAccess',
  'electricity',
] as const;

export const amenitiesSchema = z.object({
  water: z.boolean().optional(),
  foodPlots: z.boolean().optional(),
  parking: z.boolean().optional(),
  lodging: z.boolean().optional(),
  atvAccess: z.boolean().optional(),
  electricity: z.boolean().optional(),
}).strict();

// PATCH schema — every field optional, validated piecewise.
// Used at every wizard-step submit and any future autosave.
export const updateListingSchema = z.object({
  // Step 2: lease terms
  askingPriceMin: z.number().int().positive().optional().nullable(),
  askingPriceMax: z.number().int().positive().optional().nullable(),
  leaseType: z.enum(LEASE_TYPES).optional().nullable(),
  huntersMax: z.number().int().positive().max(50).optional().nullable(),
  seasonAvailability: z.array(z.enum(SEASON_OPTIONS)).optional(),
  amenities: amenitiesSchema.optional().nullable(),

  // Step 3: listing content + contact
  title: z.string().max(120).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  photos: z
    .array(z.string().url())
    .max(6)
    .refine((arr) => arr.every((p) => p.includes('listings/')), {
      message: 'photos must use listings/ prefix',
    })
    .optional(),
  contactMethod: z.enum(CONTACT_METHODS).optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().max(32).optional().nullable(),
}).strict()
  .refine(
    (d) =>
      d.askingPriceMin == null ||
      d.askingPriceMax == null ||
      d.askingPriceMax >= d.askingPriceMin,
    {
      message: 'askingPriceMax must be >= askingPriceMin',
      path: ['askingPriceMax'],
    },
  );

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

// ---------------------------------------------------------------------------
// Snapshot helper (chunk 1: stub. chunk 3 uses this on PUBLISH transition)
//
// This is the ONLY function in the codebase that reads SavedProperty
// fields onto a Listing. By design it ONLY destructures the OPSEC-safe
// fields. It MUST NOT read centroidLat or centroidLng.
//
// The introspection test in __tests__/opsec.test.ts asserts the source of
// THIS function does not contain those identifiers.
// ---------------------------------------------------------------------------
export function snapshotFromSavedProperty(sp: SavedProperty): Pick<
  Listing,
  | 'state'
  | 'county'
  | 'acres'
  | 'terrainScore'
  | 'primaryMovement'
  | 'bedAcres'
  | 'funnelCount'
  | 'savedPropertyUpdatedAt'
> {
  // Only OPSEC-safe fields. State/county will be derived from the
  // SavedProperty's parcels JSON in chunk 3 (Regrid lookup); for now
  // we return null for those and let the form capture them manually if
  // needed at PUBLISH time.
  return {
    state: null,
    county: null,
    acres: sp.totalAcres ?? null,
    terrainScore: sp.terrainScore ?? null,
    primaryMovement: sp.primaryMovement ?? null,
    bedAcres: sp.bedAcres ?? null,
    funnelCount: sp.funnelCount ?? null,
    savedPropertyUpdatedAt: sp.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
export function listingTitleFallback(l: Pick<Listing, 'title' | 'acres' | 'county' | 'state'>): string {
  if (l.title && l.title.trim().length > 0) return l.title;
  const parts: string[] = [];
  if (l.acres != null) parts.push(`${Math.round(l.acres)} ac`);
  const region = [l.county, l.state].filter(Boolean).join(', ');
  if (region) parts.push(`in ${region}`);
  return parts.length > 0 ? parts.join(' ') : 'Untitled Listing';
}

// Derived A+ / A / B+ ... grade from terrainScore. Pure render-time, never
// stored. Public marketplace pages (chunk 4) and the owner dashboard both
// use this so the grade letter never drifts from the score.
export function gradeFromScore(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return '\u2014';
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'B-';
  if (score >= 60) return 'C+';
  if (score >= 55) return 'C';
  return 'C-';
}
