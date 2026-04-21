import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  // Ensure the property belongs to this user
  const prop = await prisma.savedProperty.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!prop) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.savedProperty.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
