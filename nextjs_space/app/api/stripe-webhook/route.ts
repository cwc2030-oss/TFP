import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover' as any,
});

// Health-check GET so we can verify the route is reachable
export async function GET() {
  return NextResponse.json({ status: 'ok', route: '/api/stripe-webhook', ts: Date.now() });
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

  // ── Checkout session completed (one-time purchases) ──
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId;

    if (!orderId) {
      console.error('[webhook] No orderId in session metadata');
      return NextResponse.json({ error: 'No orderId' }, { status: 400 });
    }

    try {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'paid',
          stripeSessionId: session.id,
        },
      });
      console.log('[webhook] Order', orderId, 'marked as paid');
    } catch (err: any) {
      console.error('[webhook] Failed to update order:', err.message);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }
  }

  // ── Subscription created or updated → activate Pro ──
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;
    const status = subscription.status; // 'active', 'trialing', 'past_due', 'canceled', etc.
    const firstItem = subscription.items.data[0];
    const priceId = firstItem?.price?.id || null;
    const currentPeriodEnd = firstItem?.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : null;

    console.log('[webhook] Subscription', event.type, '→', subscription.id, 'status:', status, 'customer:', customerId);

    try {
      // Find user by stripeCustomerId, or fall back to customer email
      let user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });

      if (!user) {
        // First subscription — resolve customer email and link
        const customer = await stripe.customers.retrieve(customerId);
        if (customer.deleted) {
          console.warn('[webhook] Customer deleted, skipping');
          return NextResponse.json({ received: true });
        }
        const email = (customer as Stripe.Customer).email;
        if (email) {
          user = await prisma.user.findUnique({ where: { email } });
        }
      }

      if (!user) {
        console.warn('[webhook] No matching user for customer', customerId);
        return NextResponse.json({ received: true });
      }

      const isPro = status === 'active' || status === 'trialing';
      await prisma.user.update({
        where: { id: user.id },
        data: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          subscriptionStatus: isPro ? 'pro' : status,
          subscriptionEnds: currentPeriodEnd,
        },
      });
      console.log('[webhook] User', user.email, '→ subscriptionStatus:', isPro ? 'pro' : status);
    } catch (err: any) {
      console.error('[webhook] Subscription update failed:', err.message);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }
  }

  // ── Subscription deleted → revert to free ──
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    console.log('[webhook] Subscription deleted:', subscription.id, 'customer:', customerId);

    try {
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
    } catch (err: any) {
      console.error('[webhook] Subscription deletion handler failed:', err.message);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}

