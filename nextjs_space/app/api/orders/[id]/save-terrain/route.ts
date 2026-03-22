import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { terrainPayload } = await req.json();
    await prisma.order.update({
      where: { id: params.id },
      data: {
        terrainData: JSON.stringify(terrainPayload),
      },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[save-terrain]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
