import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// One-time report products (Land Report / Hunt Report / Broker Quick Look) are
// discontinued. Active checkout flows are now handled exclusively by:
//   - /api/parcels/purchase    (single-parcel $19 unlock)
//   - /api/stripe/checkout     (Pro $99/yr and Pro Max $199/yr subscriptions)
// This endpoint returns 410 Gone so stale clients fail loudly.
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error:
        "Report checkout is no longer available. Use parcel unlock or subscribe via /pricing.",
    },
    { status: 410 }
  );
}
