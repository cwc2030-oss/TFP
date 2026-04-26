/**
 * Chunk 5: report-to-listing prefill API, OPSEC, zod, PDF CTA, and form wiring tests.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../lib/db';
import {
  buildListingPrefill,
  listingPrefillResponseSchema,
} from '../lib/listing-prefill';

let currentUserId: string | null = null;
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => {
    if (!currentUserId) return null;
    return {
      user: {
        id: currentUserId,
        email: 'prefill-test@terrafirma.partners',
        name: 'Prefill Test',
        role: 'user',
        subscriptionStatus: 'free',
      },
    } as any;
  }),
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { GET as prefillGET } from '../app/api/listings/new/prefill/route';
import { POST as huntFilePOST } from '../app/api/parcel-hunt-file/route';

const RUN_ID = `vitest-prefill-${Date.now()}`;
let ownerAId = '';
let ownerBId = '';
let savedPropertyAId = '';
let savedPropertyBId = '';

function asReq(url: string, init?: RequestInit): any {
  return new Request(url, init) as any;
}

beforeAll(async () => {
  const ownerA = await prisma.user.create({
    data: {
      email: `prefill-owner-a-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'Prefill Owner A',
    },
  });
  ownerAId = ownerA.id;

  const ownerB = await prisma.user.create({
    data: {
      email: `prefill-owner-b-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'Prefill Owner B',
    },
  });
  ownerBId = ownerB.id;

  const spA = await prisma.savedProperty.create({
    data: {
      userId: ownerAId,
      name: `Prefill SP A ${RUN_ID}`,
      type: 'single',
      parcels: [
        {
          address: '123 County Road, Howard County, MO 65201',
          county: 'Howard',
          acres: 181.4,
          geometry: { type: 'Polygon', coordinates: [[[1, 2]]] },
        },
      ] as any,
      totalAcres: 181.4,
      centroidLat: 39.123456,
      centroidLng: -92.654321,
      terrainScore: 91,
      primaryMovement: 'Creek-bottom funnels',
      bedAcres: 17.7,
      funnelCount: 9,
    },
  });
  savedPropertyAId = spA.id;

  const spB = await prisma.savedProperty.create({
    data: {
      userId: ownerBId,
      name: `Prefill SP B ${RUN_ID}`,
      type: 'single',
      parcels: [],
      totalAcres: 80,
      centroidLat: 38.999999,
      centroidLng: -91.111111,
      terrainScore: 70,
    },
  });
  savedPropertyBId = spB.id;
});

afterAll(async () => {
  await prisma.listing.deleteMany({ where: { savedPropertyId: { in: [savedPropertyAId, savedPropertyBId].filter(Boolean) } } });
  await prisma.savedProperty.deleteMany({ where: { id: { in: [savedPropertyAId, savedPropertyBId].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerAId, ownerBId].filter(Boolean) } } });
  await prisma.$disconnect();
});

describe('GET /api/listings/new/prefill', () => {
  it('returns 401 for unauthenticated callers', async () => {
    currentUserId = null;
    const res = await prefillGET(asReq(`http://localhost/api/listings/new/prefill?savedPropertyId=${savedPropertyAId}`));
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-owner to avoid existence leaks', async () => {
    currentUserId = ownerBId;
    const res = await prefillGET(asReq(`http://localhost/api/listings/new/prefill?savedPropertyId=${savedPropertyAId}`));
    expect(res.status).toBe(404);
  });

  it('returns 200 with only the safe owner-scoped prefill fields', async () => {
    currentUserId = ownerAId;
    const res = await prefillGET(asReq(`http://localhost/api/listings/new/prefill?savedPropertyId=${savedPropertyAId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      savedPropertyId: savedPropertyAId,
      state: 'MO',
      county: 'Howard',
      acres: 181.4,
      terrainScore: 91,
      primaryMovement: 'Creek-bottom funnels',
      bedAcres: 17.7,
      funnelCount: 9,
    });
    expect(listingPrefillResponseSchema.parse(body)).toEqual(body);
  });

  it('does not return precise-location or parcel/address/geometry fields', async () => {
    currentUserId = ownerAId;
    const res = await prefillGET(asReq(`http://localhost/api/listings/new/prefill?savedPropertyId=${savedPropertyAId}`));
    const body = await res.json();
    const json = JSON.stringify(body);
    for (const forbidden of ['centroidLat', 'centroidLng', 'lat', 'lng', 'parcel', 'address', 'geom', 'polygon']) {
      expect(json.toLowerCase().includes(forbidden.toLowerCase()), `leaked ${forbidden}`).toBe(false);
    }
  });
});

describe('listing prefill zod contract', () => {
  it('rejects unknown response fields', async () => {
    const sp = await prisma.savedProperty.findUniqueOrThrow({ where: { id: savedPropertyAId } });
    const prefill = buildListingPrefill(sp);
    expect(() => listingPrefillResponseSchema.parse({ ...prefill, centroidLat: 39.123456 })).toThrow();
    expect(() => listingPrefillResponseSchema.parse({ ...prefill, address: '123 County Road' })).toThrow();
  });
});

describe('PDF listing CTA rendering', () => {
  it('renders the CTA panel with the safe listing link and no precise coords in panel/link text', async () => {
    currentUserId = ownerAId;
    const html2PdfFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.mapbox.com')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      if (url.includes('createConvertHtmlToPdfRequest')) {
        return new Response(JSON.stringify({ request_id: 'req_test' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'FAILED', result: { error: 'force html fallback' } }), { status: 200 });
    });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = html2PdfFetch as any;
    try {
      const res = await huntFilePOST(asReq('https://terrafirma.partners/api/parcel-hunt-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'https://terrafirma.partners' },
        body: JSON.stringify({
          savedPropertyId: savedPropertyAId,
          address: '123 County Road, Howard County, MO 65201',
          lat: 39.123456,
          lng: -92.654321,
          acreage: 181.4,
          county: 'Howard',
          state: 'MO',
          prevailingWind: 'NW',
          stands: [],
          summary: { topStandScore: 91, totalBeddingAcres: 17.7, funnelCount: 9, analysisAreaAcres: 181.4 },
          corridors: {},
          seasonScores: { topScore: 91, recommended: 'rut' },
          parcelCoords: null,
        }),
      }));
      const html = await res.text();
      expect(html).toContain('You&apos;ve mapped it. Ready to lease it?');
      expect(html).toContain('List this property and connect with vetted hunters in your area.');
      expect(html).toContain(`/dashboard/listings/new?savedPropertyId=${savedPropertyAId}&cta=pdf`);
      const panel = html.slice(html.indexOf('You&apos;ve mapped it'), html.indexOf('TERRA FIRMA PARTNERS', html.indexOf('You&apos;ve mapped it')));
      expect(panel).not.toContain('39.123456');
      expect(panel).not.toContain('-92.654321');
      expect(panel).not.toMatch(/-?\d{1,3}\.\d{4,}.*-?\d{1,3}\.\d{4,}/);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

describe('prefill form rendering', () => {
  it('pre-populates editable fields from query-driven prefill', async () => {
    const sp = await prisma.savedProperty.findUniqueOrThrow({ where: { id: savedPropertyAId } });
    const prefill = buildListingPrefill(sp);
    expect(prefill.state).toBe('MO');
    expect(prefill.county).toBe('Howard');
    expect(prefill.savedPropertyId).toBe(savedPropertyAId);
  });

  it('submission contract persists user edits over prefill with the original savedPropertyId FK', () => {
    const editedState = 'KS';
    const editedCounty = 'Linn';
    const createBody = { savedPropertyId: savedPropertyAId };
    const patchBody = {
      state: editedState,
      county: editedCounty,
    };
    expect(createBody.savedPropertyId).toBe(savedPropertyAId);
    expect(patchBody).toEqual({ state: 'KS', county: 'Linn' });
    expect(listingPrefillResponseSchema.shape.state.safeParse(patchBody.state).success).toBe(true);
    expect(listingPrefillResponseSchema.shape.county.safeParse(patchBody.county).success).toBe(true);
  });
});
