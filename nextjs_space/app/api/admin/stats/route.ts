import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const totalUsers = await prisma.user.count();
    const totalOrders = await prisma.order.count();
    const completedOrders = await prisma.order.count({
      where: { status: "completed" },
    });

    const recentOrders = await prisma.order.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { name: true, email: true },
        },
      },
    });

    const revenue = completedOrders * 350;

    // Get orders by day for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentOrdersByDay = await prisma.order.groupBy({
      by: ["createdAt"],
      where: {
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
      _count: true,
    });

    return NextResponse.json({
      stats: {
        totalUsers,
        totalOrders,
        completedOrders,
        revenue,
      },
      recentOrders,
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
