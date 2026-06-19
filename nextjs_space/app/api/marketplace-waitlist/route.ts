import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { side, email, name, state, acres } = data;

    // Validate
    if (!side || !['HUNTER', 'LANDOWNER'].includes(side)) {
      return NextResponse.json({ success: false, message: 'Please choose Hunter or Landowner.' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return NextResponse.json({ success: false, message: 'Valid email is required.' }, { status: 400 });
    }

    // Check for duplicate
    const existing = await prisma.waitlist.findFirst({
      where: { email: email.trim().toLowerCase(), side },
    });
    if (existing) {
      return NextResponse.json({ success: true, message: 'You\'re already on the list!' });
    }

    // Create waitlist entry
    await prisma.waitlist.create({
      data: {
        side: side as 'HUNTER' | 'LANDOWNER',
        email: email.trim().toLowerCase(),
        name: name?.trim() || null,
        state: side === 'LANDOWNER' ? (state?.trim() || null) : null,
        states: side === 'HUNTER' && state ? state.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        acres: side === 'LANDOWNER' && acres ? parseFloat(acres) || null : null,
        source: 'marketplace_coming_soon',
      },
    });

    // Send notification email to Clark
    try {
      const appUrl = process.env.NEXTAUTH_URL || '';
      const appName = 'Terra Firma Partners';
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #065f46; border-bottom: 2px solid #059669; padding-bottom: 10px;">
            New Marketplace Waitlist Signup
          </h2>
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 8px 0;"><strong>Side:</strong> ${side === 'HUNTER' ? '🎯 Hunter' : '🌲 Landowner'}</p>
            <p style="margin: 8px 0;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            ${name ? `<p style="margin: 8px 0;"><strong>Name:</strong> ${name}</p>` : ''}
            ${state ? `<p style="margin: 8px 0;"><strong>State:</strong> ${state}</p>` : ''}
            ${acres ? `<p style="margin: 8px 0;"><strong>Acres:</strong> ~${acres}</p>` : ''}
          </div>
          <p style="color: #666; font-size: 12px;">Source: Marketplace Coming Soon page</p>
        </div>
      `;

      await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_token: process.env.ABACUSAI_API_KEY,
          app_id: process.env.WEB_APP_ID,
          notification_id: process.env.NOTIF_ID_MARKETPLACE_WAITLIST_SIGNUP,
          subject: `Marketplace Waitlist: ${side === 'HUNTER' ? 'Hunter' : 'Landowner'} signup — ${email}`,
          body: htmlBody,
          is_html: true,
          recipient_email: 'cwc2030@gmail.com',
          reply_to: email.trim().toLowerCase(),
          sender_email: appUrl ? `noreply@${new URL(appUrl).hostname}` : undefined,
          sender_alias: appName,
        }),
      });
    } catch (emailErr) {
      console.error('Waitlist notification email failed (non-blocking):', emailErr);
    }

    return NextResponse.json({ success: true, message: 'Added to waitlist!' });
  } catch (err) {
    console.error('Marketplace waitlist error:', err);
    return NextResponse.json({ success: false, message: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
