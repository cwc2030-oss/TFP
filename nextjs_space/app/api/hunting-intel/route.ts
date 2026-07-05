import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { jsPDF } from "jspdf";
import { getCachedParcel, setCachedParcel, CachedParcelData } from "@/lib/regrid-cache";
import { regridFetch } from "@/lib/regrid-client";
import { geocodeAddress } from "@/lib/geocode-address";
import { fetchSoilData } from "@/lib/usda-soil";
import { getCWDStatus, getDroughtStatus, getHarvestData, getHarvestPressureLabel, isHarvestDataBacked, HARVEST_DATA_YEAR, DEER_SEASONS_2025_2026, isMissouriState, getStateDisplayName } from "@/lib/missouri-hunting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ParcelData {
  parcelId: string;
  owner: string;
  siteAddress: string;
  acreage: number;
  sqft: number;
  zoning: string;
  useDescription: string;
  coordinates: number[][][] | number[][][][] | null;
  county: string;
  state: string;
  legalDescription: string | null;
}

async function fetchRegridParcelData(lat: number, lng: number, address?: string): Promise<ParcelData | null> {
  // If address provided, geocode to lat/lng for better cache hit rates
  let effectiveLat = lat;
  let effectiveLng = lng;
  if (address && (!lat || !lng || (lat === 0 && lng === 0))) {
    const geo = await geocodeAddress(address);
    if (geo) {
      effectiveLat = geo.lat;
      effectiveLng = geo.lng;
      console.log(`[HUNTING-INTEL] Geocoded "${address}" → ${effectiveLat}, ${effectiveLng}`);
    }
  }

  const cached = await getCachedParcel(effectiveLat, effectiveLng);
  if (cached) {
    return {
      parcelId: cached.parcelId,
      owner: cached.owner,
      siteAddress: cached.siteAddress,
      acreage: cached.acreage,
      sqft: cached.sqft,
      zoning: cached.zoning,
      useDescription: cached.useDescription,
      coordinates: cached.coordinates,
      county: cached.county,
      state: cached.state,
      legalDescription: cached.legalDescription,
    };
  }

  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) return null;

  try {
    // Prefer coordinates over raw address query for consistent caching
    let searchUrl: string;
    if (effectiveLat && effectiveLng) {
      searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${effectiveLat}&lon=${effectiveLng}&token=${apiKey}`;
    } else if (address) {
      searchUrl = `https://app.regrid.com/api/v1/search.json?query=${encodeURIComponent(address)}&token=${apiKey}`;
    } else {
      searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;
    }
    const searchResponse = await regridFetch(searchUrl, 'hunting-intel', {
      headers: { Accept: "application/json" },
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

    const siteParts = [fields.address, fields.city || fields.situs_city, fields.state2 || fields.situs_state2, fields.szip || fields.situs_zip].filter(Boolean);

    const result: ParcelData = {
      parcelId: fields.parcelnumb || "XX-XXX-XXX",
      owner: "LAND OWNER",
      siteAddress: siteParts.length > 0 ? siteParts.join(", ") : parcel.properties?.headline || "Address Not Available",
      acreage: fields.ll_gisacre || fields.acres || 0,
      sqft: fields.ll_gissqft || fields.sqft || 0,
      zoning: fields.zoning || "A-1 Agricultural",
      useDescription: fields.usedesc || "Agricultural - Vacant Land",
      coordinates,
      county: fields.county || "Unknown",
      state: fields.state2 || "MO",
      legalDescription: fields.legaldesc || null,
    };

    setCachedParcel(effectiveLat, effectiveLng, result as CachedParcelData).catch(console.error);
    return result;
  } catch (error) {
    console.error("Regrid fetch error:", error);
    return null;
  }
}


function buildGeoJsonOverlay(coordinates: number[][][] | number[][][][] | null): string {
  if (!coordinates || coordinates.length === 0 || !coordinates[0]) return "";
  const ring = coordinates[0];
  if (ring.length < 3) return "";
  const maxPoints = 50;
  const step = ring.length > maxPoints ? Math.ceil(ring.length / maxPoints) : 1;
  const simplified = ring.filter((_: any, i: number) => i % step === 0 || i === ring.length - 1);
  const geojson = {
    type: "Feature",
    properties: { stroke: "#22C55E", "stroke-width": 3, "stroke-opacity": 1, fill: "#22C55E", "fill-opacity": 0.2 },
    geometry: { type: "Polygon", coordinates: [simplified] }
  };
  return encodeURIComponent(JSON.stringify(geojson));
}

async function fetchMapboxStaticImage(
  lat: number, lng: number, mapType: string = "satellite", zoom: number = 15,
  parcelCoordinates: number[][][] | number[][][][] | null = null
): Promise<string | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    console.error("Mapbox token not configured");
    return null;
  }

  try {
    const styleMap: Record<string, string> = {
      satellite: "satellite-v9",
      terrain: "outdoors-v12",
      hybrid: "satellite-streets-v12",
      roadmap: "streets-v12",
    };
    const style = styleMap[mapType] || "satellite-streets-v12";
    const overlay = buildGeoJsonOverlay(parcelCoordinates);
    const baseUrl = 'https://api.mapbox.com/styles/v1/mapbox/' + style + '/static';
    const location = `${lng},${lat},${zoom},0`;
    const size = "640x400@2x";
    const mapUrl = overlay
      ? `${baseUrl}/geojson(${overlay})/${location}/${size}?access_token=${token}`
      : `${baseUrl}/${location}/${size}?access_token=${token}`;

    const response = await fetch(mapUrl, { signal: AbortSignal.timeout(15000) });
    if (response.ok && response.headers.get('content-type')?.includes('image')) {
      const buffer = await response.arrayBuffer();
      return `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
    } else {
      console.error("Map fetch failed:", response.status, response.statusText);
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
  } catch {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const logoPath = path.join(process.cwd(), "public", "logo-tfp.png");
      const buffer = await fs.readFile(logoPath);
      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch { /* ignore */ }
  }
  return null;
}

function generateReportNumber(): string {
  const date = new Date();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TFP-HI-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${random}`;
}

const formatDate = (date: Date) => date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

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

function drawPageHeader(doc: jsPDF, pageWidth: number, title: string, logoImage: string | null) {
  doc.setFillColor(34, 83, 60);
  doc.rect(18, 18, pageWidth - 36, 18, "F");
  if (logoImage) { try { doc.addImage(logoImage, "JPEG", 20, 19, 16, 16); } catch (e) { /* ignore */ } }
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

function drawDeerSilhouette(doc: jsPDF, x: number, y: number, size: number, color: [number, number, number]) {
  doc.setFillColor(...color);
  doc.setDrawColor(...color);
  doc.ellipse(x, y, size * 0.35, size * 0.45, "F");
  doc.triangle(x - size * 0.3, y - size * 0.3, x - size * 0.15, y - size * 0.5, x - size * 0.05, y - size * 0.25, "F");
  doc.triangle(x + size * 0.3, y - size * 0.3, x + size * 0.15, y - size * 0.5, x + size * 0.05, y - size * 0.25, "F");
  doc.setLineWidth(size * 0.06);
  doc.line(x - size * 0.2, y - size * 0.4, x - size * 0.4, y - size * 0.8);
  doc.line(x - size * 0.35, y - size * 0.65, x - size * 0.55, y - size * 0.7);
  doc.line(x - size * 0.3, y - size * 0.55, x - size * 0.45, y - size * 0.5);
  doc.line(x + size * 0.2, y - size * 0.4, x + size * 0.4, y - size * 0.8);
  doc.line(x + size * 0.35, y - size * 0.65, x + size * 0.55, y - size * 0.7);
  doc.line(x + size * 0.3, y - size * 0.55, x + size * 0.45, y - size * 0.5);
  doc.ellipse(x, y + size * 0.5, size * 0.25, size * 0.2, "F");
}

// ═══════════════════════════════════════════════════════
// CORRIDOR DATA — Mirrors the 3D viewer exactly
// ═══════════════════════════════════════════════════════
const CORRIDOR_INFO = {
  primary: {
    name: "Primary Travel Corridors",
    color: [239, 68, 68] as [number, number, number],
    hex: "#ef4444",
    icon: "🔴",
    desc: "Main movement paths along ridgelines",
    method: "We trace the highest ridgelines connecting timber to food sources. Deer prefer ridge tops because they can see, smell, and hear danger from above. Elevation data shows us where those ridges run on your property.",
    tip: "Best for morning hunts. Deer travel ridges from feed to bedding at first light.",
  },
  secondary: {
    name: "Secondary Routes",
    color: [249, 115, 22] as [number, number, number],
    hex: "#f97316",
    icon: "🟠",
    desc: "Edge transitions & saddle crossings",
    method: "Where timber meets open field, deer travel the edge — it's cover and food in one step. We map every timber/field boundary and find the low saddle points between ridges where deer cross with minimal exposure.",
    tip: "Evening hunts excel here. Deer move from bedding to feed along edges at dusk.",
  },
  water: {
    name: "Water Sources",
    color: [59, 130, 246] as [number, number, number],
    hex: "#3b82f6",
    icon: "🔵",
    desc: "Creeks, ponds & drainage",
    method: "Elevation data reveals every drainage, creek bottom, and low spot that holds water. Deer visit water 1–3 times daily, especially in early season. If there's a crease in the terrain, water collects there.",
    tip: "Trail cams within 30 yards of water = guaranteed photos in September.",
  },
  bedding: {
    name: "Bedding Areas",
    color: [34, 197, 94] as [number, number, number],
    hex: "#22c55e",
    icon: "🟢",
    desc: "Likely bedding zones",
    method: "Deer bed on south-facing slopes (warmth) with thick cover and escape routes downhill. We find slopes facing 135°–225° with nearby timber and at least two exit paths. The steeper the better — they watch their backtrail from above.",
    tip: "Never walk through bedding. Hunt the edges, 100+ yards downwind.",
  },
  funnel: {
    name: "Terrain Funnels",
    color: [168, 85, 247] as [number, number, number],
    hex: "#a855f7",
    icon: "🟣",
    desc: "Pinch points & bottlenecks",
    method: "Where a creek, ridge, or fence forces deer through a narrow gap — that's a funnel. We measure the distance between terrain obstacles and flag any gap under 80 yards. These are the spots mature bucks can't avoid.",
    tip: "All-day sits during the rut. Bucks cruise funnels looking for does.",
  },
  food_plot: {
    name: "Food Plot Zones",
    color: [234, 179, 8] as [number, number, number],
    hex: "#eab308",
    icon: "🌱",
    desc: "Ideal food plot locations",
    method: "We look for small openings (¼–½ acre) in timber that are screened by terrain on 2+ sides, have decent soil drainage, and sit between bedding and travel corridors. If deer can reach it without crossing open ground, it's a kill plot.",
    tip: "Plant half in clover (spring/summer draw) and half in brassicas (fall/winter hold).",
  },
  stand: {
    name: "Optimal Stand Sites",
    color: [236, 72, 153] as [number, number, number],
    hex: "#ec4899",
    icon: "🎯",
    desc: "Best stand placements",
    method: "Stand sites sit downwind of travel corridors at funnel points, with entry/exit routes that don't spook bedded deer. We factor prevailing wind (SW in Missouri), morning vs. evening thermals, and line-of-sight to shooting lanes.",
    tip: "Hang stands in February. Deer forget about the disturbance by October.",
  },
};

type CorridorKey = keyof typeof CORRIDOR_INFO;

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
    const totalPages = 5;

    const regridData = await fetchRegridParcelData(order.parcelLat, order.parcelLng, order.parcelAddress);
    const parcelData = regridData || {
      parcelId: "XX-XXX-XXX", owner: "LAND OWNER", siteAddress: order.parcelAddress,
      acreage: 80, sqft: 3484800, zoning: "A-1 Agricultural", useDescription: "Agricultural",
      coordinates: null, county: "Unknown", state: "MO", legalDescription: null,
    };

    const logoImage = await loadLogoImage();
    const soilData = await fetchSoilData(order.parcelLat, order.parcelLng);
    const cwdStatus = getCWDStatus(parcelData.county);
    const harvestData = getHarvestData(parcelData.county);
    const harvestBacked = isHarvestDataBacked(parcelData.county);
    const isMO = isMissouriState(parcelData.state);
    const stateName = getStateDisplayName(parcelData.state);

    const acreage = parcelData.acreage || 80;
    let optimalZoom = 15;
    if (acreage > 200) optimalZoom = 13;
    else if (acreage > 80) optimalZoom = 14;
    else if (acreage > 20) optimalZoom = 15;
    else optimalZoom = 16;

    const aerialMap = await fetchMapboxStaticImage(order.parcelLat, order.parcelLng, "satellite", optimalZoom, parcelData.coordinates);
    const terrainMap = await fetchMapboxStaticImage(order.parcelLat, order.parcelLng, "terrain", optimalZoom, parcelData.coordinates);

    // ════════════════════════════════════════════════════
    // PAGE 1: COVER — HUNTING INTELLIGENCE REPORT
    // ════════════════════════════════════════════════════
    drawCertificateBorder(doc, pageWidth, pageHeight);

    // Header bar
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 32, "F");
    if (logoImage) { try { doc.addImage(logoImage, "JPEG", 22, 20, 28, 28); } catch (e) { /* ignore */ } }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("TERRA FIRMA PARTNERS", pageWidth / 2 + 8, 30, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Land Intelligence for Missouri Outdoorsmen", pageWidth / 2 + 8, 38, { align: "center" });

    // Gold divider
    doc.setFillColor(184, 134, 11);
    doc.rect(18, 50, pageWidth - 36, 2, "F");

    // Title
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.text("HUNTING INTELLIGENCE", pageWidth / 2, 68, { align: "center" });
    doc.text("REPORT", pageWidth / 2, 80, { align: "center" });

    // Deer silhouette
    drawDeerSilhouette(doc, pageWidth / 2, 95, 12, [34, 83, 60]);

    // Subtitle
    doc.setTextColor(184, 134, 11);
    doc.setFontSize(11);
    doc.setFont("helvetica", "italic");
    doc.text("7 Layers of Terrain Brain Intelligence", pageWidth / 2, 115, { align: "center" });

    // Aerial map
    const heroMapHeight = 65;
    const mapY = 122;
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(2);
    doc.rect(30, mapY, pageWidth - 60, heroMapHeight);
    if (aerialMap) {
      try { doc.addImage(aerialMap, "PNG", 32, mapY + 2, pageWidth - 64, heroMapHeight - 4); } catch (e) { /* ignore */ }
    }

    // Property info box
    let infoY = mapY + heroMapHeight + 6;
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(30, infoY, pageWidth - 60, 26, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("SUBJECT PROPERTY", pageWidth / 2, infoY + 8, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(order.parcelAddress, pageWidth / 2, infoY + 15, { align: "center" });
    doc.text(`${parcelData.acreage.toFixed(1)} Acres | ${parcelData.county} County, ${parcelData.state}`, pageWidth / 2, infoY + 21, { align: "center" });

    infoY += 32;
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(8);
    doc.text(`Report ID: ${reportNumber}  |  Generated: ${formatDate(new Date())}`, pageWidth / 2, infoY, { align: "center" });

    // CWD alert if in zone (Missouri-only)
    if (isMO && cwdStatus.inZone) {
      infoY += 8;
      doc.setFillColor(254, 243, 199);
      doc.roundedRect(30, infoY, pageWidth - 60, 10, 2, 2, "F");
      doc.setTextColor(180, 83, 9);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(`\u26A0 CWD MANAGEMENT ZONE — ${parcelData.county} County is in a CWD management area. Mandatory testing may apply.`, pageWidth / 2, infoY + 6, { align: "center" });
    }

    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 1, totalPages);

    // ════════════════════════════════════════════════════
    // PAGE 2: 7 LAYERS OF TERRAIN BRAIN — OVERVIEW
    // ════════════════════════════════════════════════════
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawPageHeader(doc, pageWidth, "7 LAYERS OF TERRAIN BRAIN", logoImage);

    let yPos = 42;

    // Intro blurb
    doc.setFillColor(255, 251, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 18, 2, 2, "F");
    doc.setDrawColor(184, 134, 11);
    doc.setLineWidth(0.3);
    doc.roundedRect(20, yPos, pageWidth - 40, 18, 2, 2, "S");
    doc.setTextColor(120, 90, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Every layer is terrain-derived.", 25, yPos + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 70, 50);
    doc.text("We analyze LiDAR elevation data, slope aspect, drainage patterns, and land cover to predict where deer eat, sleep, drink, and travel.", 25, yPos + 13);
    yPos += 24;

    // Draw each corridor as a card
    const corridorKeys: CorridorKey[] = ["primary", "secondary", "water", "bedding", "funnel", "food_plot", "stand"];

    corridorKeys.forEach((key) => {
      const info = CORRIDOR_INFO[key];
      const cardHeight = 22;

      // Color bar on left
      doc.setFillColor(info.color[0], info.color[1], info.color[2]);
      doc.roundedRect(20, yPos, 4, cardHeight, 1, 1, "F");

      // Card background
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(25, yPos, pageWidth - 46, cardHeight, 2, 2, "F");
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.roundedRect(25, yPos, pageWidth - 46, cardHeight, 2, 2, "S");

      // Title
      doc.setTextColor(info.color[0], info.color[1], info.color[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`${info.icon}  ${info.name}`, 29, yPos + 7);

      // Description
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(info.desc, 29, yPos + 13);

      // Pro tip on the right
      doc.setTextColor(120, 100, 60);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.5);
      const tipText = doc.splitTextToSize(`Pro Tip: ${info.tip}`, 68);
      doc.text(tipText, pageWidth - 24 - 68, yPos + 7);

      yPos += cardHeight + 2;
    });

    yPos += 4;

    // Terrain map
    if (terrainMap) {
      const tmH = 42;
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(20, yPos, pageWidth - 40, 7, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("TERRAIN VIEW — YOUR PROPERTY", pageWidth / 2, yPos + 5, { align: "center" });
      try { doc.addImage(terrainMap, "PNG", 20, yPos + 8, pageWidth - 40, tmH); } catch (e) { /* ignore */ }
    }

    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 2, totalPages);

    // ════════════════════════════════════════════════════
    // PAGE 3: HOW WE KNOW — METHODOLOGY
    // ════════════════════════════════════════════════════
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawPageHeader(doc, pageWidth, "HOW WE KNOW — THE METHOD BEHIND EACH LAYER", logoImage);

    yPos = 42;

    // Intro
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 14, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const introLines = doc.splitTextToSize("No guesswork. No buddy's opinion. Every prediction below is derived from terrain analysis — elevation data, slope calculations, drainage patterns, and land cover classification. Here's exactly how we determine each layer.", pageWidth - 50);
    doc.text(introLines, 25, yPos + 6);
    yPos += 20;

    // Each methodology section
    corridorKeys.forEach((key) => {
      const info = CORRIDOR_INFO[key];
      const methodLines = doc.splitTextToSize(info.method, pageWidth - 60);
      const cardH = 10 + methodLines.length * 4;

      // Color dot
      doc.setFillColor(info.color[0], info.color[1], info.color[2]);
      doc.circle(25, yPos + 5, 2.5, "F");

      // Title
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(info.name, 31, yPos + 6);

      // Method text
      doc.setTextColor(70, 70, 70);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(methodLines, 31, yPos + 12);

      // Divider
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.2);
      doc.line(20, yPos + cardH + 2, pageWidth - 20, yPos + cardH + 2);

      yPos += cardH + 5;
    });

    // Disclaimer
    if (yPos < pageHeight - 50) {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(20, yPos, pageWidth - 40, 16, 2, 2, "F");
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      const discLines = doc.splitTextToSize("AI predictions based on terrain analysis. Always ground-truth with boots on the property. Trail cameras recommended to verify patterns during season. Deer behavior varies by season, weather, and hunting pressure.", pageWidth - 50);
      doc.text(discLines, 25, yPos + 6);
    }

    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 3, totalPages);

    // ════════════════════════════════════════════════════
    // PAGE 4: SEASON PLAYBOOK & PROPERTY STRATEGY
    // ════════════════════════════════════════════════════
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawPageHeader(doc, pageWidth, "SEASON PLAYBOOK — YOUR PROPERTY STRATEGY", logoImage);

    yPos = 42;

    // Property quick stats
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("PROPERTY AT A GLANCE", 25, yPos + 6);
    yPos += 12;

    // Stats grid
    const statsW = (pageWidth - 50) / 3;
    const stats = [
      { label: "Total Acres", value: `${parcelData.acreage.toFixed(1)}` },
      { label: "County", value: parcelData.county },
      { label: "CWD Zone", value: isMO ? (cwdStatus.inZone ? "YES — Mandatory Testing" : "No") : "See state resources" },
    ];
    stats.forEach((s, i) => {
      const sx = 20 + i * (statsW + 5);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(sx, yPos, statsW, 18, 2, 2, "F");
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(s.label, sx + statsW / 2, yPos + 6, { align: "center" });
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(s.value, sx + statsW / 2, yPos + 14, { align: "center" });
    });
    yPos += 24;

    // Season strategy sections
    const seasons = [
      {
        title: "EARLY SEASON (Sept – Oct)",
        color: [234, 179, 8] as [number, number, number],
        strategies: [
          "Hunt water sources — deer visit 1-3x daily in warm weather",
          "Focus on food plot zones in evenings — pattern is predictable",
          "Use secondary routes (timber edges) for entry/exit",
          "Hang trail cameras on primary corridors to inventory bucks",
          "Prevailing wind: SW — set stands on NE side of corridors",
        ],
      },
      {
        title: "RUT PHASE (Late Oct – Nov)",
        color: [239, 68, 68] as [number, number, number],
        strategies: [
          "All-day sits at terrain funnels — bucks cruise pinch points",
          "Hunt primary travel corridors connecting bedding areas",
          "Morning: set up between bedding and food on ridgelines",
          "Evening: timber edges where does feed and bucks follow",
          "Be aggressive — mature bucks move unpredictably during peak rut",
        ],
      },
      {
        title: "LATE SEASON (Dec – Jan)",
        color: [59, 130, 246] as [number, number, number],
        strategies: [
          "Pattern resets — deer focus on remaining food sources",
          "Food plot zones become critical gathering points",
          "Hunt bedding area edges during afternoon thermal shifts",
          "S-facing slopes (bedding) = warmest spots on cold days",
          "Deer are pressured — quiet entry using creek drainages",
        ],
      },
    ];

    seasons.forEach((season) => {
      doc.setFillColor(season.color[0], season.color[1], season.color[2]);
      doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(season.title, 25, yPos + 5.5);
      yPos += 11;

      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      season.strategies.forEach((s) => {
        doc.setTextColor(60, 60, 60);
        doc.text(`•  ${s}`, 25, yPos);
        yPos += 5.5;
      });
      yPos += 4;
    });

    // Harvest data box (Missouri-only)
    if (isMO) {
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`${parcelData.county.toUpperCase()} COUNTY HARVEST DATA`, 25, yPos + 5.5);
      yPos += 11;

      // Data-confidence badge
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      if (harvestBacked) {
        doc.setTextColor(22, 163, 74);
        doc.text(`Data-backed - MDC ${HARVEST_DATA_YEAR}`, 25, yPos);
      } else {
        doc.setTextColor(217, 119, 6);
        doc.text("Estimated - limited county data", 25, yPos);
      }
      yPos += 6;

      if (harvestBacked) {
        const harvestItems = [
          `Total Deer Harvested: ${harvestData!.totalDeer.toLocaleString()}`,
          `Antlered: ${harvestData!.antlered.toLocaleString()}`,
          `Antlerless: ${harvestData!.antlerless.toLocaleString()}`,
          `Harvest Pressure: ${getHarvestPressureLabel(harvestData!.harvestDensity)}`,
        ];
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        harvestItems.forEach((item) => {
          doc.text(`\u2022  ${item}`, 25, yPos);
          yPos += 5.5;
        });
      } else {
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text("MDC has not published a county-specific harvest record for this", 25, yPos);
        yPos += 5.5;
        doc.text("county. Regional estimates apply - treat as directional only.", 25, yPos);
        yPos += 5.5;
      }
    } else {
      // Non-Missouri: neutral placeholder
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.4);
      doc.roundedRect(20, yPos, pageWidth - 40, 34, 3, 3, "FD");
      drawDeerSilhouette(doc, 34, yPos + 15, 7, [148, 163, 184]);
      doc.setTextColor(71, 85, 105);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("State-specific hunting data coming soon", 48, yPos + 12);
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(`Harvest, CWD, and season data for ${stateName} is in development.`, 48, yPos + 19);
      doc.text("We only show verified state data - wrong data is worse than", 48, yPos + 24.5);
      doc.text("no data. Consult your state wildlife agency in the meantime.", 48, yPos + 30);
      yPos += 40;
    }

    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 4, totalPages);

    // ════════════════════════════════════════════════════
    // PAGE 5: WHAT'S NEXT — UPSELL + NOTES
    // ════════════════════════════════════════════════════
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawPageHeader(doc, pageWidth, "NEXT STEPS & FIELD NOTES", logoImage);

    yPos = 42;

    // Season dates (Missouri-only)
    if (isMO) {
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("MISSOURI DEER SEASON DATES 2025-2026", 25, yPos + 5.5);
      yPos += 12;

      doc.setFontSize(7.5);
      DEER_SEASONS_2025_2026.forEach((s) => {
        doc.setTextColor(34, 83, 60);
        doc.setFont("helvetica", "bold");
        doc.text(s.season, 25, yPos);
        doc.setTextColor(80, 80, 80);
        doc.setFont("helvetica", "normal");
        doc.text(s.dates, 90, yPos);
        yPos += 5.5;
      });
      yPos += 6;
    } else {
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`${stateName.toUpperCase()} SEASON DATES`, 25, yPos + 5.5);
      yPos += 12;

      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Season dates for ${stateName} are coming soon. Consult your state`, 25, yPos);
      yPos += 5.5;
      doc.text("wildlife agency for current regulations and season calendars.", 25, yPos);
      yPos += 8;
    }

    // Field Notes section — blank area for the hunter
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("FIELD NOTES — YOUR OBSERVATIONS", 25, yPos + 5.5);
    yPos += 12;

    doc.setTextColor(180, 180, 180);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.text("Use this space to record trail camera findings, sightings, and ground-truth observations:", 25, yPos);
    yPos += 6;

    // Lined note area
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    for (let i = 0; i < 8; i++) {
      doc.line(25, yPos + i * 7, pageWidth - 25, yPos + i * 7);
    }
    yPos += 62;

    // Upsell box
    doc.setFillColor(255, 251, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 42, 3, 3, "F");
    doc.setDrawColor(184, 134, 11);
    doc.setLineWidth(0.8);
    doc.roundedRect(20, yPos, pageWidth - 40, 42, 3, 3, "S");

    drawDeerSilhouette(doc, 32, yPos + 14, 8, [184, 134, 11]);

    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Ready for the Full Picture?", 45, yPos + 10);

    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const upsellLines = [
      "Our $350 Full Land Analysis Report includes everything in this Hunting Intel report, plus:",
      "• Complete USDA soil analysis with drainage, farmland classification, & crop yields",
      "• FEMA flood zone verification & water rights assessment",
      "• Property tax snapshot & assessed value breakdown",
      "• County resources, contacts, conservation programs & area info",
      "• Perfect for buying, selling, or financing rural land in Missouri",
    ];
    upsellLines.forEach((line, i) => {
      doc.text(line, 25, yPos + 18 + i * 4.5);
    });

    doc.setTextColor(184, 134, 11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Visit terrafirmapartners.abacusai.app/map to order", pageWidth / 2, yPos + 38, { align: "center" });

    drawPageFooter(doc, pageWidth, pageHeight, reportNumber, 5, totalPages);

    // ════════════════════════════════════════════════════
    // OUTPUT
    // ════════════════════════════════════════════════════
    const pdfBase64 = doc.output("datauristring").split(",")[1];

    await prisma.order.update({
      where: { id: orderId },
      data: { status: "completed" },
    });

    const safeAddress = order.parcelAddress
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 50);
    const filename = `TFP-HuntingIntel-${safeAddress}.pdf`;

    return NextResponse.json({ pdf: pdfBase64, filename });
  } catch (error) {
    console.error("Hunting Intel PDF error:", error);
    return NextResponse.json({ error: "Failed to generate Hunting Intelligence Report" }, { status: 500 });
  }
}