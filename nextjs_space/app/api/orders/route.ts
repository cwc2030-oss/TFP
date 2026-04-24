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

// Product pricing configuration (in cents)
const PRICES: Record<string, number> = {
  land_report: 4900,   // $49.00
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await request.json();

    const {
      parcelId,
      parcelAddress,
      parcelLat,
      parcelLng,
      selectedLayers,
      guestEmail,
      productType = "full_report", // Default to full report
    } = body;

    if (!parcelAddress || parcelLat === undefined || parcelLng === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate product type
    const validTypes = ['land_report'];
    if (!validTypes.includes(productType)) {
      return NextResponse.json({ error: 'Invalid product type' }, { status: 400 });
    }

    // Get price based on product type (in cents)
    const price = PRICES[productType] ?? 4900;

    // Get user ID if logged in
    let userId = null;
    if (session?.user?.email) {
      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
      });
      userId = user?.id || null;
    }

    const order = await prisma.order.create({
      data: {
        parcelId,
        parcelAddress,
        parcelLat,
        parcelLng,
        selectedLayers: JSON.stringify(selectedLayers || []),
        price,
        productType,
        status: "pending",
        userId,
        guestEmail: !userId ? guestEmail : null,
      },
    });

    return NextResponse.json({ order });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}
