import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover' as any,
});

// Determine subscription tier from Stripe price ID
function getTierFromPriceId(priceId: string | null): 'pro' | 'promax' {
  const promaxIds = [
    process.env.STRIPE_PROMAX_ANNUAL_PRICE_ID,
    process.env.STRIPE_PROMAX_MONTHLY_PRICE_ID,
    process.env.STRIPE_PRO_MAX_YEARLY_PRICE_ID,
    process.env.STRIPE_PRO_MAX_MONTHLY_PRICE_ID,
  ].filter(Boolean);

  if (priceId && promaxIds.includes(priceId)) {
    return 'promax';
  }
  return 'pro';
}

// Health-check GET so we can verify the route is reachable
export async function GET() {
  return NextResponse.json({ status: 'ok', route: '/api/stripe-webhook', ts: Date.now() });
}

// ── Background processor: runs AFTER the 200 response is sent ──
async function processWebhookEvent(event: Stripe.Event) {
  try {
    // ── Checkout session completed ──
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    }

    // ── Subscription created or updated → activate tier ──
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      await handleSubscriptionChange(event.type, event.data.object as Stripe.Subscription);
    }

    // ── Subscription deleted → revert to free ──
    if (event.type === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
    }
  } catch (err: any) {
    // Log but never throw — this runs after the response was already sent
    console.error('[webhook-bg] Unhandled error processing', event.type, ':', err.message, err.stack);
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.orderId;

  if (session.mode === 'subscription' || session.subscription) {
    const stripeCustomerId = session.customer as string | null;
    const customerEmail = session.customer_email || session.customer_details?.email || null;
    const subscriptionId = (session.subscription as string) || null;

    console.log('[webhook] checkout.session.completed (subscription)', {
      stripeCustomerId, customerEmail, subscriptionId, sessionId: session.id,
    });

    let user = stripeCustomerId
      ? await prisma.user.findUnique({ where: { stripeCustomerId } })
      : null;

    if (!user && customerEmail) {
      user = await prisma.user.findUnique({ where: { email: customerEmail } });
    }

    if (!user && session.metadata?.userId) {
      user = await prisma.user.findUnique({ where: { id: session.metadata.userId } });
    }

    if (!user) {
      console.warn('[webhook] No user found for subscription checkout, customer:', stripeCustomerId, 'email:', customerEmail);
      return;
    }

    // Resolve the price from the subscription to determine tier
    let resolvedTier: 'pro' | 'promax' = 'pro';
    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price?.id || null;
        resolvedTier = getTierFromPriceId(priceId);
      } catch (e: any) {
        console.warn('[webhook] Could not retrieve subscription for tier resolution:', e.message);
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeCustomerId: stripeCustomerId || user.stripeCustomerId,
        stripeSubscriptionId: subscriptionId || user.stripeSubscriptionId,
        subscriptionStatus: resolvedTier,
      },
    });
    console.log('[webhook] User', user.email, '→', resolvedTier, '(via checkout.session.completed)');

  } else if (session.metadata?.purchaseType === 'hunt_plan') {
    // ── $19 one-time parcel hunt plan purchase ──
    await handleHuntPlanPurchase(session);

  } else if (orderId) {
    // ── One-time payment checkout — mark order as paid ──
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'paid',
        stripeSessionId: session.id,
      },
    });
    console.log('[webhook] Order', orderId, 'marked as paid');

  } else {
    console.warn('[webhook] checkout.session.completed with no subscription and no orderId, session:', session.id);
  }
}

async function handleHuntPlanPurchase(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const parcelLat = parseFloat(session.metadata?.parcelLat || '');
  const parcelLng = parseFloat(session.metadata?.parcelLng || '');
  const parcelAddress = session.metadata?.parcelAddress || null;
  const parcelAcreage = parseFloat(session.metadata?.parcelAcreage || '') || null;

  if (!userId || isNaN(parcelLat) || isNaN(parcelLng)) {
    console.error('[webhook] hunt_plan purchase missing required metadata:', session.metadata);
    return;
  }

  // Upsert to avoid duplicates
  await prisma.parcelPurchase.upsert({
    where: {
      userId_parcelLat_parcelLng: {
        userId,
        parcelLat,
        parcelLng,
      },
    },
    create: {
      userId,
      parcelLat,
      parcelLng,
      parcelAddress,
      parcelAcreage,
      stripeSessionId: session.id,
      purchaseType: 'hunt_plan',
      amount: 1900,
    },
    update: {
      stripeSessionId: session.id,
    },
  });

  console.log('[webhook] Hunt plan purchased for user', userId, 'parcel:', parcelAddress || `${parcelLat},${parcelLng}`);
}

async function handleSubscriptionChange(eventType: string, subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const status = subscription.status;
  const firstItem = subscription.items.data[0];
  const priceId = firstItem?.price?.id || null;

  // current_period_end lives on the subscription object (cast for newer Stripe types)
  const rawPeriodEnd = (subscription as any).current_period_end as number | undefined;
  const currentPeriodEnd = rawPeriodEnd
    ? new Date(rawPeriodEnd * 1000)
    : null;

  console.log('[webhook]', eventType, '→', subscription.id, 'status:', status, 'price:', priceId, 'customer:', customerId);

  let user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });

  if (!user) {
    // First subscription — resolve customer email and link
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        console.warn('[webhook] Customer deleted, skipping');
        return;
      }
      const email = (customer as Stripe.Customer).email;
      if (email) {
        user = await prisma.user.findUnique({ where: { email } });
      }
    } catch (e: any) {
      console.warn('[webhook] Could not retrieve customer:', e.message);
    }
  }

  if (!user) {
    console.warn('[webhook] No matching user for customer', customerId);
    return;
  }

  const isActive = status === 'active' || status === 'trialing';
  const tier = getTierFromPriceId(priceId);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      subscriptionStatus: isActive ? tier : status,
      subscriptionEnds: currentPeriodEnd,
    },
  });
  console.log('[webhook] User', user.email, '→ subscriptionStatus:', isActive ? tier : status);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  console.log('[webhook] Subscription deleted:', subscription.id, 'customer:', customerId);

  const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionStatus: 'free',
        stripeSubscriptionId: null,
        stripePriceId: null,
        subscriptionEnds: null,
      },
    });
    console.log('[webhook] User', user.email, '→ subscriptionStatus: free');
  } else {
    console.warn('[webhook] No user found for customer', customerId, '(deletion)');
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error('[webhook] Missing signature or secret');
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error('[webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  console.log('[webhook] ✓ Verified event:', event.type, event.id);

  // Fire-and-forget: process in background, respond immediately
  // This prevents Stripe timeouts — all DB/API work happens after the 200
  processWebhookEvent(event).catch((err) => {
    console.error('[webhook-bg] Fatal error in background processing:', err);
  });

  return NextResponse.json({ received: true });
}
