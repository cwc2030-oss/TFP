export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * POST /api/reads/unlock
 *
 * PLACEHOLDER Season Pass unlock for Piece 6a — flips User.readsUnlocked so we
 * can exercise the "unlocked -> no wall" path end-to-end WITHOUT a real charge.
 * Piece 6b replaces this with a Stripe checkout + webhook that sets the flag.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { readsUnlocked: true },
    });

    return NextResponse.json({ unlocked: true, placeholder: true });
  } catch (err) {
    console.error('[reads/unlock] error:', err);
    return NextResponse.json({ error: 'Failed to unlock' }, { status: 500 });
  }
}
