import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const orders = await prisma.order.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Get orders error:", error);
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
      parcelAddress,
      parcelId,
      parcelLat,
      parcelLng,
      parcelBounds,
      selectedLayers,
      guestEmail,
    } = body;

    if (!parcelAddress || !parcelLat || !parcelLng || !selectedLayers?.length) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const order = await prisma.order.create({
      data: {
        userId: session?.user?.id || null,
        guestEmail: session?.user?.id ? null : guestEmail,
        parcelAddress,
        parcelId: parcelId || null,
        parcelLat,
        parcelLng,
        selectedLayers: JSON.stringify(selectedLayers),
        price: 99,
        status: "pending",
      },
    });

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    console.error("Create order error:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}
