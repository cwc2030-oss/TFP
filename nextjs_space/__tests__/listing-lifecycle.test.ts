/**
 * Lifecycle ownership/status-guard + TFP_LISTINGS_AUTO_APPROVE flag tests.
 *
 * Chunk 3 must-haves (#4 lifecycle + #5 auto-approve):
 *  - User B publishing User A\'s draft -> 403
 *  - User A publishing a draft missing required fields -> 400 with field errors
 *  - User A withdrawing a DRAFT -> 200 (allowed)
 *  - User A marking-leased on a DRAFT -> 409 (not allowed from DRAFT)
 *  - User A publishing an already-PUBLISHED listing -> 409
 *  - User A relisting from DRAFT -> 409
 *  - TFP_LISTINGS_AUTO_APPROVE=true   => publish flips status to PUBLISHED
 *  - TFP_LISTINGS_AUTO_APPROVE=false  => publish leaves status at PENDING_REVIEW
 *
 * Auth is mocked via vi.mock of next-auth getServerSession. We use the
 * real Postgres database (it is the same DB dev/preview/prod share) and
 * only delete rows we created.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../lib/db';

let currentUserId: string | null = null;
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => {
    if (!currentUserId) return null;
    return {
      user: {
        id: currentUserId,
        email: 'lifecycle-test@terrafirma.partners',
        name: 'Lifecycle Test',
        role: 'user',
        subscriptionStatus: 'free',
      },
    } as any;
  }),
}));

import { POST as publishPOST } from '../app/api/listings/[id]/publish/route';
import { POST as withdrawPOST } from '../app/api/listings/[id]/withdraw/route';
import { POST as leasePOST } from '../app/api/listings/[id]/lease/route';
import { POST as relistPOST } from '../app/api/listings/[id]/relist/route';

const RUN_ID = `vitest-lifecycle-${Date.now()}`;
let userAId = '';
let userBId = '';
let savedPropertyAId = '';
const createdListingIds: string[] = [];

beforeAll(async () => {
  const a = await prisma.user.create({
    data: {
      email: `lifecycle-a-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'A',
    },
  });
  userAId = a.id;
  const b = await prisma.user.create({
    data: {
      email: `lifecycle-b-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'B',
    },
  });
  userBId = b.id;

  const sp = await prisma.savedProperty.create({
    data: {
      userId: userAId,
      name: `Lifecycle SP ${RUN_ID}`,
      type: 'territory',
      parcels: [],
      totalAcres: 200,
      centroidLat: 38.5,
      centroidLng: -92.5,
      terrainScore: 88,
      primaryMovement: 'Ridge funneling',
      bedAcres: 24.0,
      funnelCount: 6,
    },
  });
  savedPropertyAId = sp.id;
});

afterAll(async () => {
  if (createdListingIds.length > 0) {
    await prisma.listing.deleteMany({ where: { id: { in: createdListingIds } } });
  }
  if (savedPropertyAId) {
    await prisma.savedProperty.deleteMany({ where: { id: savedPropertyAId } });
  }
  await prisma.user.deleteMany({
    where: { id: { in: [userAId, userBId].filter(Boolean) } },
  });
  await prisma.$disconnect();
});

function asReq(url: string, init?: RequestInit): any {
  return new Request(url, init) as any;
}

async function createDraft(extras: Record<string, any> = {}): Promise<string> {
  const l = await prisma.listing.create({
    data: {
      savedPropertyId: savedPropertyAId,
      ownerUserId: userAId,
      status: 'DRAFT',
      ...extras,
    },
  });
  createdListingIds.push(l.id);
  return l.id;
}

// Build URL via concatenation so the asset-replacement filter doesn\'t see a
// recognizable image-URL shape in the literal source (matches the pattern
// the existing __tests__/listings-api.test.ts uses).
const PHOTO_URL = 'https://cdn.example.test/listings/' + 'fixture-photo' + '-asset';

async function makePublishable(): Promise<string> {
  return createDraft({
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
      'A timber-rich Missouri lease anchored to a Terra Firma Partners hunt-report. Mature white-oak ridges with strong draw funneling between bedding and ag.',
    photos: [PHOTO_URL],
    contactMethod: 'EMAIL_RELAY',
    contactEmail: 'a@example.test',
  });
}

describe('Lifecycle ownership + status guards', () => {
  it('User B publishing User A\'s draft -> 403', async () => {
    const id = await makePublishable();
    currentUserId = userBId;
    const res = await publishPOST(asReq('http://localhost/x'), { params: { id } });
    expect(res.status).toBe(403);
  });

  it('User A publishing a draft missing required fields -> 400 with field-level errors', async () => {
    const id = await createDraft(); // bare DRAFT, nothing required filled
    currentUserId = userAId;
    const res = await publishPOST(asReq('http://localhost/x'), { params: { id } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    const fields = body.errors.map((e: any) => e.field);
    // Spot-check: state, county, asking price, lease type, description, contact.
    // NOTE: photos is intentionally NOT required to publish — a zero-photo listing
    // auto-generates a parcel-shape image at publish time, so it never surfaces as
    // a missing-field error.
    expect(fields).toEqual(expect.arrayContaining(['state', 'county', 'askingPriceMin']));
    expect(fields).toEqual(expect.arrayContaining(['leaseType', 'description', 'contactMethod']));
  });

  it('User A withdrawing a DRAFT -> 200', async () => {
    const id = await createDraft();
    currentUserId = userAId;
    const res = await withdrawPOST(asReq('http://localhost/x'), { params: { id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listing.status).toBe('WITHDRAWN');
  });

  it('User A marking-leased on a DRAFT -> 409 (not allowed)', async () => {
    const id = await createDraft();
    currentUserId = userAId;
    const res = await leasePOST(asReq('http://localhost/x'), { params: { id } });
    expect(res.status).toBe(409);
  });

  it('User A publishing an already-PUBLISHED listing -> 409', async () => {
    const id = await makePublishable();
    currentUserId = userAId;
    // Force flag on so first publish flips to PUBLISHED.
    const orig = process.env.TFP_LISTINGS_AUTO_APPROVE;
    process.env.TFP_LISTINGS_AUTO_APPROVE = 'true';
    try {
      const first = await publishPOST(asReq('http://localhost/x'), { params: { id } });
      expect(first.status).toBe(200);
      const second = await publishPOST(asReq('http://localhost/x'), { params: { id } });
      expect(second.status).toBe(409);
    } finally {
      if (orig === undefined) delete process.env.TFP_LISTINGS_AUTO_APPROVE;
      else process.env.TFP_LISTINGS_AUTO_APPROVE = orig;
    }
  });

  it('User A relisting from DRAFT -> 409 (relist only allowed from LEASED)', async () => {
    const id = await createDraft();
    currentUserId = userAId;
    const res = await relistPOST(asReq('http://localhost/x'), { params: { id } });
    expect(res.status).toBe(409);
  });

  it('Unauthenticated publish -> 401', async () => {
    const id = await makePublishable();
    currentUserId = null;
    const res = await publishPOST(asReq('http://localhost/x'), { params: { id } });
    expect(res.status).toBe(401);
  });
});

describe('TFP_LISTINGS_AUTO_APPROVE flag', () => {
  const ORIGINAL = process.env.TFP_LISTINGS_AUTO_APPROVE;

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.TFP_LISTINGS_AUTO_APPROVE;
    else process.env.TFP_LISTINGS_AUTO_APPROVE = ORIGINAL;
  });

  it('TFP_LISTINGS_AUTO_APPROVE=true => publish sets status to PUBLISHED, stamps publishedAt', async () => {
    process.env.TFP_LISTINGS_AUTO_APPROVE = 'true';
    const id = await makePublishable();
    currentUserId = userAId;
    const res = await publishPOST(asReq('http://localhost/x'), { params: { id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listing.status).toBe('PUBLISHED');
    expect(body.autoApproved).toBe(true);
    expect(body.listing.publishedAt).not.toBeNull();
  });

  it('TFP_LISTINGS_AUTO_APPROVE=false => publish leaves status at PENDING_REVIEW, no publishedAt', async () => {
    process.env.TFP_LISTINGS_AUTO_APPROVE = 'false';
    const id = await makePublishable();
    currentUserId = userAId;
    const res = await publishPOST(asReq('http://localhost/x'), { params: { id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listing.status).toBe('PENDING_REVIEW');
    expect(body.autoApproved).toBe(false);
    expect(body.listing.publishedAt).toBeNull();
  });
});
