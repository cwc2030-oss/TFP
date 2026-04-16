export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const { plan, tier = 'pro' } = await req.json();

    // Resolve price ID based on tier + plan
    const PRICE_MAP: Record<string, Record<string, string | undefined>> = {
      pro: {
        annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
        monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      },
      promax: {
        annual: process.env.STRIPE_PROMAX_ANNUAL_PRICE_ID,
        monthly: process.env.STRIPE_PROMAX_MONTHLY_PRICE_ID,
      },
    };

    const priceId = PRICE_MAP[tier]?.[plan] || null;

    if (!priceId) {
      return NextResponse.json({ error: "Invalid plan or tier" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Re-use existing Stripe customer or create new
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // If already subscribed at or above requested tier, return info
    const currentStatus = user.subscriptionStatus || 'free';
    if ((currentStatus === 'pro' || currentStatus === 'promax') && user.stripeSubscriptionId) {
      // Allow upgrade from pro → promax via Stripe portal
      if (currentStatus === 'pro' && tier === 'promax') {
        // Let them proceed to checkout for the upgrade
      } else {
        return NextResponse.json({ alreadySubscribed: true, currentTier: currentStatus }, { status: 200 });
      }
    }

    const origin = req.headers.get("origin") || process.env.NEXTAUTH_URL || "";

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/intel?upgrade=success`,
      cancel_url: `${origin}/intel?upgrade=cancelled`,
      metadata: {
        userId: user.id,
      },
    });

    console.log("[stripe/checkout] Session created:", checkoutSession.id, "for user:", user.email);

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err: any) {
    console.error("[stripe/checkout] Error:", err.message);
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
