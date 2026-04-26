/**
 * OPSEC integration test for /listings/[slug] (public detail page) +
 * status-based 404 gating.
 *
 * Chunk 3 must-haves (#1 OPSEC + #2 status 404):
 *
 * #1 (CRITICAL):
 *   - Create a SavedProperty whose centroidLat/centroidLng are real,
 *     high-precision values (4+ decimal digits).
 *   - Create a PUBLISHED listing anchored to that SavedProperty.
 *   - Render the page server component to HTML.
 *   - Assert the response HTML body does NOT match
 *       /-?\d{1,3}\.\d{4,}.*-?\d{1,3}\.\d{4,}/
 *     (the lat/lng pair leak signature).
 *   - Assert the response body does NOT contain any of:
 *       "centroidLat", "centroidLng", "polygon", "geometry", "parcels".
 *   - Assert the response body does NOT contain the literal source
 *     SavedProperty centroidLat/centroidLng numbers (parameterized).
 *
 * #2:
 *   - DRAFT, PENDING_REVIEW, WITHDRAWN, LEASED -> notFound() (Next 404)
 *   - PUBLISHED -> renders successfully.
 *
 *   LEASED behavior decision: documented to 404 publicly, by design.
 *   Listings that have been leased should disappear from public surfaces
 *   so prospects don\'t inquire on already-taken inventory. This matches
 *   the public detail loader which filters status: \'PUBLISHED\'.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../lib/db';

// Public detail has no auth gate, but a deeply-imported module might pull
// next-auth in. Mock it to a no-op to be safe.
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }));

// Navbar is \'use client\' and uses useSession(). Replace with a no-op so SSR
// rendering doesn\'t require a SessionProvider in this node test context.
vi.mock('@/components/navbar', () => ({ default: () => null }));

import { renderToStaticMarkup } from 'react-dom/server';
import PublicListingDetail from '../app/listings/[slug]/page';
import { listingSlug } from '../lib/listings';

const RUN_ID = `vitest-opsec-${Date.now()}`;

// Distinctive high-precision values (>=4 decimal digits) so the leak regex
// would obviously catch them if they ever flowed into the public HTML.
const SP_LAT = 38.987654;
const SP_LNG = -92.123456;

let userId = '';
let savedPropertyId = '';
const createdListingIds: string[] = [];

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `opsec-test-${RUN_ID}@terrafirma.partners`,
      passwordHash: 'x',
      name: 'OPSEC Test',
    },
  });
  userId = u.id;
  const sp = await prisma.savedProperty.create({
    data: {
      userId,
      name: `OPSEC Lease ${RUN_ID}`,
      type: 'territory',
      // Realistic-shaped parcels JSON to make sure stripForPublic doesn\'t
      // accidentally serialize them through any include path.
      parcels: [
        {
          ogc_fid: 12345,
          geometry: { type: 'Polygon', coordinates: [[[1, 2]]] },
        },
      ] as any,
      totalAcres: 200,
      centroidLat: SP_LAT,
      centroidLng: SP_LNG,
      terrainScore: 88,
      primaryMovement: 'Draw funneling',
      bedAcres: 24.0,
      funnelCount: 6,
    },
  });
  savedPropertyId = sp.id;
});

afterAll(async () => {
  if (createdListingIds.length > 0) {
    await prisma.listing.deleteMany({ where: { id: { in: createdListingIds } } });
  }
  if (savedPropertyId) {
    await prisma.savedProperty.deleteMany({ where: { id: savedPropertyId } });
  }
  if (userId) {
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

const PHOTO_URL = 'https://cdn.example.test/listings/' + 'opsec-photo' + '-asset';

async function createListing(
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'LEASED' | 'WITHDRAWN',
) {
  const l = await prisma.listing.create({
    data: {
      savedPropertyId,
      ownerUserId: userId,
      status,
      state: 'MO',
      county: 'Boone',
      acres: 200,
      terrainScore: 88,
      primaryMovement: 'Draw funneling',
      bedAcres: 24.0,
      funnelCount: 6,
      askingPriceMin: 1500,
      askingPriceMax: 2500,
      leaseType: 'ANNUAL',
      huntersMax: 4,
      seasonAvailability: ['bow', 'rifle'],
      description:
        'Mature white-oak ridge anchored to a Terra Firma Partners hunt-report. Strong draw funneling.',
      photos: [PHOTO_URL],
      contactMethod: 'EMAIL_RELAY',
      contactEmail: 'a@example.test',
      publishedAt: status === 'PUBLISHED' || status === 'LEASED' ? new Date() : null,
    },
  });
  createdListingIds.push(l.id);
  return l;
}

function canonicalSlugFor(l: {
  state: string | null;
  county: string | null;
  acres: number | null;
  terrainScore: number | null;
  leaseType: any;
  id: string;
}): string {
  return `${listingSlug({
    state: l.state,
    county: l.county,
    acres: l.acres,
    terrainScore: l.terrainScore,
    leaseType: l.leaseType,
  })}-${l.id}`;
}

async function renderPage(slug: string): Promise<string> {
  const tree = await PublicListingDetail({ params: { slug } } as any);
  return renderToStaticMarkup(tree as any);
}

describe('OPSEC: PUBLISHED /listings/[slug] HTML', () => {
  it('does NOT contain forbidden tokens (centroidLat, centroidLng, polygon, geometry, parcels)', async () => {
    const l = await createListing('PUBLISHED');
    const slug = canonicalSlugFor(l);
    const html = await renderPage(slug);

    const forbidden = ['centroidLat', 'centroidLng', 'polygon', 'geometry', 'parcels'];
    for (const word of forbidden) {
      expect(
        html.toLowerCase().includes(word.toLowerCase()),
        `Public HTML contained forbidden token "${word}"`,
      ).toBe(false);
    }
  });

  it('does NOT contain the source SavedProperty\'s real centroidLat/centroidLng numeric values', async () => {
    const l = await createListing('PUBLISHED');
    const slug = canonicalSlugFor(l);
    const html = await renderPage(slug);

    expect(html.includes(String(SP_LAT))).toBe(false);
    expect(html.includes(String(SP_LNG))).toBe(false);
    // Common rounded forms an attacker might check for.
    expect(html.includes(SP_LAT.toFixed(6))).toBe(false);
    expect(html.includes(SP_LNG.toFixed(6))).toBe(false);
    expect(html.includes(SP_LAT.toFixed(5))).toBe(false);
    expect(html.includes(SP_LNG.toFixed(5))).toBe(false);
    expect(html.includes(SP_LAT.toFixed(4))).toBe(false);
    expect(html.includes(SP_LNG.toFixed(4))).toBe(false);
  });

  it('does NOT match the lat/lng pair leak regex (high-precision number, anything, high-precision number)', async () => {
    const l = await createListing('PUBLISHED');
    const slug = canonicalSlugFor(l);
    const html = await renderPage(slug);

    const pairRe = /-?\d{1,3}\.\d{4,}.*-?\d{1,3}\.\d{4,}/;
    const m = html.match(pairRe);
    expect(
      m,
      `Public HTML matched lat/lng-pair leak signature: ${m ? m[0] : ''}`,
    ).toBeNull();
  });

  it('does render the listing on the happy path (sanity)', async () => {
    const l = await createListing('PUBLISHED');
    const slug = canonicalSlugFor(l);
    const html = await renderPage(slug);

    expect(html.length).toBeGreaterThan(0);
    // Sanity: county and state textual labels do appear.
    expect(html).toContain('Boone');
    expect(html).toContain('MO');
  });
});

describe('Public detail status gate', () => {
  // notFound() in next/navigation throws an Error whose .digest is
  // "NEXT_NOT_FOUND". We assert it bubbles for every non-PUBLISHED status.
  function isNextNotFound(e: any): boolean {
    if (!e) return false;
    if (e.digest === 'NEXT_NOT_FOUND') return true;
    const s = String(e?.message ?? e);
    return /NEXT_NOT_FOUND/.test(s);
  }

  it('PUBLISHED -> renders successfully', async () => {
    const l = await createListing('PUBLISHED');
    const slug = canonicalSlugFor(l);
    const html = await renderPage(slug);
    expect(html.length).toBeGreaterThan(0);
  });

  it.each(['DRAFT', 'PENDING_REVIEW', 'WITHDRAWN', 'LEASED'] as const)(
    '%s -> notFound() (Next treats as 404)',
    async (status) => {
      const l = await createListing(status);
      const slug = canonicalSlugFor(l);
      let threw = false;
      try {
        await renderPage(slug);
      } catch (e: any) {
        threw = true;
        expect(
          isNextNotFound(e),
          `expected notFound() from status ${status}, got: ${e?.message ?? e}`,
        ).toBe(true);
      }
      expect(threw, `status ${status} should call notFound()`).toBe(true);
    },
  );
});
