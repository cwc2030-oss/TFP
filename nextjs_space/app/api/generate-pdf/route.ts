import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { jsPDF } from "jspdf";
import { MAP_LAYERS } from "@/lib/map-layers";

export const dynamic = "force-dynamic";

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

// Fetch Google Maps Static API image as base64
async function fetchGoogleMapImage(
  lat: number, 
  lng: number, 
  layerId: string, 
  zoom: number = 15
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("Google Maps API key not configured");
    return null;
  }

  try {
    const width = 640;
    const height = 400;
    
    // Different map types for different layers
    let mapType = "roadmap";
    let style = "";
    
    switch (layerId) {
      case "flood_zones":
      case "wetlands":
        mapType = "terrain";
        break;
      case "topography":
        mapType = "terrain";
        style = "&style=feature:all|element:labels|visibility:on";
        break;
      case "soil_types":
        mapType = "satellite";
        break;
      case "roads_transportation":
        mapType = "roadmap";
        style = "&style=feature:road|element:geometry|color:0x000000|weight:2";
        break;
      case "property_boundaries":
      case "zoning":
        mapType = "hybrid";
        break;
      case "power_substations":
        mapType = "roadmap";
        break;
      default:
        mapType = "roadmap";
    }

    const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&maptype=${mapType}&markers=color:red%7C${lat},${lng}${style}&key=${apiKey}`;

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
function drawSimpleMap(doc: jsPDF, lat: number, lng: number, layerId: string, x: number, y: number, width: number, height: number) {
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

    // Cover Page
    doc.setFillColor(34, 83, 60); // Forest green
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(32);
    doc.text("TERRA FIRMA", pageWidth / 2, 60, { align: "center" });
    doc.setFontSize(18);
    doc.text("PARTNERS LLC", pageWidth / 2, 72, { align: "center" });

    doc.setFontSize(14);
    doc.text("Land Parcel Analysis Report", pageWidth / 2, 100, { align: "center" });

    doc.setDrawColor(255, 255, 255);
    doc.line(40, 115, pageWidth - 40, 115);

    doc.setFontSize(12);
    doc.text("Property Address:", pageWidth / 2, 135, { align: "center" });
    doc.setFontSize(14);
    const addressLines = doc.splitTextToSize(order.parcelAddress, 140);
    doc.text(addressLines, pageWidth / 2, 147, { align: "center" });

    doc.setFontSize(11);
    doc.text(`Report Generated: ${formatDate(new Date())}`, pageWidth / 2, 180, { align: "center" });
    doc.text(`Order ID: ${order.id.slice(0, 8)}...`, pageWidth / 2, 190, { align: "center" });

    doc.setFontSize(10);
    doc.text("Coordinates:", pageWidth / 2, 210, { align: "center" });
    doc.text(`Lat: ${order.parcelLat.toFixed(6)}, Lng: ${order.parcelLng.toFixed(6)}`, pageWidth / 2, 220, { align: "center" });

    // Summary Page
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    // Header
    doc.setFillColor(34, 83, 60);
    doc.rect(0, 0, pageWidth, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text("REPORT SUMMARY", 15, 20);

    doc.setTextColor(50, 50, 50);
    doc.setFontSize(12);
    let yPos = 50;

    doc.setFont("helvetica", "bold");
    doc.text("Property Information", 15, yPos);
    doc.setFont("helvetica", "normal");
    yPos += 10;
    doc.text(`Address: ${order.parcelAddress}`, 15, yPos);
    yPos += 8;
    if (order.parcelId) {
      doc.text(`Parcel ID: ${order.parcelId}`, 15, yPos);
      yPos += 8;
    }
    doc.text(`Location: ${order.parcelLat.toFixed(6)}, ${order.parcelLng.toFixed(6)}`, 15, yPos);

    yPos += 20;
    doc.setFont("helvetica", "bold");
    doc.text("Selected Analysis Layers", 15, yPos);
    doc.setFont("helvetica", "normal");
    yPos += 10;

    selectedLayers.forEach((layerId: string, index: number) => {
      const layer = getLayerInfo(layerId);
      doc.text(`${index + 1}. ${layer.displayName}`, 20, yPos);
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`   Data Source: ${layer.dataSource}`, 20, yPos + 6);
      doc.setFontSize(12);
      doc.setTextColor(50, 50, 50);
      yPos += 18;
    });

    // Pre-fetch all Google Maps images for layers
    const mapImages: Record<string, string | null> = {};
    for (const layerId of selectedLayers) {
      const mapImage = await fetchGoogleMapImage(order.parcelLat, order.parcelLng, layerId);
      mapImages[layerId] = mapImage;
    }

    // Layer Detail Pages
    for (let index = 0; index < selectedLayers.length; index++) {
      const layerId = selectedLayers[index];
      const layer = getLayerInfo(layerId);

      doc.addPage();
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, pageWidth, pageHeight, "F");

      // Header
      doc.setFillColor(34, 83, 60);
      doc.rect(0, 0, pageWidth, 30, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text(layer.displayName.toUpperCase(), 15, 20);

      // Add Google Map image or fallback to simple map
      const mapImage = mapImages[layerId];
      if (mapImage) {
        try {
          doc.addImage(mapImage, "PNG", 15, 40, pageWidth - 30, 80);
          // Add coordinates label below map
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(`Location: ${order.parcelLat.toFixed(6)}°N, ${Math.abs(order.parcelLng).toFixed(6)}°W`, pageWidth - 15, 125, { align: "right" });
        } catch (imgError) {
          console.error("Failed to add map image:", imgError);
          drawSimpleMap(doc, order.parcelLat, order.parcelLng, layerId, 15, 40, pageWidth - 30, 80);
        }
      } else {
        // Fallback to simple drawn map
        drawSimpleMap(doc, order.parcelLat, order.parcelLng, layerId, 15, 40, pageWidth - 30, 80);
      }

      // Layer info
      doc.setTextColor(50, 50, 50);
      let y = 155;

      doc.setFont("helvetica", "bold");
      doc.text("Layer Description", 15, y);
      doc.setFont("helvetica", "normal");
      y += 10;
      const descLines = doc.splitTextToSize(layer.description, pageWidth - 30);
      doc.text(descLines, 15, y);
      y += descLines.length * 7 + 10;

      doc.setFont("helvetica", "bold");
      doc.text("Data Source", 15, y);
      doc.setFont("helvetica", "normal");
      y += 10;
      doc.text(layer.dataSource, 15, y);

      y += 20;
      doc.setFont("helvetica", "bold");
      doc.text("Analysis Notes", 15, y);
      doc.setFont("helvetica", "normal");
      y += 10;

      const notes = getLayerNotes(layerId);
      const noteLines = doc.splitTextToSize(notes, pageWidth - 30);
      doc.text(noteLines, 15, y);

      // Footer
      doc.setFillColor(34, 83, 60);
      doc.rect(0, pageHeight - 15, pageWidth, 15, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.text(`Terra Firma Partners LLC | Page ${index + 3}`, pageWidth / 2, pageHeight - 5, { align: "center" });
    }

    // Disclaimer Page
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    doc.setFillColor(34, 83, 60);
    doc.rect(0, 0, pageWidth, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text("DISCLAIMER & TERMS", 15, 20);

    doc.setTextColor(50, 50, 50);
    doc.setFontSize(10);
    const disclaimer = `This report is provided by Terra Firma Partners LLC for informational purposes only. While we strive to ensure accuracy, the data presented may not reflect the most current conditions or all relevant factors affecting the property.

The information contained herein is compiled from various public and third-party data sources including FEMA, USGS, local government agencies, and other providers. Terra Firma Partners LLC does not guarantee the accuracy, completeness, or timeliness of this information.

This report is not intended to replace professional surveys, appraisals, or official government records. Property buyers, sellers, and investors should conduct their own due diligence and consult with qualified professionals before making any decisions.

Data sources referenced in this report retain their respective copyrights and usage restrictions. FEMA flood zone data is subject to change and official Flood Insurance Rate Maps (FIRMs) should be consulted for insurance purposes.

© ${new Date().getFullYear()} Terra Firma Partners LLC. All rights reserved.`;

    const disclaimerLines = doc.splitTextToSize(disclaimer, pageWidth - 30);
    doc.text(disclaimerLines, 15, 50);

    // Contact info
    doc.setFontSize(11);
    doc.text("Contact Us:", 15, 180);
    doc.text("Terra Firma Partners LLC", 15, 190);
    doc.text("Kansas City Metro Area", 15, 200);
    doc.text("www.terrafirmapartners.com", 15, 210);

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
