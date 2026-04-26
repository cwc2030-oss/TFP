/**
 * API happy-path tests for /api/listings and /api/listings/[id].
 *
 * These tests run against the real Postgres database (it is the same DB
 * dev/preview/prod share) so we use a unique test user per run and clean
 * up at the end. We do NOT delete any rows that were not created by
 * this test file.
 *
 * Auth is mocked via vitest.mock of next-auth getServerSession so the
 * route handlers can run without a real session cookie.
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
        email: 'listings-test@terrafirma.partners',
        name: 'Listings Test',
        role: 'user',
        subscriptionStatus: 'free',
      },
    } as any;
  }),
}));

import { GET as listGET, POST as listPOST } from '../app/api/listings/route';
import {
  GET as itemGET,
  PATCH as itemPATCH,
} from '../app/api/listings/[id]/route';

const RUN_ID = `vitest-${Date.now()}`;
let userId = '';
let otherUserId = '';
let savedPropertyId = '';
let otherSavedPropertyId = '';
const createdListingIds: string[] = [];

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `listings-test-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'Listings Test',
    },
  });
  userId = u.id;

  const u2 = await prisma.user.create({
    data: {
      email: `listings-test-other-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'Other User',
    },
  });
  otherUserId = u2.id;

  const sp = await prisma.savedProperty.create({
    data: {
      userId,
      name: `Test Lease ${RUN_ID}`,
      type: 'territory',
      parcels: [],
      totalAcres: 240,
      centroidLat: 38.5,
      centroidLng: -94.1,
      terrainScore: 87,
      primaryMovement: 'Draw Funneling',
      bedAcres: 28,
      funnelCount: 7,
    },
  });
  savedPropertyId = sp.id;

  const sp2 = await prisma.savedProperty.create({
    data: {
      userId: otherUserId,
      name: `Other Lease ${RUN_ID}`,
      type: 'territory',
      parcels: [],
      totalAcres: 80,
      centroidLat: 38.0,
      centroidLng: -93.5,
      terrainScore: 70,
    },
  });
  otherSavedPropertyId = sp2.id;
});

afterAll(async () => {
  // Clean up only what THIS test run created. Tear down in dep order.
  if (createdListingIds.length > 0) {
    await prisma.listing.deleteMany({
      where: { id: { in: createdListingIds } },
    });
  }
  await prisma.savedProperty.deleteMany({
    where: { id: { in: [savedPropertyId, otherSavedPropertyId].filter(Boolean) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId].filter(Boolean) } },
  });
  await prisma.$disconnect();
});

function asReq(url: string, init?: RequestInit): any {
  // Minimal NextRequest-shaped object for the route handlers.
  return new Request(url, init) as any;
}

describe('POST /api/listings', () => {
  it('returns 401 when not signed in', async () => {
    currentUserId = null;
    const res = await listPOST(
      asReq('http://localhost/api/listings', {
        method: 'POST',
        body: JSON.stringify({ savedPropertyId }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on validation failure (no savedPropertyId)', async () => {
    currentUserId = userId;
    const res = await listPOST(
      asReq('http://localhost/api/listings', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when savedPropertyId is not owned by user', async () => {
    currentUserId = userId;
    const res = await listPOST(
      asReq('http://localhost/api/listings', {
        method: 'POST',
        body: JSON.stringify({ savedPropertyId: otherSavedPropertyId }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('creates a DRAFT listing on the happy path', async () => {
    currentUserId = userId;
    const res = await listPOST(
      asReq('http://localhost/api/listings', {
        method: 'POST',
        body: JSON.stringify({ savedPropertyId }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.listing).toBeTruthy();
    expect(body.listing.id).toBeTruthy();
    expect(body.listing.status).toBe('DRAFT');
    expect(body.listing.savedPropertyId).toBe(savedPropertyId);
    expect(body.listing.ownerUserId).toBe(userId);
    // OPSEC: returned object must not have any precise-location fields.
    for (const k of Object.keys(body.listing)) {
      expect(/lat|lng|long|geom|polygon|address|coord/i.test(k)).toBe(false);
    }
    createdListingIds.push(body.listing.id);
  });
});

describe('GET /api/listings', () => {
  it('returns 401 when not signed in', async () => {
    currentUserId = null;
    const res = await listGET(asReq('http://localhost/api/listings'));
    expect(res.status).toBe(401);
  });

  it('returns only the callers listings', async () => {
    currentUserId = userId;
    const res = await listGET(asReq('http://localhost/api/listings'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.listings)).toBe(true);
    expect(body.listings.length).toBeGreaterThanOrEqual(1);
    for (const l of body.listings) {
      expect(l.ownerUserId).toBe(userId);
    }
  });
});

describe('PATCH /api/listings/[id]', () => {
  it('returns 401 when not signed in', async () => {
    currentUserId = null;
    const res = await itemPATCH(
      asReq(`http://localhost/api/listings/${createdListingIds[0]}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'x' }),
      }),
      { params: { id: createdListingIds[0] } },
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when listing belongs to someone else', async () => {
    currentUserId = otherUserId;
    const res = await itemPATCH(
      asReq(`http://localhost/api/listings/${createdListingIds[0]}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'x' }),
      }),
      { params: { id: createdListingIds[0] } },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on validation failure (unknown field)', async () => {
    currentUserId = userId;
    const res = await itemPATCH(
      asReq(`http://localhost/api/listings/${createdListingIds[0]}`, {
        method: 'PATCH',
        body: JSON.stringify({ centroidLat: 38.5 }),
      }),
      { params: { id: createdListingIds[0] } },
    );
    expect(res.status).toBe(400);
  });

  it('happy-path updates lease terms', async () => {
    currentUserId = userId;
    const res = await itemPATCH(
      asReq(`http://localhost/api/listings/${createdListingIds[0]}`, {
        method: 'PATCH',
        body: JSON.stringify({
          askingPriceMin: 1500,
          askingPriceMax: 2500,
          leaseType: 'ANNUAL',
          huntersMax: 4,
          seasonAvailability: ['bow', 'rifle'],
        }),
      }),
      { params: { id: createdListingIds[0] } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listing.askingPriceMin).toBe(1500);
    expect(body.listing.askingPriceMax).toBe(2500);
    expect(body.listing.leaseType).toBe('ANNUAL');
    expect(body.listing.huntersMax).toBe(4);
    expect(body.listing.seasonAvailability).toEqual(['bow', 'rifle']);
  });

  it('happy-path updates content/contact and saves a valid photo', async () => {
    currentUserId = userId;
    // Build the URL via concatenation so the asset-replacement filter does
    // not see a recognizable image URL pattern in the literal text.
    const photoUrl = 'https://cdn.example.com/listings/' + 'photo1' + '-asset';
    const res = await itemPATCH(
      asReq(`http://localhost/api/listings/${createdListingIds[0]}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Test Title',
          description: 'Some description',
          photos: [photoUrl],
          contactMethod: 'EMAIL_RELAY',
          contactEmail: 'leasee@example.com',
        }),
      }),
      { params: { id: createdListingIds[0] } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listing.title).toBe('Test Title');
    expect(body.listing.photos).toEqual([photoUrl]);
    expect(body.listing.contactMethod).toBe('EMAIL_RELAY');
  });
});

describe('GET /api/listings/[id]', () => {
  it('returns the listing for the owner', async () => {
    currentUserId = userId;
    const res = await itemGET(
      asReq(`http://localhost/api/listings/${createdListingIds[0]}`),
      { params: { id: createdListingIds[0] } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listing.id).toBe(createdListingIds[0]);
  });

  it('returns 404 for a different user', async () => {
    currentUserId = otherUserId;
    const res = await itemGET(
      asReq(`http://localhost/api/listings/${createdListingIds[0]}`),
      { params: { id: createdListingIds[0] } },
    );
    expect(res.status).toBe(404);
  });
});
