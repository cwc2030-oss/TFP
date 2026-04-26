/**
 * DRAFT-level validation tests for chunk 1.
 *
 * Per spec:
 *   - DRAFT level (this chunk): only reportId + ownerUserId required.
 *     Everything else may be empty/null.
 *
 * In our Option-A schema the FK is savedPropertyId, so the createListingSchema
 * requires only that. ownerUserId is set server-side from the session.
 */
import { describe, it, expect } from 'vitest';
import {
  createListingSchema,
  updateListingSchema,
  gradeFromScore,
  listingTitleFallback,
} from '../lib/listings';

describe('createListingSchema (DRAFT-level)', () => {
  it('accepts a savedPropertyId and nothing else', () => {
    const r = createListingSchema.safeParse({ savedPropertyId: 'sp_abc' });
    expect(r.success).toBe(true);
  });

  it('rejects empty body', () => {
    const r = createListingSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects empty-string savedPropertyId', () => {
    const r = createListingSchema.safeParse({ savedPropertyId: '' });
    expect(r.success).toBe(false);
  });
});

describe('updateListingSchema', () => {
  it('accepts an empty patch (everything optional at DRAFT)', () => {
    const r = updateListingSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts a minimal lease-terms patch', () => {
    const r = updateListingSchema.safeParse({
      askingPriceMin: 1500,
      askingPriceMax: 2500,
      leaseType: 'ANNUAL',
      huntersMax: 4,
      seasonAvailability: ['bow', 'rifle'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid leaseType', () => {
    const r = updateListingSchema.safeParse({ leaseType: 'WEEKLY' });
    expect(r.success).toBe(false);
  });

  it('rejects price min > price max', () => {
    const r = updateListingSchema.safeParse({
      askingPriceMin: 5000,
      askingPriceMax: 1000,
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative price', () => {
    const r = updateListingSchema.safeParse({ askingPriceMin: -100 });
    expect(r.success).toBe(false);
  });

  it('rejects more than 6 photos', () => {
    // Build URLs without using any image-style suffix that might trigger
    // an asset auto-replacement filter on writes.
    const seven = Array.from({ length: 7 }, (_, i) =>
      'https://cdn.example.com/listings/asset-' + i,
    );
    const r = updateListingSchema.safeParse({ photos: seven });
    expect(r.success).toBe(false);
  });

  it('rejects photos missing the listings/ prefix', () => {
    const r = updateListingSchema.safeParse({
      photos: ['https://cdn.example.com/users/asset-x'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields (strict mode)', () => {
    const r = updateListingSchema.safeParse({
      // OPSEC: anything that looks like a precise-location leak must be rejected.
      centroidLat: 38.5,
      centroidLng: -94.1,
    } as any);
    expect(r.success).toBe(false);
  });

  it('rejects description over 500 chars', () => {
    const long = 'a'.repeat(501);
    const r = updateListingSchema.safeParse({ description: long });
    expect(r.success).toBe(false);
  });

  it('accepts description at exactly 500 chars', () => {
    const exact = 'a'.repeat(500);
    const r = updateListingSchema.safeParse({ description: exact });
    expect(r.success).toBe(true);
  });
});

describe('gradeFromScore', () => {
  it.each([
    [95, 'A+'],
    [90, 'A+'],
    [89, 'A'],
    [85, 'A'],
    [84, 'A-'],
    [80, 'A-'],
    [79, 'B+'],
    [75, 'B+'],
    [74, 'B'],
    [70, 'B'],
    [50, 'C-'],
  ])('gradeFromScore(%i) === %s', (score, expected) => {
    expect(gradeFromScore(score)).toBe(expected);
  });

  it('returns em-dash for null score', () => {
    expect(gradeFromScore(null)).toBe('\u2014');
  });
});

describe('listingTitleFallback', () => {
  it('uses the title when present', () => {
    expect(
      listingTitleFallback({
        title: 'My Lease',
        acres: 200,
        county: 'Cass',
        state: 'MO',
      }),
    ).toBe('My Lease');
  });

  it('falls back to acres + county + state', () => {
    expect(
      listingTitleFallback({
        title: null,
        acres: 200,
        county: 'Cass',
        state: 'MO',
      }),
    ).toBe('200 ac in Cass, MO');
  });

  it('renders "Untitled Listing" with no fields', () => {
    expect(
      listingTitleFallback({
        title: null,
        acres: null,
        county: null,
        state: null,
      }),
    ).toBe('Untitled Listing');
  });
});
