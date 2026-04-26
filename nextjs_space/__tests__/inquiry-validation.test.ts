/**
 * Inquiry zod schema unit tests — chunk 4 (group 1).
 *
 * Pure schema tests, no DB hits. Verifies:
 *   - .strict() rejects unknown fields (centroidLat / lat / lng / coords)
 *   - hunterName / hunterEmail / message are required
 *   - hunterEmail is normalised to lowercase
 *   - message length 20-2000 chars
 *   - partySize 1-50, defaults to 1
 *   - honeypot field `website` is accepted (presence determines drop, not validity)
 *   - utm fields are optional and capped
 */
import { describe, it, expect } from 'vitest';
import { inquiryInputSchema } from '../lib/inquiry';

const BASE = {
  hunterName: 'Test Hunter',
  hunterEmail: 'TEST.Hunter@example.com',
  message: 'I am interested in this lease for the upcoming bow season please give me a call.',
};

describe('inquiryInputSchema (.strict)', () => {
  it('accepts a minimal valid payload, normalises email to lowercase, defaults partySize to 1', () => {
    const r = inquiryInputSchema.safeParse(BASE);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.hunterEmail).toBe('test.hunter@example.com');
      expect(r.data.partySize).toBe(1);
    }
  });

  it('trims whitespace on string fields', () => {
    const r = inquiryInputSchema.safeParse({
      ...BASE,
      hunterName: '   Trimmed Hunter   ',
      message: '   ' + BASE.message + '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.hunterName).toBe('Trimmed Hunter');
      expect(r.data.message.startsWith('I am interested')).toBe(true);
    }
  });

  it('rejects unknown fields (centroidLat) — OPSEC: no precise location ever', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, centroidLat: 38.5 });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields (lat / lng / coords / parcel)', () => {
    for (const k of ['lat', 'lng', 'long', 'coords', 'parcel', 'address', 'geom']) {
      const r = inquiryInputSchema.safeParse({ ...BASE, [k]: 'leak' });
      expect(r.success).toBe(false);
    }
  });

  it('rejects when hunterName missing', () => {
    const { hunterName, ...rest } = BASE;
    void hunterName;
    const r = inquiryInputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects when hunterEmail missing', () => {
    const { hunterEmail, ...rest } = BASE;
    void hunterEmail;
    const r = inquiryInputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects invalid hunterEmail', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, hunterEmail: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('rejects when message missing', () => {
    const { message, ...rest } = BASE;
    void message;
    const r = inquiryInputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects message under 20 chars', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, message: 'too short' });
    expect(r.success).toBe(false);
  });

  it('rejects message over 2000 chars', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, message: 'a'.repeat(2001) });
    expect(r.success).toBe(false);
  });

  it('accepts message at exactly 2000 chars', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, message: 'a'.repeat(2000) });
    expect(r.success).toBe(true);
  });

  it('rejects partySize below 1', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, partySize: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects partySize above 50', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, partySize: 51 });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer partySize', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, partySize: 2.5 });
    expect(r.success).toBe(false);
  });

  it('accepts honeypot field `website` (presence determines drop, not validity)', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, website: 'http://spam.example' });
    expect(r.success).toBe(true);
  });

  it('accepts optional phone, preferred dates, source, utms', () => {
    const r = inquiryInputSchema.safeParse({
      ...BASE,
      hunterPhone: '555-123-4567',
      preferredDates: 'Nov 1 - Nov 14',
      source: 'listing_detail',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'rut2026',
    });
    expect(r.success).toBe(true);
  });

  it('rejects phone shorter than 7 chars', () => {
    const r = inquiryInputSchema.safeParse({ ...BASE, hunterPhone: '12345' });
    expect(r.success).toBe(false);
  });
});
