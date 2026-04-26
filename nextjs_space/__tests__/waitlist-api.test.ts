/**
 * API integration tests for /api/waitlist.
 *
 * Hits the real Postgres DB (shared dev/prod). Cleans up at end via
 * email prefix filter. Mocks NextRequest with a minimal shim.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/db';
import { POST } from '../app/api/waitlist/route';

const RUN_ID = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function mkRequest(body: unknown, opts?: { url?: string; referer?: string }) {
  return {
    url: opts?.url ?? 'http://localhost:3000/api/waitlist',
    headers: new Headers(opts?.referer ? { referer: opts.referer } : {}),
    json: async () => body,
  } as unknown as Request;
}

afterAll(async () => {
  await prisma.waitlist.deleteMany({
    where: { email: { contains: RUN_ID } },
  });
  await prisma.$disconnect();
});

describe('POST /api/waitlist', () => {
  it('creates a new LANDOWNER entry and returns 201', async () => {
    const email = `landowner.${RUN_ID}@example.com`;
    const res = await POST(
      mkRequest({
        side: 'LANDOWNER',
        email,
        name: 'Jane',
        state: 'mo',
        acres: 240,
        source: 'lease_your_land_landing',
      }) as any,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.mode).toBe('created');

    const saved = await prisma.waitlist.findUnique({ where: { id: body.id } });
    expect(saved?.email).toBe(email.toLowerCase());
    expect(saved?.side).toBe('LANDOWNER');
    expect(saved?.state).toBe('MO');
    expect(saved?.acres).toBe(240);
    expect(saved?.source).toBe('lease_your_land_landing');
  });

  it('updates an existing (email, side) entry and returns 200', async () => {
    const email = `update.${RUN_ID}@example.com`;
    const r1 = await POST(
      mkRequest({
        side: 'LANDOWNER',
        email,
        state: 'MO',
      }) as any,
    );
    expect(r1.status).toBe(201);
    const id1 = (await r1.json()).id;

    const r2 = await POST(
      mkRequest({
        side: 'LANDOWNER',
        email,
        name: 'Updated Name',
        acres: 500,
      }) as any,
    );
    expect(r2.status).toBe(200);
    const body2 = await r2.json();
    expect(body2.id).toBe(id1);
    expect(body2.mode).toBe('updated');

    const saved = await prisma.waitlist.findUnique({ where: { id: id1 } });
    expect(saved?.name).toBe('Updated Name');
    expect(saved?.acres).toBe(500);
    expect(saved?.state).toBe('MO');  // preserved from first submit
  });

  it('treats different sides as distinct rows', async () => {
    const email = `dual.${RUN_ID}@example.com`;
    const r1 = await POST(
      mkRequest({ side: 'LANDOWNER', email }) as any,
    );
    expect(r1.status).toBe(201);
    const r2 = await POST(
      mkRequest({ side: 'HUNTER', email }) as any,
    );
    expect(r2.status).toBe(201);

    const rows = await prisma.waitlist.findMany({ where: { email } });
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.side))).toEqual(new Set(['LANDOWNER', 'HUNTER']));
  });

  it('returns 400 when email is missing', async () => {
    const res = await POST(
      mkRequest({ side: 'LANDOWNER' }) as any,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.fieldErrors.email).toBeTruthy();
  });

  it('returns 400 when email is invalid', async () => {
    const res = await POST(
      mkRequest({ side: 'LANDOWNER', email: 'not-an-email' }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when side is missing', async () => {
    const res = await POST(
      mkRequest({ email: `nosa.${RUN_ID}@example.com` }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = {
      url: 'http://localhost:3000/api/waitlist',
      headers: new Headers(),
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Request;
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('captures utm params from request URL when not in body', async () => {
    const email = `utm.${RUN_ID}@example.com`;
    const res = await POST(
      mkRequest(
        { side: 'HUNTER', email },
        {
          url:
            'http://localhost:3000/api/waitlist?utm_source=facebook&utm_medium=cpc&utm_campaign=launch_2026',
        },
      ) as any,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const saved = await prisma.waitlist.findUnique({ where: { id: body.id } });
    expect(saved?.utmSource).toBe('facebook');
    expect(saved?.utmMedium).toBe('cpc');
    expect(saved?.utmCampaign).toBe('launch_2026');
  });

  it('captures utm params from referer header when not in body or URL', async () => {
    const email = `utm2.${RUN_ID}@example.com`;
    const res = await POST(
      mkRequest(
        { side: 'HUNTER', email },
        {
          referer:
            'http://localhost:3000/find-a-lease?utm_source=google&utm_medium=cpc&utm_campaign=spring',
        },
      ) as any,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const saved = await prisma.waitlist.findUnique({ where: { id: body.id } });
    expect(saved?.utmSource).toBe('google');
    expect(saved?.utmCampaign).toBe('spring');
  });

  it('does not overwrite a populated value with a blank on re-submit', async () => {
    const email = `nodump.${RUN_ID}@example.com`;
    const r1 = await POST(
      mkRequest({
        side: 'LANDOWNER',
        email,
        name: 'Original Name',
        state: 'MO',
        acres: 100,
      }) as any,
    );
    expect(r1.status).toBe(201);
    const id1 = (await r1.json()).id;

    const r2 = await POST(
      mkRequest({
        side: 'LANDOWNER',
        email,
      }) as any,
    );
    expect(r2.status).toBe(200);

    const saved = await prisma.waitlist.findUnique({ where: { id: id1 } });
    expect(saved?.name).toBe('Original Name');
    expect(saved?.state).toBe('MO');
    expect(saved?.acres).toBe(100);
  });

  it('rejects unknown top-level fields with 400 (strict)', async () => {
    const res = await POST(
      mkRequest({
        side: 'LANDOWNER',
        email: `strict.${RUN_ID}@example.com`,
        latitude: 38.5,
        longitude: -94.5,
      }) as any,
    );
    expect(res.status).toBe(400);
  });
});
