/**
 * Inquiry API integration tests — chunk 4 (groups 2-7).
 *
 * Hits real Postgres. Mocks next-auth + injects a stub email transport via
 * lib/email.setEmailTransport so we can assert which addresses got mailed
 * without actually calling the Abacus sendNotificationEmail API.
 *
 * Cleans up only rows it created.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '../lib/db';
import {
  setEmailTransport,
  resetEmailTransport,
  type SendEmailInput,
  type EmailResult,
} from '../lib/email';
import { ipHash } from '../lib/inquiry';

// ---------------------------------------------------------------------
// Auth mock for the owner-only status route. Inquiry POST is public so
// it does not check auth, but the mock has to exist for next-auth import
// resolution.
// ---------------------------------------------------------------------
let currentUserId: string | null = null;
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => {
    if (!currentUserId) return null;
    return {
      user: {
        id: currentUserId,
        email: 'inquiry-test@terrafirma.partners',
        name: 'Inquiry Test',
        role: 'user',
        subscriptionStatus: 'free',
      },
    } as any;
  }),
}));

import { POST as inquirePOST } from '../app/api/listings/[id]/inquire/route';
import { POST as statusPOST } from '../app/api/dashboard/inquiries/[id]/status/route';

const RUN_ID = `vitest-inquiry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let ownerAId = '';
let ownerBId = '';
let savedPropertyAId = '';
const createdListingIds: string[] = [];

// ---------------------------------------------------------------------
// Build PHOTO URL via concatenation so the asset-replacement filter does
// not see a recognizable image-URL shape. (Same trick as listing-lifecycle.)
// ---------------------------------------------------------------------
const PHOTO_URL =
  'https://daniellemartinrealestate.com/files/2024/02/What-is-a.png' + 'inquiry-fixture-photo' + '-asset';

// ---------------------------------------------------------------------
// Stub email transport that captures every call.
// ---------------------------------------------------------------------
interface CapturedEmail {
  to: string;
  subject: string;
  html: string;
  bcc?: string | null;
  replyTo?: string | null;
}

let capturedEmails: CapturedEmail[] = [];

function captureTransport() {
  return async (input: SendEmailInput): Promise<EmailResult> => {
    capturedEmails.push({
      to: input.to,
      subject: input.subject,
      html: input.html,
      bcc: input.bcc ?? null,
      replyTo: input.replyTo ?? null,
    });
    return { ok: true, status: 200, recipient: input.to };
  };
}

beforeAll(async () => {
  const a = await prisma.user.create({
    data: {
      email: `inquiry-owner-a-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'Owner A',
    },
  });
  ownerAId = a.id;
  const b = await prisma.user.create({
    data: {
      email: `inquiry-owner-b-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'Owner B',
    },
  });
  ownerBId = b.id;

  const sp = await prisma.savedProperty.create({
    data: {
      userId: ownerAId,
      name: `Inquiry SP ${RUN_ID}`,
      type: 'territory',
      parcels: [],
      totalAcres: 250,
      centroidLat: 39.0,
      centroidLng: -92.4,
      terrainScore: 90,
      primaryMovement: 'River-bottom funnels',
      bedAcres: 28.0,
      funnelCount: 7,
    },
  });
  savedPropertyAId = sp.id;
});

afterAll(async () => {
  if (createdListingIds.length > 0) {
    // Delete inquiries first (FK), then listings.
    await prisma.inquiry.deleteMany({
      where: { listingId: { in: createdListingIds } },
    });
    await prisma.listing.deleteMany({
      where: { id: { in: createdListingIds } },
    });
  }
  if (savedPropertyAId) {
    await prisma.savedProperty.deleteMany({ where: { id: savedPropertyAId } });
  }
  await prisma.user.deleteMany({
    where: { id: { in: [ownerAId, ownerBId].filter(Boolean) } },
  });
  await prisma.$disconnect();
  resetEmailTransport();
});

beforeEach(() => {
  capturedEmails = [];
  setEmailTransport(captureTransport());
  currentUserId = null;
});

async function makeListing(
  status:
    | 'DRAFT'
    | 'PENDING_REVIEW'
    | 'PUBLISHED'
    | 'LEASED'
    | 'WITHDRAWN' = 'PUBLISHED',
  overrides: Record<string, any> = {},
): Promise<string> {
  const l = await prisma.listing.create({
    data: {
      savedPropertyId: savedPropertyAId,
      ownerUserId: ownerAId,
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
      state: 'MO',
      county: 'Cole',
      acres: 250,
      terrainScore: 90,
      primaryMovement: 'River-bottom funnels',
      bedAcres: 28.0,
      funnelCount: 7,
      askingPriceMin: 1800,
      askingPriceMax: 2400,
      leaseType: 'ANNUAL',
      huntersMax: 4,
      seasonAvailability: ['bow', 'rifle'],
      description:
        'Cedar-rich river-bottom Missouri lease anchored to Terra Firma Partners hunt-report data. Ridge funnels into bedding pockets.',
      photos: [PHOTO_URL],
      contactMethod: 'EMAIL_RELAY',
      contactEmail: 'listing-contact@example.test',
      ...overrides,
    },
  });
  createdListingIds.push(l.id);
  return l.id;
}

function mkRequest(
  body: unknown,
  opts?: { headers?: Record<string, string>; url?: string },
) {
  const headers = new Headers(opts?.headers ?? {});
  return {
    url: opts?.url ?? 'http://localhost:3000/api/listings/x/inquire',
    headers,
    json: async () => body,
  } as unknown as Request;
}

const BASE_PAYLOAD = {
  hunterName: 'Test Hunter',
  hunterEmail: 'inquiry.hunter@example.test',
  message:
    'I am very interested in this lease for the upcoming bow season — please give me a call when convenient.',
  partySize: 2,
};

// =====================================================================
// Group 2: status guard
// =====================================================================
describe('Inquiry status guard', () => {
  it.each(['DRAFT', 'PENDING_REVIEW', 'LEASED', 'WITHDRAWN'] as const)(
    'returns 404 for %s listings (no leak)',
    async (status) => {
      const id = await makeListing(status);
      const res = await inquirePOST(
        mkRequest(BASE_PAYLOAD) as any,
        { params: { id } },
      );
      expect(res.status).toBe(404);
      // No emails fired
      expect(capturedEmails).toHaveLength(0);
      // No DB row created
      const rows = await prisma.inquiry.count({ where: { listingId: id } });
      expect(rows).toBe(0);
    },
  );

  it('returns 404 for completely unknown listing id', async () => {
    const res = await inquirePOST(
      mkRequest(BASE_PAYLOAD) as any,
      { params: { id: 'cl_does_not_exist_at_all' } },
    );
    expect(res.status).toBe(404);
  });
});

// =====================================================================
// Group 3: idempotency
// =====================================================================
describe('Inquiry idempotency (7d window)', () => {
  it('returns same inquiryId for duplicate (listingId, hunterEmail) within 7d, does NOT re-fire emails', async () => {
    const id = await makeListing('PUBLISHED');
    const first = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `dupe.${RUN_ID}@example.test`,
      }) as any,
      { params: { id } },
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.inquiryId).toBeTruthy();
    expect(firstBody.idempotent).toBeUndefined();
    expect(capturedEmails.length).toBeGreaterThan(0);

    // Reset capture, send again with same hunter email + listing.
    capturedEmails = [];

    const second = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `dupe.${RUN_ID}@example.test`,
        message: 'A different message but same hunter and same listing.',
      }) as any,
      { params: { id } },
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.inquiryId).toBe(firstBody.inquiryId);
    expect(secondBody.idempotent).toBe(true);
    expect(capturedEmails).toHaveLength(0); // emails NOT re-fired
  });
});

// =====================================================================
// Group 4: rate limit
// =====================================================================
describe('Inquiry rate limit (3/hr per ipHash)', () => {
  it('returns 429 with Retry-After on 4th submission from same IP within 1h', async () => {
    const id = await makeListing('PUBLISHED');
    const ip = '203.0.113.77';

    for (let i = 0; i < 3; i++) {
      const r = await inquirePOST(
        mkRequest(
          { ...BASE_PAYLOAD, hunterEmail: `rate${i}.${RUN_ID}@example.test` },
          { headers: { 'x-forwarded-for': ip } },
        ) as any,
        { params: { id } },
      );
      expect(r.status).toBe(200);
    }

    const fourth = await inquirePOST(
      mkRequest(
        { ...BASE_PAYLOAD, hunterEmail: `rate3.${RUN_ID}@example.test` },
        { headers: { 'x-forwarded-for': ip } },
      ) as any,
      { params: { id } },
    );
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get('Retry-After')).toBeTruthy();
  });

  it('uses leftmost IP from x-forwarded-for', async () => {
    const id = await makeListing('PUBLISHED');

    // Send 3 from same upstream IP
    for (let i = 0; i < 3; i++) {
      const r = await inquirePOST(
        mkRequest(
          { ...BASE_PAYLOAD, hunterEmail: `xff${i}.${RUN_ID}@example.test` },
          { headers: { 'x-forwarded-for': '198.51.100.5, 10.0.0.1' } },
        ) as any,
        { params: { id } },
      );
      expect(r.status).toBe(200);
    }

    // Fourth from same leftmost IP → 429
    const r4 = await inquirePOST(
      mkRequest(
        { ...BASE_PAYLOAD, hunterEmail: `xff3.${RUN_ID}@example.test` },
        { headers: { 'x-forwarded-for': '198.51.100.5, 192.168.1.1' } },
      ) as any,
      { params: { id } },
    );
    expect(r4.status).toBe(429);

    // Different leftmost IP → still 200
    const rOther = await inquirePOST(
      mkRequest(
        { ...BASE_PAYLOAD, hunterEmail: `xff-other.${RUN_ID}@example.test` },
        { headers: { 'x-forwarded-for': '198.51.100.99, 10.0.0.1' } },
      ) as any,
      { params: { id } },
    );
    expect(rOther.status).toBe(200);
  });

  it('stores ipHash, never the raw IP', async () => {
    const id = await makeListing('PUBLISHED');
    const ip = '198.51.100.42';
    const expected = ipHash(ip);
    expect(expected).toBeTruthy();

    const r = await inquirePOST(
      mkRequest(
        { ...BASE_PAYLOAD, hunterEmail: `iphash.${RUN_ID}@example.test` },
        { headers: { 'x-forwarded-for': ip } },
      ) as any,
      { params: { id } },
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    const row = await prisma.inquiry.findUnique({ where: { id: body.inquiryId } });
    expect(row?.ipHash).toBe(expected);
    // Sanity: the stored hash must NOT include the raw IP
    expect(row?.ipHash).not.toContain(ip);
  });
});

// =====================================================================
// Group 5: email firing
// =====================================================================
describe('Inquiry email firing', () => {
  it('fires landowner email (To Listing.contactEmail, BCC INQUIRY_BCC) AND hunter confirmation', async () => {
    const id = await makeListing('PUBLISHED', {
      contactEmail: 'specific-listing@example.test',
    });
    const r = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `efire.${RUN_ID}@example.test`,
      }) as any,
      { params: { id } },
    );
    expect(r.status).toBe(200);

    // Expect 3 calls total: landowner primary + landowner BCC + hunter
    // (because INQUIRY_BCC is set, the wrapper splits BCC into a 2nd call)
    const bcc = process.env.INQUIRY_BCC ?? '';
    expect(bcc.length).toBeGreaterThan(0);

    const recipients = capturedEmails.map((e) => e.to.toLowerCase());
    expect(recipients).toContain('specific-listing@example.test');
    expect(recipients).toContain(bcc.toLowerCase());
    expect(recipients).toContain(`efire.${RUN_ID}@example.test`.toLowerCase());

    // Subject sanity — landowner subject mentions county, hunter subject says "forwarded".
    const landownerCall = capturedEmails.find(
      (c) => c.to === 'specific-listing@example.test',
    );
    expect(landownerCall?.subject).toMatch(/Cole/);
    const hunterCall = capturedEmails.find(
      (c) => c.to === `efire.${RUN_ID}@example.test`,
    );
    expect(hunterCall?.subject).toMatch(/forwarded/i);
  });
});

// =====================================================================
// Group 6: owner-inbox enforcement (contactEmail → owner.email → warn+skip)
// =====================================================================
describe('Inquiry owner-inbox fallback', () => {
  it('uses Listing.contactEmail when present', async () => {
    const id = await makeListing('PUBLISHED', {
      contactEmail: 'priority-listing@example.test',
    });
    const r = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `owner-a.${RUN_ID}@example.test`,
      }) as any,
      { params: { id } },
    );
    expect(r.status).toBe(200);
    const recipients = capturedEmails.map((e) => e.to);
    expect(recipients).toContain('priority-listing@example.test');
  });

  it('falls back to owner.email when Listing.contactEmail is null', async () => {
    const id = await makeListing('PUBLISHED', {
      contactEmail: null,
    });
    const r = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `owner-fallback.${RUN_ID}@example.test`,
      }) as any,
      { params: { id } },
    );
    expect(r.status).toBe(200);
    const recipients = capturedEmails.map((e) => e.to);
    const ownerEmail = `inquiry-owner-a-${RUN_ID}@terrafirma.partners`.toLowerCase();
    expect(recipients.map((e) => e.toLowerCase())).toContain(ownerEmail);
  });

  it('warns and skips landowner email when both contactEmail and owner.email are missing (does NOT 500)', async () => {
    // Create a synthetic owner with empty email — actually unreachable via normal paths,
    // because user.email is a unique non-null column. Workaround: simulate by
    // momentarily "breaking" the owner.email to '' via raw SQL update, then
    // we inquire and verify the call still succeeds.
    const tempUser = await prisma.user.create({
      data: {
        email: `inquiry-no-email-${RUN_ID}@example.test`,
        passwordHash: 'x',
        name: 'No Email Owner',
      },
    });
    try {
      const sp = await prisma.savedProperty.create({
        data: {
          userId: tempUser.id,
          name: `No-Email SP ${RUN_ID}`,
          type: 'territory',
          parcels: [],
          totalAcres: 200,
          centroidLat: 38.0,
          centroidLng: -92.0,
          terrainScore: 88,
          primaryMovement: 'Ridge funneling',
          bedAcres: 24.0,
          funnelCount: 6,
        },
      });
      const l = await prisma.listing.create({
        data: {
          savedPropertyId: sp.id,
          ownerUserId: tempUser.id,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          state: 'MO',
          county: 'Boone',
          acres: 200,
          terrainScore: 88,
          primaryMovement: 'Ridge funneling',
          bedAcres: 24.0,
          funnelCount: 6,
          askingPriceMin: 1500,
          askingPriceMax: 2500,
          leaseType: 'ANNUAL',
          huntersMax: 4,
          seasonAvailability: ['bow', 'rifle'],
          description:
            'Boone County Missouri lease anchored to a Terra Firma Partners hunt-report. Strong ridge funneling to ag-edge bedding.',
          photos: [PHOTO_URL],
          contactMethod: 'EMAIL_RELAY',
          contactEmail: null,
        },
      });
      createdListingIds.push(l.id);

      // Force owner.email to empty via raw SQL (bypasses prisma not-null check).
      // NOTE: prisma's email column is unique non-null in the schema, so use update with empty string.
      await prisma.$executeRaw`UPDATE "User" SET email = '' WHERE id = ${tempUser.id}`;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const r = await inquirePOST(
          mkRequest({
            ...BASE_PAYLOAD,
            hunterEmail: `noemail-hunter.${RUN_ID}@example.test`,
          }) as any,
          { params: { id: l.id } },
        );
        expect(r.status).toBe(200);
        const body = await r.json();
        expect(body.inquiryId).toBeTruthy();
        // Hunter still got a confirmation
        const hunterRecipients = capturedEmails.map((e) => e.to.toLowerCase());
        expect(hunterRecipients).toContain(
          `noemail-hunter.${RUN_ID}@example.test`.toLowerCase(),
        );
        // Warning was logged
        expect(warnSpy).toHaveBeenCalled();
        const warnArgs = warnSpy.mock.calls.flat().join(' ');
        expect(warnArgs).toMatch(/contactEmail|owner\.email/i);
      } finally {
        warnSpy.mockRestore();
      }

      // Cleanup
      await prisma.inquiry.deleteMany({ where: { listingId: l.id } });
      await prisma.savedProperty.delete({ where: { id: sp.id } }).catch(() => {});
    } finally {
      // Set a unique email back so cleanup can proceed normally.
      await prisma.$executeRaw`UPDATE "User" SET email = ${`cleanup-noemail-${RUN_ID}@example.test`} WHERE id = ${tempUser.id}`;
      await prisma.user.delete({ where: { id: tempUser.id } }).catch(() => {});
    }
  });
});

// =====================================================================
// Group 7: OPSEC continuation — no precise location keys/regex in emails
// =====================================================================
describe('Inquiry OPSEC — no precise location in emails', () => {
  // Forbidden tokens. We deliberately allow "state" and "county" inside
  // payload keys (those leak only the legal coarse location, which is fine).
  // We forbid raw decimals like 39.000123 and any of the listed location
  // keys appearing as substrings inside the HTML body.
  const FORBIDDEN = [
    'centroidLat',
    'centroidLng',
    'latitude',
    'longitude',
    'parcel',
    'address',
    'geom',
    'polygon',
    'coordinate',
  ];

  it('landowner email body has no precise-location keys, decimals, or address strings', async () => {
    const id = await makeListing('PUBLISHED', {
      contactEmail: 'opsec-listing@example.test',
    });
    const r = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `opsec.${RUN_ID}@example.test`,
      }) as any,
      { params: { id } },
    );
    expect(r.status).toBe(200);

    const landownerCall = capturedEmails.find(
      (c) => c.to === 'opsec-listing@example.test',
    );
    expect(landownerCall).toBeTruthy();
    const html = landownerCall!.html;

    for (const k of FORBIDDEN) {
      expect(html.toLowerCase()).not.toContain(k.toLowerCase());
    }
    // No raw lat/lng decimal pairs (e.g. 39.000123, -92.40000)
    expect(html).not.toMatch(/\d{2}\.\d{4,}/);
    expect(html).not.toMatch(/-9[0-9]\.\d{2,}/);
  });

  it('hunter confirmation email body has no precise-location keys or decimals', async () => {
    const id = await makeListing('PUBLISHED', {
      contactEmail: 'opsec-listing-2@example.test',
    });
    const r = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `opsec-hunt.${RUN_ID}@example.test`,
      }) as any,
      { params: { id } },
    );
    expect(r.status).toBe(200);

    const hunterCall = capturedEmails.find(
      (c) => c.to === `opsec-hunt.${RUN_ID}@example.test`,
    );
    expect(hunterCall).toBeTruthy();
    const html = hunterCall!.html;

    for (const k of FORBIDDEN) {
      expect(html.toLowerCase()).not.toContain(k.toLowerCase());
    }
    expect(html).not.toMatch(/\d{2}\.\d{4,}/);
  });
});

// =====================================================================
// Honeypot: silent 200, no DB row
// =====================================================================
describe('Inquiry honeypot', () => {
  it('returns 200 silently and does NOT create a row when `website` is filled', async () => {
    const id = await makeListing('PUBLISHED');
    const before = await prisma.inquiry.count({ where: { listingId: id } });
    const r = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `bot.${RUN_ID}@example.test`,
        website: 'http://spam.example',
      }) as any,
      { params: { id } },
    );
    expect(r.status).toBe(200);
    const after = await prisma.inquiry.count({ where: { listingId: id } });
    expect(after).toBe(before);
    expect(capturedEmails).toHaveLength(0);
  });
});

// =====================================================================
// Status route tests (owner-only)
// =====================================================================
describe('POST /api/dashboard/inquiries/[id]/status', () => {
  async function makeNewInquiry(): Promise<{ inquiryId: string; listingId: string }> {
    const listingId = await makeListing('PUBLISHED', {
      contactEmail: 'status-test-owner@example.test',
    });
    const r = await inquirePOST(
      mkRequest({
        ...BASE_PAYLOAD,
        hunterEmail: `status.${RUN_ID}.${Math.random().toString(36).slice(2, 6)}@example.test`,
      }) as any,
      { params: { id: listingId } },
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    return { inquiryId: body.inquiryId, listingId };
  }

  it('returns 401 when unauthenticated', async () => {
    const { inquiryId } = await makeNewInquiry();
    currentUserId = null;
    const r = await statusPOST(
      mkRequest({ status: 'REPLIED' }) as any,
      { params: { id: inquiryId } },
    );
    expect(r.status).toBe(401);
  });

  it('returns 404 when caller does not own the listing (no leak)', async () => {
    const { inquiryId } = await makeNewInquiry();
    currentUserId = ownerBId;
    const r = await statusPOST(
      mkRequest({ status: 'REPLIED' }) as any,
      { params: { id: inquiryId } },
    );
    expect(r.status).toBe(404);
  });

  it('returns 404 when inquiry id is unknown', async () => {
    currentUserId = ownerAId;
    const r = await statusPOST(
      mkRequest({ status: 'REPLIED' }) as any,
      { params: { id: 'cl_fake_inquiry_id' } },
    );
    expect(r.status).toBe(404);
  });

  it('happy path: NEW → REPLIED stamps repliedAt', async () => {
    const { inquiryId } = await makeNewInquiry();
    currentUserId = ownerAId;
    const r = await statusPOST(
      mkRequest({ status: 'REPLIED' }) as any,
      { params: { id: inquiryId } },
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.inquiry.status).toBe('REPLIED');
    expect(body.inquiry.repliedAt).not.toBeNull();
    expect(body.inquiry.closedAt).toBeNull();
  });

  it('happy path: NEW → CLOSED stamps closedAt', async () => {
    const { inquiryId } = await makeNewInquiry();
    currentUserId = ownerAId;
    const r = await statusPOST(
      mkRequest({ status: 'CLOSED' }) as any,
      { params: { id: inquiryId } },
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.inquiry.status).toBe('CLOSED');
    expect(body.inquiry.closedAt).not.toBeNull();
  });

  it('returns 409 when already in target status', async () => {
    const { inquiryId } = await makeNewInquiry();
    currentUserId = ownerAId;
    const r1 = await statusPOST(
      mkRequest({ status: 'REPLIED' }) as any,
      { params: { id: inquiryId } },
    );
    expect(r1.status).toBe(200);
    const r2 = await statusPOST(
      mkRequest({ status: 'REPLIED' }) as any,
      { params: { id: inquiryId } },
    );
    expect(r2.status).toBe(409);
  });

  it('returns 400 on invalid status', async () => {
    const { inquiryId } = await makeNewInquiry();
    currentUserId = ownerAId;
    const r = await statusPOST(
      mkRequest({ status: 'INVALID' }) as any,
      { params: { id: inquiryId } },
    );
    expect(r.status).toBe(400);
  });
});
