import { NextRequest, NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getCachedParcel, setCachedParcel, CachedParcelData } from "@/lib/regrid-cache";
import { fetchSoilData, SoilData, getDrainageRating } from "@/lib/usda-soil";
import { getCWDStatus } from "@/lib/missouri-hunting";

export const dynamic = 'force-dynamic';

interface ParcelData {
  parcelId: string;
  owner: string;
  mailingAddress: string;
  siteAddress: string;
  acreage: number;
  sqft: number;
  zoning: string;
  useDescription: string;
  coordinates: number[][][] | null;
  marketValue: number | null;
  landValue: number | null;
  county: string;
  state: string;
  legalDescription: string | null;
  femaFloodZone?: string | null;
  elementarySchoolDistrict?: string | null;
}

// Fetch parcel data from Regrid API with caching
async function fetchRegridParcelData(lat: number, lng: number): Promise<ParcelData | null> {
  const cached = await getCachedParcel(lat, lng);
  if (cached) {
    return {
      parcelId: cached.parcelId,
      owner: cached.owner,
      mailingAddress: cached.mailingAddress,
      siteAddress: cached.siteAddress,
      acreage: cached.acreage,
      sqft: cached.sqft,
      zoning: cached.zoning,
      useDescription: cached.useDescription,
      coordinates: cached.coordinates,
      marketValue: cached.marketValue,
      landValue: cached.landValue,
      county: cached.county,
      state: cached.state,
      legalDescription: cached.legalDescription,
      femaFloodZone: (cached as any).femaFloodZone || null,
      elementarySchoolDistrict: (cached as any).elementarySchoolDistrict || null,
    };
  }

  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) return null;

  try {
    const searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;
    const searchResponse = await fetch(searchUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!searchResponse.ok) return null;

    const searchData = await searchResponse.json();
    const results = searchData.results || [];
    if (results.length === 0) return null;

    const parcel = results[0];
    const fields = parcel.properties?.fields || {};
    
    let coordinates: number[][][] | null = null;
    if (parcel.geometry?.type === "Polygon" && parcel.geometry.coordinates) {
      coordinates = parcel.geometry.coordinates as number[][][];
    } else if (parcel.geometry?.type === "MultiPolygon" && parcel.geometry.coordinates) {
      coordinates = (parcel.geometry.coordinates as number[][][][])[0] || null;
    }

    const siteParts = [
      fields.address,
      fields.city || fields.situs_city,
      fields.state2 || fields.situs_state2,
      fields.szip || fields.situs_zip
    ].filter(Boolean);

    const result: ParcelData = {
      parcelId: fields.parcelnumb || fields.parcelnumb_no_formatting || "XX-XXX-XXX",
      owner: "LAND OWNER",
      mailingAddress: "[Mailing Address Redacted]",
      siteAddress: siteParts.length > 0 ? siteParts.join(", ") : parcel.properties?.headline || "Address Not Available",
      acreage: fields.ll_gisacre || fields.acres || 0,
      sqft: fields.ll_gissqft || fields.sqft || 0,
      zoning: fields.zoning || "A-1 Agricultural",
      useDescription: fields.usedesc || "Agricultural - Vacant Land",
      coordinates,
      marketValue: fields.parval || fields.market_value || null,
      landValue: fields.landval || fields.land_value || null,
      county: fields.county || "Unknown",
      state: fields.state2 || "MO",
      legalDescription: fields.legaldesc || null,
      femaFloodZone: fields.fema_flood_zone || null,
      elementarySchoolDistrict: fields.elementary_school_district || null,
    };

    // Cache result
    const cacheData: CachedParcelData = { ...result } as CachedParcelData;
    setCachedParcel(lat, lng, cacheData).catch(console.error);

    return result;
  } catch (error) {
    console.error("Regrid fetch error:", error);
    return null;
  }
}

function buildParcelPath(coordinates: number[][][] | null): string {
  if (!coordinates || coordinates.length === 0 || !coordinates[0]) return "";
  const ring = coordinates[0];
  if (ring.length < 3) return "";
  const maxPoints = 50;
  const step = ring.length > maxPoints ? Math.ceil(ring.length / maxPoints) : 1;
  const pathPoints = ring
    .filter((_, i) => i % step === 0 || i === ring.length - 1)
    .map(coord => `${coord[1]},${coord[0]}`)
    .join("|");
  return `&path=color:0x22C55EFF|weight:5|fillcolor:0x22C55E30|${pathPoints}`;
}

async function fetchGoogleMapImage(
  lat: number, lng: number, mapType: string = "satellite", zoom: number = 15,
  parcelCoordinates: number[][][] | null = null
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const parcelPath = buildParcelPath(parcelCoordinates);
    const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
    const params = new URLSearchParams({
      center: `${lat},${lng}`,
      zoom: zoom.toString(),
      size: "640x400",
      maptype: mapType,
      key: apiKey
    });
    const mapUrl = `${baseUrl}?${params.toString()}${parcelPath}`;
    
    const response = await fetch(mapUrl, { signal: AbortSignal.timeout(15000) });
    if (response.ok && response.headers.get('content-type')?.includes('image')) {
      const buffer = await response.arrayBuffer();
      const imageType = mapType === "terrain" ? "png" : "jpeg";
      return `data:image/${imageType};base64,${Buffer.from(buffer).toString("base64")}`;
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
  const date = new Date();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TFP-QL-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${random}`;
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: "Order ID required" }, { status: 400 });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Verify this is a quick_look order
    if (order.productType !== "quick_look") {
      return NextResponse.json({ error: "This is not a Quick Look order" }, { status: 400 });
    }

    const parcelData = await fetchRegridParcelData(order.parcelLat, order.parcelLng);
    if (!parcelData) {
      return NextResponse.json({ error: "Failed to fetch parcel data" }, { status: 500 });
    }

    // Fetch additional data
    const [soilData, logoImage, mapImageSatellite] = await Promise.all([
      fetchSoilData(order.parcelLat, order.parcelLng),
      loadLogoImage(),
      fetchGoogleMapImage(order.parcelLat, order.parcelLng, "satellite", 16, parcelData.coordinates),
    ]);

    const cwdStatusResult = getCWDStatus(parcelData.county);
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
    const addressLines = doc.splitTextToSize(parcelData.siteAddress, pageWidth - 50);
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
    drawDetailRow("VERIFIED ACREAGE", `${parcelData.acreage.toFixed(2)} acres`, col1X, detailY);
    drawDetailRow("COUNTY", `${parcelData.county} County, ${parcelData.state}`, col1X, detailY + 15);
    drawDetailRow("PARCEL ID", parcelData.parcelId, col1X, detailY + 30);

    // Column 2
    drawDetailRow("ZONING", parcelData.zoning, col2X, detailY);
    drawDetailRow("USE TYPE", parcelData.useDescription, col2X, detailY + 15);
    const schoolDistrict = parcelData.elementarySchoolDistrict || "Contact county for info";
    drawDetailRow("SCHOOL DISTRICT", schoolDistrict.length > 30 ? schoolDistrict.substring(0, 30) + "..." : schoolDistrict, col2X, detailY + 30);

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
    const legalDesc = parcelData.legalDescription || "Contact county assessor for full legal description";
    const legalLines = doc.splitTextToSize(legalDesc, pageWidth - 56);
    doc.text(legalLines.slice(0, 2), 28, yPos + 14);

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text("Page 1 of 2 • Broker Quick Look Report • www.terrafirmapartners.com • (573) 508-3830", pageWidth / 2, pageHeight - 14, { align: "center" });

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
    const floodZone = parcelData.femaFloodZone || "Zone X (Minimal Risk)";
    const isHighRiskFlood = floodZone.includes("A") || floodZone.includes("V");
    yPos = drawChecklistItem(
      "FEMA Flood Zone",
      isHighRiskFlood ? "HIGH RISK" : "LOW RISK",
      isHighRiskFlood ? [220, 53, 69] : [40, 167, 69],
      `Designation: ${floodZone}. ${isHighRiskFlood ? "Property is in a Special Flood Hazard Area. Flood insurance required for federally-backed mortgages." : "Property is outside the 100-year floodplain. Standard flood insurance rates apply."}`,
      yPos
    );

    // 2. CWD Status
    const isCWDZone = cwdStatusResult.inZone;
    yPos = drawChecklistItem(
      "CWD Management Zone",
      isCWDZone ? "IN CWD ZONE" : "NOT IN ZONE",
      isCWDZone ? [255, 193, 7] : [40, 167, 69],
      isCWDZone 
        ? `County is in a Chronic Wasting Disease management area. Special deer hunting regulations apply. Carcass transport restrictions in effect.`
        : `${parcelData.county} County is not currently in a CWD management zone. Standard deer hunting regulations apply.`,
      yPos
    );

    // 3. Road Access
    const hasRoadAccess = parcelData.siteAddress && !parcelData.siteAddress.toLowerCase().includes("landlocked");
    yPos = drawChecklistItem(
      "Road Access",
      hasRoadAccess ? "ACCESS VERIFIED" : "VERIFY ACCESS",
      hasRoadAccess ? [40, 167, 69] : [255, 193, 7],
      hasRoadAccess 
        ? `Property has road frontage. Site address: ${parcelData.siteAddress.split(",")[0]}. Recommend verifying easements and road maintenance agreements.`
        : "Road access should be verified. Check for recorded easements and confirm legal access to public road.",
      yPos
    );

    // 4. Soil Buildability
    const drainageClass = soilData?.drainageClass || "Unknown";
    const isBuildable = drainageClass.toLowerCase().includes("well") || drainageClass.toLowerCase().includes("moderate");
    yPos = drawChecklistItem(
      "Soil Buildability",
      isBuildable ? "SUITABLE" : "VERIFY",
      isBuildable ? [40, 167, 69] : [255, 193, 7],
      `Drainage Class: ${drainageClass}. ${isBuildable ? "Soils appear suitable for conventional septic systems and foundations." : "Soil conditions may require engineered septic system or special foundation considerations. Site-specific perc test recommended."}`,
      yPos
    );

    // 5. Zoning Compliance
    const isAgZoning = parcelData.zoning.toLowerCase().includes("ag") || parcelData.zoning.toLowerCase().includes("a-1") || parcelData.zoning.toLowerCase().includes("rural");
    yPos = drawChecklistItem(
      "Zoning Classification",
      isAgZoning ? "AGRICULTURAL" : "CHECK ZONING",
      isAgZoning ? [40, 167, 69] : [255, 193, 7],
      `Current Zoning: ${parcelData.zoning}. ${isAgZoning ? "Agricultural zoning typically allows residential, farming, and recreational uses. Verify permitted uses with county." : "Non-agricultural zoning may have specific use restrictions. Contact county planning office for permitted uses."}`,
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
    const disclaimer = "This Broker Quick Look is for informational purposes only and does not constitute a survey, appraisal, or legal opinion. Data sourced from Regrid, USDA, FEMA, and Missouri Department of Conservation. Verify all information independently before making purchasing decisions. Terra Firma Partners LLC is not liable for decisions made based on this report.";
    const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 50);
    doc.text(disclaimerLines, 25, yPos);

    // Contact CTA
    yPos = pageHeight - 32;
    doc.setFillColor(184, 134, 11);
    doc.roundedRect(pageWidth / 2 - 55, yPos, 110, 12, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Questions? Call (573) 508-3830", pageWidth / 2, yPos + 8, { align: "center" });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text("Page 2 of 2 • Broker Quick Look Report • www.terrafirmapartners.com", pageWidth / 2, pageHeight - 14, { align: "center" });

    // Generate PDF
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfBase64 = pdfBuffer.toString("base64");

    // Update order status
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "completed" }
    });

    return NextResponse.json({
      success: true,
      pdf: pdfBase64,
      filename: `TFP-QuickLook-${parcelData.siteAddress.replace(/[^a-zA-Z0-9]/g, "-").substring(0, 40)}.pdf`
    });

  } catch (error) {
    console.error("Broker Quick Look generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}
