/**
 * /api/sit-pins/[id]
 *
 * DELETE — remove one of the current user's sit pins.
 * Safe against cross-user deletes (user_id must match the session).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { spatialQuery } from "@/lib/spatial-db";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pinId = params?.id;
    if (!pinId) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const result = await spatialQuery<{ id: string }>(
      `DELETE FROM public.user_sit_pins
        WHERE id = $1 AND user_id = $2
        RETURNING id`,
      [pinId, userId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Pin not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("[sit-pins DELETE] error:", err);
    return NextResponse.json({ error: "Failed to delete sit pin" }, { status: 500 });
  }
}
