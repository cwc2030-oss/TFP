import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Sample location - will fetch real parcel data from Regrid
const SAMPLE_ORDER = {
  parcelAddress: "Sample Road, Leeton, Johnson County, MO 64761, USA",
  parcelLat: 38.6447214,
  parcelLng: -93.6672555,
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

// Fetch REAL parcel data from Regrid API
async function fetchRegridParcelData(lat: number, lng: number): Promise<ParcelData | null> {
  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) {
    console.error("Regrid API key not configured");
    return null;
  }

  try {
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
    
    // Extract parcel boundary coordinates
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

    return {
      parcelId: fields.parcelnumb || fields.parcelnumb_no_formatting || "XX-XXX-XXX",
      owner: "LAND OWNER", // Redacted for sample
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
  } catch (error) {
    console.error("Regrid fetch error:", error);
    return null;
  }
}

// Fallback sample data if Regrid fails
function getDefaultSampleData(): ParcelData {
  return {
    parcelId: "XX-XXX-XXX-XX-XXX-XXX.XX",
    owner: "LAND OWNER",
    mailingAddress: "[Mailing Address Redacted]",
    siteAddress: "Sample Road, Leeton, MO 64761",
    acreage: 101.48,
    sqft: 4420725,
    zoning: "A-1 Agricultural",
    useDescription: "Agricultural - Vacant Land",
    coordinates: null,
    marketValue: 348500,
    landValue: 348500,
    improvementValue: 0,
    taxYear: "2024",
    saleDate: "2020-03-15",
    salePrice: 425000,
    county: "Johnson",
    state: "Missouri",
    legalDescription: "THE NW 1/4 OF SECTION 34, TOWNSHIP 45N, RANGE 26W, JOHNSON COUNTY, MISSOURI",
    plssTownship: "T45N",
    plssRange: "R26W",
    plssSection: "S34",
  };
}

// Fun facts generator based on property data
function generateFunFacts(acres: number, county: string, state: string) {
  const footballFields = Math.round(acres / 1.32);
  const walkingMiles = (acres * 0.015).toFixed(1);
  
  const facts = [
    `This ${acres.toFixed(1)}-acre property is equivalent to approximately ${footballFields} football fields!`,
    `Walking the perimeter of this property would cover roughly ${walkingMiles} miles.`,
  ];
  
  if (state === "Missouri") {
    facts.push("Missouri is known as the 'Show-Me State' and has over 30 million acres of farmland.");
    facts.push("The Missouri River watershed covers this region, providing excellent water access potential.");
    if (acres > 50) {
      facts.push(`A ${acres.toFixed(0)}-acre timber tract in Missouri could contain $15,000-$25,000 worth of black walnut trees alone.`);
    }
  }
  
  if (acres > 100) {
    facts.push("Properties over 100 acres qualify for enhanced agricultural tax exemptions in most states.");
  }
  
  if (acres > 40) {
    facts.push("This property size is ideal for wildlife habitat management and hunting leases.");
  }
  
  return facts;
}

const formatDate = (date: Date) => {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

function generateReportNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TFP-${year}${month}${day}-${random}`;
}

// Load logo from CDN
async function loadLogoImage(): Promise<string | null> {
  try {
    const logoUrl = "https://cdn.abacus.ai/images/a218da49-35b3-4581-83cf-641e0b734762.png";
    const response = await fetch(logoUrl, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      return `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
    }
  } catch (error) {
    console.error("Failed to load logo:", error);
  }
  return null;
}

// Build parcel boundary path for Google Maps Static API
function buildParcelPath(coordinates: number[][][] | null): string {
  if (!coordinates || coordinates.length === 0 || !coordinates[0]) {
    return "";
  }
  
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

// Fetch Google Maps Static API image
async function fetchGoogleMapImage(
  lat: number, 
  lng: number, 
  mapType: string = "satellite", 
  zoom: number = 15,
  parcelCoordinates: number[][][] | null = null
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("Google Maps API key not configured");
    return null;
  }

  try {
    const width = 640;
    const height = 400;
    const parcelPath = buildParcelPath(parcelCoordinates);
    
    const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&maptype=${mapType}${parcelPath}&key=${apiKey}`;

    const response = await fetch(mapUrl, { signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('image')) {
        const buffer = await response.arrayBuffer();
        return `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
      }
    }
  } catch (error) {
    console.error("Failed to fetch map image:", error);
  }
  return null;
}

// Fetch USDA Hardiness Zone map image
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

// Draw certificate border
function drawCertificateBorder(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setDrawColor(34, 83, 60);
  doc.setLineWidth(3);
  doc.rect(8, 8, pageWidth - 16, pageHeight - 16);
  doc.setLineWidth(0.5);
  doc.rect(12, 12, pageWidth - 24, pageHeight - 24);
  
  // Corner accents
  doc.setLineWidth(2);
  doc.setDrawColor(184, 134, 11);
  const cornerSize = 12;
  doc.line(15, 15 + cornerSize, 15, 15);
  doc.line(15, 15, 15 + cornerSize, 15);
  doc.line(pageWidth - 15 - cornerSize, 15, pageWidth - 15, 15);
  doc.line(pageWidth - 15, 15, pageWidth - 15, 15 + cornerSize);
  doc.line(15, pageHeight - 15 - cornerSize, 15, pageHeight - 15);
  doc.line(15, pageHeight - 15, 15 + cornerSize, pageHeight - 15);
  doc.line(pageWidth - 15 - cornerSize, pageHeight - 15, pageWidth - 15, pageHeight - 15);
  doc.line(pageWidth - 15, pageHeight - 15 - cornerSize, pageWidth - 15, pageHeight - 15);
}

// Draw SAMPLE watermark
function drawSampleWatermark(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setTextColor(200, 200, 200);
  doc.setFontSize(60);
  doc.setFont("helvetica", "bold");
  doc.text("SAMPLE", pageWidth / 2, pageHeight / 2, { 
    align: "center", 
    angle: 45 
  });
  doc.setTextColor(0, 0, 0);
}

// Format size display
function formatSizeDisplay(acres: number, sqft: number): string {
  if (acres >= 1) {
    return `${acres.toFixed(2)} acres (${sqft.toLocaleString()} sq ft)`;
  } else if (sqft > 0) {
    return `${sqft.toLocaleString()} sq ft (${acres.toFixed(3)} acres)`;
  }
  return "Not Available";
}

// Draw simple fallback map
function drawSimpleMap(
  doc: jsPDF, 
  lat: number, 
  lng: number, 
  x: number, 
  y: number, 
  width: number, 
  height: number,
  parcelCoordinates: number[][][] | null = null
) {
  doc.setFillColor(235, 245, 235);
  doc.rect(x, y, width, height, "F");
  
  doc.setDrawColor(200, 215, 200);
  doc.setLineWidth(0.3);
  const gridSpacing = 15;
  for (let gx = x; gx <= x + width; gx += gridSpacing) {
    doc.line(gx, y, gx, y + height);
  }
  for (let gy = y; gy <= y + height; gy += gridSpacing) {
    doc.line(x, gy, x + width, gy);
  }

  if (parcelCoordinates && parcelCoordinates[0] && parcelCoordinates[0].length > 2) {
    const ring = parcelCoordinates[0];
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const coord of ring) {
      minLng = Math.min(minLng, coord[0]);
      maxLng = Math.max(maxLng, coord[0]);
      minLat = Math.min(minLat, coord[1]);
      maxLat = Math.max(maxLat, coord[1]);
    }
    
    const lngRange = maxLng - minLng || 0.001;
    const latRange = maxLat - minLat || 0.001;
    const padding = 0.15;
    
    doc.setFillColor(34, 197, 94, 0.3);
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(1.5);
    
    const points: { x: number; y: number }[] = [];
    for (const coord of ring) {
      const px = x + padding * width + ((coord[0] - minLng) / lngRange) * width * (1 - 2 * padding);
      const py = y + padding * height + ((maxLat - coord[1]) / latRange) * height * (1 - 2 * padding);
      points.push({ x: px, y: py });
    }
    
    if (points.length > 2) {
      doc.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        doc.lineTo(points[i].x, points[i].y);
      }
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

export async function GET() {
  try {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const reportNumber = generateReportNumber();
    const totalPages = 13;
    const order = SAMPLE_ORDER;
    
    // Fetch REAL parcel data from Regrid (actual property boundary!)
    const regridData = await fetchRegridParcelData(order.parcelLat, order.parcelLng);
    const parcelData = regridData || getDefaultSampleData();
    
    console.log("Parcel coordinates fetched:", parcelData.coordinates ? `${parcelData.coordinates[0]?.length} points` : "none");
    
    const logoImage = await loadLogoImage();
    const funFacts = generateFunFacts(parcelData.acreage, parcelData.county, parcelData.state);

    // Calculate optimal zoom based on acreage
    const acreage = parcelData.acreage || 100;
    let optimalZoom = 15;
    if (acreage > 200) optimalZoom = 13;
    else if (acreage > 80) optimalZoom = 14;
    else if (acreage > 20) optimalZoom = 15;
    else optimalZoom = 16;

    // Pre-fetch maps with real Google Maps Static API and REAL parcel boundary
    const aerialMap = await fetchGoogleMapImage(order.parcelLat, order.parcelLng, "satellite", optimalZoom, parcelData.coordinates);
    const topoMap = await fetchGoogleMapImage(order.parcelLat, order.parcelLng, "terrain", optimalZoom, parcelData.coordinates);
    const hybridMap = await fetchGoogleMapImage(order.parcelLat, order.parcelLng, "hybrid", optimalZoom, parcelData.coordinates);
    const hardinessMap = await fetchHardinessZoneMap();

    // ============================================
    // PAGE 1: COVER PAGE
    // ============================================
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    // Header with logo
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 32, "F");
    
    if (logoImage) {
      try {
        doc.addImage(logoImage, "PNG", 22, 20, 28, 28);
      } catch (e) { console.error("Logo error:", e); }
    }
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("TERRA FIRMA PARTNERS", pageWidth / 2 + 8, 30, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Satellite Intelligence for Landowners", pageWidth / 2 + 8, 38, { align: "center" });
    
    // Gold accent line
    doc.setFillColor(184, 134, 11);
    doc.rect(18, 50, pageWidth - 36, 2, "F");
    
    // Report title
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text("COMPREHENSIVE LAND", pageWidth / 2, 68, { align: "center" });
    doc.text("ANALYSIS REPORT", pageWidth / 2, 80, { align: "center" });
    
    // Hero map
    const heroMapHeight = 85;
    const mapY = 90;
    
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(2);
    doc.rect(25, mapY, pageWidth - 50, heroMapHeight);
    
    if (aerialMap) {
      try {
        doc.addImage(aerialMap, "PNG", 27, mapY + 2, pageWidth - 54, heroMapHeight - 4);
      } catch (imgError) {
        drawSimpleMap(doc, order.parcelLat, order.parcelLng, 27, mapY + 2, pageWidth - 54, heroMapHeight - 4, parcelData.coordinates);
      }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, 27, mapY + 2, pageWidth - 54, heroMapHeight - 4, parcelData.coordinates);
    }
    
    // Property info block
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
    
    // Report details
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    doc.text(`Report ID: ${reportNumber}`, pageWidth / 2, infoY, { align: "center" });
    doc.text(`Generated: ${formatDate(new Date())}`, pageWidth / 2, infoY + 6, { align: "center" });
    
    // Footer
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text("Satellite Intelligence for Landowners", pageWidth / 2, pageHeight - 20, { align: "center" });
    doc.text(`Page 1 of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // ============================================
    // PAGE 2: PROPERTY AT-A-GLANCE
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    // Header
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 18, "F");
    
    if (logoImage) {
      try { doc.addImage(logoImage, "PNG", 20, 19, 16, 16); } catch (e) {}
    }
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PROPERTY AT-A-GLANCE", pageWidth / 2, 30, { align: "center" });
    
    let yPos = 45;
    
    // Property snapshot box
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 55, 3, 3, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(0.5);
    doc.roundedRect(20, yPos, pageWidth - 40, 55, 3, 3, "S");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Property Snapshot", 25, yPos + 8);
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    
    const col1X = 25;
    const col2X = 115;
    let snapY = yPos + 18;
    
    doc.setFont("helvetica", "bold");
    doc.text("Address:", col1X, snapY);
    doc.setFont("helvetica", "normal");
    doc.text(parcelData.siteAddress, col1X + 22, snapY);
    
    snapY += 8;
    doc.setFont("helvetica", "bold");
    doc.text("Owner:", col1X, snapY);
    doc.setFont("helvetica", "normal");
    doc.text(parcelData.owner, col1X + 22, snapY);
    
    doc.setFont("helvetica", "bold");
    doc.text("Parcel ID:", col2X, snapY);
    doc.setFont("helvetica", "normal");
    doc.text(parcelData.parcelId, col2X + 22, snapY);
    
    snapY += 8;
    doc.setFont("helvetica", "bold");
    doc.text("Size:", col1X, snapY);
    doc.setFont("helvetica", "normal");
    doc.text(formatSizeDisplay(parcelData.acreage, parcelData.sqft), col1X + 22, snapY);
    
    doc.setFont("helvetica", "bold");
    doc.text("Zoning:", col2X, snapY);
    doc.setFont("helvetica", "normal");
    doc.text(parcelData.zoning || "N/A", col2X + 22, snapY);
    
    snapY += 8;
    doc.setFont("helvetica", "bold");
    doc.text("Use:", col1X, snapY);
    doc.setFont("helvetica", "normal");
    doc.text(parcelData.useDescription || "Agricultural - Vacant Land", col1X + 22, snapY);
    
    yPos += 65;
    
    // Valuation section
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("OWNERSHIP & VALUATION", 25, yPos + 6);
    
    yPos += 14;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    
    const valuationData = [
      ["Market Value:", parcelData.marketValue ? `$${parcelData.marketValue.toLocaleString()}` : "Not Available"],
      ["Land Value:", parcelData.landValue ? `$${parcelData.landValue.toLocaleString()}` : "Not Available"],
      ["Improvement Value:", parcelData.improvementValue ? `$${parcelData.improvementValue.toLocaleString()}` : "$0 (Vacant Land)"],
      ["Tax Year:", parcelData.taxYear || "N/A"],
      ["Last Sale Date:", parcelData.saleDate || "Not Available"],
      ["Last Sale Price:", parcelData.salePrice ? `$${parcelData.salePrice.toLocaleString()}` : "Not Available"],
    ];
    
    valuationData.forEach(([label, value], idx) => {
      const xOffset = idx % 2 === 0 ? col1X : col2X;
      const yOffset = yPos + Math.floor(idx / 2) * 10;
      doc.setFont("helvetica", "bold");
      doc.text(label, xOffset, yOffset);
      doc.setFont("helvetica", "normal");
      doc.text(value, xOffset + 38, yOffset);
    });
    
    yPos += 40;
    
    // Legal description section
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LEGAL DESCRIPTION", 25, yPos + 6);
    
    yPos += 14;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    
    const legalDesc = parcelData.legalDescription || "Legal description not available";
    const legalLines = doc.splitTextToSize(legalDesc, pageWidth - 50);
    doc.text(legalLines, 25, yPos);
    
    yPos += legalLines.length * 5 + 10;
    
    // PLSS Info
    if (parcelData.plssTownship || parcelData.plssRange || parcelData.plssSection) {
      doc.setFont("helvetica", "bold");
      doc.text("PLSS Location:", 25, yPos);
      doc.setFont("helvetica", "normal");
      doc.text(`${parcelData.plssTownship || ""} ${parcelData.plssRange || ""} ${parcelData.plssSection || ""}`.trim(), 55, yPos);
    }
    
    // Footer
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
    doc.text(`Page 2 of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // ============================================
    // PAGE 3: AERIAL VIEW
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 18, "F");
    if (logoImage) { try { doc.addImage(logoImage, "PNG", 20, 19, 16, 16); } catch (e) {} }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("AERIAL VIEW", pageWidth / 2, 30, { align: "center" });
    
    // Large aerial map
    const aerialMapY = 42;
    const aerialMapHeight = 120;
    
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(1);
    doc.rect(20, aerialMapY, pageWidth - 40, aerialMapHeight);
    
    if (aerialMap) {
      try {
        doc.addImage(aerialMap, "PNG", 22, aerialMapY + 2, pageWidth - 44, aerialMapHeight - 4);
      } catch (e) {
        drawSimpleMap(doc, order.parcelLat, order.parcelLng, 22, aerialMapY + 2, pageWidth - 44, aerialMapHeight - 4, parcelData.coordinates);
      }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, 22, aerialMapY + 2, pageWidth - 44, aerialMapHeight - 4, parcelData.coordinates);
    }
    
    // Map legend
    yPos = aerialMapY + aerialMapHeight + 8;
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 22, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Map Legend", 25, yPos + 7);
    
    // Green boundary indicator
    doc.setFillColor(34, 197, 94);
    doc.rect(25, yPos + 11, 12, 3, "F");
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Property Boundary", 40, yPos + 14);
    
    doc.text(`Coordinates: ${order.parcelLat.toFixed(6)}, ${order.parcelLng.toFixed(6)}`, 100, yPos + 14);
    
    // Aerial insights
    yPos += 28;
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("AERIAL INSIGHTS", 25, yPos + 6);
    
    yPos += 12;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    
    const aerialInsights = [
      `This ${parcelData.acreage.toFixed(1)}-acre parcel shows satellite imagery with surveyed boundaries`,
      "Green polygon overlay indicates official parcel boundaries from county assessor records",
      "Satellite imagery is updated regularly to reflect current land conditions",
      "Visible features: tree coverage, terrain contours, access points, and water features"
    ];
    
    aerialInsights.forEach((insight, idx) => {
      doc.text(`• ${insight}`, 25, yPos + (idx * 6));
    });
    
    // Footer
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
    doc.text(`Page 3 of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // ============================================
    // PAGE 4: PROPERTY & LAND DETAILS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 18, "F");
    if (logoImage) { try { doc.addImage(logoImage, "PNG", 20, 19, 16, 16); } catch (e) {} }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PROPERTY & LAND DETAILS", pageWidth / 2, 30, { align: "center" });
    
    yPos = 45;
    
    // Land Classification
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LAND CLASSIFICATION", 25, yPos + 6);
    
    yPos += 14;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    
    const landDetails = [
      ["Property Type:", "Vacant Land"],
      ["Primary Use:", parcelData.useDescription || "Agricultural"],
      ["Zoning Classification:", parcelData.zoning || "A-1 Agricultural"],
      ["Total Acreage:", `${parcelData.acreage.toFixed(2)} acres`],
      ["Total Square Feet:", parcelData.sqft.toLocaleString()],
      ["County:", `${parcelData.county} County, ${parcelData.state}`],
    ];
    
    landDetails.forEach(([label, value], idx) => {
      const xOffset = idx % 2 === 0 ? col1X : col2X;
      const yOffset = yPos + Math.floor(idx / 2) * 10;
      doc.setFont("helvetica", "bold");
      doc.text(label, xOffset, yOffset);
      doc.setFont("helvetica", "normal");
      doc.text(value, xOffset + 40, yOffset);
    });
    
    yPos += 45;
    
    // Vacant Land Notice
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 30, 3, 3, "F");
    doc.setDrawColor(184, 134, 11);
    doc.setLineWidth(0.5);
    doc.roundedRect(20, yPos, pageWidth - 40, 30, 3, 3, "S");
    
    doc.setTextColor(139, 90, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("VACANT LAND PROPERTY", 25, yPos + 10);
    
    doc.setTextColor(100, 80, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("This property is classified as vacant/unimproved land with no permanent structures.", 25, yPos + 18);
    doc.text("Improvement value reflects raw land status - ideal for development or agricultural use.", 25, yPos + 25);
    
    yPos += 40;
    
    // Fun Fact
    if (funFacts.length > 0) {
      doc.setFillColor(245, 250, 245);
      doc.roundedRect(20, yPos, pageWidth - 40, 25, 3, 3, "F");
      
      doc.setTextColor(184, 134, 11);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("DID YOU KNOW?", 25, yPos + 8);
      
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const factLines = doc.splitTextToSize(funFacts[0], pageWidth - 50);
      doc.text(factLines, 25, yPos + 16);
    }
    
    // Footer
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
    doc.text(`Page 4 of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // ============================================
    // PAGES 5-8: CATEGORY ANALYSIS PAGES
    // ============================================
    const categories = [
      {
        title: "TOPOGRAPHY ANALYSIS",
        pageNum: 5,
        map: topoMap,
        mapType: "terrain",
        fields: [
          ["Elevation Range:", "850-920 ft above sea level"],
          ["Terrain Type:", "Rolling to Gently Sloping"],
          ["Slope Grade:", "2-8% average grade"],
          ["Drainage Pattern:", "Natural watershed drainage"],
          ["Soil Drainage:", "Well-drained loamy soil"],
          ["Flood Risk:", "Minimal - outside flood zones"],
        ],
        summary: "This property features gentle rolling terrain typical of western Missouri agricultural land. The moderate slopes provide excellent natural drainage while remaining suitable for farming equipment operation.",
        tips: [
          "Consider contour farming practices to prevent erosion on sloped areas",
          "Natural drainage patterns are ideal for pond construction",
          "Rolling terrain provides wind protection for livestock operations"
        ],
        funFact: funFacts[1] || funFacts[0]
      },
      {
        title: "FLOOD & WATER ANALYSIS",
        pageNum: 6,
        map: hybridMap,
        mapType: "hybrid",
        fields: [
          ["FEMA Flood Zone:", "Zone X - Minimal Risk"],
          ["Flood Insurance:", "Not Required"],
          ["Nearest Water Body:", "1.2 miles to creek"],
          ["Watershed:", "Missouri River Basin"],
          ["Wetland Status:", "No designated wetlands"],
          ["Water Rights:", "Riparian rights may apply"],
        ],
        summary: "Property is located in FEMA Zone X with minimal flood risk. The Missouri River watershed provides excellent groundwater recharge. No designated wetlands restrict development options.",
        tips: [
          "Zone X designation means no federal flood insurance requirement",
          "Excellent candidate for pond or water feature installation",
          "Well drilling typically successful in this watershed region"
        ],
        funFact: funFacts[2] || funFacts[0]
      },
      {
        title: "ACCESS & UTILITIES",
        pageNum: 7,
        map: hybridMap,
        mapType: "hybrid",
        fields: [
          ["Road Frontage:", "County Road Access"],
          ["Road Surface:", "Paved county road"],
          ["Distance to Highway:", "3.5 miles to US-50"],
          ["Electric Service:", "Available at road"],
          ["Water Service:", "Well required"],
          ["Internet Options:", "Rural wireless/satellite"],
        ],
        summary: "Property has direct access via paved county road with electric service available at the property line. Rural location requires well and septic for water/sewer services.",
        tips: [
          "Contact local electric cooperative for service extension costs",
          "Well drilling permits available through county health department",
          "Starlink and fixed wireless provide rural internet options"
        ],
        funFact: funFacts[3] || funFacts[0]
      },
      {
        title: "LAND USE SUITABILITY",
        pageNum: 8,
        map: aerialMap,
        mapType: "satellite",
        fields: [
          ["Agricultural Rating:", "★★★★★ Excellent"],
          ["Hunting/Recreation:", "★★★★★ Excellent"],
          ["Residential Building:", "★★★★☆ Very Good"],
          ["Livestock Grazing:", "★★★★★ Excellent"],
          ["Timber Production:", "★★★☆☆ Good"],
          ["Commercial Use:", "★★☆☆☆ Limited by Zoning"],
        ],
        summary: "This property excels for agricultural and recreational uses. The A-1 zoning supports farming, livestock, and residential construction. Hunting lease potential is high given the acreage and rural location.",
        tips: [
          "100+ acres qualifies for agricultural tax assessment in Missouri",
          "Hunting leases in this region average $10-15 per acre annually",
          "Consider conservation easements for tax benefits"
        ],
        funFact: funFacts[4] || funFacts[0]
      }
    ];

    for (const category of categories) {
      doc.addPage();
      drawCertificateBorder(doc, pageWidth, pageHeight);
      drawSampleWatermark(doc, pageWidth, pageHeight);
      
      // Header
      doc.setFillColor(34, 83, 60);
      doc.rect(18, 18, pageWidth - 36, 18, "F");
      if (logoImage) { try { doc.addImage(logoImage, "PNG", 20, 19, 16, 16); } catch (e) {} }
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(category.title, pageWidth / 2, 30, { align: "center" });
      
      yPos = 42;
      
      // Subject Property label and aerial image
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(pageWidth - 95, yPos, 75, 8, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("SUBJECT PROPERTY", pageWidth - 57.5, yPos + 5.5, { align: "center" });
      
      // Aerial image
      const imgY = yPos + 10;
      const imgWidth = 75;
      const imgHeight = 50;
      
      doc.setDrawColor(34, 83, 60);
      doc.setLineWidth(0.5);
      doc.rect(pageWidth - 95, imgY, imgWidth, imgHeight);
      
      if (aerialMap) {
        try {
          doc.addImage(aerialMap, "PNG", pageWidth - 94, imgY + 1, imgWidth - 2, imgHeight - 2);
        } catch (e) {
          drawSimpleMap(doc, order.parcelLat, order.parcelLng, pageWidth - 94, imgY + 1, imgWidth - 2, imgHeight - 2, parcelData.coordinates);
        }
      } else {
        drawSimpleMap(doc, order.parcelLat, order.parcelLng, pageWidth - 94, imgY + 1, imgWidth - 2, imgHeight - 2, parcelData.coordinates);
      }
      
      // Data fields on left side
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(9);
      
      let fieldY = yPos + 5;
      category.fields.forEach(([label, value]) => {
        doc.setFont("helvetica", "bold");
        doc.text(label, 25, fieldY);
        doc.setFont("helvetica", "normal");
        doc.text(value, 70, fieldY);
        fieldY += 10;
      });
      
      yPos = Math.max(fieldY, imgY + imgHeight) + 10;
      
      // Summary box
      doc.setFillColor(245, 250, 245);
      doc.roundedRect(20, yPos, pageWidth - 40, 28, 3, 3, "F");
      doc.setDrawColor(34, 83, 60);
      doc.setLineWidth(0.3);
      doc.roundedRect(20, yPos, pageWidth - 40, 28, 3, 3, "S");
      
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("SUMMARY", 25, yPos + 8);
      
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const summaryLines = doc.splitTextToSize(category.summary, pageWidth - 50);
      doc.text(summaryLines, 25, yPos + 16);
      
      yPos += 35;
      
      // Fun Fact box
      doc.setFillColor(255, 250, 235);
      doc.roundedRect(20, yPos, pageWidth - 40, 22, 3, 3, "F");
      doc.setDrawColor(184, 134, 11);
      doc.setLineWidth(0.3);
      doc.roundedRect(20, yPos, pageWidth - 40, 22, 3, 3, "S");
      
      doc.setTextColor(184, 134, 11);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("DID YOU KNOW?", 25, yPos + 7);
      
      doc.setTextColor(100, 80, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const funFactLines = doc.splitTextToSize(category.funFact, pageWidth - 50);
      doc.text(funFactLines, 25, yPos + 14);
      
      yPos += 28;
      
      // Tips box
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(20, yPos, pageWidth - 40, 35, 3, 3, "F");
      
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("LANDOWNER TIPS", 25, yPos + 8);
      
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      category.tips.forEach((tip, idx) => {
        doc.text(`• ${tip}`, 25, yPos + 16 + (idx * 7));
      });
      
      // Footer
      doc.setFillColor(184, 134, 11);
      doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
      doc.text(`Page ${category.pageNum} of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });
    }

    // ============================================
    // PAGE 9: USDA HARDINESS ZONES
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 18, "F");
    if (logoImage) { try { doc.addImage(logoImage, "PNG", 20, 19, 16, 16); } catch (e) {} }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("USDA PLANT HARDINESS ZONES", pageWidth / 2, 30, { align: "center" });
    
    yPos = 45;
    
    // Property zone highlight
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 20, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Your Property Zone: 6a", pageWidth / 2, yPos + 8, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Average Annual Minimum Temperature: -10°F to -5°F", pageWidth / 2, yPos + 15, { align: "center" });
    
    yPos += 28;
    
    // Hardiness map
    if (hardinessMap) {
      try {
        doc.addImage(hardinessMap, "JPEG", 25, yPos, pageWidth - 50, 80);
      } catch (e) {
        doc.setFillColor(240, 240, 240);
        doc.rect(25, yPos, pageWidth - 50, 80, "F");
        doc.setTextColor(100, 100, 100);
        doc.text("USDA Hardiness Zone Map", pageWidth / 2, yPos + 40, { align: "center" });
      }
    } else {
      doc.setFillColor(240, 240, 240);
      doc.rect(25, yPos, pageWidth - 50, 80, "F");
      doc.setTextColor(100, 100, 100);
      doc.text("USDA Hardiness Zone Map", pageWidth / 2, yPos + 40, { align: "center" });
    }
    
    yPos += 90;
    
    // Zone 6a info
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 45, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Zone 6a Growing Recommendations", 25, yPos + 10);
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    
    const zone6Info = [
      "• Fruit Trees: Apple, Pear, Cherry, Peach (with protection), Plum",
      "• Nut Trees: Black Walnut, Pecan (northern varieties), Hickory",
      "• Vegetables: Full growing season for tomatoes, corn, beans, squash",
      "• Last Frost: Mid-April | First Frost: Mid-October",
      "• Growing Season: Approximately 180 days"
    ];
    
    zone6Info.forEach((info, idx) => {
      doc.text(info, 25, yPos + 18 + (idx * 6));
    });
    
    // Footer
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
    doc.text(`Page 9 of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // ============================================
    // PAGE 10: COMPARABLE SALES & VALUATION
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 18, "F");
    if (logoImage) { try { doc.addImage(logoImage, "PNG", 20, 19, 16, 16); } catch (e) {} }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("VALUATION & MARKET DATA", pageWidth / 2, 30, { align: "center" });
    
    yPos = 45;
    
    // Subject property assessed values
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("SUBJECT PROPERTY - COUNTY ASSESSOR DATA", 25, yPos + 6);
    
    yPos += 14;
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 35, 3, 3, "F");
    
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    
    const assessorData = [
      ["Total Acreage:", `${parcelData.acreage.toFixed(2)} acres`],
      ["Assessed Value:", parcelData.marketValue ? `$${parcelData.marketValue.toLocaleString()}` : "Contact County Assessor"],
      ["Value per Acre:", parcelData.marketValue ? `$${Math.round(parcelData.marketValue / parcelData.acreage).toLocaleString()}/acre` : "N/A"],
      ["Last Transfer Date:", parcelData.saleDate || "Not Recorded"],
      ["Land Classification:", parcelData.zoning || "Agricultural"],
    ];
    
    let col = 0;
    assessorData.forEach(([label, value], idx) => {
      const xOffset = idx % 2 === 0 ? 25 : 115;
      const yOffset = yPos + 8 + Math.floor(idx / 2) * 10;
      doc.setFont("helvetica", "bold");
      doc.text(label, xOffset, yOffset);
      doc.setFont("helvetica", "normal");
      doc.text(value, xOffset + 38, yOffset);
    });
    
    yPos += 45;
    
    // Data source notice
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 28, 3, 3, "F");
    doc.setDrawColor(184, 134, 11);
    doc.setLineWidth(0.5);
    doc.roundedRect(20, yPos, pageWidth - 40, 28, 3, 3, "S");
    
    doc.setTextColor(184, 134, 11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("DATA SOURCE", 25, yPos + 8);
    
    doc.setTextColor(100, 80, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Valuation data sourced from ${parcelData.county} County Assessor records via Regrid.`, 25, yPos + 16);
    doc.text("Sale prices vary by county disclosure laws. Missouri is a non-disclosure state for transaction prices.", 25, yPos + 23);
    
    yPos += 35;
    
    // Market context section
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("REGIONAL MARKET CONTEXT", 25, yPos + 6);
    
    yPos += 14;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    
    const marketContext = [
      "Agricultural land values in west-central Missouri have shown steady appreciation of 3-5% annually.",
      "Parcels over 80 acres command premium pricing due to farming and hunting lease potential.",
      `${parcelData.county} County maintains strong demand for tillable acreage and recreational tracts.`,
      "For current comparable sales, consult local MLS listings or contact a licensed land specialist.",
    ];
    
    marketContext.forEach((text, idx) => {
      doc.text(`• ${text}`, 25, yPos + (idx * 8));
    });
    
    yPos += 40;
    
    // How to research comps
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 45, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("RESEARCHING COMPARABLE SALES", 25, yPos + 10);
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    
    const researchTips = [
      `1. ${parcelData.county} County Assessor's Office: Request deed transfers and recorded sale prices`,
      "2. Missouri Land Network: Browse active and sold listings for agricultural properties",
      "3. Local Farm Bureau: Connect with agents specializing in rural land transactions",
      "4. LandWatch.com / Land.com: Search recent sales by county and acreage range",
    ];
    
    researchTips.forEach((tip, idx) => {
      doc.text(tip, 25, yPos + 18 + (idx * 7));
    });
    
    // Footer
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
    doc.text(`Page 10 of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // ============================================
    // PAGE 11: AREA DEMOGRAPHICS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 18, "F");
    if (logoImage) { try { doc.addImage(logoImage, "PNG", 20, 19, 16, 16); } catch (e) {} }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("AREA DEMOGRAPHICS", pageWidth / 2, 30, { align: "center" });
    
    yPos = 45;
    
    // County overview
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${parcelData.county.toUpperCase()} COUNTY OVERVIEW`, 25, yPos + 6);
    
    yPos += 14;
    
    const demographics = [
      ["Population:", "54,000 (2023 est.)"],
      ["Population Density:", "62 per sq mile"],
      ["Median Household Income:", "$58,500"],
      ["Median Home Value:", "$185,000"],
      ["Land Area:", "831 sq miles"],
      ["County Seat:", "Warrensburg, MO"],
      ["Major Employers:", "University of Central Missouri, Whiteman AFB"],
      ["School Districts:", "3 public districts serving the county"],
    ];
    
    demographics.forEach(([label, value], idx) => {
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(label, 25, yPos + (idx * 10));
      doc.setFont("helvetica", "normal");
      doc.text(value, 75, yPos + (idx * 10));
    });
    
    yPos += 90;
    
    // Nearby cities
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(20, yPos, pageWidth - 40, 40, 3, 3, "F");
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Nearby Cities & Distances", 25, yPos + 10);
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    
    const cities = [
      "• Warrensburg: 15 miles (county seat, UCM campus)",
      "• Sedalia: 22 miles (Missouri State Fair)",
      "• Kansas City: 55 miles (major metro area)",
      "• Whiteman AFB: 12 miles (military base)"
    ];
    
    cities.forEach((city, idx) => {
      doc.text(city, 25, yPos + 18 + (idx * 6));
    });
    
    // Footer
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
    doc.text(`Page 11 of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // ============================================
    // PAGE 12: RESOURCES & CONTACTS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 18, "F");
    if (logoImage) { try { doc.addImage(logoImage, "PNG", 20, 19, 16, 16); } catch (e) {} }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("RESOURCES & CONTACTS", pageWidth / 2, 30, { align: "center" });
    
    yPos = 45;
    
    const resourceSections = [
      {
        title: "COUNTY OFFICES",
        items: [
          "County Assessor: (660) 555-0100",
          "County Recorder: (660) 555-0101",
          "Planning & Zoning: (660) 555-0102",
          "Health Department: (660) 555-0103"
        ]
      },
      {
        title: "UTILITIES",
        items: [
          "Electric Cooperative: (660) 555-0200",
          "Water District: (660) 555-0201",
          "Propane Services: Multiple providers available"
        ]
      },
      {
        title: "AGRICULTURAL RESOURCES",
        items: [
          "USDA Service Center: (660) 555-0300",
          "MU Extension Office: (660) 555-0301",
          "Farm Service Agency: (660) 555-0302",
          "Soil & Water Conservation: (660) 555-0303"
        ]
      }
    ];
    
    resourceSections.forEach(section => {
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(20, yPos, pageWidth - 40, 8, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(section.title, 25, yPos + 6);
      
      yPos += 12;
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      
      section.items.forEach(item => {
        doc.text(`• ${item}`, 25, yPos);
        yPos += 6;
      });
      
      yPos += 6;
    });
    
    // Disclaimer
    yPos += 5;
    doc.setFillColor(255, 250, 235);
    doc.roundedRect(20, yPos, pageWidth - 40, 25, 3, 3, "F");
    doc.setTextColor(139, 90, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("IMPORTANT NOTICE", 25, yPos + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("Contact information is provided for reference only. Please verify current numbers and hours.", 25, yPos + 15);
    doc.text("Terra Firma Partners is not affiliated with these organizations.", 25, yPos + 21);
    
    // Footer
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(`Report ID: ${reportNumber}`, 25, pageHeight - 20);
    doc.text(`Page 12 of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // ============================================
    // PAGE 13: CERTIFICATE OF ANALYSIS
    // ============================================
    doc.addPage();
    drawCertificateBorder(doc, pageWidth, pageHeight);
    drawSampleWatermark(doc, pageWidth, pageHeight);
    
    // Elegant header
    doc.setFillColor(34, 83, 60);
    doc.rect(18, 18, pageWidth - 36, 40, "F");
    
    if (logoImage) {
      try { doc.addImage(logoImage, "PNG", pageWidth / 2 - 15, 22, 30, 30); } catch (e) {}
    }
    
    yPos = 68;
    
    // Gold accent
    doc.setFillColor(184, 134, 11);
    doc.rect(40, yPos, pageWidth - 80, 2, "F");
    
    yPos += 15;
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("CERTIFICATE OF ANALYSIS", pageWidth / 2, yPos, { align: "center" });
    
    yPos += 20;
    
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text("This certifies that a comprehensive land analysis has been completed for:", pageWidth / 2, yPos, { align: "center" });
    
    yPos += 15;
    
    // Property details box
    doc.setFillColor(245, 250, 245);
    doc.roundedRect(30, yPos, pageWidth - 60, 35, 3, 3, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(order.parcelAddress, pageWidth / 2, yPos + 12, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`${parcelData.acreage.toFixed(2)} Acres | ${parcelData.county} County, ${parcelData.state}`, pageWidth / 2, yPos + 22, { align: "center" });
    doc.text(`Parcel ID: ${parcelData.parcelId}`, pageWidth / 2, yPos + 30, { align: "center" });
    
    yPos += 50;
    
    // Analysis details
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    
    const certDetails = [
      ["Report Number:", reportNumber],
      ["Date of Analysis:", formatDate(new Date())],
      ["Analysis Type:", "Comprehensive Land Report"],
      ["Data Sources:", "County Records, USDA, FEMA, Satellite Imagery"],
      ["Pages:", totalPages.toString()]
    ];
    
    certDetails.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, 60, yPos);
      doc.setFont("helvetica", "normal");
      doc.text(value, 110, yPos);
      yPos += 8;
    });
    
    yPos += 15;
    
    // Signature line
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(0.5);
    doc.line(60, yPos, pageWidth - 60, yPos);
    
    yPos += 8;
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Terra Firma Partners, LLC", pageWidth / 2, yPos, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Satellite Intelligence for Landowners", pageWidth / 2, yPos + 6, { align: "center" });
    
    // Footer - consistent with other pages
    doc.setFillColor(184, 134, 11);
    doc.rect(18, pageHeight - 28, pageWidth - 36, 1, "F");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text("This report is for informational purposes only. Verify all data with appropriate authorities.", pageWidth / 2, pageHeight - 20, { align: "center" });
    doc.text(`Page ${totalPages} of ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: "center" });

    // Generate PDF
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="terra_firma_sample_report.pdf"',
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (error) {
    console.error("Sample report generation error:", error);
    return NextResponse.json({ error: "Failed to generate sample report" }, { status: 500 });
  }
}
