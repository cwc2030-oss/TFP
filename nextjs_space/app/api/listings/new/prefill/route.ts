import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getListingPrefillForOwner } from '@/lib/listing-prefill';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl ?? new URL(req.url);
  const savedPropertyId = url.searchParams.get('savedPropertyId')?.trim();
  if (!savedPropertyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const prefill = await getListingPrefillForOwner(savedPropertyId, session.user.id);
  if (!prefill) {
    // Collapse not-found and not-owned to avoid leaking SavedProperty existence.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(prefill);
}
