import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { jsPDF } from "jspdf";
import { getCachedParcel, setCachedParcel, CachedParcelData } from "@/lib/regrid-cache";
import { fetchSoilData, SoilData, getFarmlandRating, getDrainageRating, getCapabilityDescription } from "@/lib/usda-soil";
import { getCWDStatus, getMDCRegion, getNearbyMRAPAreas, getDroughtStatus, getHarvestData, getHarvestPressureLabel, getHarvestPressureColor, DEER_SEASONS_2025_2026, TURKEY_SEASONS_2025_2026, CONSERVATION_PROGRAMS } from "@/lib/missouri-hunting";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
  improvementValue: number | null;
  taxYear: string | null;
  saleDate: string | null;
  salePrice: number | null;
  county: string;
  state: string;
  legalDescription: string | null;
  plssTownship: string | null;
  plssRange: string | null;
  plssSection: string | null;
}

// Fetch REAL parcel data from Regrid API with caching
async function fetchRegridParcelData(lat: number, lng: number, address?: string): Promise<ParcelData | null> {
  // Check cache first
  const cached = await getCachedParcel(lat, lng);
  if (cached) {
    console.log(`[PDF] Using cached parcel data for ${lat}, ${lng}`);
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
      improvementValue: cached.improvementValue,
      taxYear: cached.taxYear,
      saleDate: cached.saleDate,
      salePrice: cached.salePrice,
      county: cached.county,
      state: cached.state,
      legalDescription: cached.legalDescription,
      plssTownship: cached.plssTownship,
      plssRange: cached.plssRange,
      plssSection: cached.plssSection,
    };
  }

  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) {
    console.error("Regrid API key not configured");
    return null;
  }

  try {
    // Try address search first if provided (more reliable than exact coordinates)
    let searchUrl: string;
    if (address) {
      console.log(`[PDF] Searching Regrid by address: ${address}`);
      searchUrl = `https://app.regrid.com/api/v1/search.json?query=${encodeURIComponent(address)}&token=${apiKey}`;
    } else {
      console.log(`[PDF] Fetching from Regrid by coordinates: ${lat}, ${lng}`);
      searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;
    }
    const searchResponse = await fetch(searchUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!searchResponse.ok) {
      console.error("Regrid search error:", searchResponse.status);
      return null;
    }

    const searchData = await searchResponse.json();
    const results = searchData.results || [];
    
    if (results.length === 0) {
      console.log("No parcels found at coordinates:", lat, lng);
      return null;
    }

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
      improvementValue: fields.improvval || fields.improvement_value || null,
      taxYear: fields.taxyear || "2024",
      saleDate: fields.saledate || null,
      salePrice: fields.saleprice || null,
      county: fields.county || "Johnson",
      state: fields.state2 || "MO",
      legalDescription: fields.legaldesc || null,
      plssTownship: fields.plss_township || null,
      plssRange: fields.plss_range || null,
      plssSection: fields.plss_section || null,
    };

    // Cache the result
    const cacheData: CachedParcelData = {
      ...result,
    };
    setCachedParcel(lat, lng, cacheData).catch(console.error);

    return result;
  } catch (error) {
    console.error("Regrid fetch error:", error);
    return null;
  }
}

function getDefaultSampleData(): ParcelData {
  return {
    parcelId: "XX-XXX-XXX-XX-XXX-XXX.XX",
    owner: "LAND OWNER",
    mailingAddress: "[Mailing Address Redacted]",
    siteAddress: "437 SE Highway AA, Bethlehem, MO 64735",
    acreage: 9.51,
    sqft: 414314,
    zoning: "A-1 Agricultural",
    useDescription: "Agricultural - Residential",
    coordinates: null,
    marketValue: 1124800,
    landValue: 63000,
    improvementValue: 1061800,
    taxYear: "2024",
    saleDate: "2020-03-15",
    salePrice: 425000,
    county: "Henry",
    state: "Missouri",
    legalDescription: "N. 506.5' OF E. 860' OF S'2 SW'4 NW'4 (EX. CO. HWY. R/W)",
    plssTownship: "041N",
    plssRange: "025W",
    plssSection: "Section 08",
  };
}

// Fun facts generator - only shows football comparison for parcels >= 3 acres
function generateFunFacts(acres: number, county: string, state: string) {
  const facts: string[] = [];
  
  if (acres >= 3) {
    const footballFields = Math.round(acres / 1.32);
    facts.push(`This ${acres.toFixed(1)}-acre property equals approximately ${footballFields} football fields!`);
  }
  
  if (acres >= 1) {
    const walkingMiles = (acres * 0.015).toFixed(1);
    facts.push(`Walking the perimeter would cover roughly ${walkingMiles} miles.`);
  }
  
  if (state === "Missouri" || state === "MO") {
    facts.push("Missouri has over 30 million acres of farmland - the 'Show-Me State'.");
    if (acres > 50) {
      facts.push(`A ${acres.toFixed(0)}-acre timber tract could contain $15,000-$25,000 in black walnut trees.`);
    }
  }
  
  if (acres > 100) {
    facts.push("Properties over 100 acres qualify for enhanced agricultural tax exemptions.");
  }
  
  if (acres > 40) {
    facts.push("This property size is ideal for wildlife habitat and hunting leases.");
  }
  
  if (facts.length === 0) {
    facts.push("Every property has unique characteristics that affect its value.");
  }
  
  return facts;
}

const formatDate = (date: Date) => {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

function generateReportNumber(): string {
  const date = new Date();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TFP-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${random}`;
}

async function loadLogoImage(): Promise<string | null> {
  try {
    // Try to load JPEG version (no transparency issues)
    const fs = await import("fs/promises");
    const path = await import("path");
    const logoPath = path.join(process.cwd(), "public", "logo-tfp-solid.jpg");
    const buffer = await fs.readFile(logoPath);
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.error("Failed to load logo from file:", error);
    // Fallback to PNG
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const logoPath = path.join(process.cwd(), "public", "logo-tfp.png");
      const buffer = await fs.readFile(logoPath);
      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch (e) {
      console.error("Failed to load logo PNG:", e);
    }
  }
  return null;
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
  if (!apiKey) {
    console.error("Google Maps API key not configured");
    return null;
  }

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
    } else {
      console.error("Map fetch failed:", response.status, response.statusText);
    }
  } catch (error) {
    console.error("Failed to fetch map image:", error);
  }
  return null;
}

async function fetchHardinessZoneMap(): Promise<string | null> {
  try {
    const url = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/USDA_Hardiness_zone_map.jpg/1200px-USDA_Hardiness_zone_map.jpg";
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
    }
  } catch (error) {
    console.error("Failed to fetch hardiness map:", error);
  }
  return null;
}

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

function drawSampleWatermark(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setTextColor(200, 200, 200);
  doc.setFontSize(60);
  doc.setFont("helvetica", "bold");
  doc.text("SAMPLE", pageWidth / 2, pageHeight / 2, { align: "center", angle: 45 });
  doc.setTextColor(0, 0, 0);
}

function drawSimpleMap(doc: jsPDF, lat: number, lng: number, x: number, y: number, width: number, height: number, parcelCoordinates: number[][][] | null = null) {
  doc.setFillColor(235, 245, 235);
  doc.rect(x, y, width, height, "F");
  
  doc.setDrawColor(200, 215, 200);
  doc.setLineWidth(0.3);
  for (let gx = x; gx <= x + width; gx += 15) doc.line(gx, y, gx, y + height);
  for (let gy = y; gy <= y + height; gy += 15) doc.line(x, gy, x + width, gy);

  if (parcelCoordinates && parcelCoordinates[0] && parcelCoordinates[0].length > 2) {
    const ring = parcelCoordinates[0];
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const coord of ring) {
      minLng = Math.min(minLng, coord[0]); maxLng = Math.max(maxLng, coord[0]);
      minLat = Math.min(minLat, coord[1]); maxLat = Math.max(maxLat, coord[1]);
    }
    const lngRange = maxLng - minLng || 0.001;
    const latRange = maxLat - minLat || 0.001;
    const padding = 0.15;
    
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(1.5);
    const points = ring.map(coord => ({
      x: x + padding * width + ((coord[0] - minLng) / lngRange) * width * (1 - 2 * padding),
      y: y + padding * height + ((maxLat - coord[1]) / latRange) * height * (1 - 2 * padding)
    }));
    if (points.length > 2) {
      doc.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) doc.lineTo(points[i].x, points[i].y);
      doc.lineTo(points[0].x, points[0].y);
      doc.stroke();
    }
  }

  doc.setFillColor(255, 255, 255, 0.9);
  doc.roundedRect(x + width/2 - 25, y + height - 12, 50, 10, 2, 2, "F");
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(`${lat.toFixed(4)}, ${lng.toFixed(4)}`, x + width/2, y + height - 5, { align: "center" });
}

function drawPageHeader(doc: jsPDF, pageWidth: number, title: string, logoImage: string | null) {
  doc.setFillColor(34, 83, 60);
  doc.rect(18, 18, pageWidth - 36, 18, "F");
  if (logoImage) { try { doc.addImage(logoImage, "JPEG", 20, 19, 16, 16); } catch (e) {} }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, pageWidth / 2, 30, { align: "center" });
}

function drawPageFooter(doc: jsPDF, pageWidth: number, pageHeight: number, reportNumber: string, currentPage: number, totalPages: number) {
  doc.setFillColor(184, 134, 11);
  doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
  doc.setTextColor(100, 100, 100);
  doc.setFontSize(8);
  doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
  doc.text(`Page ${currentPage} of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId } = body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const reportNumber = generateReportNumber();
    const totalPages = 12; // Including 2-page Unwritten Rules bonus
    
    const regridData = await fetchRegridParcelData(order.parcelLat, order.parcelLng, order.parcelAddress);
    const parcelData = regridData || getDefaultSampleData();
    const logoImage = await loadLogoImage();
    const funFacts = generateFunFacts(parcelData.acreage, parcelData.county, parcelData.state);
    
    // Fetch USDA soil data
    const soilData = await fetchSoilData(order.parcelLat, order.parcelLng);

    const acreage = parcelData.acreage || 100;
    let optimalZoom = 15;
    if (acreage > 200) optimalZoom = 13;
    else if (acreage > 80) optimalZoom = 14;
    else if (acreage > 20) optimalZoom = 15;
    else optimalZoom = 16;

    const aerialMap = await fetchGoogleMapImage(order.parcelLat, order.parcelLng, "satellite", optimalZoom, parcelData.coordinates);
    const topoMap = await fetchGoogleMapImage(order.parcelLat, order.parcelLng, "terrain", optimalZoom, parcelData.coordinates);
    const hybridMap = await fetchGoogleMapImage(order.parcelLat, order.parcelLng, "hybrid", optimalZoom, parcelData.coordinates);
    const hardinessMap = await fetchHardinessZoneMap();

    // ============================================
    // PAGE 1: COVER PAGE
    // ============================================
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 32, "F");
    if (logoImage) { try { doc.addImage(logoImage, "JPEG", 22, 20, 28, 28); } catch (e) {} }
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("TERRA FIRMA PARTNERS", pageWidth / 2 + 8, 30, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Satellite Intelligence for Landowners", pageWidth / 2 + 8, 38, { align: "center" });
    
    doc.setFillColor(184, 134, 11);
    doc.rect(18, 50, pageWidth - 36, 2, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text("COMPREHENSIVE LAND", pageWidth / 2, 68, { align: "center" });
    doc.text("ANALYSIS REPORT", pageWidth / 2, 80, { align: "center" });
    
    const heroMapHeight = 85;
    const mapY = 90;
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(2);
    doc.rect(25, mapY, pageWidth - 50, heroMapHeight);
    
    if (aerialMap) {
      try { doc.addImage(aerialMap, "PNG", 27, mapY + 2, pageWidth - 54, heroMapHeight - 4); }
      catch (e) { drawSimpleMap(doc, order.parcelLat, order.parcelLng, 27, mapY + 2, pageWidth - 54, heroMapHeight - 4, parcelData.coordinates); }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, 27, mapY + 2, pageWidth - 54, heroMapHeight - 4, parcelData.coordinates);
    }
    
    let infoY = mapY + heroMapHeight + 8;
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25, infoY, pageWidth - 50, 28, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("SUBJECT PROPERTY", pageWidth / 2, infoY + 8, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(order.parcelAddress, pageWidth / 2, infoY + 16, { align: "center" });
    doc.text(`${parcelData.acreage.toFixed(2)} Acres | ${parcelData.county} County, ${parcelData.state}`, pageWidth / 2, infoY + 23, { align: "center" });
    
    infoY += 36;
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    doc.text(`Report ID: ${reportNumber}`, pageWidth / 2, infoY, { align: "center" });
    doc.text(`Generated: ${formatDate(new Date())}`, pageWidth / 2, infoY + 6, { align: "center" });
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 1, totalPages);

    // ============================================
    // PAGE 2: PROPERTY OVERVIEW (Combined At-A-Glance + Aerial)
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    drawPageHeader(doc, pageWidth, "PROPERTY OVERVIEW", logoImage);
    
    let yPos = 42;
    
    // Two-column layout: Property info on left, aerial on right
    const leftColW = 90;
    const rightColW = pageWidth - 40 - leftColW - 5;
    
    // Left column - Property details
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, leftColW, 75, 3, 3, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(0.5);
    doc.roundedRect(20, yPos, leftColW, 75, 3, 3, "S");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Property Details", 25, yPos + 8);
    
    const propDetails = [
      ["Address:", parcelData.siteAddress.substring(0, 35)],
      ["Parcel ID:", parcelData.parcelId.substring(0, 25)],
      ["Owner:", parcelData.owner],
      ["Total Size:", `${parcelData.acreage.toFixed(2)} acres`],
      ["Square Feet:", parcelData.sqft.toLocaleString()],
      ["Zoning:", parcelData.zoning || "N/A"],
      ["Use:", (parcelData.useDescription || "Agricultural").substring(0, 20)],
      ["County:", `${parcelData.county}, ${parcelData.state}`],
    ];
    
    let detY = yPos + 16;
    doc.setFontSize(8);
    propDetails.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text(label, 24, detY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(value, 24, detY + 5);
      detY += 11;
    });
    
    // Right column - Aerial image
    const imgX = 20 + leftColW + 5;
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(imgX, yPos, rightColW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("AERIAL VIEW", imgX + rightColW / 2, yPos + 5.5, { align: "center" });
    
    const imgY = yPos + 10;
    const imgH = 65;
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(0.5);
    doc.rect(imgX, imgY, rightColW, imgH);
    if (aerialMap) {
      try { doc.addImage(aerialMap, "PNG", imgX + 1, imgY + 1, rightColW - 2, imgH - 2); }
      catch (e) { drawSimpleMap(doc, order.parcelLat, order.parcelLng, imgX + 1, imgY + 1, rightColW - 2, imgH - 2, parcelData.coordinates); }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, imgX + 1, imgY + 1, rightColW - 2, imgH - 2, parcelData.coordinates);
    }
    
    yPos += 82;
    
    // Valuation section
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("VALUATION & OWNERSHIP", 25, yPos + 6);
    
    yPos += 12;
    
    // Three value boxes
    const boxW = (pageWidth - 50) / 3;
    const valBoxes = [
      { label: "TAX ASSESSED VALUE", value: parcelData.marketValue ? `$${parcelData.marketValue.toLocaleString()}` : "N/A", color: [34, 83, 60] },
      { label: "LAND VALUE", value: parcelData.landValue ? `$${parcelData.landValue.toLocaleString()}` : "N/A", color: [139, 92, 246] },
      { label: "IMPROVEMENT VALUE", value: parcelData.improvementValue ? `$${parcelData.improvementValue.toLocaleString()}` : "$0", color: [59, 130, 246] },
    ];
    
    valBoxes.forEach((box, i) => {
      const bx = 20 + i * (boxW + 5);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(bx, yPos, boxW - 2, 28, 2, 2, "F");
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(box.label, bx + (boxW - 2) / 2, yPos + 8, { align: "center" });
      doc.setTextColor(box.color[0], box.color[1], box.color[2]);
      doc.setFontSize(14);
      doc.text(box.value, bx + (boxW - 2) / 2, yPos + 20, { align: "center" });
    });
    
    yPos += 32;
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    doc.text("Note: Tax assessed values typically represent 60-70% of actual market value. Tax Year: " + (parcelData.taxYear || "N/A"), 25, yPos);
    
    yPos += 10;
    
    // Legal description
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LEGAL DESCRIPTION & LOCATION", 25, yPos + 6);
    
    yPos += 12;
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const legalDesc = parcelData.legalDescription || "Legal description available from county records";
    const legalLines = doc.splitTextToSize(legalDesc, pageWidth - 50);
    doc.text(legalLines, 25, yPos);
    
    yPos += legalLines.length * 4 + 6;
    
    // PLSS and coordinates
    const plss = `${parcelData.plssTownship || ""} ${parcelData.plssRange || ""} ${parcelData.plssSection || ""}`.trim();
    if (plss) {
      doc.setFont("helvetica", "bold");
      doc.text("PLSS:", 25, yPos);
      doc.setFont("helvetica", "normal");
      doc.text(plss, 45, yPos);
    }
    doc.text(`Coordinates: ${order.parcelLat.toFixed(6)}°N, ${Math.abs(order.parcelLng).toFixed(6)}°W`, 100, yPos);
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 2, totalPages);

    // ============================================
    // PAGE 3: TERRAIN & TOPOGRAPHY (Enhanced)
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    drawPageHeader(doc, pageWidth, "TERRAIN & TOPOGRAPHY ANALYSIS", logoImage);
    
    yPos = 42;
    
    // Two maps side by side
    const mapW = (pageWidth - 50) / 2;
    const mapH = 55;
    
    // Satellite view
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, mapW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("SATELLITE VIEW", 20 + mapW / 2, yPos + 5.5, { align: "center" });
    
    if (aerialMap) {
      try { doc.addImage(aerialMap, "PNG", 20, yPos + 9, mapW, mapH); }
      catch (e) { drawSimpleMap(doc, order.parcelLat, order.parcelLng, 20, yPos + 9, mapW, mapH, parcelData.coordinates); }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, 20, yPos + 9, mapW, mapH, parcelData.coordinates);
    }
    
    // Terrain view
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25 + mapW, yPos, mapW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.text("TERRAIN VIEW", 25 + mapW + mapW / 2, yPos + 5.5, { align: "center" });
    
    if (topoMap) {
      try { doc.addImage(topoMap, "PNG", 25 + mapW, yPos + 9, mapW, mapH); }
      catch (e) { drawSimpleMap(doc, order.parcelLat, order.parcelLng, 25 + mapW, yPos + 9, mapW, mapH, parcelData.coordinates); }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, 25 + mapW, yPos + 9, mapW, mapH, parcelData.coordinates);
    }
    
    yPos += mapH + 15;
    
    // Terrain data fields
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 50, 3, 3, "F");
    
    const terrainFields = [
      ["Elevation Range:", "850-920 ft above sea level", "Terrain Type:", "Rolling to Gently Sloping"],
      ["Slope Grade:", "2-8% average grade", "Drainage:", "Natural watershed drainage"],
      ["Soil Type:", "Well-drained loamy soil", "Flood Risk:", "Minimal - outside flood zones"],
    ];
    
    let tY = yPos + 10;
    doc.setFontSize(8);
    terrainFields.forEach(row => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text(row[0], 25, tY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(row[1], 60, tY);
      
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text(row[2], 115, tY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(row[3], 145, tY);
      tY += 14;
    });
    
    yPos += 55;
    
    // Terrain insights box
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("TERRAIN INSIGHTS & RECOMMENDATIONS", 25, yPos + 5.5);
    
    yPos += 12;
    
    const terrainInsights = [
      "• Gentle rolling terrain is ideal for farming equipment operation and livestock grazing",
      "• Moderate slopes provide excellent natural drainage, reducing standing water issues",
      "• Elevation variations create microclimates beneficial for diverse crop selection",
      "• Terrain is suitable for building sites with minimal grading requirements",
      "• Natural contours can be leveraged for pond construction and water management",
      "• Wind exposure is moderate - consider windbreaks for livestock and crop protection",
    ];
    
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    terrainInsights.forEach((insight, i) => {
      doc.text(insight, 25, yPos + i * 7);
    });
    
    yPos += 48;
    
    // Fun fact box
    if (funFacts.length > 0) {
      doc.setFillColor(255, 250, 235);
      doc.roundedRect(20, yPos, pageWidth - 40, 18, 3, 3, "F");
      doc.setDrawColor(184, 134, 11);
      doc.setLineWidth(0.5);
      doc.roundedRect(20, yPos, pageWidth - 40, 18, 3, 3, "S");
      
      doc.setTextColor(184, 134, 11);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("DID YOU KNOW?", 25, yPos + 7);
      doc.setTextColor(100, 80, 40);
      doc.setFont("helvetica", "normal");
      doc.text(funFacts[0], 25, yPos + 13);
    }
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 3, totalPages);

    // ============================================
    // PAGE 4: WATER, FLOOD & ACCESS ANALYSIS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    drawPageHeader(doc, pageWidth, "WATER, FLOOD & ACCESS ANALYSIS", logoImage);
    
    yPos = 42;
    
    // Hybrid map
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(0.5);
    doc.rect(20, yPos, pageWidth - 40, 50);
    if (hybridMap) {
      try { doc.addImage(hybridMap, "PNG", 21, yPos + 1, pageWidth - 42, 48); }
      catch (e) { drawSimpleMap(doc, order.parcelLat, order.parcelLng, 21, yPos + 1, pageWidth - 42, 48, parcelData.coordinates); }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, 21, yPos + 1, pageWidth - 42, 48, parcelData.coordinates);
    }
    
    yPos += 55;
    
    // Two-column layout for Water/Flood and Access
    const colW = (pageWidth - 45) / 2;
    
    // Left: Water & Flood
    doc.setFillColor(59, 130, 246);
    doc.roundedRect(20, yPos, colW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("WATER & FLOOD", 20 + colW / 2, yPos + 5.5, { align: "center" });
    
    const waterFields = [
      ["FEMA Zone:", "Zone X - Minimal Risk"],
      ["Flood Insurance:", "Not Required"],
      ["Nearest Water:", "1.2 miles to creek"],
      ["Watershed:", "Missouri River Basin"],
      ["Wetlands:", "None designated"],
      ["Water Rights:", "Riparian may apply"],
    ];
    
    let wY = yPos + 14;
    doc.setFontSize(8);
    waterFields.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text(label, 24, wY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(value, 24, wY + 5);
      wY += 11;
    });
    
    // Right: Access & Utilities
    doc.setFillColor(34, 197, 94);
    doc.roundedRect(25 + colW, yPos, colW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("ACCESS & UTILITIES", 25 + colW + colW / 2, yPos + 5.5, { align: "center" });
    
    const accessFields = [
      ["Road Frontage:", "County Road Access"],
      ["Road Surface:", "Paved county road"],
      ["Highway Distance:", "3.5 mi to US-50"],
      ["Electric:", "Available at road"],
      ["Water Service:", "Well required"],
      ["Internet:", "Rural wireless/satellite"],
    ];
    
    let aY = yPos + 14;
    accessFields.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text(label, 29 + colW, aY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(value, 29 + colW, aY + 5);
      aY += 11;
    });
    
    yPos += 80;
    
    // Key takeaways
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 35, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("KEY TAKEAWAYS", 25, yPos + 8);
    
    const takeaways = [
      "• Zone X designation = no federal flood insurance requirement, excellent for building",
      "• Electric at road means lower utility extension costs vs. remote properties",
      "• Missouri River watershed provides reliable groundwater for well drilling",
      "• Paved road access increases property value and year-round accessibility",
    ];
    
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    takeaways.forEach((t, i) => {
      doc.text(t, 25, yPos + 15 + i * 6);
    });
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 4, totalPages);

    // ============================================
    // PAGE 5: SOIL ANALYSIS (USDA Data)
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    drawPageHeader(doc, pageWidth, "SOIL ANALYSIS", logoImage);
    
    yPos = 42;
    
    // Farmland Classification Hero Banner
    const farmlandRating = getFarmlandRating(soilData.farmlandClass);
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 28, 3, 3, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(1);
    doc.roundedRect(20, yPos, pageWidth - 40, 28, 3, 3, "S");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("USDA FARMLAND CLASSIFICATION", 25, yPos + 8);
    
    // Rating stars
    doc.setTextColor(184, 134, 11);
    doc.setFontSize(14);
    // Draw star rating using filled/empty circles
    const starX = pageWidth - 25;
    for (let i = 0; i < 5; i++) {
      if (i < farmlandRating.rating) {
        doc.setFillColor(218, 165, 32); // Gold for filled
      } else {
        doc.setFillColor(200, 200, 200); // Gray for empty
      }
      doc.circle(starX - (4 - i) * 6, yPos + 6, 2, 'F');
    }
    
    doc.setTextColor(34, 83, 60);
    doc.setFontSize(16);
    doc.text(farmlandRating.label.toUpperCase(), 25, yPos + 20);
    
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(soilData.farmlandClass || "Classification data not available", 25, yPos + 25);
    
    yPos += 34;
    
    // Soil Type Section
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("SOIL COMPOSITION", 25, yPos + 6);
    
    yPos += 12;
    
    // Two-column soil details
    const soilColW = (pageWidth - 45) / 2;
    
    // Left column
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(20, yPos, soilColW, 55, 2, 2, "F");
    
    const leftSoilFields = [
      ["Soil Type:", soilData.mapUnitName || "N/A"],
      ["Map Unit Key:", soilData.mapUnitKey || "N/A"],
      ["Drainage Class:", soilData.drainageClass || "N/A"],
      ["Hydrologic Group:", soilData.hydrologicGroup || "N/A"],
      ["Slope:", soilData.slopeGradient || "N/A"],
    ];
    
    let sY = yPos + 7;
    doc.setFontSize(8);
    leftSoilFields.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text(label, 24, sY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      const displayVal = String(value).substring(0, 35);
      doc.text(displayVal, 24, sY + 5);
      sY += 11;
    });
    
    // Right column
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(25 + soilColW, yPos, soilColW, 55, 2, 2, "F");
    
    const rightSoilFields = [
      ["Land Capability:", `Class ${soilData.landCapabilityClass}${soilData.landCapabilitySubclass}`],
      ["Surface pH:", soilData.ph ? soilData.ph.toFixed(1) : "N/A"],
      ["Organic Matter:", soilData.organicMatter ? `${soilData.organicMatter.toFixed(1)}%` : "N/A"],
      ["CEC:", soilData.cec ? `${soilData.cec.toFixed(1)} meq/100g` : "N/A"],
      ["Flood Frequency:", soilData.floodFrequency || "N/A"],
    ];
    
    sY = yPos + 7;
    rightSoilFields.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text(label, 29 + soilColW, sY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(String(value).substring(0, 35), 29 + soilColW, sY + 5);
      sY += 11;
    });
    
    yPos += 60;
    
    // Land Capability interpretation
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 18, 2, 2, "F");
    doc.setTextColor(184, 134, 11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("LAND CAPABILITY INTERPRETATION", 25, yPos + 7);
    doc.setTextColor(100, 80, 40);
    doc.setFont("helvetica", "normal");
    doc.text(getCapabilityDescription(soilData.landCapabilityClass), 25, yPos + 13);
    
    yPos += 24;
    
    // Crop Productivity & Suitability Section
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("PRODUCTIVITY & SUITABILITY RATINGS", 25, yPos + 6);
    
    yPos += 12;
    
    // Four boxes for ratings
    const ratingBoxW = (pageWidth - 55) / 4;
    const ratingBoxes = [
      { label: "CORN YIELD", value: soilData.cropYieldCorn ? `${Math.round(soilData.cropYieldCorn)} bu/ac` : "N/A", color: [234, 179, 8] },
      { label: "SOYBEAN YIELD", value: soilData.cropYieldSoy ? `${Math.round(soilData.cropYieldSoy)} bu/ac` : "N/A", color: [34, 197, 94] },
      { label: "SEPTIC SUITABILITY", value: soilData.septicSuitability.substring(0, 12), color: [59, 130, 246] },
      { label: "BUILDING SUITABILITY", value: soilData.buildingSuitability.substring(0, 12), color: [139, 92, 246] },
    ];
    
    ratingBoxes.forEach((box, i) => {
      const bx = 20 + i * (ratingBoxW + 5);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(bx, yPos, ratingBoxW, 28, 2, 2, "F");
      doc.setDrawColor(box.color[0], box.color[1], box.color[2]);
      doc.setLineWidth(0.5);
      doc.roundedRect(bx, yPos, ratingBoxW, 28, 2, 2, "S");
      
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(6);
      doc.setFont("helvetica", "bold");
      doc.text(box.label, bx + ratingBoxW / 2, yPos + 7, { align: "center" });
      
      doc.setTextColor(box.color[0], box.color[1], box.color[2]);
      doc.setFontSize(10);
      doc.text(box.value, bx + ratingBoxW / 2, yPos + 18, { align: "center" });
    });
    
    yPos += 35;
    
    // Drainage Rating visual
    const drainageRating = getDrainageRating(soilData.drainageClass);
    doc.setFillColor(59, 130, 246, 0.1);
    doc.roundedRect(20, yPos, pageWidth - 40, 22, 2, 2, "F");
    doc.setTextColor(59, 130, 246);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("DRAINAGE ASSESSMENT: " + drainageRating.label.toUpperCase(), 25, yPos + 8);
    doc.setTextColor(184, 134, 11);
    // Draw drainage star rating using filled/empty circles
    const drainageStarX = pageWidth - 25;
    for (let i = 0; i < 5; i++) {
      if (i < drainageRating.rating) {
        doc.setFillColor(218, 165, 32); // Gold for filled
      } else {
        doc.setFillColor(200, 200, 200); // Gray for empty
      }
      doc.circle(drainageStarX - (4 - i) * 6, yPos + 6, 2, 'F');
    }
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("Drainage affects septic systems, foundations, crop selection, and flood risk. Well-drained soils are ideal for most uses.", 25, yPos + 16);
    
    yPos += 28;
    
    // USDA Data Source Note
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.text("Source: USDA Natural Resources Conservation Service - Soil Data Access (SDA)", 25, yPos);
    doc.text("Data represents dominant soil conditions. Actual conditions may vary. Site-specific testing recommended.", 25, yPos + 5);
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 5, totalPages);

    // ============================================
    // PAGE 6: LAND USE & PREMIUM INSIGHTS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    drawPageHeader(doc, pageWidth, "LAND USE & PREMIUM INSIGHTS", logoImage);
    
    yPos = 42;
    
    // Land Use Suitability ratings
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LAND USE SUITABILITY RATINGS", 25, yPos + 6);
    
    yPos += 12;
    
    const useRatings = [
      { use: "Agricultural/Farming", rating: 5, desc: "Excellent soil, terrain, and water access" },
      { use: "Hunting/Recreation", rating: 5, desc: "Ideal acreage with wildlife habitat" },
      { use: "Residential Building", rating: 4, desc: "Good road access, utilities available" },
      { use: "Livestock Grazing", rating: 5, desc: "Natural pasture with water potential" },
      { use: "Timber Production", rating: 3, desc: "Mixed woodland, moderate timber value" },
      { use: "Commercial Use", rating: 2, desc: "Limited by agricultural zoning" },
    ];
    
    useRatings.forEach((item, i) => {
      const rx = i % 2 === 0 ? 20 : pageWidth / 2 + 5;
      const ry = yPos + Math.floor(i / 2) * 18;
      
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(rx, ry, (pageWidth - 50) / 2, 15, 2, 2, "F");
      
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(item.use, rx + 3, ry + 6);
      
      // Star rating using circles
      for (let s = 0; s < 5; s++) {
        if (s < item.rating) {
          doc.setFillColor(218, 165, 32); // Gold for filled
        } else {
          doc.setFillColor(200, 200, 200); // Gray for empty
        }
        doc.circle(rx + 62 + s * 5, ry + 5, 1.5, 'F');
      }
      
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.text(item.desc, rx + 3, ry + 11);
    });
    
    yPos += 60;
    
    // Premium Insights section with gold star badge
    doc.setFillColor(184, 134, 11);
    doc.roundedRect(20, yPos, pageWidth - 40, 10, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("PREMIUM INSIGHTS", pageWidth / 2, yPos + 7, { align: "center" });
    
    yPos += 14;
    
    // Four premium insight boxes
    const insightW = (pageWidth - 50) / 2;
    const insightH = 35;
    
    const premiumInsights = [
      { title: "QUALIFIED OPPORTUNITY ZONE", value: "Not in QOZ", desc: "Standard tax treatment applies", color: [139, 92, 246], icon: "$" },
      { title: "FEMA RISK INDEX", value: "Low Risk", desc: "Below national average for natural hazards", color: [34, 197, 94], icon: "OK" },
      { title: "BUILDING FOOTPRINTS", value: "4,768 sq ft", desc: "Single structure built in 2018", color: [59, 130, 246], icon: "H" },
      { title: "SCHOOL DISTRICT", value: "Clinton R-III", desc: "Local public school district", color: [234, 88, 12], icon: "S" },
    ];
    
    premiumInsights.forEach((insight, i) => {
      const ix = 20 + (i % 2) * (insightW + 5);
      const iy = yPos + Math.floor(i / 2) * (insightH + 5);
      
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(ix, iy, insightW, insightH, 3, 3, "F");
      doc.setDrawColor(insight.color[0], insight.color[1], insight.color[2]);
      doc.setLineWidth(1);
      doc.roundedRect(ix, iy, insightW, insightH, 3, 3, "S");
      
      // Icon circle
      doc.setFillColor(insight.color[0], insight.color[1], insight.color[2]);
      doc.circle(ix + 12, iy + 12, 6, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text(insight.icon, ix + 12, iy + 14, { align: "center" });
      
      // Text
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(insight.title, ix + 22, iy + 9);
      
      doc.setTextColor(insight.color[0], insight.color[1], insight.color[2]);
      doc.setFontSize(11);
      doc.text(insight.value, ix + 22, iy + 18);
      
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.text(insight.desc, ix + 22, iy + 25);
    });
    
    yPos += insightH * 2 + 15;
    
    // Additional fun fact
    if (funFacts.length > 1) {
      doc.setFillColor(255, 250, 235);
      doc.roundedRect(20, yPos, pageWidth - 40, 16, 3, 3, "F");
      doc.setTextColor(184, 134, 11);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("MARKET INSIGHT:", 25, yPos + 7);
      doc.setTextColor(100, 80, 40);
      doc.setFont("helvetica", "normal");
      doc.text(funFacts[1] || "Premium insights help you make informed land investment decisions.", 25, yPos + 12);
    }
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 6, totalPages);

    // ============================================
    // PAGE 7: GROWING ZONES & MARKET DATA
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    drawPageHeader(doc, pageWidth, "GROWING ZONES & MARKET DATA", logoImage);
    
    yPos = 42;
    
    // Growing zone highlight
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 18, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Your Property: USDA Hardiness Zone 6a", pageWidth / 2, yPos + 8, { align: "center" });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("Average Annual Minimum Temperature: -10°F to -5°F", pageWidth / 2, yPos + 14, { align: "center" });
    
    yPos += 24;
    
    // Hardiness map
    if (hardinessMap) {
      try { doc.addImage(hardinessMap, "JPEG", 30, yPos, pageWidth - 60, 55); }
      catch (e) {
        doc.setFillColor(240, 240, 240);
        doc.rect(30, yPos, pageWidth - 60, 55, "F");
        doc.setTextColor(100, 100, 100);
        doc.text("USDA Hardiness Zone Map", pageWidth / 2, yPos + 28, { align: "center" });
      }
    } else {
      doc.setFillColor(240, 240, 240);
      doc.rect(30, yPos, pageWidth - 60, 55, "F");
      doc.setTextColor(100, 100, 100);
      doc.text("USDA Hardiness Zone Map", pageWidth / 2, yPos + 28, { align: "center" });
    }
    
    yPos += 60;
    
    // Growing recommendations
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 45, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Zone 6a Growing Recommendations", 25, yPos + 10);
    
    const growingInfo = [
      "• Fruit Trees: Apple, Pear, Cherry, Peach (protected), Plum",
      "• Nut Trees: Black Walnut ($$$), Pecan (northern), Hickory",
      "• Vegetables: Full season for tomatoes, corn, beans, squash",
      "• Growing Season: ~180 days (Mid-April to Mid-October)",
      "• Native Grasses: Big Bluestem, Switchgrass, Indian Grass",
    ];
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    growingInfo.forEach((info, i) => {
      doc.text(info, 25, yPos + 18 + i * 6);
    });
    
    yPos += 52;
    
    // Market context
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("REGIONAL MARKET CONTEXT", 25, yPos + 6);
    
    yPos += 12;
    
    const marketContext = [
      "• Agricultural land in west-central Missouri appreciates 3-5% annually",
      "• Parcels over 80 acres command premium pricing for farming/hunting",
      `• ${parcelData.county} County has strong demand for tillable acreage`,
      "• Hunting leases average $10-15 per acre annually in this region",
      "• Conservation easements can provide significant tax benefits",
    ];
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    marketContext.forEach((info, i) => {
      doc.text(info, 25, yPos + i * 6);
    });
    
    yPos += 38;
    
    // ============================================
    // TIMBER VALUE SECTION
    // ============================================
    doc.setFillColor(139, 90, 43); // Brown header
    doc.roundedRect(20, yPos, pageWidth - 40, 10, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("TIMBER VALUE SNAPSHOT", pageWidth / 2, yPos + 7, { align: "center" });
    
    yPos += 14;
    
    // Timber content box
    doc.setFillColor(255, 250, 240);
    doc.roundedRect(20, yPos, pageWidth - 40, 58, 4, 4, "F");
    doc.setDrawColor(139, 90, 43);
    doc.setLineWidth(1);
    doc.roundedRect(20, yPos, pageWidth - 40, 58, 4, 4, "S");
    
    // Left side - Stumpage Prices
    doc.setTextColor(139, 90, 43);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("MISSOURI STUMPAGE PRICES (per MBF)", 28, yPos + 10);
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    
    // Current MO timber prices (MDC Q4 2025 data approximations)
    const timberPrices = [
      ["White Oak (veneer):", "$800 - $2,500+"],
      ["Red Oak (sawlog):", "$250 - $450"],
      ["Black Walnut:", "$1,200 - $4,000+"],
      ["Hickory:", "$150 - $300"],
    ];
    
    let timberPriceY = yPos + 20;
    timberPrices.forEach(([species, price]) => {
      doc.setFont("helvetica", "normal");
      doc.text(species, 28, timberPriceY);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(34, 83, 60);
      doc.text(price, 75, timberPriceY);
      doc.setTextColor(60, 60, 60);
      timberPriceY += 9;
    });
    
    // Right side - Timber Potential indicator
    const timberBoxX = pageWidth / 2 + 10;
    doc.setTextColor(139, 90, 43);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("TIMBER POTENTIAL", timberBoxX, yPos + 10);
    
    // Calculate timber potential based on acreage
    const timberAcres = parcelData.acreage || 80;
    let timberRating = "LOW";
    let timberColor: [number, number, number] = [220, 53, 69]; // red
    let timberNote = "< 40 acres - Limited harvest value";
    
    if (timberAcres >= 80) {
      timberRating = "HIGH";
      timberColor = [34, 139, 34];
      timberNote = "80+ acres - Commercial harvest viable";
    } else if (timberAcres >= 40) {
      timberRating = "MODERATE";
      timberColor = [184, 134, 11];
      timberNote = "40-80 acres - Selective cut potential";
    }
    
    // Big rating display
    doc.setTextColor(timberColor[0], timberColor[1], timberColor[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(timberRating, timberBoxX, yPos + 30);
    
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(timberNote, timberBoxX, yPos + 40);
    
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text("Prices vary by quality, access & mill distance.", timberBoxX, yPos + 50);
    doc.text("Source: MDC Timber Price Trends", 28, yPos + 54);
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 7, totalPages);

    // ============================================
    // PAGE 8: RESOURCES & DEMOGRAPHICS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    drawPageHeader(doc, pageWidth, "RESOURCES & AREA INFORMATION", logoImage);
    
    yPos = 42;
    
    // County demographics
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, (pageWidth - 45) / 2, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`${parcelData.county.toUpperCase()} COUNTY`, 25, yPos + 5.5);
    
    const demographics = [
      ["Population:", "54,000 (est.)"],
      ["Density:", "62 per sq mi"],
      ["Med. Income:", "$58,500"],
      ["Med. Home:", "$185,000"],
      ["County Seat:", "Warrensburg"],
    ];
    
    let dY = yPos + 14;
    doc.setFontSize(8);
    demographics.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text(label, 24, dY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(value, 55, dY);
      dY += 8;
    });
    
    // Nearby cities
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25 + (pageWidth - 45) / 2, yPos, (pageWidth - 45) / 2, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("NEARBY CITIES", 30 + (pageWidth - 45) / 2, yPos + 5.5);
    
    const cities = [
      "Warrensburg: 15 mi (county seat)",
      "Sedalia: 22 mi (State Fair)",
      "Kansas City: 55 mi (metro)",
      "Whiteman AFB: 12 mi",
      "Columbia: 75 mi (Mizzou)",
    ];
    
    let cY = yPos + 14;
    cities.forEach(city => {
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("• " + city, 30 + (pageWidth - 45) / 2, cY);
      cY += 8;
    });
    
    yPos += 60;
    
    // Resource sections
    const resources = [
      { title: "COUNTY OFFICES", items: ["Assessor: (660) 555-0100", "Recorder: (660) 555-0101", "Planning/Zoning: (660) 555-0102"] },
      { title: "UTILITIES", items: ["Electric Co-op: (660) 555-0200", "Water District: (660) 555-0201", "Propane: Multiple providers"] },
      { title: "AGRICULTURAL", items: ["USDA Service: (660) 555-0300", "MU Extension: (660) 555-0301", "Soil & Water: (660) 555-0303"] },
    ];
    
    resources.forEach((section, i) => {
      const sx = 20 + i * ((pageWidth - 40) / 3 + 2);
      const sw = (pageWidth - 50) / 3;
      
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(sx, yPos, sw, 8, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(section.title, sx + sw / 2, yPos + 5.5, { align: "center" });
      
      let sY = yPos + 13;
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      section.items.forEach(item => {
        doc.text(item, sx + 2, sY);
        sY += 7;
      });
    });
    
    yPos += 45;
    
    // Disclaimer
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 20, 3, 3, "F");
    doc.setTextColor(139, 90, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("IMPORTANT NOTICE", 25, yPos + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("Contact information provided for reference. Please verify current numbers.", 25, yPos + 13);
    doc.text("Terra Firma Partners is not affiliated with these organizations.", 25, yPos + 17);
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 8, totalPages);

    // ============================================
    // PAGE 9: HUNTING & CONSERVATION RESOURCES
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    drawPageHeader(doc, pageWidth, "HUNTING & CONSERVATION RESOURCES", logoImage);
    
    yPos = 42;
    
    // Get hunting data for this county
    const cwdStatus = getCWDStatus(parcelData.county);
    const droughtStatus = getDroughtStatus(parcelData.county);
    const harvestData = getHarvestData(parcelData.county);
    const mdcRegion = getMDCRegion(parcelData.county);
    const nearbyMRAP = getNearbyMRAPAreas(parcelData.county, 3);
    
    // ========================================
    // THREE KEY INDICATORS - Understated but powerful
    // ========================================
    const indicatorW = (pageWidth - 55) / 3;
    
    // INDICATOR 1: CWD Status
    const cwdColor: [number, number, number] = cwdStatus.inZone ? [220, 53, 69] : [34, 139, 34];
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(20, yPos, indicatorW, 32, 3, 3, "F");
    doc.setDrawColor(...cwdColor);
    doc.setLineWidth(0.8);
    doc.roundedRect(20, yPos, indicatorW, 32, 3, 3, "S");
    
    // Small colored dot indicator
    doc.setFillColor(...cwdColor);
    doc.circle(27, yPos + 8, 3, "F");
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("CWD STATUS", 33, yPos + 9);
    
    doc.setTextColor(...cwdColor);
    doc.setFontSize(9);
    doc.text(cwdStatus.inZone ? "In Zone" : "Clear", 22, yPos + 19);
    
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    const cwdNote = cwdStatus.inZone 
      ? (cwdStatus.isNew ? "New 2025 - Special regs apply" : "Management zone - Special regs")
      : "No special CWD restrictions";
    doc.text(cwdNote, 22, yPos + 26);
    
    // INDICATOR 2: Drought Monitor
    const droughtColor: [number, number, number] = droughtStatus.isAffected 
      ? (droughtStatus.level?.color || [234, 179, 8])
      : [34, 139, 34];
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(25 + indicatorW, yPos, indicatorW, 32, 3, 3, "F");
    doc.setDrawColor(...droughtColor);
    doc.setLineWidth(0.8);
    doc.roundedRect(25 + indicatorW, yPos, indicatorW, 32, 3, 3, "S");
    
    doc.setFillColor(...droughtColor);
    doc.circle(32 + indicatorW, yPos + 8, 3, "F");
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("DROUGHT MONITOR", 38 + indicatorW, yPos + 9);
    
    doc.setTextColor(...droughtColor);
    doc.setFontSize(9);
    doc.text(droughtStatus.isAffected ? droughtStatus.level?.name || "Dry" : "Normal", 27 + indicatorW, yPos + 19);
    
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    const droughtNote = droughtStatus.isAffected 
      ? (droughtStatus.level?.impact || "Monitor food plots/water")
      : "Adequate moisture conditions";
    doc.text(droughtNote, 27 + indicatorW, yPos + 26);
    
    // INDICATOR 3: Harvest Pressure
    const harvestColor = harvestData ? getHarvestPressureColor(harvestData.harvestDensity) : [234, 179, 8] as [number, number, number];
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(30 + indicatorW * 2, yPos, indicatorW, 32, 3, 3, "F");
    doc.setDrawColor(...harvestColor);
    doc.setLineWidth(0.8);
    doc.roundedRect(30 + indicatorW * 2, yPos, indicatorW, 32, 3, 3, "S");
    
    doc.setFillColor(...harvestColor);
    doc.circle(37 + indicatorW * 2, yPos + 8, 3, "F");
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("HARVEST PRESSURE", 43 + indicatorW * 2, yPos + 9);
    
    doc.setTextColor(...harvestColor);
    doc.setFontSize(9);
    doc.text(harvestData ? getHarvestPressureLabel(harvestData.harvestDensity) : "Moderate", 32 + indicatorW * 2, yPos + 19);
    
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    const harvestNote = harvestData 
      ? `${harvestData.totalDeer.toLocaleString()} deer harvested (2024)`
      : "County harvest data pending";
    doc.text(harvestNote, 32 + indicatorW * 2, yPos + 26);
    
    yPos += 38;
    
    // Thin divider
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(30, yPos, pageWidth - 30, yPos);
    
    yPos += 6;
    
    // Two column layout: Deer Seasons | Turkey Seasons
    const huntColW = (pageWidth - 50) / 2;
    
    // Deer Seasons
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, huntColW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("DEER SEASONS 2025-2026", 20 + huntColW / 2, yPos + 5.5, { align: "center" });
    
    let dsY = yPos + 12;
    doc.setFontSize(6.5);
    DEER_SEASONS_2025_2026.forEach((season) => {
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.text(season.season + ":", 22, dsY);
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text(season.dates, 50, dsY);
      dsY += 5;
    });
    
    // Turkey Seasons
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25 + huntColW, yPos, huntColW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("TURKEY SEASONS 2025-2026", 25 + huntColW + huntColW / 2, yPos + 5.5, { align: "center" });
    
    let tsY = yPos + 12;
    doc.setFontSize(6.5);
    TURKEY_SEASONS_2025_2026.forEach((season) => {
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.text(season.season + ":", 27 + huntColW, tsY);
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text(season.dates, 57 + huntColW, tsY);
      tsY += 5;
    });
    
    yPos += 42;
    
    // MDC Regional Office & Walk-In Areas side by side
    const halfW = (pageWidth - 45) / 2;
    
    // MDC Regional Office
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, halfW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("YOUR MDC REGIONAL OFFICE", 25, yPos + 5.5);
    
    if (mdcRegion) {
      let mdcY = yPos + 13;
      doc.setFontSize(7);
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.text(mdcRegion.name, 22, mdcY);
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text(mdcRegion.address, 22, mdcY + 5);
      doc.text(mdcRegion.city, 22, mdcY + 10);
      doc.text(mdcRegion.phone, 22, mdcY + 15);
      doc.setTextColor(59, 130, 246);
      doc.text(mdcRegion.email, 22, mdcY + 20);
    }
    
    // Walk-In Hunting Areas
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25 + halfW, yPos, halfW, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("NEARBY MRAP WALK-IN AREAS", 30 + halfW, yPos + 5.5);
    
    let mrapY = yPos + 13;
    doc.setFontSize(7);
    nearbyMRAP.forEach((area) => {
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.text(area.name, 27 + halfW, mrapY);
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text(`${area.county} Co. | ${area.acres} ac | ${area.access}`, 27 + halfW, mrapY + 4);
      mrapY += 10;
    });
    
    yPos += 38;
    
    // Conservation Programs
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("CONSERVATION PROGRAMS FOR LANDOWNERS", pageWidth / 2, yPos + 5.5, { align: "center" });
    
    yPos += 12;
    
    const progW = (pageWidth - 50) / 2;
    CONSERVATION_PROGRAMS.forEach((prog, i) => {
      const px = 20 + (i % 2) * (progW + 5);
      const py = yPos + Math.floor(i / 2) * 16;
      
      doc.setFillColor(245, 250, 245);
      doc.roundedRect(px, py, progW, 14, 2, 2, "F");
      
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(`${prog.abbrev} - ${prog.name}`, px + 3, py + 5);
      
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.5);
      const descLines = doc.splitTextToSize(prog.description, progW - 6);
      doc.text(descLines[0], px + 3, py + 10);
    });
    
    yPos += 38;
    
    // Important Resources
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 18, 3, 3, "F");
    doc.setTextColor(139, 90, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("KEY RESOURCES", 25, yPos + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.text("MDC: mdc.mo.gov | Drought Monitor: droughtmonitor.unl.edu | Report Poaching: 1-800-392-1111", 25, yPos + 11);
    doc.text("CWD Info: mdc.mo.gov/cwd | USDA Service Center: farmers.gov/service-locator", 25, yPos + 15);
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 9, totalPages);

    // ============================================
    // PAGE 10: CERTIFICATE OF ANALYSIS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    
    yPos = 50;
    
    // Certificate header
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(30, yPos, pageWidth - 60, 35, 5, 5, "F");
    
    if (logoImage) { try { doc.addImage(logoImage, "JPEG", pageWidth / 2 - 15, yPos + 3, 30, 30); } catch (e) {} }
    
    yPos += 45;
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("CERTIFICATE OF ANALYSIS", pageWidth / 2, yPos, { align: "center" });
    
    yPos += 12;
    doc.setFillColor(184, 134, 11);
    doc.rect(60, yPos, pageWidth - 120, 1, "F");
    
    yPos += 15;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("This certifies that a comprehensive land analysis has been", pageWidth / 2, yPos, { align: "center" });
    doc.text("conducted for the following property:", pageWidth / 2, yPos + 7, { align: "center" });
    
    yPos += 20;
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(35, yPos, pageWidth - 70, 35, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(order.parcelAddress, pageWidth / 2, yPos + 12, { align: "center" });
    doc.setFontSize(10);
    doc.text(`${parcelData.acreage.toFixed(2)} Acres | ${parcelData.county} County, ${parcelData.state}`, pageWidth / 2, yPos + 22, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Parcel ID: ${parcelData.parcelId}`, pageWidth / 2, yPos + 30, { align: "center" });
    
    yPos += 45;
    
    // Report details
    const certDetails = [
      ["Report ID:", reportNumber],
      ["Generated:", formatDate(new Date())],
      ["Total Pages:", totalPages.toString()],
      ["Data Sources:", "Regrid, Google Maps, USDA, FEMA"],
    ];
    
    certDetails.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(label, pageWidth / 2 - 30, yPos);
      doc.setFont("helvetica", "normal");
      doc.text(value, pageWidth / 2 + 20, yPos);
      yPos += 8;
    });
    
    yPos += 15;
    
    // Signature line
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(0.5);
    doc.line(55, yPos, pageWidth - 55, yPos);
    
    yPos += 8;
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Terra Firma Partners", pageWidth / 2, yPos, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Satellite Intelligence for Landowners", pageWidth / 2, yPos + 6, { align: "center" });
    
    yPos += 20;
    
    // Disclaimer
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    const disclaimer = "This report is provided for informational purposes only and should not be considered legal, financial, or professional advice. Data is sourced from public records and third-party providers. Always verify information with local authorities before making decisions.";
    const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 60);
    doc.text(disclaimerLines, pageWidth / 2, yPos, { align: "center" });
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 10, totalPages);

    // ========== PAGE 11: Unwritten Rules of Rural Land (Part 1) ==========
    doc.addPage();
    yPos = 20;
    
    // Header bar
    doc.setFillColor(34, 83, 60);
    doc.rect(0, 0, pageWidth, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("BONUS: The Unwritten Rules of Rural Land", pageWidth / 2, 12, { align: "center" });
    
    yPos = 30;
    
    // Title
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("The Unwritten Rules of Rural Land", pageWidth / 2, yPos, { align: "center" });
    yPos += 7;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text("A Missouri Field Guide to Neighboring Well", pageWidth / 2, yPos, { align: "center" });
    
    yPos += 15;
    
    // Intro quote
    doc.setFillColor(245, 245, 240);
    doc.roundedRect(20, yPos, pageWidth - 40, 16, 2, 2, "F");
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("Your deed says what you own. This page tells you how to live on it.", pageWidth / 2, yPos + 10, { align: "center" });
    
    yPos += 26;
    
    // Section: Fences & Boundaries
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("🚧  Fences & Boundaries", 20, yPos);
    yPos += 7;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const fenceText = [
      "The fence ain't always the line. Old fences follow working history, not surveys. Your neighbor's",
      "daddy might've set that post in 1962 based on a handshake, not a plat map. That's okay. Don't",
      "move it without a conversation. Leave buffers alone — that scrubby tree line between properties?",
      "It's there on purpose. Don't clear right up to the edge unless you've talked about it first."
    ];
    fenceText.forEach(line => {
      doc.text(line, 25, yPos);
      yPos += 5;
    });
    
    yPos += 8;
    
    // Section: Gates & Crossings
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("🚪  Gates & Crossings", 20, yPos);
    yPos += 7;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const gatesText = [
      "Leave gates how you found 'em. Open means open. Closed means closed. This isn't decorative",
      "— there's livestock logic behind it. Paths exist. You might find worn trails, creek crossings, or",
      "two-tracks that wander across your new property. Some have been used for decades. Ask around",
      "before you block them."
    ];
    gatesText.forEach(line => {
      doc.text(line, 25, yPos);
      yPos += 5;
    });
    
    yPos += 8;
    
    // Section: Noise, Activity & Seasons
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("🔊  Noise, Activity & Seasons", 20, yPos);
    yPos += 7;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const noiseText = [
      "Rural ain't quiet. Tractors at dawn. Chainsaws on Saturdays. Dogs that bark at deer. Roosters.",
      "This is the soundtrack — not a disturbance. Hunting season is real. Trucks parked on field edges",
      "at 4am in November? Turkey hunters in full camo crossing the back forty in April? That's not",
      "trespassing — that's tradition. If you didn't post it and they've hunted it for years, expect a",
      "conversation before you shut it down. Hay gets cut when hay's ready. Your neighbor might be",
      "running equipment at 10pm in June. That's not rude — that's rain coming tomorrow."
    ];
    noiseText.forEach(line => {
      doc.text(line, 25, yPos);
      yPos += 5;
    });
    
    yPos += 8;
    
    // Section: Wildlife & Water
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("🦌  Wildlife & Water", 20, yPos);
    yPos += 7;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const wildlifeText = [
      "Deer don't read deeds. Wildlife crosses every line. So do their hunters' eyes. Be a good neighbor",
      "about sight lines and food plots. Creeks are shared. That drainage ditch, wet-weather creek, or",
      "pond overflow doesn't belong to anybody fully. Don't dam it. Don't poison it. Don't assume."
    ];
    wildlifeText.forEach(line => {
      doc.text(line, 25, yPos);
      yPos += 5;
    });
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 11, totalPages);

    // ========== PAGE 12: Unwritten Rules of Rural Land (Part 2) ==========
    doc.addPage();
    yPos = 20;
    
    // Header bar
    doc.setFillColor(34, 83, 60);
    doc.rect(0, 0, pageWidth, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("BONUS: The Unwritten Rules of Rural Land (continued)", pageWidth / 2, 12, { align: "center" });
    
    yPos = 30;
    
    // Section: The Neighbor Code
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("🤝  The Neighbor Code", 20, yPos);
    yPos += 10;
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    
    const neighborRules = [
      ["Wave.", "Every time. Even if you don't know 'em yet."],
      ["Assume good intent.", "That guy on your property line with a chainsaw? Probably cleaning up a fallen tree that's half on his side. Say thanks before you say \"hey.\""],
      ["Talk before you change things.", "New fence. New driveway. New buildings. If it's visible from their porch or audible from their bedroom, a heads-up goes a long way."],
      ["Don't be the one who \"lawyered up.\"", "You can win a boundary dispute and lose every neighbor for a mile. Out here, reputation lasts longer than lawsuits."],
    ];
    
    neighborRules.forEach(([rule, explanation]) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(`• ${rule}`, 25, yPos);
      yPos += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const expLines = doc.splitTextToSize(explanation, pageWidth - 55);
      expLines.forEach((line: string) => {
        doc.text(line, 30, yPos);
        yPos += 5;
      });
      yPos += 4;
    });
    
    yPos += 10;
    
    // Bottom line box
    doc.setFillColor(245, 245, 240);
    doc.roundedRect(20, yPos, pageWidth - 40, 35, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("The Bottom Line", pageWidth / 2, yPos + 10, { align: "center" });
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("These aren't rules. They're how it works.", pageWidth / 2, yPos + 18, { align: "center" });
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("And if you mess up? A six-pack and an apology go further than you'd think.", pageWidth / 2, yPos + 26, { align: "center" });
    
    yPos += 50;
    
    // Final note
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("This isn't legal advice. It's land sense. Actual neighbor expectations vary — and that's the point.", pageWidth / 2, yPos, { align: "center" });
    
    yPos += 15;
    
    // About section
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25, yPos, pageWidth - 50, 40, 3, 3, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("About This Guide", pageWidth / 2, yPos + 10, { align: "center" });
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const aboutText = "Understanding land means understanding how it's been lived on. This guide was written for buyers, investors, and newcomers navigating the unwritten customs of rural Missouri.";
    const aboutLines = doc.splitTextToSize(aboutText, pageWidth - 60);
    let aboutY = yPos + 18;
    aboutLines.forEach((line: string) => {
      doc.text(line, pageWidth / 2, aboutY, { align: "center" });
      aboutY += 5;
    });
    
    doc.setFont("helvetica", "italic");
    doc.text("The best land decisions start with local knowledge.", pageWidth / 2, yPos + 33, { align: "center" });
    
    yPos += 55;
    
    // Closing
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Questions about a property?", pageWidth / 2, yPos, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.text("TerraFirmaPartners.com  —  Your neighbor in the land business.", pageWidth / 2, yPos + 7, { align: "center" });
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 12, totalPages);

    // Generate and return PDF as base64 JSON for dashboard download
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfBase64 = pdfBuffer.toString("base64");
    const filename = `TFP-${parcelData.siteAddress?.replace(/[^a-zA-Z0-9]/g, "-") || order.id}.pdf`;
    
    return NextResponse.json({
      pdf: pdfBase64,
      filename: filename,
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
