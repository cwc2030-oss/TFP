/**
 * /api/stand-journal
 *
 * GET  ?sitPinId=<uuid>  → list the logged-in user's journal entries for that sit pin
 * POST { sitPinId, entryDate, windDirection, tempF, sightings, notes }
 *                        → create a journal entry (Pro-only, must own the sit pin)
 *
 * Storage: Supabase spatial Postgres (SUPABASE_SPATIAL_DB_URL) via pg pool.
 * Auth:    NextAuth session (user_id = session.user.id).
 *
 * Follows the same pattern as /api/sit-pins/route.ts — security is enforced
 * at the API layer, not via Supabase Auth / RLS.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { spatialQuery } from "@/lib/spatial-db";

export const dynamic = "force-dynamic";

export interface StandJournalRow {
  id: string;
  user_id: string;
  sit_pin_id: string;
  entry_date: string; // ISO date (YYYY-MM-DD)
  wind_direction: string | null;
  temp_f: number | null;
  sightings: string | null;
  notes: string | null;
  created_at: string;
}

function isPro(status?: string | null): boolean {
  return status === "pro" || status === "promax";
}

// -------------------------------------------------------------------------
// GET — list current user's journal entries for one sit pin
// -------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const sitPinId = request.nextUrl.searchParams.get("sitPinId");
    if (!sitPinId) {
      return NextResponse.json({ entries: [] });
    }

    const result = await spatialQuery<StandJournalRow>(
      `SELECT id, user_id, sit_pin_id,
              to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
              wind_direction, temp_f, sightings, notes, created_at
         FROM public.user_stand_journal
        WHERE user_id = $1 AND sit_pin_id = $2
        ORDER BY entry_date DESC, created_at DESC`,
      [userId, sitPinId]
    );

    return NextResponse.json({ entries: result.rows });
  } catch (err) {
    console.error("[stand-journal GET] error:", err);
    return NextResponse.json(
      { error: "Failed to load journal entries" },
      { status: 500 }
    );
  }
}

// -------------------------------------------------------------------------
// POST — create a journal entry (Pro-only, user must own the sit pin)
// -------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const subStatus = (session?.user as any)?.subscriptionStatus as
      | string
      | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (!isPro(subStatus)) {
      return NextResponse.json(
        { error: "Pro subscription required", code: "UPGRADE_REQUIRED" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));

    const sitPinId: string =
      typeof body.sitPinId === "string" ? body.sitPinId.trim() : "";
    const entryDate: string =
      typeof body.entryDate === "string" ? body.entryDate.trim() : "";
    const windDirection: string | null =
      typeof body.windDirection === "string" && body.windDirection.trim()
        ? body.windDirection.trim().slice(0, 20)
        : null;
    const sightings: string | null =
      typeof body.sightings === "string" && body.sightings.trim()
        ? body.sightings.trim().slice(0, 2000)
        : null;
    const notes: string | null =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim().slice(0, 2000)
        : null;

    let tempF: number | null = null;
    if (body.tempF !== undefined && body.tempF !== null && body.tempF !== "") {
      const n = Number(body.tempF);
      if (!Number.isFinite(n) || n < -60 || n > 150) {
        return NextResponse.json(
          { error: "tempF must be an integer between -60 and 150" },
          { status: 400 }
        );
      }
      tempF = Math.round(n);
    }

    // Validate required fields
    if (!sitPinId) {
      return NextResponse.json(
        { error: "sitPinId is required" },
        { status: 400 }
      );
    }
    if (!entryDate) {
      return NextResponse.json(
        { error: "entryDate is required" },
        { status: 400 }
      );
    }
    // Basic YYYY-MM-DD shape check; Postgres will do final date parsing.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      return NextResponse.json(
        { error: "entryDate must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    // Verify the sit pin belongs to this user before attaching a journal entry.
    const ownership = await spatialQuery<{ id: string }>(
      `SELECT id FROM public.user_sit_pins
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [sitPinId, userId]
    );
    if (ownership.rowCount === 0) {
      return NextResponse.json(
        { error: "Sit pin not found" },
        { status: 404 }
      );
    }

    const result = await spatialQuery<StandJournalRow>(
      `INSERT INTO public.user_stand_journal
         (user_id, sit_pin_id, entry_date, wind_direction, temp_f, sightings, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, sit_pin_id,
                 to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
                 wind_direction, temp_f, sightings, notes, created_at`,
      [userId, sitPinId, entryDate, windDirection, tempF, sightings, notes]
    );

    return NextResponse.json({ entry: result.rows[0] }, { status: 201 });
  } catch (err) {
    console.error("[stand-journal POST] error:", err);
    return NextResponse.json(
      { error: "Failed to save journal entry" },
      { status: 500 }
    );
  }
}
