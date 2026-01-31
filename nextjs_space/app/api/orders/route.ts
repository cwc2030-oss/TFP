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
    } = body;

    if (!parcelAddress || parcelLat === undefined || parcelLng === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

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
        price: 350,
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
