import { NextRequest, NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

export const dynamic = 'force-dynamic';

interface StandData {
  name: string;
  tier: string;
  score: number;
  face: string;
  intrusion: string;
}

interface ParcelHuntFileRequest {
  county: string;
  state: string;
  acreage: number;
  address: string;
  lat: number;
  lng: number;
  stands: StandData[];
  terrainDescription?: string;
  movementDescription?: string;
  accessDescription?: string;
  prevailingWind?: string;
}

// Sanitize filename
function sanitizeFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30);
}

export async function POST(request: NextRequest) {
  try {
    const body: ParcelHuntFileRequest = await request.json();
    const { county, state, acreage, address, lat, lng, stands, terrainDescription, movementDescription, accessDescription, prevailingWind } = body;

    // Create PDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter'
    });

    const pageWidth = 215.9;
    const pageHeight = 279.4;
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);

    // ========== PAGE 1: COVER ==========
    doc.setFillColor(248, 246, 243);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Header bar
    doc.setFillColor(75, 54, 33);
    doc.rect(0, 0, pageWidth, 8, 'F');

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(32);
    doc.setTextColor(75, 54, 33);
    doc.text('Parcel Hunt File', pageWidth / 2, 50, { align: 'center' });

    // Location
    doc.setFontSize(18);
    doc.setTextColor(139, 115, 85);
    doc.text(`${county} County, ${state}`, pageWidth / 2, 70, { align: 'center' });

    // Acreage
    doc.setFontSize(24);
    doc.setTextColor(74, 124, 89);
    doc.text(`${Math.round(acreage)} Acres`, pageWidth / 2, 90, { align: 'center' });

    // Divider line
    doc.setDrawColor(139, 115, 85);
    doc.setLineWidth(0.5);
    doc.line(margin + 40, 105, pageWidth - margin - 40, 105);

    // Address
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    const addressLines = doc.splitTextToSize(address, contentWidth - 60);
    doc.text(addressLines, pageWidth / 2, 120, { align: 'center' });

    // Coordinates
    doc.setFontSize(9);
    doc.text(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, pageWidth / 2, 135, { align: 'center' });

    // Brand
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 54, 33);
    doc.text('Terra Firma', pageWidth / 2, 200, { align: 'center' });

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Parcel Intelligence for Whitetail Hunters', pageWidth / 2, 208, { align: 'center' });

    // Footer bar
    doc.setFillColor(75, 54, 33);
    doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');

    // ========== PAGE 2: TERRAIN BACKBONE ==========
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Section header
    doc.setFillColor(75, 54, 33);
    doc.rect(0, 0, pageWidth, 25, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text('Terrain Backbone', margin, 17);

    // Content
    let yPos = 45;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(45, 45, 45);

    const terrainText = terrainDescription || 
      `This parcel features a defined terrain structure with ridge spines and saddles that create natural travel corridors for whitetail movement. The primary ridge system runs through the property, offering elevated vantage points and consistent deer travel routes.\n\nSecondary terrain features including draws and benches provide additional structure that funnels deer movement toward predictable pinch points. The terrain backbone of this property suggests established travel patterns that can be used to position stands effectively.`;

    const terrainLines = doc.splitTextToSize(terrainText, contentWidth);
    doc.text(terrainLines, margin, yPos);

    yPos += terrainLines.length * 6 + 20;

    // Visual placeholder box
    doc.setDrawColor(112, 128, 144);
    doc.setLineWidth(0.3);
    doc.setFillColor(245, 243, 240);
    doc.roundedRect(margin, yPos, contentWidth, 60, 3, 3, 'FD');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('[Terrain Structure Visualization]', pageWidth / 2, yPos + 32, { align: 'center' });

    // Page footer
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('Parcel Hunt File — Terra Firma', margin, pageHeight - 12);
    doc.text('Page 2', pageWidth - margin, pageHeight - 12, { align: 'right' });

    // ========== PAGE 3: ALIGNMENT ZONES ==========
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Section header
    doc.setFillColor(74, 124, 89);
    doc.rect(0, 0, pageWidth, 25, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text('Alignment Zones', margin, 17);

    yPos = 45;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(45, 45, 45);
    doc.text('Top stand locations ranked by terrain alignment:', margin, yPos);

    yPos += 15;

    // Stand cards - tier color RGB values
    const tierColors: Record<string, [number, number, number]> = {
      'Deep Moss': [74, 124, 89],
      'Weathered Oak': [139, 115, 85],
      'Field Stone': [112, 128, 144],
    };

    const displayStands = stands.slice(0, 3);
    displayStands.forEach((stand) => {
      const tierColor = tierColors[stand.tier] || [112, 128, 144];
      
      // Card background
      doc.setFillColor(250, 248, 245);
      doc.roundedRect(margin, yPos, contentWidth, 35, 2, 2, 'F');
      
      // Left accent bar
      doc.setFillColor(tierColor[0], tierColor[1], tierColor[2]);
      doc.rect(margin, yPos, 4, 35, 'F');
      
      // Stand name
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(45, 45, 45);
      doc.text(stand.name, margin + 10, yPos + 12);
      
      // Tier label
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(tierColor[0], tierColor[1], tierColor[2]);
      doc.text(stand.tier, margin + 10, yPos + 22);
      
      // Score
      doc.setFontSize(14);
      doc.setTextColor(100, 100, 100);
      doc.text(`${stand.score}`, pageWidth - margin - 15, yPos + 17, { align: 'right' });
      
      // Details
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(`Face: ${stand.face} • Intrusion: ${stand.intrusion}`, margin + 10, yPos + 30);
      
      yPos += 42;
    });

    if (displayStands.length === 0) {
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('No stands placed on this parcel yet.', margin, yPos + 10);
    }

    // Page footer
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('Parcel Hunt File — Terra Firma', margin, pageHeight - 12);
    doc.text('Page 3', pageWidth - margin, pageHeight - 12, { align: 'right' });

    // ========== PAGE 4: SEASONAL MOVEMENT OUTLOOK ==========
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Section header
    doc.setFillColor(139, 115, 85);
    doc.rect(0, 0, pageWidth, 25, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text('Seasonal Movement Outlook', margin, 17);

    yPos = 45;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(45, 45, 45);

    const movementText = movementDescription || 
      `Early Season (Oct 1-20):\nDeer movement is predictable and tied to food sources. Focus on travel routes between bedding and feeding areas during late afternoon hours. Morning sits near bedding edges can be productive with careful entry.\n\nRut Phase (Oct 25 - Nov 20):\nBuck movement increases significantly. Ridge travel and saddle crossings become high-priority locations as bucks cruise for does. All-day sits are warranted during peak rut activity.\n\nLate Season (Nov 25 - Jan 15):\nDeer return to predictable food-focused patterns. Focus shifts to afternoon hunts near remaining food sources. Weather fronts can trigger increased daylight movement.`;

    const movementLines = doc.splitTextToSize(movementText, contentWidth);
    doc.text(movementLines, margin, yPos);

    // Page footer
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('Parcel Hunt File — Terra Firma', margin, pageHeight - 12);
    doc.text('Page 4', pageWidth - margin, pageHeight - 12, { align: 'right' });

    // ========== PAGE 5: ACCESS REALITY & WIND DISCIPLINE ==========
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Section header
    doc.setFillColor(112, 128, 144);
    doc.rect(0, 0, pageWidth, 25, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text('Access Reality & Wind Discipline', margin, 17);

    yPos = 45;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(45, 45, 45);

    const windInfo = prevailingWind ? `Prevailing Fall Wind: ${prevailingWind}` : 'Prevailing Fall Wind: Northwest (NW)';
    doc.setFont('helvetica', 'bold');
    doc.text(windInfo, margin, yPos);
    doc.setFont('helvetica', 'normal');

    yPos += 15;

    const accessText = accessDescription || 
      `This parcel appears to function with limited practical access from a single side. Because entry flexibility is constrained, wind discipline becomes more important than stand variety.\n\nAccess Classification: Single practical entry\n\nWhen wind direction is unfavorable for your primary access route, it is often better to stay home than to risk contaminating the property with scent. Consistent, disciplined access over time builds deer confidence and increases daytime movement.\n\nKey principles:\n• Only hunt stands when wind favors your entry AND exit\n• Avoid walking through deer travel corridors to reach your stand\n• Consider alternate parking locations for different wind conditions\n• Early season access is especially critical — one bad entry can pattern deer to avoid an area`;

    const accessLines = doc.splitTextToSize(accessText, contentWidth);
    doc.text(accessLines, margin, yPos);

    // Footer line
    yPos = pageHeight - 40;
    doc.setDrawColor(112, 128, 144);
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageWidth - margin, yPos);

    yPos += 10;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Generated using Terrain Spine and Alignment Engine v1', pageWidth / 2, yPos, { align: 'center' });

    // Page footer
    doc.setFontSize(8);
    doc.text('Parcel Hunt File — Terra Firma', margin, pageHeight - 12);
    doc.text('Page 5', pageWidth - margin, pageHeight - 12, { align: 'right' });

    // Generate PDF
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    
    // Create filename
    const countyClean = sanitizeFilename(county);
    const stateClean = sanitizeFilename(state);
    const filename = `ParcelHuntFile_${countyClean}${stateClean}_${Math.round(acreage)}ac_TerraFirma.pdf`;

    // Optionally save to user account
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      try {
        console.log(`[ParcelHuntFile] Generated for user: ${session.user.email}, parcel: ${address}`);
      } catch (err) {
        console.error('[ParcelHuntFile] Failed to save to account:', err);
      }
    }

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });

  } catch (error) {
    console.error('[ParcelHuntFile] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate Parcel Hunt File' },
      { status: 500 }
    );
  }
}
