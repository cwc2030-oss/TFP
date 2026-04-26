/**
 * Zod schema tests for waitlistInputSchema.
 *
 * Pure unit tests — no DB. Validates side+email required, email format,
 * 2-letter state coercion, optional numeric coercion, default empty arrays.
 */
import { describe, it, expect } from 'vitest';
import { waitlistInputSchema, nonNullDelta } from '../lib/waitlist';

describe('waitlistInputSchema', () => {
  it('accepts the minimum payload (LANDOWNER)', () => {
    const result = waitlistInputSchema.safeParse({
      side: 'LANDOWNER',
      email: 'A.B+test@Example.COM',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('a.b+test@example.com');
      expect(result.data.states).toEqual([]);
      expect(result.data.seasonInterest).toEqual([]);
    }
  });

  it('accepts the minimum payload (HUNTER)', () => {
    const result = waitlistInputSchema.safeParse({
      side: 'HUNTER',
      email: 'h@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when side is missing', () => {
    const result = waitlistInputSchema.safeParse({ email: 'a@b.com' });
    expect(result.success).toBe(false);
  });

  it('rejects when side is unknown', () => {
    const result = waitlistInputSchema.safeParse({
      side: 'BROKER',
      email: 'a@b.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when email is missing', () => {
    const result = waitlistInputSchema.safeParse({ side: 'LANDOWNER' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email shape', () => {
    const result = waitlistInputSchema.safeParse({
      side: 'LANDOWNER',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('uppercases a 2-letter state and accepts it', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'LANDOWNER',
      email: 'a@b.com',
      state: 'mo',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.state).toBe('MO');
  });

  it('rejects a 3-letter state', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'LANDOWNER',
      email: 'a@b.com',
      state: 'MOO',
    });
    expect(r.success).toBe(false);
  });

  it('coerces a string numeric acres to number', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'LANDOWNER',
      email: 'a@b.com',
      acres: '120',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.acres).toBe(120);
  });

  it('rejects a negative acres', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'LANDOWNER',
      email: 'a@b.com',
      acres: -5,
    });
    expect(r.success).toBe(false);
  });

  it('treats empty-string optional fields as undefined', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'HUNTER',
      email: 'a@b.com',
      name: '',
      state: '',
      acres: '',
      maxBudgetUsd: '',
      groupSize: '',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBeUndefined();
      expect(r.data.state).toBeUndefined();
      expect(r.data.acres).toBeUndefined();
      expect(r.data.maxBudgetUsd).toBeUndefined();
      expect(r.data.groupSize).toBeUndefined();
    }
  });

  it('rejects unknown top-level fields (strict)', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'HUNTER',
      email: 'a@b.com',
      latitude: 38.5,  // OPSEC: lat/lng must NEVER be accepted
    } as any);
    expect(r.success).toBe(false);
  });

  it('rejects unknown season values', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'HUNTER',
      email: 'a@b.com',
      seasonInterest: ['bow', 'crossbow'],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a multi-state hunter payload', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'HUNTER',
      email: 'a@b.com',
      states: ['mo', 'KS', 'AR'],
      maxBudgetUsd: 3000,
      seasonInterest: ['bow', 'rifle'],
      groupSize: 4,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.states).toEqual(['MO', 'KS', 'AR']);
      expect(r.data.maxBudgetUsd).toBe(3000);
      expect(r.data.seasonInterest).toEqual(['bow', 'rifle']);
      expect(r.data.groupSize).toBe(4);
    }
  });

  it('caps states at 10', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'HUNTER',
      email: 'a@b.com',
      states: ['MO', 'KS', 'AR', 'IA', 'IL', 'KY', 'TN', 'OK', 'NE', 'SD', 'WI'],
    });
    expect(r.success).toBe(false);
  });

  it('captures source and utm fields when provided', () => {
    const r = waitlistInputSchema.safeParse({
      side: 'LANDOWNER',
      email: 'a@b.com',
      source: 'lease_your_land_landing',
      utmSource: 'facebook',
      utmMedium: 'cpc',
      utmCampaign: 'launch_2026',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.source).toBe('lease_your_land_landing');
      expect(r.data.utmSource).toBe('facebook');
      expect(r.data.utmMedium).toBe('cpc');
      expect(r.data.utmCampaign).toBe('launch_2026');
    }
  });
});

describe('nonNullDelta', () => {
  it('omits side and email', () => {
    const out = nonNullDelta({
      side: 'LANDOWNER',
      email: 'a@b.com',
      name: 'Jane',
      states: [],
      seasonInterest: [],
    } as any);
    expect(Object.keys(out)).toEqual(['name']);
  });

  it('omits empty arrays', () => {
    const out = nonNullDelta({
      side: 'HUNTER',
      email: 'a@b.com',
      states: [],
      seasonInterest: ['bow'],
    } as any);
    expect(out.states).toBeUndefined();
    expect(out.seasonInterest).toEqual(['bow']);
  });

  it('omits undefined values', () => {
    const out = nonNullDelta({
      side: 'LANDOWNER',
      email: 'a@b.com',
      acres: undefined,
      state: 'MO',
      states: [],
      seasonInterest: [],
    } as any);
    expect(out.acres).toBeUndefined();
    expect(out.state).toBe('MO');
  });
});
