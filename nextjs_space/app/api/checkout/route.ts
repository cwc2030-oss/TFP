import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await request.json();
    const { orderId } = body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    const origin = request.headers.get("origin") || "http://localhost:3000";

    // If Stripe is not configured, return placeholder response
    if (!stripe) {
      // Simulate checkout by updating order status
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "demo_checkout",
          paymentIntentId: `demo_${Date.now()}`,
        },
      });

      return NextResponse.json({
        url: `${origin}/checkout/success?orderId=${orderId}&demo=true`,
        message: "Demo mode - Stripe not configured",
      });
    }

    const PRODUCT_INFO: Record<string, { name: string; description: string }> = {
      hunt_report: {
        name: 'TerraFirma Hunt Intelligence Report',
        description: 'Complete terrain analysis, intercept placement, wind strategy, and satellite hunt map. Indefinite parcel access included.',
      },
      land_report: {
        name: 'TerraFirma Land Intelligence Report',
        description: 'Comprehensive land analysis including terrain, water, access, valuation, and market data.',
      },
    };
    const productInfo = PRODUCT_INFO[order.productType] ?? { name: 'TerraFirma Report', description: '' };

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: productInfo.name,
              description: `Property: ${order.parcelAddress}\n${productInfo.description}`,
            },
            unit_amount: order.price,
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/checkout/success?orderId=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout/cancel?orderId=${orderId}`,
      metadata: {
        orderId: order.id,
        userId: session?.user?.id || "guest",
      },
      customer_email: session?.user?.email || order.guestEmail || undefined,
    });

    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentIntentId: checkoutSession.id,
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
