export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/db';

/**
 * POST /api/parcels/purchase
 * Creates a Stripe checkout session for a $19 one-time parcel unlock.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const { lat, lng, address, acreage } = await req.json();

    if (!lat || !lng) {
      return NextResponse.json({ error: 'Missing parcel coordinates' }, { status: 400 });
    }

    // Check if already purchased
    const TOLERANCE = 0.0001;
    const existing = await prisma.parcelPurchase.findFirst({
      where: {
        userId: session.user.id,
        parcelLat: { gte: lat - TOLERANCE, lte: lat + TOLERANCE },
        parcelLng: { gte: lng - TOLERANCE, lte: lng + TOLERANCE },
      },
    });

    if (existing) {
      return NextResponse.json({ alreadyPurchased: true });
    }

    // Check if user is Pro (shouldn't need to buy, but just in case).
    // Admins are exempt from this short-circuit so they can run real $19
    // checkouts end-to-end for QA/testing without comping themselves.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subscriptionStatus: true, stripeCustomerId: true, role: true },
    });

    const subStatus = user?.subscriptionStatus || 'free';
    const isAdmin = user?.role === 'admin';
    if ((subStatus === 'pro' || subStatus === 'promax') && !isAdmin) {
      console.log('[parcels/purchase] Pro/ProMax short-circuit for', session.user.email, 'subStatus=', subStatus);
      return NextResponse.json({ alreadyPurchased: true, isPro: true });
    }
    if ((subStatus === 'pro' || subStatus === 'promax') && isAdmin) {
      console.log('[parcels/purchase] Admin override — allowing Pro/ProMax admin to run real checkout for', session.user.email, 'subStatus=', subStatus);
    }

    // Get or create Stripe customer
    let customerId = user?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        metadata: { userId: session.user.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: session.user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const priceId = process.env.STRIPE_HUNT_PLAN_PRICE_ID;
    if (!priceId) {
      return NextResponse.json({ error: 'Hunt plan price not configured' }, { status: 500 });
    }

    const origin = req.headers.get('origin') || process.env.NEXTAUTH_URL || '';

    console.log('[parcels/purchase] PRE-STRIPE', {
      userId: session.user.id,
      email: session.user.email,
      priceId,
      origin,
      customerId,
      lat,
      lng,
      address,
      acreage,
      subStatus,
      isAdmin,
    });

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/intel?parcel_unlocked=true&lat=${lat}&lng=${lng}`,
      cancel_url: `${origin}/intel?parcel_unlocked=cancelled`,
      metadata: {
        userId: session.user.id,
        purchaseType: 'hunt_plan',
        parcelLat: String(lat),
        parcelLng: String(lng),
        parcelAddress: address || '',
        parcelAcreage: String(acreage || ''),
      },
    });

    console.log('[parcels/purchase] Checkout session:', checkoutSession.id, 'for', session.user.email, 'parcel:', address);

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err: any) {
    console.error('[parcels/purchase] Error:', {
      message: err?.message,
      type: err?.type,
      code: err?.code,
      statusCode: err?.statusCode,
      raw: err?.raw?.message,
      stack: err?.stack?.split('\n').slice(0, 4).join('\n'),
    });
    const detail = err?.raw?.message || err?.message || 'Unknown error';
    return NextResponse.json({ error: `Checkout failed: ${detail}` }, { status: 500 });
  }
}
