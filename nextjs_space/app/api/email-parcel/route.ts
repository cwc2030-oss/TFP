import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { email, parcel } = data;

    if (!email || !parcel) {
      return NextResponse.json(
        { success: false, message: "Email and parcel data required" },
        { status: 400 }
      );
    }

    // Save lead to database
    try {
      await prisma.lead.create({
        data: {
          email: email.toLowerCase(),
          parcelId: parcel.parcelId || "unknown",
          address: parcel.siteAddress || parcel.address || "Unknown",
          source: "email_parcel",
        },
      });
    } catch (dbError) {
      // Continue even if lead save fails (might be duplicate)
      console.log("Lead save note:", dbError);
    }

    // Build the parcel details
    const acreage = parcel.acreage >= 1 
      ? `${parcel.acreage.toFixed(2)} acres` 
      : `${(parcel.acreage * 43560).toFixed(0)} sq ft`;

    // Get the current app URL for links in email
    const appUrl = process.env.NEXTAUTH_URL || "https://terrafirmapartners.abacusai.app";
    const mapLink = `${appUrl}/map?lat=${parcel.lat}&lng=${parcel.lng}`;

    // Create beautiful HTML email
    const htmlBody = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">🏔️ Terra Firma Partners</h1>
          <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 14px;">Your Saved Parcel Details</p>
        </div>
        
        <!-- Main Content -->
        <div style="padding: 30px; background: white;">
          <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #059669; padding-bottom: 10px;">
            📍 ${parcel.siteAddress || parcel.address || "Property Details"}
          </h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280; width: 40%;">Parcel ID (APN)</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-weight: 600;">${parcel.parcelId || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Owner</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-weight: 600;">${parcel.owner || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Lot Size</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-weight: 600;">${acreage}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Zoning / Use</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-weight: 600;">${parcel.zoning || parcel.useDescription || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #6b7280;">Coordinates</td>
              <td style="padding: 12px 0; color: #1f2937;">${parcel.lat?.toFixed(6)}, ${parcel.lng?.toFixed(6)}</td>
            </tr>
          </table>
          
          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${mapLink}" style="display: inline-block; background: #059669; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">View on Map</a>
          </div>
          
          <!-- Report Upsell -->
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin-top: 20px;">
            <h3 style="color: #166534; margin: 0 0 10px 0; font-size: 16px;">📋 Want the Full Picture?</h3>
            <p style="color: #15803d; margin: 0 0 15px 0; font-size: 14px;">Our $99 Land Analysis Report includes:</p>
            <ul style="color: #166534; margin: 0; padding-left: 20px; font-size: 14px;">
              <li>FEMA Flood Zone Analysis</li>
              <li>Topography & Elevation Maps</li>
              <li>Soil Composition Data</li>
              <li>Property Boundaries (survey-grade)</li>
              <li>Roads & Access Points</li>
            </ul>
            <div style="text-align: center; margin-top: 15px;">
              <a href="${mapLink}" style="display: inline-block; background: #166534; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">Order Full Report - $99</a>
            </div>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="padding: 20px; text-align: center; background: #f3f4f6;">
          <p style="color: #6b7280; margin: 0; font-size: 12px;">Terra Firma Partners LLC</p>
          <p style="color: #9ca3af; margin: 5px 0 0 0; font-size: 11px;">Professional Land Analysis for Informed Decisions</p>
        </div>
      </div>
    `;

    // Send email via Abacus API
    const hostname = new URL(appUrl).hostname;

    const response = await fetch("https://apps.abacus.ai/api/sendNotificationEmail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        subject: `Your Saved Parcel: ${parcel.siteAddress || parcel.address || "Property Details"}`,
        body: htmlBody,
        is_html: true,
        recipient_email: email,
        sender_email: `noreply@${hostname}`,
        sender_alias: "Terra Firma Partners",
      }),
    });

    const result = await response.json();
    
    if (!result.success) {
      console.error("Email send error:", result);
      return NextResponse.json(
        { success: false, message: "Failed to send email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: "Parcel details sent to your email!" 
    });

  } catch (error) {
    console.error("Email parcel error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
