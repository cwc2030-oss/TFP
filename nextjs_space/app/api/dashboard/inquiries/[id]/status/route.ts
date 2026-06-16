/**
 * POST /api/dashboard/inquiries/[id]/status — owner-only.
 *
 * Body: { status: "REPLIED" | "CLOSED" }
 *
 *   401 — unauthenticated
 *   404 — inquiry not found OR inquiry is not on a listing the caller owns
 *           (we collapse "not found" + "not yours" to a single 404 to avoid
 *           leaking listing existence)
 *   400 — invalid status
 *   409 — already in target status (no-op)
 *   200 — updated inquiry returned
 *
 * Stamps repliedAt / closedAt accordingly. Returning to NEW is not allowed
 * via this endpoint by design — if needed, do it from a separate admin path
 * later.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    status: z.enum(['REPLIED', 'ACCEPTED', 'CLOSED']),
  })
  .strict();

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: params.id },
    include: { listing: { select: { ownerUserId: true } } },
  });
  if (!inquiry || inquiry.listing.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (inquiry.status === parsed.data.status) {
    return NextResponse.json(
      { error: `Already ${parsed.data.status}` },
      { status: 409 },
    );
  }

  const now = new Date();
  const updated = await prisma.inquiry.update({
    where: { id: inquiry.id },
    data: {
      status: parsed.data.status,
      repliedAt:
        parsed.data.status === 'REPLIED'
          ? inquiry.repliedAt ?? now
          : inquiry.repliedAt,
      acceptedAt:
        parsed.data.status === 'ACCEPTED' ? now : inquiry.acceptedAt,
      closedAt: parsed.data.status === 'CLOSED' ? now : inquiry.closedAt,
    },
  });

  return NextResponse.json({ inquiry: updated });
}
