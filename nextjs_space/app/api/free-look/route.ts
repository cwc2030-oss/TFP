import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { getCachedParcel, setCachedParcel, CachedParcelData } from "@/lib/regrid-cache";
import { fetchSoilData, SoilData, getFarmlandRating, getDrainageRating, getCapabilityDescription } from "@/lib/usda-soil";
import { getCWDStatus, getMDCRegion, getNearbyMRAPAreas, getDroughtStatus, getHarvestData, getHarvestPressureLabel, getHarvestPressureColor, DEER_SEASONS_2025_2026, TURKEY_SEASONS_2025_2026, CONSERVATION_PROGRAMS } from "@/lib/missouri-hunting";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Sample location - will fetch real parcel data from Regrid
const SAMPLE_ORDER = {
  parcelAddress: "2100 S State Route Y, Pleasant Hill, MO 64080, USA",
  parcelLat: 38.7892,
  parcelLng: -94.2654,
};

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
async function fetchRegridParcelData(lat: number, lng: number): Promise<ParcelData | null> {
  // Check cache first
  const cached = await getCachedParcel(lat, lng);
  if (cached) {
    console.log(`[SAMPLE] Using cached parcel data for ${lat}, ${lng}`);
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
    console.log(`[SAMPLE] Fetching fresh parcel data from Regrid for ${lat}, ${lng}`);
    const searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;
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
    siteAddress: "2100 S State Route Y, Pleasant Hill, MO 64080",
    acreage: 117.52,
    sqft: 5120071,
    zoning: "A-1 Agricultural",
    useDescription: "Agricultural - Recreational",
    coordinates: null,
    marketValue: 528840,
    landValue: 528840,
    improvementValue: 0,
    taxYear: "2024",
    saleDate: "2022-06-15",
    salePrice: 499000,
    county: "Cass",
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

// Draw a stylized deer head silhouette
function drawDeerSilhouette(doc: jsPDF, x: number, y: number, size: number, color: [number, number, number]) {
  doc.setFillColor(...color);
  doc.setDrawColor(...color);
  
  // Head (oval)
  doc.ellipse(x, y, size * 0.35, size * 0.45, "F");
  
  // Ears (triangles)
  doc.triangle(x - size * 0.3, y - size * 0.3, x - size * 0.15, y - size * 0.5, x - size * 0.05, y - size * 0.25, "F");
  doc.triangle(x + size * 0.3, y - size * 0.3, x + size * 0.15, y - size * 0.5, x + size * 0.05, y - size * 0.25, "F");
  
  // Antlers (lines) - left side
  doc.setLineWidth(size * 0.06);
  doc.line(x - size * 0.2, y - size * 0.4, x - size * 0.4, y - size * 0.8);
  doc.line(x - size * 0.35, y - size * 0.65, x - size * 0.55, y - size * 0.7);
  doc.line(x - size * 0.3, y - size * 0.55, x - size * 0.45, y - size * 0.5);
  
  // Antlers - right side
  doc.line(x + size * 0.2, y - size * 0.4, x + size * 0.4, y - size * 0.8);
  doc.line(x + size * 0.35, y - size * 0.65, x + size * 0.55, y - size * 0.7);
  doc.line(x + size * 0.3, y - size * 0.55, x + size * 0.45, y - size * 0.5);
  
  // Neck
  doc.setLineWidth(0.5);
  doc.ellipse(x, y + size * 0.5, size * 0.25, size * 0.2, "F");
}

// Draw a simple turkey silhouette
function drawTurkeySilhouette(doc: jsPDF, x: number, y: number, size: number, color: [number, number, number]) {
  doc.setFillColor(...color);
  
  // Body (oval)
  doc.ellipse(x, y, size * 0.4, size * 0.3, "F");
  
  // Head/neck
  doc.ellipse(x - size * 0.35, y - size * 0.15, size * 0.12, size * 0.15, "F");
  
  // Tail fan (triangle)
  doc.triangle(x + size * 0.3, y - size * 0.4, x + size * 0.7, y, x + size * 0.3, y + size * 0.4, "F");
  
  // Snood
  doc.setDrawColor(...color);
  doc.setLineWidth(size * 0.05);
  doc.line(x - size * 0.4, y - size * 0.05, x - size * 0.45, y + size * 0.1);
}

function drawPageFooter(doc: jsPDF, pageWidth: number, pageHeight: number, reportNumber: string, currentPage: number, totalPages: number) {
  doc.setFillColor(184, 134, 11);
  doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
  doc.setTextColor(100, 100, 100);
  doc.setFontSize(8);
  doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
  doc.text(`Page ${currentPage} of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });
}

export async function GET() {
  try {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const reportNumber = generateReportNumber();
    const totalPages = 11; // Added soil analysis + hunting pages + unwritten rules tease
    const order = SAMPLE_ORDER;
    
    // For Free Look, always use our curated sample data to showcase best features
    // (Real parcel lookups sometimes hit small adjacent parcels that don't showcase well)
    const parcelData = getDefaultSampleData();
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
    // Removed hardiness map fetch - no longer needed

    // ============================================
    // PAGE 1: COVER PAGE
    // ============================================
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
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
    
    // BIG ACREAGE DISPLAY - Most prominent element
    doc.setFillColor(184, 134, 11);
    doc.roundedRect(25, infoY, pageWidth - 50, 22, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(32);
    doc.text(`${parcelData.acreage.toFixed(2)} ACRES`, pageWidth / 2, infoY + 16, { align: "center" });
    
    infoY += 26;
    
    // Property details below
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25, infoY, pageWidth - 50, 20, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(order.parcelAddress, pageWidth / 2, infoY + 8, { align: "center" });
    doc.text(`${parcelData.county} County, ${parcelData.state}`, pageWidth / 2, infoY + 15, { align: "center" });
    
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
    drawSampleWatermark(doc, pageWidth, pageHeight);
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
    
    // Property Tax Snapshot section (clean, clear format)
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("PROPERTY TAX SNAPSHOT", 25, yPos + 6);
    
    yPos += 12;
    
    // Calculate tax values - Missouri agricultural land assessment
    const estimatedMarketValue = Math.round(parcelData.acreage * 4500); // ~$4,500/acre for ag land
    const assessedValue = parcelData.marketValue || Math.round(estimatedMarketValue * 0.12); // Agricultural = 12% of market
    const classificationPct = 12; // Agricultural classification in Missouri
    const effectiveTaxRate = 3.12; // Typical rural MO rate per $100
    const estimatedAnnualTax = Math.round((assessedValue / 100) * effectiveTaxRate);
    const isEstimated = !parcelData.marketValue;
    
    // Property Tax Snapshot box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(20, yPos, pageWidth - 40, 52, 3, 3, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(0.3);
    doc.roundedRect(20, yPos, pageWidth - 40, 52, 3, 3, "S");
    
    // Tax details - clean bullet list format
    const taxItems = [
      { label: "Assessed Value (Tax Basis):", value: `$${assessedValue.toLocaleString()}${isEstimated ? "*" : ""}` },
      { label: "Classification:", value: `Agricultural (${classificationPct}%)` },
      { label: "Effective Tax Rate:", value: `$${effectiveTaxRate.toFixed(2)} / $100` },
      { label: "Estimated Annual Property Tax:", value: `~$${estimatedAnnualTax.toLocaleString()}` },
    ];
    
    let taxY = yPos + 10;
    doc.setFontSize(10);
    taxItems.forEach((item) => {
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text("•", 26, taxY);
      doc.setFont("helvetica", "bold");
      doc.text(item.label, 32, taxY);
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      const labelWidth = doc.getTextWidth(item.label);
      doc.text(item.value, 34 + labelWidth, taxY);
      taxY += 10;
    });
    
    yPos += 56;
    
    // Interpretation Note box
    doc.setFillColor(255, 251, 235); // Warm cream background
    doc.roundedRect(20, yPos, pageWidth - 40, 22, 2, 2, "F");
    doc.setDrawColor(180, 140, 60);
    doc.setLineWidth(0.3);
    doc.roundedRect(20, yPos, pageWidth - 40, 22, 2, 2, "S");
    
    // Interpretation note header
    doc.setTextColor(120, 90, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Interpretation Note:", 25, yPos + 6);
    
    // Interpretation note text
    doc.setTextColor(80, 70, 50);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    const noteText = '"This value is assigned for taxation purposes only and does not represent market value. It is best interpreted as an indicator of annual holding cost and classification status."';
    const noteLines = doc.splitTextToSize(noteText, pageWidth - 50);
    doc.text(noteLines, 25, yPos + 12);
    
    yPos += 26;
    
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
    drawSampleWatermark(doc, pageWidth, pageHeight);
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
    drawSampleWatermark(doc, pageWidth, pageHeight);
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
    
    // Key takeaways - LARGER FONT
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 50, 3, 3, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(1);
    doc.roundedRect(20, yPos, pageWidth - 40, 50, 3, 3, "S");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("KEY TAKEAWAYS", 25, yPos + 10);
    
    const takeaways = [
      "• Zone X = No flood insurance required - excellent for building",
      "• Electric at road = lower utility extension costs",
      "• Missouri River watershed = reliable groundwater for wells",
      "• Paved road access = higher property value",
    ];
    
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    takeaways.forEach((t, i) => {
      doc.text(t, 25, yPos + 20 + i * 8);
    });
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 4, totalPages);

    // ============================================
    // PAGE 5: SOIL ANALYSIS (USDA Data) - SIMPLIFIED
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    drawPageHeader(doc, pageWidth, "SOIL COMPOSITION", logoImage);
    
    yPos = 48;
    
    // Two big soil composition boxes - LARGER AND CLEANER
    const soilColW = (pageWidth - 50) / 2;
    const soilBoxH = 100;
    
    // Left column - Primary Soil Data
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, soilColW, soilBoxH, 4, 4, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(1);
    doc.roundedRect(20, yPos, soilColW, soilBoxH, 4, 4, "S");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("PRIMARY SOIL DATA", 28, yPos + 14);
    
    const leftSoilFields = [
      ["Soil Type:", soilData.mapUnitName || "See county records"],
      ["Drainage:", soilData.drainageClass || "See county records"],
      ["Hydrologic Group:", soilData.hydrologicGroup || "N/A"],
      ["Slope:", soilData.slopeGradient || "0-3%"],
    ];
    
    let sY = yPos + 28;
    leftSoilFields.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(label, 28, sY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.setFontSize(11);
      const displayVal = String(value).substring(0, 28);
      doc.text(displayVal, 28, sY + 8);
      sY += 18;
    });
    
    // Right column - Agricultural Metrics
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(30 + soilColW, yPos, soilColW, soilBoxH, 4, 4, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(1);
    doc.roundedRect(30 + soilColW, yPos, soilColW, soilBoxH, 4, 4, "S");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("AGRICULTURAL METRICS", 38 + soilColW, yPos + 14);
    
    const rightSoilFields = [
      ["Land Class:", `Class ${soilData.landCapabilityClass}${soilData.landCapabilitySubclass}`],
      ["Surface pH:", soilData.ph ? soilData.ph.toFixed(1) : "6.0-7.0 typical"],
      ["Organic Matter:", soilData.organicMatter ? `${soilData.organicMatter.toFixed(1)}%` : "2-4% typical"],
      ["Flood Risk:", soilData.floodFrequency || "None expected"],
    ];
    
    sY = yPos + 28;
    rightSoilFields.forEach(([label, value]) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(label, 38 + soilColW, sY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.setFontSize(11);
      doc.text(String(value).substring(0, 28), 38 + soilColW, sY + 8);
      sY += 18;
    });
    
    yPos += soilBoxH + 15;
    
    // Simple USDA Source Note
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 22, 3, 3, "F");
    doc.setTextColor(139, 90, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("DATA SOURCE", 28, yPos + 9);
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("USDA Natural Resources Conservation Service. Site-specific testing recommended.", 28, yPos + 17);
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 5, totalPages);

    // ============================================
    // PAGE 6: PREMIUM INSIGHTS - SIMPLIFIED
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    drawPageHeader(doc, pageWidth, "PREMIUM INSIGHTS", logoImage);
    
    yPos = 48;
    
    // Three clean insight boxes (removed Building Footprints sq ft)
    const insightW = (pageWidth - 55) / 3;
    const insightH = 65;
    
    const premiumInsights = [
      { title: "OPPORTUNITY ZONE", value: "Not in QOZ", desc: "Standard tax treatment applies", color: [139, 92, 246] as [number, number, number], icon: "$" },
      { title: "FEMA RISK INDEX", value: "Low Risk", desc: "Below national average for hazards", color: [34, 197, 94] as [number, number, number], icon: "✓" },
      { title: "SCHOOL DISTRICT", value: `${parcelData.county} County`, desc: "Contact county for details", color: [234, 88, 12] as [number, number, number], icon: "S" },
    ];
    
    premiumInsights.forEach((insight, i) => {
      const ix = 20 + i * (insightW + 7);
      
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(ix, yPos, insightW, insightH, 4, 4, "F");
      doc.setDrawColor(insight.color[0], insight.color[1], insight.color[2]);
      doc.setLineWidth(2);
      doc.roundedRect(ix, yPos, insightW, insightH, 4, 4, "S");
      
      // Icon circle
      doc.setFillColor(insight.color[0], insight.color[1], insight.color[2]);
      doc.circle(ix + insightW / 2, yPos + 16, 8, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(insight.icon, ix + insightW / 2, yPos + 19, { align: "center" });
      
      // Title
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(insight.title, ix + insightW / 2, yPos + 34, { align: "center" });
      
      // Value
      doc.setTextColor(insight.color[0], insight.color[1], insight.color[2]);
      doc.setFontSize(14);
      doc.text(insight.value, ix + insightW / 2, yPos + 46, { align: "center" });
      
      // Description
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(insight.desc, ix + insightW / 2, yPos + 56, { align: "center" });
    });
    
    yPos += insightH + 20;
    
    // Big Market Insight Box
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 50, 4, 4, "F");
    doc.setDrawColor(184, 134, 11);
    doc.setLineWidth(1);
    doc.roundedRect(20, yPos, pageWidth - 40, 50, 4, 4, "S");
    
    doc.setTextColor(184, 134, 11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("MARKET INSIGHT", 28, yPos + 14);
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const marketText = funFacts.length > 1 
      ? funFacts[1] 
      : `Properties in ${parcelData.county} County are seeing steady demand from hunters and farmers.`;
    const marketLines = doc.splitTextToSize(marketText, pageWidth - 60);
    doc.text(marketLines, 28, yPos + 28);
    
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text("West-central Missouri ag land appreciates 3-5% annually on average.", 28, yPos + 44);
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 6, totalPages);

    // ============================================
    // PAGE 7: WHAT GROWS HERE - SIMPLIFIED
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    drawPageHeader(doc, pageWidth, "WHAT GROWS HERE", logoImage);
    
    yPos = 48;
    
    // Growing zone banner - compact
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 22, 4, 4, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("USDA Hardiness Zone 6a  •  Growing Season: ~180 days", pageWidth / 2, yPos + 14, { align: "center" });
    
    yPos += 32;
    
    // Two FANCY column layout - What grows here
    const growColW = (pageWidth - 50) / 2;
    const growBoxH = 120;
    
    // LEFT: Food Plots & Trees - FANCIED UP
    doc.setFillColor(240, 255, 240);
    doc.roundedRect(20, yPos, growColW, growBoxH, 6, 6, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(2);
    doc.roundedRect(20, yPos, growColW, growBoxH, 6, 6, "S");
    
    // Decorative leaf icon
    doc.setFillColor(34, 83, 60);
    doc.circle(45, yPos + 18, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text("🌱", 41, yPos + 22);
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("FOOD PLOTS & TREES", 60, yPos + 20);
    
    doc.setTextColor(50, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("DEER FOOD PLOTS", 28, yPos + 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Clover, chicory, brassicas,", 28, yPos + 50);
    doc.text("soybeans, winter wheat", 28, yPos + 60);
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("FRUIT & NUT TREES", 28, yPos + 78);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Apple, pear, persimmon, white", 28, yPos + 90);
    doc.text("oak, sawtooth oak, chestnuts", 28, yPos + 100);
    
    // RIGHT: Native Habitat - FANCIED UP
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(30 + growColW, yPos, growColW, growBoxH, 6, 6, "F");
    doc.setDrawColor(139, 90, 43);
    doc.setLineWidth(2);
    doc.roundedRect(30 + growColW, yPos, growColW, growBoxH, 6, 6, "S");
    
    // Decorative grass icon
    doc.setFillColor(139, 90, 43);
    doc.circle(55 + growColW, yPos + 18, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text("🌾", 51 + growColW, yPos + 22);
    
    doc.setTextColor(139, 90, 43);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("NATIVE HABITAT", 70 + growColW, yPos + 20);
    
    doc.setTextColor(50, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("WARM SEASON GRASSES", 38 + growColW, yPos + 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Big bluestem, switchgrass,", 38 + growColW, yPos + 50);
    doc.text("Indian grass", 38 + growColW, yPos + 60);
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("WILDLIFE COVER", 38 + growColW, yPos + 78);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Native plum thickets, cedar", 38 + growColW, yPos + 90);
    doc.text("windbreaks, shrub rows", 38 + growColW, yPos + 100);
    
    yPos += growBoxH + 15;
    
    // ============================================
    // TIMBER VALUE SECTION - NEW
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
    const acres = parcelData.acreage || 117.52;
    let timberRating = "LOW";
    let timberColor: [number, number, number] = [220, 53, 69]; // red
    let timberNote = "< 40 acres - Limited harvest value";
    
    if (acres >= 80) {
      timberRating = "HIGH";
      timberColor = [34, 139, 34];
      timberNote = "80+ acres - Commercial harvest viable";
    } else if (acres >= 40) {
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
    drawSampleWatermark(doc, pageWidth, pageHeight);
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
      { title: "UTILITIES", items: ["Electric Co-op: (660) 555-0200", "Water District: (660) 555-0201", "Internet: Starlink available"] },
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
    // PAGE 9: HUNTING INTELLIGENCE DASHBOARD
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    // Custom header for this page - more impactful with COUNTY NAME
    doc.setFillColor(34, 83, 60);
    doc.rect(0, 0, pageWidth, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`${parcelData.county.toUpperCase()} COUNTY HUNTING INTEL`, pageWidth / 2, 12, { align: "center" });
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("The stuff nobody else tells you about this land", pageWidth / 2, 23, { align: "center" });
    
    yPos = 42;
    
    // Get hunting data for this county
    const cwdStatus = getCWDStatus(parcelData.county);
    const droughtStatus = getDroughtStatus(parcelData.county);
    const harvestData = getHarvestData(parcelData.county);
    const mdcRegion = getMDCRegion(parcelData.county);
    const nearbyMRAP = getNearbyMRAPAreas(parcelData.county, 3);
    
    // ========================================
    // THREE BIG DASHBOARD CARDS WITH DEER SILHOUETTES
    // ========================================
    const cardW = (pageWidth - 50) / 3;
    const cardH = 62;
    const cardGap = 5;
    
    // CARD 1: CWD STATUS
    const cwdColor: [number, number, number] = cwdStatus.inZone ? [220, 53, 69] : [34, 139, 34];
    const cwdBg: [number, number, number] = cwdStatus.inZone ? [255, 240, 240] : [240, 255, 240];
    
    doc.setFillColor(...cwdBg);
    doc.roundedRect(20, yPos, cardW, cardH, 4, 4, "F");
    doc.setDrawColor(...cwdColor);
    doc.setLineWidth(2);
    doc.roundedRect(20, yPos, cardW, cardH, 4, 4, "S");
    
    // Deer silhouette watermark (subtle)
    drawDeerSilhouette(doc, 20 + cardW - 15, yPos + 18, 12, [cwdColor[0], cwdColor[1], cwdColor[2]]);
    
    doc.setTextColor(...cwdColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("CWD STATUS", 25, yPos + 12);
    
    doc.setFontSize(26);
    doc.text(cwdStatus.inZone ? "IN ZONE" : "CLEAR", 25, yPos + 32);
    
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const cwdNote = cwdStatus.inZone 
      ? (cwdStatus.isNew ? "New 2025 designation" : "Management zone")
      : "No CWD detected in county";
    doc.text(cwdNote, 25, yPos + 42);
    
    doc.setFontSize(8);
    doc.text(cwdStatus.inZone ? "Special regulations apply" : "Standard harvest rules", 25, yPos + 51);
    
    // Date stamp for CWD data
    doc.setTextColor(120, 120, 120);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    const cwdDate = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    doc.text(`Verified: ${cwdDate}`, 25, yPos + 58);
    
    // CARD 2: DROUGHT MONITOR
    const droughtColor: [number, number, number] = droughtStatus.isAffected 
      ? (droughtStatus.level?.color || [234, 179, 8])
      : [34, 139, 34];
    const droughtBg: [number, number, number] = droughtStatus.isAffected ? [255, 250, 230] : [240, 255, 240];
    
    doc.setFillColor(...droughtBg);
    doc.roundedRect(25 + cardW, yPos, cardW, cardH, 4, 4, "F");
    doc.setDrawColor(...droughtColor);
    doc.setLineWidth(2);
    doc.roundedRect(25 + cardW, yPos, cardW, cardH, 4, 4, "S");
    
    // Deer silhouette watermark
    drawDeerSilhouette(doc, 25 + cardW * 2 - 10, yPos + 18, 12, droughtColor);
    
    doc.setTextColor(...droughtColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("DROUGHT STATUS", 30 + cardW, yPos + 12);
    
    doc.setFontSize(26);
    doc.text(droughtStatus.isAffected ? droughtStatus.level?.name?.toUpperCase() || "DRY" : "NORMAL", 30 + cardW, yPos + 32);
    
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const droughtNote = droughtStatus.isAffected 
      ? (droughtStatus.level?.impact || "Monitor water sources")
      : "Good moisture conditions";
    doc.text(droughtNote, 30 + cardW, yPos + 42);
    
    doc.setFontSize(8);
    doc.text(droughtStatus.isAffected ? "Food plots may struggle" : "Healthy forage expected", 30 + cardW, yPos + 51);
    
    // CARD 3: HARVEST PRESSURE
    const harvestColor: [number, number, number] = harvestData ? getHarvestPressureColor(harvestData.harvestDensity) : [234, 179, 8];
    const isHighPressure = harvestData?.harvestDensity === "high" || harvestData?.harvestDensity === "very high";
    const harvestBg: [number, number, number] = isHighPressure ? [255, 240, 240] : [240, 255, 240];
    
    doc.setFillColor(...harvestBg);
    doc.roundedRect(30 + cardW * 2, yPos, cardW, cardH, 4, 4, "F");
    doc.setDrawColor(...harvestColor);
    doc.setLineWidth(2);
    doc.roundedRect(30 + cardW * 2, yPos, cardW, cardH, 4, 4, "S");
    
    // Deer silhouette watermark
    drawDeerSilhouette(doc, 30 + cardW * 3 - 10, yPos + 18, 12, harvestColor);
    
    doc.setTextColor(...harvestColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("HARVEST PRESSURE", 35 + cardW * 2, yPos + 12);
    
    doc.setFontSize(26);
    const pressureLabel = harvestData ? getHarvestPressureLabel(harvestData.harvestDensity).toUpperCase() : "MODERATE";
    doc.text(pressureLabel, 35 + cardW * 2, yPos + 32);
    
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const harvestNote = harvestData 
      ? `${harvestData.totalDeer.toLocaleString()} deer taken (2024)`
      : "County data pending";
    doc.text(harvestNote, 35 + cardW * 2, yPos + 42);
    
    doc.setFontSize(8);
    const pressureTip = isHighPressure ? "High competition area" : "Lower hunting pressure";
    doc.text(pressureTip, 35 + cardW * 2, yPos + 51);
    
    yPos += cardH + 10;
    
    // ========================================
    // SEASON DATES - Two columns with icons
    // ========================================
    const seasonW = (pageWidth - 45) / 2;
    
    // Deer Season Box
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, seasonW, 50, 3, 3, "F");
    
    // Deer silhouette in corner
    drawDeerSilhouette(doc, 20 + seasonW - 12, yPos + 12, 10, [255, 255, 255]);
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("DEER SEASONS", 25, yPos + 10);
    doc.setFontSize(8);
    doc.text("2025-2026", 25, yPos + 17);
    
    let dsY = yPos + 26;
    doc.setFontSize(8);
    DEER_SEASONS_2025_2026.slice(0, 4).forEach((season) => {
      doc.setFont("helvetica", "bold");
      doc.text(season.season, 25, dsY);
      doc.setFont("helvetica", "normal");
      doc.text(season.dates, 55, dsY);
      dsY += 6;
    });
    
    // Turkey Season Box
    doc.setFillColor(139, 90, 43);
    doc.roundedRect(25 + seasonW, yPos, seasonW, 50, 3, 3, "F");
    
    // Turkey silhouette in corner
    drawTurkeySilhouette(doc, 25 + seasonW * 2 - 12, yPos + 12, 10, [255, 255, 255]);
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("TURKEY SEASONS", 30 + seasonW, yPos + 10);
    doc.setFontSize(8);
    doc.text("2025-2026", 30 + seasonW, yPos + 17);
    
    let tsY = yPos + 26;
    doc.setFontSize(8);
    TURKEY_SEASONS_2025_2026.slice(0, 4).forEach((season) => {
      doc.setFont("helvetica", "bold");
      doc.text(season.season, 30 + seasonW, tsY);
      doc.setFont("helvetica", "normal");
      doc.text(season.dates, 62 + seasonW, tsY);
      tsY += 6;
    });
    
    yPos += 58;
    
    // ========================================
    // MDC OFFICE & MRAP AREAS - Compact
    // ========================================
    const infoW = (pageWidth - 45) / 2;
    
    // MDC Office
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, infoW, 40, 3, 3, "F");
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("YOUR MDC OFFICE", 25, yPos + 8);
    
    if (mdcRegion) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);
      doc.text(mdcRegion.name, 25, yPos + 16);
      doc.text(mdcRegion.phone, 25, yPos + 23);
      doc.setTextColor(59, 130, 246);
      doc.text(mdcRegion.email, 25, yPos + 30);
    }
    
    // Nearby Walk-In Areas
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(25 + infoW, yPos, infoW, 40, 3, 3, "F");
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("WALK-IN HUNTING NEARBY", 30 + infoW, yPos + 8);
    
    let mrapY = yPos + 16;
    doc.setFontSize(7);
    nearbyMRAP.slice(0, 3).forEach((area) => {
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text(`${area.name} - ${area.acres} ac`, 30 + infoW, mrapY);
      mrapY += 7;
    });
    
    yPos += 48;
    
    // KEY RESOURCES - Footer bar
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 16, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("KEY RESOURCES:", 25, yPos + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("mdc.mo.gov  |  droughtmonitor.unl.edu  |  Report Poaching: 1-800-392-1111", 70, yPos + 7);
    doc.text("CWD Info: mdc.mo.gov/cwd  |  USDA Service: farmers.gov/service-locator", 70, yPos + 13);
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 9, totalPages);

    // ============================================
    // PAGE 10: CERTIFICATE OF ANALYSIS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
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
    doc.roundedRect(35, yPos, pageWidth - 70, 50, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(order.parcelAddress, pageWidth / 2, yPos + 12, { align: "center" });
    
    // BIG ACREAGE
    doc.setFontSize(22);
    doc.setTextColor(184, 134, 11);
    doc.text(`${parcelData.acreage.toFixed(2)} ACRES`, pageWidth / 2, yPos + 28, { align: "center" });
    
    doc.setTextColor(34, 83, 60);
    doc.setFontSize(11);
    doc.text(`${parcelData.county} County, ${parcelData.state}`, pageWidth / 2, yPos + 38, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Parcel ID: ${parcelData.parcelId}`, pageWidth / 2, yPos + 46, { align: "center" });
    
    yPos += 58;
    
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

    // ========== PAGE 11: Unwritten Rules Tease ==========
    doc.addPage();
    yPos = 25;
    
    // Header
    doc.setFillColor(34, 83, 60);
    doc.rect(0, 0, pageWidth, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("BONUS: Included with Every Paid Report", pageWidth / 2, 12, { align: "center" });
    
    yPos = 40;
    
    // Main title
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text("The Unwritten Rules", pageWidth / 2, yPos, { align: "center" });
    yPos += 10;
    doc.setFontSize(16);
    doc.text("of Rural Land", pageWidth / 2, yPos, { align: "center" });
    
    yPos += 8;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text("A Missouri Field Guide to Neighboring Well", pageWidth / 2, yPos, { align: "center" });
    
    yPos += 20;
    
    // Intro quote box
    doc.setFillColor(245, 245, 240);
    doc.roundedRect(25, yPos, pageWidth - 50, 28, 3, 3, "F");
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    const quoteText = "Your deed says what you own. This guide tells you how to live on it.";
    doc.text(quoteText, pageWidth / 2, yPos + 12, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("— The stuff your realtor won't tell you", pageWidth / 2, yPos + 21, { align: "center" });
    
    yPos += 45;
    
    // What's covered section
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("What You'll Learn:", 30, yPos);
    yPos += 12;
    
    const topics = [
      ["🚧", "Fences & Boundaries", "Why the fence ain't always the property line"],
      ["🚪", "Gates & Crossings", "The unspoken rules of rural access"],
      ["🔊", "Noise & Seasons", "Tractors at dawn, chainsaws on Saturdays"],
      ["🦌", "Wildlife & Water", "Deer don't read deeds — neither do creeks"],
      ["🤝", "The Neighbor Code", "How to earn trust, not lawsuits"],
    ];
    
    topics.forEach(([emoji, title, desc]) => {
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(`${emoji}  ${title}`, 35, yPos);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(desc, 50, yPos + 6);
      yPos += 18;
    });
    
    yPos += 10;
    
    // Bottom callout box
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25, yPos, pageWidth - 50, 45, 3, 3, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("This 2-page guide is included FREE", pageWidth / 2, yPos + 14, { align: "center" });
    doc.text("with every paid Land Analysis Report.", pageWidth / 2, yPos + 24, { align: "center" });
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Ready to get the full picture?  →  TerraFirmaPartners.com", pageWidth / 2, yPos + 36, { align: "center" });
    
    yPos += 60;
    
    // Footer note
    doc.setTextColor(120, 120, 120);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("Rural land runs on an operating system nobody writes down.", pageWidth / 2, yPos, { align: "center" });
    doc.text("The families who've been here for generations absorbed it growing up.", pageWidth / 2, yPos + 5, { align: "center" });
    doc.text("If you're new to the country — this guide helps you fit right in.", pageWidth / 2, yPos + 10, { align: "center" });
    
    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 11, totalPages);

    // Generate and return PDF
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=terra_firma_free_look.pdf",
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (error) {
    console.error("Sample report generation error:", error);
    return NextResponse.json({ error: "Failed to generate sample report" }, { status: 500 });
  }
}
