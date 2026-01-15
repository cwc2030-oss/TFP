import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { jsPDF } from "jspdf";
import { MAP_LAYERS } from "@/lib/map-layers";

export const dynamic = "force-dynamic";

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
}

const formatDate = (date: Date) => {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const getLayerInfo = (layerId: string) => {
  return MAP_LAYERS.find((l) => l.id === layerId) || {
    displayName: layerId,
    description: "Layer data",
    dataSource: "Unknown",
  };
};

// Fetch parcel data from Regrid API using typeahead + path approach
async function fetchRegridParcelData(lat: number, lng: number, address: string): Promise<ParcelData | null> {
  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) {
    console.error("Regrid API key not configured");
    return null;
  }

  try {
    // Step 1: Use typeahead to find parcel path from address
    const typeaheadUrl = `https://app.regrid.com/api/v1/typeahead.json?query=${encodeURIComponent(address)}&token=${apiKey}`;
    const typeaheadResponse = await fetch(typeaheadUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!typeaheadResponse.ok) {
      console.error("Regrid typeahead error:", typeaheadResponse.status);
      return null;
    }

    const typeaheadResults = await typeaheadResponse.json();
    
    if (!Array.isArray(typeaheadResults) || typeaheadResults.length === 0) {
      console.log("No typeahead results for address:", address);
      return null;
    }

    // Get the path from the first result
    const parcelPath = typeaheadResults[0].path;
    if (!parcelPath) {
      console.log("No path in typeahead result");
      return null;
    }

    // Step 2: Fetch full parcel data using path
    const parcelUrl = `https://app.regrid.com/api/v1/parcel.json?path=${parcelPath}&token=${apiKey}`;
    const parcelResponse = await fetch(parcelUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!parcelResponse.ok) {
      console.error("Regrid parcel error:", parcelResponse.status);
      return null;
    }

    const parcelData = await parcelResponse.json();
    const fields = parcelData.properties?.fields || {};
    
    // Build addresses
    const mailParts = [
      fields.mailadd || fields.mail_address,
      fields.mail_unit,
      fields.mail_city,
      fields.mail_state2,
      fields.mail_zip
    ].filter(Boolean);
    
    const siteParts = [
      fields.address,
      fields.city || fields.situs_city,
      fields.state2 || fields.situs_state2,
      fields.szip || fields.situs_zip
    ].filter(Boolean);

    // Extract polygon coordinates
    let coordinates: number[][][] | null = null;
    if (parcelData.geometry?.type === "Polygon" && parcelData.geometry.coordinates) {
      coordinates = parcelData.geometry.coordinates as number[][][];
    } else if (parcelData.geometry?.type === "MultiPolygon" && parcelData.geometry.coordinates) {
      // Take the first polygon from MultiPolygon
      coordinates = (parcelData.geometry.coordinates as number[][][][])[0] || null;
    }

    return {
      parcelId: fields.parcelnumb || fields.parcelnumb_no_formatting || "Not Available",
      owner: fields.owner || "Not Available",
      mailingAddress: mailParts.length > 0 ? mailParts.join(", ") : "Not Available",
      siteAddress: siteParts.length > 0 ? siteParts.join(", ") : parcelData.properties?.headline || "Not Available",
      acreage: fields.ll_gisacre || fields.acres || 0,
      sqft: fields.ll_gissqft || fields.ll_bldg_footprint_sqft || fields.sqft || 0,
      zoning: fields.zoning || "N/A",
      useDescription: fields.usedesc || fields.zoning_description || "N/A",
      coordinates,
    };
  } catch (error) {
    console.error("Failed to fetch Regrid parcel data:", error);
    return null;
  }
}

const formatAcreage = (acres: number, sqft: number): string => {
  if (acres >= 1) {
    return `${acres.toFixed(2)} acres (${sqft.toLocaleString()} sq ft)`;
  } else if (sqft > 0) {
    return `${sqft.toLocaleString()} sq ft (${acres.toFixed(3)} acres)`;
  }
  return "Not Available";
};

// Build parcel boundary path for Google Maps Static API with prominent border
function buildParcelPath(coordinates: number[][][] | null): string {
  if (!coordinates || coordinates.length === 0 || !coordinates[0]) {
    return "";
  }
  
  // Get the outer ring (first array)
  const ring = coordinates[0];
  if (ring.length < 3) return "";
  
  // Limit points to avoid URL length issues (max ~50 points)
  const maxPoints = 50;
  const step = ring.length > maxPoints ? Math.ceil(ring.length / maxPoints) : 1;
  
  // Build path string with PROMINENT GREEN BORDER like the interface
  // Using brighter green (#22C55E) with thick weight (5) and semi-transparent fill
  const pathPoints = ring
    .filter((_, i) => i % step === 0 || i === ring.length - 1)
    .map(coord => `${coord[1]},${coord[0]}`) // GeoJSON is [lng, lat], Google wants lat,lng
    .join("|");
  
  return `&path=color:0x22C55EFF|weight:5|fillcolor:0x22C55E30|${pathPoints}`;
}

// Fetch Google Maps Static API image as base64
async function fetchGoogleMapImage(
  lat: number, 
  lng: number, 
  layerId: string, 
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
    
    // Use satellite imagery for aerial property view to match the interface
    let mapType = "satellite";
    let style = "";
    
    switch (layerId) {
      case "flood_zones":
      case "wetlands":
        mapType = "satellite"; // Aerial view shows environmental features better
        break;
      case "topography":
        mapType = "terrain";
        style = "&style=feature:all|element:labels|visibility:on";
        break;
      case "soil_types":
      case "property_boundaries":
        mapType = "satellite"; // Pure satellite for clear property boundaries
        break;
      case "roads_transportation":
        mapType = "hybrid"; // Satellite with road labels
        break;
      case "zoning":
        mapType = "hybrid"; // Satellite with zoning context
        break;
      case "power_substations":
        mapType = "hybrid"; // Satellite with infrastructure labels
        break;
      default:
        mapType = "satellite"; // Default to satellite for best aerial view
    }

    // Build parcel boundary path
    const parcelPath = buildParcelPath(parcelCoordinates);

        const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&maptype=${mapType}&markers=color:red%7C${lat},${lng}${style}${parcelPath}&key=${apiKey}`;

    const response = await fetch(mapUrl, {
      signal: AbortSignal.timeout(15000)
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      // Make sure it's actually an image, not an error page
      if (contentType.includes('image')) {
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return `data:image/png;base64,${base64}`;
      } else {
        console.error(`Google Maps returned non-image content: ${contentType}`);
        return null;
      }
    }
    
    console.error(`Google Maps API error: ${response.status}`);
    return null;
  } catch (error) {
    console.error(`Failed to fetch Google map for layer ${layerId}:`, error);
    return null;
  }
}

// Generate a simple map visualization using canvas-like drawing in jsPDF
function drawSimpleMap(
  doc: jsPDF, 
  lat: number, 
  lng: number, 
  layerId: string, 
  x: number, 
  y: number, 
  width: number, 
  height: number,
  parcelCoordinates: number[][][] | null = null
) {
  // Draw base map area with light green background
  doc.setFillColor(235, 245, 235);
  doc.rect(x, y, width, height, "F");
  
  // Draw grid lines
  doc.setDrawColor(200, 215, 200);
  doc.setLineWidth(0.3);
  const gridSpacing = 15;
  for (let gx = x; gx <= x + width; gx += gridSpacing) {
    doc.line(gx, y, gx, y + height);
  }
  for (let gy = y; gy <= y + height; gy += gridSpacing) {
    doc.line(x, gy, x + width, gy);
  }

  // Draw parcel boundary if coordinates available
  if (parcelCoordinates && parcelCoordinates[0] && parcelCoordinates[0].length > 2) {
    const ring = parcelCoordinates[0];
    
    // Find bounds of the parcel
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const coord of ring) {
      minLng = Math.min(minLng, coord[0]);
      maxLng = Math.max(maxLng, coord[0]);
      minLat = Math.min(minLat, coord[1]);
      maxLat = Math.max(maxLat, coord[1]);
    }
    
    // Scale coordinates to fit in the map area with padding
    const padding = 10;
    const mapWidth = width - padding * 2;
    const mapHeight = height - padding * 2;
    const lngRange = maxLng - minLng || 0.001;
    const latRange = maxLat - minLat || 0.001;
    
    // Convert geo coordinates to PDF coordinates
    const toX = (lng: number) => x + padding + ((lng - minLng) / lngRange) * mapWidth;
    const toY = (lat: number) => y + padding + mapHeight - ((lat - minLat) / latRange) * mapHeight;
    
    // Draw filled polygon
    doc.setFillColor(34, 83, 60, 0.2); // Semi-transparent forest green
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(2);
    
    // Start path
    const points: number[][] = ring.map(coord => [toX(coord[0]), toY(coord[1])]);
    
    // Draw the polygon outline
    if (points.length > 0) {
      doc.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        doc.lineTo(points[i][0], points[i][1]);
      }
      doc.lineTo(points[0][0], points[0][1]); // Close path
      doc.stroke();
    }
  }
  
  // Draw layer-specific overlays
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  
  switch (layerId) {
    case "flood_zones":
      // Draw flood zone areas using rectangles
      doc.setFillColor(173, 216, 230); // Light blue
      doc.rect(x + 20, y + 15, width * 0.4, height * 0.5, "F");
      doc.setFillColor(100, 149, 237); // Cornflower blue
      doc.rect(x + width * 0.5, y + height * 0.4, width * 0.35, height * 0.4, "F");
      // Legend
      doc.setFontSize(8);
      doc.setTextColor(65, 105, 225);
      doc.text("Zone AE (High Risk)", x + 5, y + height - 12);
      doc.setTextColor(100, 149, 237);
      doc.text("Zone X (Moderate Risk)", x + 5, y + height - 5);
      break;
      
    case "wetlands":
      // Draw wetland areas
      doc.setFillColor(144, 238, 144); // Light green
      doc.rect(x + 25, y + 20, width * 0.35, height * 0.6, "F");
      doc.setFillColor(34, 139, 34); // Forest green
      doc.rect(x + width * 0.55, y + 25, width * 0.3, height * 0.45, "F");
      doc.setFontSize(8);
      doc.setTextColor(34, 139, 34);
      doc.text("Wetland Areas Identified", x + 5, y + height - 5);
      break;
      
    case "topography":
      // Draw contour lines using concentric rectangles
      doc.setDrawColor(139, 90, 43);
      doc.setLineWidth(0.8);
      for (let i = 0; i < 5; i++) {
        const offset = i * 8;
        doc.rect(x + 15 + offset, y + 10 + offset, width - 30 - offset * 2, height - 20 - offset * 2, "S");
      }
      doc.setFontSize(8);
      doc.setTextColor(139, 90, 43);
      doc.text("Elevation Contours (ft above sea level)", x + 5, y + height - 5);
      break;
      
    case "soil_types":
      // Draw soil type regions
      doc.setFillColor(210, 180, 140); // Tan
      doc.rect(x + 10, y + 10, width / 3 - 5, height - 20, "F");
      doc.setFillColor(139, 69, 19); // Saddle brown
      doc.rect(x + width / 3 + 10, y + 15, width / 3 - 10, height - 30, "F");
      doc.setFillColor(160, 82, 45); // Sienna
      doc.rect(x + 2 * width / 3 + 5, y + 12, width / 3 - 15, height - 24, "F");
      doc.setFontSize(8);
      doc.setTextColor(139, 69, 19);
      doc.text("Soil Classification Zones", x + 5, y + height - 5);
      break;
      
    case "zoning":
      // Draw zoning districts
      doc.setFillColor(255, 223, 128); // Light gold - Residential
      doc.rect(x + 10, y + 10, width / 2 - 15, height / 2 - 10, "F");
      doc.setFillColor(135, 206, 235); // Sky blue - Commercial
      doc.rect(x + width / 2, y + 10, width / 2 - 10, height / 2 - 10, "F");
      doc.setFillColor(144, 238, 144); // Light green - Agricultural
      doc.rect(x + 10, y + height / 2 + 5, width - 20, height / 2 - 15, "F");
      doc.setFontSize(7);
      doc.setTextColor(70, 130, 180);
      doc.text("R-1 Residential | C-1 Commercial | A-1 Agricultural", x + 5, y + height - 5);
      break;
      
    case "roads_transportation":
      // Draw roads
      doc.setDrawColor(80, 80, 80);
      doc.setLineWidth(3);
      doc.line(x + 10, centerY, x + width - 10, centerY); // Main road
      doc.setLineWidth(2);
      doc.line(centerX, y + 10, centerX, y + height - 10); // Cross road
      doc.setDrawColor(120, 120, 120);
      doc.setLineWidth(1);
      doc.line(x + 30, y + 15, x + width - 30, y + height - 15); // Secondary
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text("Road Network & Access Points", x + 5, y + height - 5);
      break;
      
    case "power_substations":
      // Draw power infrastructure
      doc.setDrawColor(255, 140, 0);
      doc.setLineWidth(1.5);
      doc.line(x + 15, centerY - 15, x + width - 15, centerY - 15); // Power line
      doc.line(x + 15, centerY + 15, x + width - 15, centerY + 15); // Power line
      // Substation symbol
      doc.setFillColor(255, 140, 0);
      doc.rect(centerX - 10, centerY - 10, 20, 20, "F");
      doc.setFillColor(255, 255, 255);
      doc.rect(centerX - 5, centerY - 5, 10, 10, "F");
      doc.setFontSize(8);
      doc.setTextColor(255, 140, 0);
      doc.text("Power Infrastructure & Substations", x + 5, y + height - 5);
      break;
      
    case "property_boundaries":
      // Draw property outline
      doc.setDrawColor(220, 20, 60);
      doc.setLineWidth(2.5);
      doc.rect(x + 20, y + 15, width - 40, height - 30, "S");
      // Corner markers
      doc.setFillColor(220, 20, 60);
      doc.rect(x + 17, y + 12, 6, 6, "F");
      doc.rect(x + width - 23, y + 12, 6, 6, "F");
      doc.rect(x + 17, y + height - 18, 6, 6, "F");
      doc.rect(x + width - 23, y + height - 18, 6, 6, "F");
      doc.setFontSize(8);
      doc.setTextColor(220, 20, 60);
      doc.text("Property Boundary Markers", x + 5, y + height - 5);
      break;
      
    default:
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text("Map Data Layer", centerX, centerY, { align: "center" });
  }
  
  // Draw property marker (red pin)
  doc.setFillColor(220, 38, 38);
  doc.rect(centerX - 4, centerY - 4, 8, 8, "F");
  doc.setFillColor(255, 255, 255);
  doc.rect(centerX - 2, centerY - 2, 4, 4, "F");
  
  // Draw border
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(1);
  doc.rect(x, y, width, height, "S");
  
  // Coordinates label
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  doc.text(`${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W`, x + width - 5, y + height - 3, { align: "right" });
}

// Helper function to get layer score/rating with risk level
function getLayerScore(layerId: string): { score: string; rating: string; color: [number, number, number]; riskLevel: number } {
  const scores: Record<string, { score: string; rating: string; color: [number, number, number]; riskLevel: number }> = {
    flood_zones: { score: "Low Risk", rating: "Zone X", color: [34, 197, 94], riskLevel: 1 }, // green - low risk
    wetlands: { score: "Minimal", rating: "<5% Coverage", color: [34, 197, 94], riskLevel: 1 },
    topography: { score: "Gentle", rating: "1-5° Slope", color: [34, 197, 94], riskLevel: 1 },
    soil_types: { score: "Type B/C", rating: "Good Drainage", color: [234, 179, 8], riskLevel: 2 }, // yellow - moderate
    zoning: { score: "Agricultural", rating: "A-1 District", color: [34, 197, 94], riskLevel: 1 },
    property_boundaries: { score: "Verified", rating: "County Records", color: [34, 197, 94], riskLevel: 1 },
    power_substations: { score: "Nearby", rating: "<1 Mile", color: [34, 197, 94], riskLevel: 1 },
    roads_transportation: { score: "Good Access", rating: "Paved Road", color: [34, 197, 94], riskLevel: 1 },
  };

  return scores[layerId] || { score: "Available", rating: "Data Present", color: [156, 163, 175], riskLevel: 1 };
}

// Calculate overall risk score from selected layers
function calculateOverallRisk(selectedLayers: string[]): { score: number; label: string; color: [number, number, number] } {
  if (selectedLayers.length === 0) {
    return { score: 0, label: "No Data", color: [156, 163, 175] };
  }

  const totalRisk = selectedLayers.reduce((sum, layerId) => {
    return sum + getLayerScore(layerId).riskLevel;
  }, 0);

  const avgRisk = totalRisk / selectedLayers.length;

  if (avgRisk <= 1.2) {
    return { score: avgRisk, label: "Low Risk", color: [34, 197, 94] }; // green
  } else if (avgRisk <= 1.8) {
    return { score: avgRisk, label: "Moderate Risk", color: [234, 179, 8] }; // yellow
  } else {
    return { score: avgRisk, label: "Higher Risk", color: [239, 68, 68] }; // red
  }
}

// Load and convert logo to base64
async function loadLogoImage(): Promise<string | null> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const logoPath = path.join(process.cwd(), 'public', 'logo-landscape.png');
    const logoBuffer = await fs.readFile(logoPath);
    const base64 = logoBuffer.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error("Failed to load logo:", error);
    return null;
  }
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
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    const selectedLayers = JSON.parse(order.selectedLayers || "[]");
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Fetch real parcel data from Regrid using address
    const parcelData = await fetchRegridParcelData(order.parcelLat, order.parcelLng, order.parcelAddress);

    // Load logo
    const logoImage = await loadLogoImage();

    // ONE PAGE REPORT DESIGN
    
    // Header Section (Forest Green)
    doc.setFillColor(34, 83, 60);
    doc.rect(0, 0, pageWidth, 35, "F");
    
    // Add logo to header if available
    if (logoImage) {
      try {
        doc.addImage(logoImage, "PNG", 15, 5, 50, 25);
      } catch (logoError) {
        console.error("Failed to add logo to PDF:", logoError);
      }
    }
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text("TERRA FIRMA PARTNERS LLC", pageWidth / 2, 15, { align: "center" });
    doc.setFontSize(11);
    doc.text("Land Analysis Report", pageWidth / 2, 25, { align: "center" });

    // ============================================
    // HERO AERIAL VIEW - Primary Focus
    // ============================================
    let yPos = 35;
    const heroMapHeight = 100; // Large hero image
    
    // Fetch satellite map image with prominent parcel boundaries
    const mapImage = await fetchGoogleMapImage(
      order.parcelLat, 
      order.parcelLng, 
      "property_boundaries",
      16, // Balanced zoom for property context
      parcelData?.coordinates || null
    );

    // Draw bordered frame for the aerial image
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(1.5);
    doc.rect(10, yPos - 2, pageWidth - 20, heroMapHeight + 4);

    if (mapImage) {
      try {
        doc.addImage(mapImage, "PNG", 12, yPos, pageWidth - 24, heroMapHeight);
      } catch (imgError) {
        console.error("Failed to add map image:", imgError);
        drawSimpleMap(doc, order.parcelLat, order.parcelLng, "property_boundaries", 12, yPos, pageWidth - 24, heroMapHeight, parcelData?.coordinates || null);
      }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, "property_boundaries", 12, yPos, pageWidth - 24, heroMapHeight, parcelData?.coordinates || null);
    }

    // Coordinates overlay on bottom of map
    yPos += heroMapHeight - 5;
    doc.setFillColor(40, 40, 40);
    doc.rect(12, yPos - 2, pageWidth - 24, 8, "F");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(`${order.parcelLat.toFixed(6)}N, ${Math.abs(order.parcelLng).toFixed(6)}W`, pageWidth / 2, yPos + 3, { align: "center" });

    // ============================================
    // PROPERTY INFO - Compact horizontal strip
    // ============================================
    yPos += 15;
    
    // Property info background
    doc.setFillColor(248, 250, 252);
    doc.rect(10, yPos - 3, pageWidth - 20, 20, "F");
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.rect(10, yPos - 3, pageWidth - 20, 20);
    
    // Property details in a single row layout
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    
    const lotSize = parcelData ? formatAcreage(parcelData.acreage, parcelData.sqft) : "N/A";
    const owner = parcelData?.owner || "Not Available";
    const parcelId = parcelData?.parcelId || "N/A";
    
    // Row 1
    doc.text("OWNER", 15, yPos + 2);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    const truncOwner = owner.length > 25 ? owner.substring(0, 22) + "..." : owner;
    doc.text(truncOwner, 15, yPos + 7);
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.text("LOT SIZE", 75, yPos + 2);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text(lotSize, 75, yPos + 7);
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.text("PARCEL ID", 130, yPos + 2);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text(parcelId, 130, yPos + 7);
    
    // Row 2 - Zoning
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.text("ZONING", 15, yPos + 12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text(parcelData?.zoning || "N/A", 35, yPos + 12);

    // Overall Risk Assessment inline
    const overallRisk = calculateOverallRisk(selectedLayers);
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.text("ASSESSMENT", 75, yPos + 12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...overallRisk.color);
    doc.text(overallRisk.label, 105, yPos + 12);

    // ============================================
    // LAYER SCORES - Clean table
    // ============================================
    yPos += 25;
    
    doc.setFillColor(34, 83, 60);
    doc.rect(15, yPos - 3, pageWidth - 30, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LAYER ANALYSIS", pageWidth / 2, yPos + 2, { align: "center" });

    yPos += 12;

    // Draw table header
    const tableStartY = yPos;
    const col1X = 20;
    const col2X = 95;
    const col3X = 145;
    const rowHeight = 8;

    doc.setFillColor(240, 240, 240);
    doc.rect(15, yPos - 2, pageWidth - 30, rowHeight, "F");
    
    doc.setTextColor(50, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Data Layer", col1X, yPos + 3);
    doc.text("Score", col2X, yPos + 3);
    doc.text("Rating/Details", col3X, yPos + 3);

    yPos += rowHeight;

    // Draw table rows for each layer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    
    selectedLayers.forEach((layerId: string, index: number) => {
      const layer = getLayerInfo(layerId);
      const scoreData = getLayerScore(layerId);
      
      // Alternating row colors
      if (index % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(15, yPos - 2, pageWidth - 30, rowHeight, "F");
      }
      
      // Layer name
      doc.setTextColor(60, 60, 60);
      doc.text(layer.displayName, col1X, yPos + 3);
      
      // Score with colored indicator
      doc.setFillColor(...scoreData.color);
      doc.circle(col2X + 2, yPos + 1.5, 2, "F");
      doc.setTextColor(60, 60, 60);
      doc.text(scoreData.score, col2X + 7, yPos + 3);
      
      // Rating/Details
      doc.setTextColor(100, 100, 100);
      doc.text(scoreData.rating, col3X, yPos + 3);
      
      yPos += rowHeight;
    });

    // Draw table border
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.rect(15, tableStartY - 2, pageWidth - 30, (selectedLayers.length + 1) * rowHeight);

    // Footer Section
    yPos = pageHeight - 35;
    
    // Data source note
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    const dataSources = "Data sources: Regrid (Parcel Data), FEMA (Flood Zones), USGS (Topography), USDA (Soils), Local Government (Zoning)";
    doc.text(dataSources, pageWidth / 2, yPos, { align: "center" });
    
    yPos += 5;
    doc.text(`Report Generated: ${formatDate(new Date())} | Order ID: ${order.id.slice(0, 12)}`, pageWidth / 2, yPos, { align: "center" });
    
    // Disclaimer
    yPos += 7;
    doc.setFontSize(6);
    const disclaimer = "This report is for informational purposes only. Data compiled from public sources and may not reflect current conditions. Not a substitute for professional surveys or appraisals. Terra Firma Partners LLC makes no guarantees regarding accuracy or completeness.";
    const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 30);
    doc.text(disclaimerLines, pageWidth / 2, yPos, { align: "center" });

    // Bottom bar
    doc.setFillColor(34, 83, 60);
    doc.rect(0, pageHeight - 12, pageWidth, 12, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text("© 2026 Terra Firma Partners LLC | www.terrafirmapartners.com", pageWidth / 2, pageHeight - 5, { align: "center" });

    const pdfBuffer = doc.output("arraybuffer");
    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

    // Update order with PDF path (in production, save to storage)
    await prisma.order.update({
      where: { id: orderId },
      data: {
        pdfPath: `report_${orderId}.pdf`,
        status: "completed",
      },
    });

    return NextResponse.json({
      success: true,
      pdf: pdfBase64,
      filename: `terra_firma_report_${orderId.slice(0, 8)}.pdf`,
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}

function getLayerNotes(layerId: string): string {
  const notes: Record<string, string> = {
    flood_zones: "FEMA flood zone designations indicate the level of flood risk. Zone A and AE areas have a 1% annual chance of flooding (100-year flood). Zone X (shaded) has a 0.2% annual chance (500-year flood). Properties in high-risk zones typically require flood insurance for federally-backed mortgages.",
    wetlands: "Wetland areas are protected under the Clean Water Act and may have restrictions on development. Activities affecting wetlands may require permits from the U.S. Army Corps of Engineers. Wetland presence can impact property value and development potential.",
    topography: "Elevation data shows the terrain characteristics of the property. Steep slopes may affect construction costs, drainage, and erosion control requirements. Understanding topography is essential for site planning and stormwater management.",
    soil_types: "Soil classifications affect construction methods, foundation requirements, and agricultural suitability. Some soil types may have poor drainage, high shrink-swell potential, or other characteristics that impact development.",
    zoning: "Zoning designations determine permitted land uses, building heights, setbacks, and density. Understanding zoning is crucial for evaluating development potential and ensuring compliance with local regulations.",
    property_boundaries: "Property boundary information helps identify the legal extent of the parcel. Always verify boundaries through an official survey before any transactions or improvements.",
    power_substations: "Proximity to electrical substations may be relevant for industrial development, data centers, or properties requiring high power capacity. Some buyers may also consider proximity for residential property decisions.",
    roads_transportation: "Road access and transportation infrastructure affect property accessibility, traffic patterns, and potential for commercial development. Consider proximity to highways, public transit, and freight routes.",
  };

  return notes[layerId] || "Additional analysis data and notes for this layer will be provided based on property-specific findings.";
}
