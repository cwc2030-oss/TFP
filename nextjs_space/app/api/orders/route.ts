import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // First find the user by email
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ orders: [] });
    }

    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { userId: user.id },
          { guestEmail: session.user.email },
        ],
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}

// One-time report products have been discontinued. Keep POST as a safety stub
// so any lingering client callers receive a clear 410 Gone response rather than
// silently succeeding. Active SKUs: $19 parcel unlock (/api/parcels/purchase),
// $99/yr Pro subscription, $199/yr Pro Max subscription.
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: "One-time report products are no longer available. Please use parcel unlock or subscribe to Pro for full access." },
    { status: 410 }
  );
}
