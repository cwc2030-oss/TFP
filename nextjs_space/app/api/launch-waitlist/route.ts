import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { first_name, email, state } = data;

    if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0 || first_name.length > 80) {
      return NextResponse.json({ success: false, message: 'Valid first name is required.' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return NextResponse.json({ success: false, message: 'Valid email is required.' }, { status: 400 });
    }
    const validStates = ['Missouri', 'Kansas', 'Iowa', 'Oklahoma', 'Other'];
    if (!state || !validStates.includes(state)) {
      return NextResponse.json({ success: false, message: 'Valid state is required.' }, { status: 400 });
    }

    await prisma.launchWaitlist.create({
      data: {
        firstName: first_name.trim(),
        email: email.trim().toLowerCase(),
        state,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LaunchWaitlist] Error:', error);
    return NextResponse.json({ success: false, message: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
