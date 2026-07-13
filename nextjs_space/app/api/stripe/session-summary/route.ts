export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { stripe } from "@/lib/stripe";

/**
 * GET /api/stripe/session-summary?session_id=cs_...
 *
 * Returns the REAL confirmed amount for a completed Stripe checkout session
 * so the browser can fire a GA4 `purchase` event with accurate revenue.
 * The amount comes straight from Stripe (amount_total) — never a hardcoded
 * map — so if a price changes in Stripe, GA4 revenue follows automatically.
 *
 * Ownership is enforced: the session's metadata.userId must match the
 * authenticated user, so one user can't read another's transaction.
 *
 * Response: { transactionId, value, currency, tier, paid }
 *   tier ∈ 'pro' | 'pro_max' | 'parcel_unlock' | 'unknown'
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const sessionId = req.nextUrl.searchParams.get("session_id");
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    const checkout = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items"],
    });

    // Only surface a purchase for genuinely completed payments.
    const paid = checkout.payment_status === "paid" || checkout.status === "complete";

    // Ownership guard — the session must belong to the caller.
    if (checkout.metadata?.userId && checkout.metadata.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const value = (checkout.amount_total ?? 0) / 100;
    const currency = (checkout.currency || "usd").toUpperCase();

    // Derive the tier from the purchased price ID (subscriptions) or the
    // one-time metadata (parcel unlock). Price IDs are the source of truth.
    const priceId = checkout.line_items?.data?.[0]?.price?.id || null;
    const tier = resolveTier(priceId, checkout.metadata?.purchaseType);

    return NextResponse.json({
      transactionId: checkout.id,
      value,
      currency,
      tier,
      paid,
    });
  } catch (err: any) {
    console.error("[stripe/session-summary] Error:", err?.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}

function resolveTier(priceId: string | null, purchaseType?: string): string {
  if (purchaseType === "season_pass") return "season_pass";
  if (purchaseType === "hunt_plan") return "parcel_unlock";
  if (!priceId) return "unknown";
  const pro = [
    process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
  ].filter(Boolean);
  const promax = [
    process.env.STRIPE_PROMAX_ANNUAL_PRICE_ID,
    process.env.STRIPE_PROMAX_MONTHLY_PRICE_ID,
  ].filter(Boolean);
  if (promax.includes(priceId)) return "pro_max";
  if (pro.includes(priceId)) return "pro";
  if (priceId === process.env.STRIPE_SEASON_PASS_PRICE_ID) return "season_pass";
  if (priceId === process.env.STRIPE_HUNT_PLAN_PRICE_ID) return "parcel_unlock";
  return "unknown";
}
