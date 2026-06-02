import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const data = await request.json();

    // Server-side validation
    const { first_name, email, state, approx_acreage, landowner_type } = data;
    if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0 || first_name.length > 80) {
      return NextResponse.json({ success: false, message: 'Valid first name is required (max 80 chars).' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return NextResponse.json({ success: false, message: 'Valid email is required.' }, { status: 400 });
    }
    const validStates = ['Missouri', 'Kansas', 'Iowa', 'Oklahoma', 'Other'];
    if (!state || !validStates.includes(state)) {
      return NextResponse.json({ success: false, message: 'Valid state is required.' }, { status: 400 });
    }
    if (!approx_acreage || typeof approx_acreage !== 'string' || approx_acreage.trim().length === 0 || approx_acreage.length > 40) {
      return NextResponse.json({ success: false, message: 'Approximate acreage is required (max 40 chars).' }, { status: 400 });
    }
    if (!landowner_type || !['personal', 'commercial'].includes(landowner_type)) {
      return NextResponse.json({ success: false, message: 'Landowner type must be personal or commercial.' }, { status: 400 });
    }

    // Insert into database
    const signup = await prisma.foundingPropertySignup.create({
      data: {
        firstName: first_name.trim(),
        email: email.trim().toLowerCase(),
        state,
        approxAcreage: approx_acreage.trim(),
        landownerType: landowner_type,
      },
    });

    const appUrl = process.env.NEXTAUTH_URL || 'https://terrafirma.partners';
    const senderEmail = `noreply@${new URL(appUrl).hostname}`;

    // EMAIL 1 — Notify Clark
    let notifiedClark = false;
    try {
      const adminRes = await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_token: process.env.ABACUSAI_API_KEY,
          app_id: process.env.WEB_APP_ID,
          notification_id: process.env.NOTIF_ID_FOUNDING_PROPERTY_SIGNUP_ADMIN_ALERT,
          subject: `New Founding Property signup — ${state} ${approx_acreage}`,
          body: `New signup on terrafirma.partners/listings:\n\nName: ${first_name.trim()}\nEmail: ${email.trim()}\nState: ${state}\nAcreage: ${approx_acreage.trim()}\nType: ${landowner_type}\nSubmitted: ${signup.createdAt.toISOString()}\n\nReply directly to this email to reach the signup, or visit /admin/founding-signups to see full list.`,
          is_html: false,
          recipient_email: 'cwc2030@gmail.com',
          reply_to: email.trim(),
          sender_email: senderEmail,
          sender_alias: 'Terra Firma Partners',
        }),
      });
      const adminResult = await adminRes.json();
      if (adminResult.success || adminResult.notification_disabled) {
        notifiedClark = true;
      }
    } catch (e) {
      console.error('[FoundingSignup] Failed to notify Clark:', e);
    }

    // Update notifiedClark flag
    if (notifiedClark) {
      await prisma.foundingPropertySignup.update({
        where: { id: signup.id },
        data: { notifiedClark: true },
      });
    }

    // EMAIL 2 or 3 — Auto-response based on landowner_type
    try {
      if (landowner_type === 'personal') {
        await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deployment_token: process.env.ABACUSAI_API_KEY,
            app_id: process.env.WEB_APP_ID,
            notification_id: process.env.NOTIF_ID_FOUNDING_PROPERTY_PERSONAL_WELCOME,
            subject: 'Welcome to the Founding Properties cohort',
            body: `Hi ${first_name.trim()},\n\nThanks for raising your hand. You're in the running for one of the 50 Founding Property spots on the TFP Hunting Marketplace.\n\nI'm Clark — I run TFP. I'll personally reach out within the next week. I prioritize properties in Missouri, Kansas, Iowa, and Oklahoma first (we're launching in those four states), then everyone else. If you're outside that quad, I'll still get to you — just be patient with me. Family farms first.\n\nWhat to expect when we connect:\n- A 15-minute call to talk through your property and what you're looking for\n- If we're a fit, we schedule a property walk and a Terrain Brain analysis\n- You get a hunter-grade map of your land + Founding Property status: free listing for life, featured placement at launch, vetted hunters only\n- Zero cost, zero obligation\n\nTalk soon.\n\nClark Colwell\nFounder, Terra Firma Partners`,
            is_html: false,
            recipient_email: email.trim(),
            reply_to: 'cwc2030@gmail.com',
            sender_email: senderEmail,
            sender_alias: 'Clark Colwell — Terra Firma Partners',
          }),
        });
      } else {
        await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deployment_token: process.env.ABACUSAI_API_KEY,
            app_id: process.env.WEB_APP_ID,
            notification_id: process.env.NOTIF_ID_FOUNDING_PROPERTY_COMMERCIAL_BATCH_2,
            subject: "Thanks — let's talk in batch 2",
            body: `Hi ${first_name.trim()},\n\nAppreciate the interest. To keep the first wave focused on individual landowners and family farms, the Founding Property cohort is limited to family-owned and personally-managed properties only.\n\nCommercial enrollment opens in batch 2 (post-September 2026), with a separate dashboard and listing format designed for multi-property operations.\n\nI'll keep you on the list and reach out when batch 2 enrollment opens. If your operation has special context that makes you a fit for the Founding cohort anyway, reply and tell me about it — happy to consider exceptions.\n\nClark Colwell\nFounder, Terra Firma Partners`,
            is_html: false,
            recipient_email: email.trim(),
            reply_to: 'cwc2030@gmail.com',
            sender_email: senderEmail,
            sender_alias: 'Clark Colwell — Terra Firma Partners',
          }),
        });
      }
    } catch (e) {
      console.error('[FoundingSignup] Failed to send auto-response:', e);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[FoundingSignup] Error:', error);
    return NextResponse.json({ success: false, message: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

// GET — return personal signup count for cap logic
export async function GET() {
  try {
    const count = await prisma.foundingPropertySignup.count({
      where: {
        landownerType: 'personal',
        status: { not: 'declined' },
      },
    });
    return NextResponse.json({ count });
  } catch (error) {
    console.error('[FoundingSignup] Count error:', error);
    return NextResponse.json({ count: 0 });
  }
}
