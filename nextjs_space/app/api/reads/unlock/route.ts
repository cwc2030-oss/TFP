export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/db';
import { getCurrentSeason, isReadsUnlocked } from '@/lib/reads';

/**
 * POST /api/reads/unlock
 *
 * Piece 6b — real Season Pass checkout. Creates a $19 one-time Stripe Checkout
 * session for the CURRENT season and returns its URL; the client redirects the
 * shopper to Stripe. On successful payment the stripe-webhook stamps
 * User.seasonPassSeason + seasonPassExpiry (see handleSeasonPassPurchase),
 * which flips the account to an unlocked pass holder for the season.
 *
 * Repurposes the existing $19 plumbing: the same STRIPE_HUNT_PLAN_PRICE_ID and
 * mode:'payment' flow already used by /api/parcels/purchase.
 *
 * Body (all optional) { lat, lng, address } — echoed into success_url so the
 * shopper lands back on the same parcel and the read re-runs automatically.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const email = session?.user?.email as string | undefined;
    if (!userId || !email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const lat = body?.lat;
    const lng = body?.lng;
    const address: string = body?.address ? String(body.address) : '';

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        stripeCustomerId: true,
        subscriptionStatus: true,
        role: true,
        readsUnlocked: true,
        seasonPassSeason: true,
        seasonPassExpiry: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const season = getCurrentSeason();

    // Already unlocked (Pro/Pro Max/admin/legacy or an active pass this season)?
    // Nothing to buy — tell the client so it can just lift the wall.
    if (isReadsUnlocked(user)) {
      return NextResponse.json({ alreadyUnlocked: true });
    }

    // Get or create the Stripe customer.
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { userId },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    // Dedicated Season Pass price (separate product from the single-parcel
    // unlock). Falls back to the legacy $19 hunt-plan price so checkout can
    // never break if the dedicated var is ever missing.
    const priceId =
      process.env.STRIPE_SEASON_PASS_PRICE_ID || process.env.STRIPE_HUNT_PLAN_PRICE_ID;
    if (!priceId) {
      return NextResponse.json({ error: 'Season Pass price not configured' }, { status: 500 });
    }

    const origin = req.headers.get('origin') || process.env.NEXTAUTH_URL || '';

    // Preserve parcel context so the shopper returns to the same read.
    const parcelQuery =
      (Number.isFinite(lat) && Number.isFinite(lng))
        ? `&lat=${lat}&lng=${lng}${address ? `&address=${encodeURIComponent(address)}` : ''}`
        : '';

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/intel?season_pass=success${parcelQuery}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/intel?season_pass=cancelled${parcelQuery}`,
      metadata: {
        userId,
        purchaseType: 'season_pass',
        season,
      },
    });

    console.log('[reads/unlock] Season Pass checkout session:', checkoutSession.id, 'for', email, 'season:', season);

    // Server-side funnel event — one checkout_initiated per real attempt.
    try {
      await prisma.funnelEvent.create({
        data: {
          event: 'checkout_initiated',
          address: email,
          metadata: JSON.stringify({
            productType: 'season_pass',
            price: 19,
            season,
            stripeSessionId: checkoutSession.id,
          }),
        },
      });
    } catch (funnelErr) {
      console.error('[reads/unlock] Funnel event log failed:', funnelErr);
    }

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err: any) {
    console.error('[reads/unlock] Error:', {
      message: err?.message,
      type: err?.type,
      code: err?.code,
      raw: err?.raw?.message,
    });
    const detail = err?.raw?.message || err?.message || 'Unknown error';
    return NextResponse.json({ error: `Checkout failed: ${detail}` }, { status: 500 });
  }
}
