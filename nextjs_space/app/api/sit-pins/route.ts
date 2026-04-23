/**
 * /api/sit-pins
 *
 * GET  ?parcelId=<id>  → list the logged-in user's sit pins for that parcel
 * POST { parcelId, name, lng, lat }    → persist a new pin (Pro-only)
 *
 * Storage: Supabase spatial Postgres (SUPABASE_SPATIAL_DB_URL) via pg pool.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { spatialQuery } from "@/lib/spatial-db";

export const dynamic = "force-dynamic";

export interface SitPinRow {
  id: string;
  user_id: string;
  parcel_id: string;
  name: string;
  lng: number;
  lat: number;
  created_at: string;
}

function isPro(status?: string | null): boolean {
  return status === "pro" || status === "promax";
}

// -------------------------------------------------------------------------
// GET — list current user's pins for a parcel
// -------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parcelId = request.nextUrl.searchParams.get("parcelId");
    if (!parcelId) {
      return NextResponse.json({ pins: [] });
    }

    const result = await spatialQuery<SitPinRow>(
      `SELECT id, user_id, parcel_id, name, lng, lat, created_at
         FROM public.user_sit_pins
        WHERE user_id = $1 AND parcel_id = $2
        ORDER BY created_at ASC`,
      [userId, parcelId]
    );

    return NextResponse.json({ pins: result.rows });
  } catch (err) {
    console.error("[sit-pins GET] error:", err);
    return NextResponse.json({ error: "Failed to load sit pins" }, { status: 500 });
  }
}

// -------------------------------------------------------------------------
// POST — create a new pin (Pro-only)
// -------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const subStatus = (session?.user as any)?.subscriptionStatus as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isPro(subStatus)) {
      return NextResponse.json(
        { error: "Pro subscription required", code: "UPGRADE_REQUIRED" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parcelId: string = typeof body.parcelId === "string" ? body.parcelId.trim() : "";
    const rawName: string = typeof body.name === "string" ? body.name : "";
    const name = rawName.trim().slice(0, 20);
    const lng = Number(body.lng);
    const lat = Number(body.lat);

    if (!parcelId) {
      return NextResponse.json({ error: "parcelId is required" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return NextResponse.json({ error: "lng and lat must be numbers" }, { status: 400 });
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return NextResponse.json({ error: "lng/lat out of range" }, { status: 400 });
    }

    const result = await spatialQuery<SitPinRow>(
      `INSERT INTO public.user_sit_pins (user_id, parcel_id, name, lng, lat)
            VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, parcel_id, name, lng, lat, created_at`,
      [userId, parcelId, name, lng, lat]
    );

    return NextResponse.json({ pin: result.rows[0] }, { status: 201 });
  } catch (err) {
    console.error("[sit-pins POST] error:", err);
    return NextResponse.json({ error: "Failed to save sit pin" }, { status: 500 });
  }
}
