/**
 * Listing utilities.
 *
 * Chunks 1–3:
 *  - Zod schemas for DRAFT-level + PUBLISH-level validation
 *  - Helpers for the 3-step wizard
 *  - OPSEC-clean snapshot helper (NEVER reads centroidLat/centroidLng)
 *  - Slug helpers + public response stripper
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
export type WizardStep = 1 | 2 | 3 | 4;

export const WIZARD_STEPS = [1, 2, 3, 4] as const;

export function getStepFromQuery(stepParam: string | string[] | undefined): WizardStep {
  const raw = Array.isArray(stepParam) ? stepParam[0] : stepParam;
  const n = Number(raw);
  if (n === 2 || n === 3 || n === 4) return n;
  return 1;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// DRAFT-level: only savedPropertyId required (ownerUserId comes from session).
// All wizard step inputs are optional at DRAFT — full required-field validation
// runs at PENDING_REVIEW (chunk 3 / publish).
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

// State code: 2-letter US (AL…WY). Stored on Listing for the public marketplace.
const STATE_CODE = z.string().regex(/^[A-Z]{2}$/, 'State must be a 2-letter code, e.g. "MO"');

// PATCH schema — every field optional, validated piecewise.
// Used at every wizard-step submit and any future autosave.
export const updateListingSchema = z.object({
  // Where (chunk 3 — surfaced in wizard step 2 alongside lease terms)
  state: STATE_CODE.optional().nullable(),
  county: z.string().min(1).max(80).optional().nullable(),

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
// Snapshot helper (chunk 3: invoked from POST /api/listings/:id/publish)
//
// This is the ONLY function in the codebase that reads SavedProperty fields
// onto a Listing. By design it ONLY destructures the OPSEC-safe SavedProperty
// fields. It MUST NOT read centroidLat or centroidLng, and the introspection
// test in __tests__/listing-opsec.test.ts asserts the source of THIS function
// does not contain those identifiers.
//
// state and county DO NOT come from SavedProperty (it has no such columns;
// only centroidLat/centroidLng + parcels JSON, neither of which we want here).
// state and county are owner-supplied via the wizard PATCH, and the publish
// endpoint validates they are present before transitioning out of DRAFT.
// ---------------------------------------------------------------------------
export function snapshotFromSavedProperty(sp: SavedProperty): {
  acres: Listing['acres'];
  terrainScore: Listing['terrainScore'];
  primaryMovement: Listing['primaryMovement'];
  bedAcres: Listing['bedAcres'];
  funnelCount: Listing['funnelCount'];
  savedPropertyUpdatedAt: Listing['savedPropertyUpdatedAt'];
} {
  return {
    acres: sp.totalAcres ?? null,
    terrainScore: sp.terrainScore ?? null,
    primaryMovement: sp.primaryMovement ?? null,
    bedAcres: sp.bedAcres ?? null,
    funnelCount: sp.funnelCount ?? null,
    savedPropertyUpdatedAt: sp.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Publish-level validation
//
// Used by POST /api/listings/:id/publish to guarantee a listing has every
// required field before transitioning out of DRAFT. Each rule maps to a
// single field error so the UI can surface it inline.
// ---------------------------------------------------------------------------
export interface PublishCandidate {
  savedPropertyId: string | null;
  state: string | null;
  county: string | null;
  acres: number | null;
  askingPriceMin: number | null;
  askingPriceMax: number | null;
  leaseType: string | null;
  huntersMax: number | null;
  seasonAvailability: string[] | null;
  description: string | null;
  photos: string[] | null;
  contactMethod: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface PublishValidationError {
  field: string;
  message: string;
}

export function validateForPublish(c: PublishCandidate): PublishValidationError[] {
  const errs: PublishValidationError[] = [];

  if (!c.savedPropertyId) errs.push({ field: 'savedPropertyId', message: 'Anchored Saved Property is required' });
  if (!c.state) errs.push({ field: 'state', message: 'State is required' });
  if (!c.county) errs.push({ field: 'county', message: 'County is required' });
  if (c.acres == null) errs.push({ field: 'acres', message: 'Acres must be set (snapshot from Saved Property)' });

  if (c.askingPriceMin == null || c.askingPriceMin <= 0) {
    errs.push({ field: 'askingPriceMin', message: 'Asking price minimum is required and must be > 0' });
  }
  if (c.askingPriceMax == null || c.askingPriceMax <= 0) {
    errs.push({ field: 'askingPriceMax', message: 'Asking price maximum is required and must be > 0' });
  } else if (c.askingPriceMin != null && c.askingPriceMax < c.askingPriceMin) {
    errs.push({ field: 'askingPriceMax', message: 'Asking price maximum must be ≥ minimum' });
  }

  if (!c.leaseType) errs.push({ field: 'leaseType', message: 'Lease type is required' });
  if (c.huntersMax == null || c.huntersMax <= 0) {
    errs.push({ field: 'huntersMax', message: 'Max hunters must be > 0' });
  }

  if (!c.seasonAvailability || c.seasonAvailability.length === 0) {
    errs.push({ field: 'seasonAvailability', message: 'At least one season is required' });
  }

  if (!c.description || c.description.trim().length < 30) {
    errs.push({ field: 'description', message: 'Description must be at least 30 characters' });
  }

  if (!c.photos || c.photos.length === 0) {
    errs.push({ field: 'photos', message: 'At least one photo URL is required' });
  }

  if (!c.contactMethod) {
    errs.push({ field: 'contactMethod', message: 'Contact method is required' });
  } else {
    const needsEmail = c.contactMethod === 'EMAIL_RELAY' || c.contactMethod === 'BOTH';
    const needsPhone = c.contactMethod === 'PHONE' || c.contactMethod === 'BOTH';
    if (needsEmail && !c.contactEmail) {
      errs.push({ field: 'contactEmail', message: 'Contact email required for the chosen contact method' });
    }
    if (needsPhone && !c.contactPhone) {
      errs.push({ field: 'contactPhone', message: 'Contact phone required for the chosen contact method' });
    }
  }

  return errs;
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
// stored. Public marketplace pages and the owner dashboard both use this so
// the grade letter never drifts from the score.
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

// Build a kebab slug from listing snapshot fields. Used as the public URL
// path: /listings/<slug>-<id>. The slug is purely cosmetic / SEO; lookup
// always happens by id.
export function listingSlug(l: Pick<Listing, 'state' | 'county' | 'acres' | 'terrainScore' | 'leaseType'>): string {
  const grade = gradeFromScore(l.terrainScore).toLowerCase().replace('+', '-plus').replace('\u2014', 'na');
  const parts: string[] = [];
  if (l.state) parts.push(l.state.toLowerCase());
  if (l.county) parts.push(l.county.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  if (l.acres != null) parts.push(`${Math.round(l.acres)}ac`);
  if (grade && grade !== 'na') parts.push(grade);
  if (l.leaseType) parts.push(l.leaseType.toLowerCase().replace(/_/g, '-'));
  const cleaned = parts.filter(Boolean).join('-');
  return cleaned || 'listing';
}

// Extract the cuid id from a `:slug-:id` route param. Returns null if no
// trailing cuid is found. Cuids start with 'c' and are 24+ chars [a-z0-9].
export function extractIdFromSlugId(slugId: string): string | null {
  // Try splitting on hyphens; the last segment should be the cuid.
  const idx = slugId.lastIndexOf('-');
  const candidate = idx === -1 ? slugId : slugId.slice(idx + 1);
  if (/^c[a-z0-9]{24,}$/.test(candidate)) return candidate;
  return null;
}

// ---------------------------------------------------------------------------
// OPSEC: Public response filter
//
// Before serializing a Listing for any non-owner viewer (public marketplace,
// public detail page, og: metadata, etc.) we strip every key whose name
// matches a precise-location pattern. This is belt-and-suspenders: the
// schema already has no such columns, and the strict-allowlist updateListingSchema
// rejects them at write-time, but if a sibling include or future migration ever
// introduced one this filter would still catch it before HTML hits the wire.
// ---------------------------------------------------------------------------
const PUBLIC_FORBIDDEN_KEY = /lat|lng|long|geom|polygon|address|coord|parcel/i;

export function stripForPublic<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (PUBLIC_FORBIDDEN_KEY.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = stripForPublic(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as Partial<T>;
}

// Inverse of gradeFromScore: given a letter grade, return the minimum
// terrainScore that maps to that grade. Used by public marketplace filters
// ("min grade A-" \u2192 terrainScore >= 80). Returns 0 for unknown grades, so
// the filter degrades gracefully to "no constraint" rather than blocking
// listings that have no score yet.
export function gradeMinScore(grade: string): number {
  switch (grade.toUpperCase()) {
    case 'A+':
      return 90;
    case 'A':
      return 85;
    case 'A-':
      return 80;
    case 'B+':
      return 75;
    case 'B':
      return 70;
    case 'B-':
      return 65;
    case 'C+':
      return 60;
    case 'C':
      return 55;
    case 'C-':
      return 50;
    default:
      return 0;
  }
}