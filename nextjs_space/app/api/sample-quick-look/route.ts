import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { getCWDStatus } from "@/lib/missouri-hunting";

export const dynamic = 'force-dynamic';

// Sample Pleasant Hill property data (same as Free Look for consistency)
const SAMPLE_DATA = {
  parcelId: "14-620-00-00-000.00-03",
  siteAddress: "2100 S State Route Y, Pleasant Hill, MO 64080",
  acreage: 87.2,
  county: "Cass",
  state: "MO",
  zoning: "A-1 Agricultural",
  useDescription: "Agricultural - Vacant Land",
  legalDescription: "E 1/2 NE 1/4 & E 1/2 W 1/2 NE 1/4 SEC 15-46-31 87.2 AC M/L",
  femaFloodZone: "Zone X (Minimal Risk)",
  elementarySchoolDistrict: "Pleasant Hill R-III School District",
  lat: 38.7958,
  lng: -94.2733,
};

const SAMPLE_SOIL = {
  drainageClass: "Well Drained",
};

function buildSampleParcelPath(): string {
  // Polygon matching the sample property location
  const coords = [
    [-94.2785, 38.7995],  // NW corner
    [-94.2680, 38.7995],  // NE corner  
    [-94.2680, 38.7920],  // SE corner
    [-94.2785, 38.7920],  // SW corner
    [-94.2785, 38.7995],  // Close polygon
  ];
  const pathPoints = coords.map(c => `${c[1]},${c[0]}`).join("|");
  return `&path=color:0x22C55EFF|weight:5|fillcolor:0x22C55E30|${pathPoints}`;
}

async function fetchGoogleMapImage(): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const parcelPath = buildSampleParcelPath();
    const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
    const params = new URLSearchParams({
      center: `${SAMPLE_DATA.lat},${SAMPLE_DATA.lng}`,
      zoom: "16",
      size: "640x400",
      maptype: "satellite",
      key: apiKey
    });
    const mapUrl = `${baseUrl}?${params.toString()}${parcelPath}`;
    
    const response = await fetch(mapUrl, { signal: AbortSignal.timeout(15000) });
    if (response.ok && response.headers.get('content-type')?.includes('image')) {
      const buffer = await response.arrayBuffer();
      return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
    }
  } catch (error) {
    console.error("Failed to fetch map image:", error);
  }
  return null;
}

async function loadLogoImage(): Promise<string | null> {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const logoPath = path.join(process.cwd(), "public", "logo-tfp-solid.jpg");
    const buffer = await fs.readFile(logoPath);
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  } catch (error) {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const logoPath = path.join(process.cwd(), "public", "logo-tfp.png");
      const buffer = await fs.readFile(logoPath);
      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch (e) {
      console.error("Failed to load logo:", e);
    }
  }
  return null;
}

function generateReportNumber(): string {
  return `TFP-QL-SAMPLE-DEMO`;
}

const formatDate = (date: Date) => {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

function drawCertificateBorder(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setDrawColor(34, 83, 60);
  doc.setLineWidth(3);
  doc.rect(8, 8, pageWidth - 16, pageHeight - 16);
  doc.setLineWidth(0.5);
  doc.rect(12, 12, pageWidth - 24, pageHeight - 24);
  
  doc.setLineWidth(2);
  doc.setDrawColor(184, 134, 11);
  const cs = 12;
  doc.line(15, 15 + cs, 15, 15); doc.line(15, 15, 15 + cs, 15);
  doc.line(pageWidth - 15 - cs, 15, pageWidth - 15, 15); doc.line(pageWidth - 15, 15, pageWidth - 15, 15 + cs);
  doc.line(15, pageHeight - 15 - cs, 15, pageHeight - 15); doc.line(15, pageHeight - 15, 15 + cs, pageHeight - 15);
  doc.line(pageWidth - 15 - cs, pageHeight - 15, pageWidth - 15, pageHeight - 15); doc.line(pageWidth - 15, pageHeight - 15 - cs, pageWidth - 15, pageHeight - 15);
}

export async function GET() {
  try {
    const [logoImage, mapImageSatellite] = await Promise.all([
      loadLogoImage(),
      fetchGoogleMapImage(),
    ]);

    const cwdStatusResult = getCWDStatus(SAMPLE_DATA.county);
    const reportNumber = generateReportNumber();
    const reportDate = formatDate(new Date());

    // Create PDF - Letter size
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // ========== PAGE 1: PROPERTY OVERVIEW ==========
    drawCertificateBorder(doc, pageWidth, pageHeight);

    // Header with logo
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 22, "F");
    if (logoImage) {
      try { doc.addImage(logoImage, "JPEG", 22, 20, 18, 18); } catch (e) {}
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("BROKER QUICK LOOK", pageWidth / 2, 32, { align: "center" });

    // SAMPLE watermark
    doc.setTextColor(184, 134, 11);
    doc.setFontSize(10);
    doc.text("SAMPLE REPORT", pageWidth - 22, 26, { align: "right" });

    // Report info bar
    doc.setFillColor(245, 245, 245);
    doc.rect(18, 42, pageWidth - 36, 10, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Report #: ${reportNumber}`, 22, 48);
    doc.text(`Generated: ${reportDate}`, pageWidth / 2, 48, { align: "center" });
    doc.text("Terra Firma Partners LLC", pageWidth - 22, 48, { align: "right" });

    // Property Address Title
    let yPos = 58;
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PROPERTY OVERVIEW", 22, yPos);
    yPos += 10;

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    const addressLines = doc.splitTextToSize(SAMPLE_DATA.siteAddress, pageWidth - 50);
    doc.text(addressLines, 22, yPos);
    yPos += addressLines.length * 5 + 8;

    // Map Image - Centered on the page
    const mapHeight = 72;
    if (mapImageSatellite) {
      try {
        doc.addImage(mapImageSatellite, "JPEG", 22, yPos, pageWidth - 44, mapHeight);
        doc.setDrawColor(34, 83, 60);
        doc.setLineWidth(1);
        doc.rect(22, yPos, pageWidth - 44, mapHeight);
      } catch (e) {
        doc.setFillColor(235, 245, 235);
        doc.rect(22, yPos, pageWidth - 44, mapHeight, "F");
        doc.setTextColor(100);
        doc.text("Satellite imagery unavailable", pageWidth / 2, yPos + mapHeight / 2, { align: "center" });
      }
    } else {
      doc.setFillColor(235, 245, 235);
      doc.rect(22, yPos, pageWidth - 44, mapHeight, "F");
      doc.setTextColor(100);
      doc.text("Satellite imagery - Available in your report", pageWidth / 2, yPos + mapHeight / 2, { align: "center" });
    }
    yPos += mapHeight + 8;

    // Key Property Details - Two Column Layout
    const detailsBoxHeight = 50;
    doc.setFillColor(250, 250, 250);
    doc.rect(22, yPos, pageWidth - 44, detailsBoxHeight, "F");
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.5);
    doc.rect(22, yPos, pageWidth - 44, detailsBoxHeight);

    const col1X = 28;
    const col2X = pageWidth / 2 + 5;
    let detailY = yPos + 9;

    const drawDetailRow = (label: string, value: string, x: number, y: number) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(label, x, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.text(value, x, y + 5);
    };

    // Column 1
    drawDetailRow("VERIFIED ACREAGE", `${SAMPLE_DATA.acreage.toFixed(2)} acres`, col1X, detailY);
    drawDetailRow("COUNTY", `${SAMPLE_DATA.county} County, ${SAMPLE_DATA.state}`, col1X, detailY + 15);
    drawDetailRow("PARCEL ID", SAMPLE_DATA.parcelId, col1X, detailY + 30);

    // Column 2
    drawDetailRow("ZONING", SAMPLE_DATA.zoning, col2X, detailY);
    drawDetailRow("USE TYPE", SAMPLE_DATA.useDescription, col2X, detailY + 15);
    drawDetailRow("SCHOOL DISTRICT", SAMPLE_DATA.elementarySchoolDistrict, col2X, detailY + 30);

    yPos += detailsBoxHeight + 6;

    // Legal Description Box
    const legalBoxHeight = 24;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(180, 180, 180);
    doc.rect(22, yPos, pageWidth - 44, legalBoxHeight, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text("LEGAL DESCRIPTION", 28, yPos + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const legalLines = doc.splitTextToSize(SAMPLE_DATA.legalDescription, pageWidth - 56);
    doc.text(legalLines.slice(0, 2), 28, yPos + 14);

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text("Page 1 of 2 • Broker Quick Look Report • www.terrafirmapartners.com • (660) 362-2797", pageWidth / 2, pageHeight - 14, { align: "center" });

    // ========== PAGE 2: DEAL-KILLER CHECKLIST ==========
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);

    // Header
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 18, "F");
    if (logoImage) {
      try { doc.addImage(logoImage, "JPEG", 22, 19, 16, 16); } catch (e) {}
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("DEAL-KILLER CHECKLIST", pageWidth / 2, 30, { align: "center" });
    
    // SAMPLE watermark
    doc.setTextColor(184, 134, 11);
    doc.setFontSize(10);
    doc.text("SAMPLE", pageWidth - 22, 26, { align: "right" });

    yPos = 44;

    // Checklist items with status indicators
    const drawChecklistItem = (title: string, status: string, statusColor: [number, number, number], details: string, y: number): number => {
      const boxHeight = 28;
      doc.setFillColor(250, 250, 250);
      doc.rect(22, y, pageWidth - 44, boxHeight, "F");
      doc.setDrawColor(220, 220, 220);
      doc.rect(22, y, pageWidth - 44, boxHeight);

      // Status indicator
      doc.setFillColor(...statusColor);
      doc.roundedRect(26, y + 4, 50, 8, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(status.toUpperCase(), 51, y + 9.5, { align: "center" });

      // Title
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(title, 82, y + 10);

      // Details
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const detailLines = doc.splitTextToSize(details, pageWidth - 56);
      doc.text(detailLines.slice(0, 2), 26, y + 18);

      return y + boxHeight + 4;
    };

    // 1. FEMA Flood Zone
    yPos = drawChecklistItem(
      "FEMA Flood Zone",
      "LOW RISK",
      [40, 167, 69],
      `Designation: ${SAMPLE_DATA.femaFloodZone}. Property is outside the 100-year floodplain. Standard flood insurance rates apply.`,
      yPos
    );

    // 2. CWD Status
    const isCWDZone = cwdStatusResult.inZone;
    yPos = drawChecklistItem(
      "CWD Management Zone",
      isCWDZone ? "IN CWD ZONE" : "NOT IN ZONE",
      isCWDZone ? [255, 193, 7] : [40, 167, 69],
      isCWDZone 
        ? `County is in a Chronic Wasting Disease management area. Special deer hunting regulations apply.`
        : `${SAMPLE_DATA.county} County is not currently in a CWD management zone. Standard deer hunting regulations apply.`,
      yPos
    );

    // 3. Road Access
    yPos = drawChecklistItem(
      "Road Access",
      "ACCESS VERIFIED",
      [40, 167, 69],
      `Property has road frontage on State Hwy PP. Recommend verifying easements and road maintenance agreements.`,
      yPos
    );

    // 4. Soil Buildability
    yPos = drawChecklistItem(
      "Soil Buildability",
      "SUITABLE",
      [40, 167, 69],
      `Drainage Class: ${SAMPLE_SOIL.drainageClass}. Soils appear suitable for conventional septic systems and foundations.`,
      yPos
    );

    // 5. Zoning Compliance
    yPos = drawChecklistItem(
      "Zoning Classification",
      "AGRICULTURAL",
      [40, 167, 69],
      `Current Zoning: ${SAMPLE_DATA.zoning}. Agricultural zoning typically allows residential, farming, and recreational uses.`,
      yPos
    );

    // Summary Box
    yPos += 6;
    doc.setFillColor(34, 83, 60);
    doc.rect(22, yPos, pageWidth - 44, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("NEXT STEPS", 28, yPos + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const nextSteps = [
      "• Order Full Land Analysis Report ($350) for complete hunting intel, soil maps, and detailed data",
      "• Schedule property visit to verify boundaries and access",
      "• Contact county offices for any items marked VERIFY"
    ];
    doc.text(nextSteps, 28, yPos + 15);

    // Disclaimer
    yPos += 38;
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    const disclaimer = "This Broker Quick Look is for informational purposes only and does not constitute a survey, appraisal, or legal opinion. Data sourced from Regrid, USDA, FEMA, and Missouri Department of Conservation. Verify all information independently before making purchasing decisions.";
    const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 50);
    doc.text(disclaimerLines, 25, yPos);

    // Contact CTA
    yPos = pageHeight - 32;
    doc.setFillColor(184, 134, 11);
    doc.roundedRect(pageWidth / 2 - 55, yPos, 110, 12, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Questions? Call (660) 362-2797", pageWidth / 2, yPos + 8, { align: "center" });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text("Page 2 of 2 • Broker Quick Look Report • www.terrafirmapartners.com", pageWidth / 2, pageHeight - 14, { align: "center" });

    // Generate PDF
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="TFP-QuickLook-SAMPLE.pdf"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });

  } catch (error) {
    console.error("Sample Quick Look generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate sample report" },
      { status: 500 }
    );
  }
}
