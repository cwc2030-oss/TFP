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

// Fetch static map image as base64
async function fetchMapImage(lat: number, lng: number, layerId: string, zoom: number = 14): Promise<string | null> {
  try {
    // Use OpenStreetMap-based static map service
    const width = 600;
    const height = 400;
    
    // Different map styles/sources for different layers
    let mapUrl: string;
    
    switch (layerId) {
      case "flood_zones":
        // Use a terrain-style map for flood zones
        mapUrl = `https://i.ytimg.com/vi/-iHUzNWzIFw/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLCBWc8owB6lt3iIKjV6HUBvE7pUVA`;
        break;
      case "topography":
        // Topographic style
        mapUrl = `https://i.ytimg.com/vi/uR9gPvAgw6s/sddefault.jpg`;
        break;
      case "wetlands":
        // Satellite-like for wetlands
        mapUrl = `https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Mercator_projection_Square.JPG/1280px-Mercator_projection_Square.JPG`;
        break;
      default:
        // Standard OpenStreetMap for other layers
        mapUrl = `https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhxaNhF_rkM9wVFyBPGK6O45CpFU7WjSHyMQ9Gjf0GFLNfMXFK8C_en3TSnzCA6CDY4zaGAtt9nF_xRAcf3MuXNGYhFUhQGD9hs06w6nx57wBji5VS40DR1p9z5jyYJyyN95Cy0Bc7_rA/s1600/gridgeo01.png`;
    }

    // Fallback to OpenStreetMap static map
    const osmUrl = `https://blog.locationiq.com/wp-content/uploads/2023/05/Empire-State-Building-to-Madison-Square-Garden-1.png`;
    
    // Try fetching the map
    let response = await fetch(osmUrl, { 
      headers: { 'User-Agent': 'TerraFirmaPartners/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      // Try alternative OSM tile-based approach
      const tileUrl = `https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEg7pHyau6SJsIskcFQWV3OGtHEvVFQq4uVHsU0mlfQAIFWrdS6NzDp_X9IORZpWoxKg4OHxdMmfn_JP1eltHWx0l4CZKh83tVRcagXqk4GihfeOvbxKIwEYIikp8ap5JJ3A7kJJnnpCFhO6/s1600/Maperitive_screenshot.png + 180) / 360 * Math.pow(2, zoom))}/${Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))}.png`;
      response = await fetch(tileUrl, {
        headers: { 'User-Agent': 'TerraFirmaPartners/1.0' },
        signal: AbortSignal.timeout(10000)
      });
    }

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const contentType = response.headers.get('content-type') || 'image/png';
      return `data:${contentType};base64,${base64}`;
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to fetch map for layer ${layerId}:`, error);
    return null;
  }
}

// Generate a simple map visualization using canvas-like drawing in jsPDF
function drawSimpleMap(doc: jsPDF, lat: number, lng: number, layerId: string, x: number, y: number, width: number, height: number) {
  // Draw base map area
  doc.setFillColor(230, 240, 230);
  doc.rect(x, y, width, height, "F");
  
  // Draw grid lines
  doc.setDrawColor(200, 210, 200);
  doc.setLineWidth(0.3);
  const gridSpacing = 20;
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
      // Draw flood zone areas
      doc.setFillColor(100, 149, 237, 0.3);
      doc.ellipse(centerX - 30, centerY + 10, 40, 25, "F");
      doc.setFillColor(65, 105, 225, 0.4);
      doc.ellipse(centerX + 20, centerY - 15, 30, 20, "F");
      // Legend
      doc.setFontSize(8);
      doc.setTextColor(65, 105, 225);
      doc.text("Zone AE", x + 5, y + height - 15);
      doc.setTextColor(100, 149, 237);
      doc.text("Zone X", x + 5, y + height - 8);
      break;
      
    case "wetlands":
      // Draw wetland areas
      doc.setFillColor(34, 139, 34, 0.4);
      doc.ellipse(centerX - 20, centerY, 35, 30, "F");
      doc.setFillColor(46, 139, 87, 0.3);
      doc.ellipse(centerX + 35, centerY + 20, 25, 18, "F");
      doc.setFontSize(8);
      doc.setTextColor(34, 139, 34);
      doc.text("Wetland Areas", x + 5, y + height - 8);
      break;
      
    case "topography":
      // Draw contour lines
      doc.setDrawColor(139, 90, 43);
      doc.setLineWidth(0.5);
      for (let i = 0; i < 5; i++) {
        const offset = i * 12;
        doc.ellipse(centerX, centerY, 50 - offset, 35 - offset * 0.7, "S");
      }
      doc.setFontSize(8);
      doc.setTextColor(139, 90, 43);
      doc.text("Elevation Contours", x + 5, y + height - 8);
      break;
      
    case "soil_types":
      // Draw soil type regions
      doc.setFillColor(210, 180, 140, 0.5);
      doc.rect(x + 10, y + 10, width / 3, height - 20, "F");
      doc.setFillColor(139, 69, 19, 0.4);
      doc.rect(x + width / 3 + 15, y + 20, width / 3, height - 40, "F");
      doc.setFillColor(160, 82, 45, 0.3);
      doc.rect(x + 2 * width / 3 + 5, y + 15, width / 4, height - 30, "F");
      doc.setFontSize(8);
      doc.setTextColor(139, 69, 19);
      doc.text("Soil Classification Zones", x + 5, y + height - 8);
      break;
      
    case "zoning":
      // Draw zoning districts
      doc.setFillColor(255, 215, 0, 0.4);
      doc.rect(x + 15, y + 15, width / 2 - 10, height / 2 - 10, "F");
      doc.setFillColor(70, 130, 180, 0.4);
      doc.rect(x + width / 2 + 5, y + 15, width / 2 - 20, height / 2 - 10, "F");
      doc.setFillColor(144, 238, 144, 0.4);
      doc.rect(x + 15, y + height / 2 + 10, width - 30, height / 2 - 25, "F");
      doc.setFontSize(8);
      doc.setTextColor(70, 130, 180);
      doc.text("Zoning Districts", x + 5, y + height - 8);
      break;
      
    case "roads_transportation":
      // Draw roads
      doc.setDrawColor(80, 80, 80);
      doc.setLineWidth(2);
      doc.line(x, centerY, x + width, centerY);
      doc.setLineWidth(1.5);
      doc.line(centerX, y, centerX, y + height);
      doc.setDrawColor(120, 120, 120);
      doc.setLineWidth(0.8);
      doc.line(x + 30, y + 20, x + width - 30, y + height - 20);
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text("Road Network", x + 5, y + height - 8);
      break;
      
    case "power_substations":
      // Draw power infrastructure
      doc.setDrawColor(255, 140, 0);
      doc.setLineWidth(1);
      doc.line(x + 20, y + 30, x + width - 20, y + height - 30);
      doc.line(x + 20, y + height - 30, x + width - 20, y + 30);
      // Substation symbol
      doc.setFillColor(255, 140, 0);
      doc.rect(centerX - 8, centerY - 8, 16, 16, "F");
      doc.setFontSize(8);
      doc.setTextColor(255, 140, 0);
      doc.text("Power Infrastructure", x + 5, y + height - 8);
      break;
      
    case "property_boundaries":
      // Draw property outline
      doc.setDrawColor(220, 20, 60);
      doc.setLineWidth(2);
      doc.rect(x + 25, y + 25, width - 50, height - 50, "S");
      // Corner markers
      doc.setFillColor(220, 20, 60);
      doc.circle(x + 25, y + 25, 3, "F");
      doc.circle(x + width - 25, y + 25, 3, "F");
      doc.circle(x + 25, y + height - 25, 3, "F");
      doc.circle(x + width - 25, y + height - 25, 3, "F");
      doc.setFontSize(8);
      doc.setTextColor(220, 20, 60);
      doc.text("Property Boundary", x + 5, y + height - 8);
      break;
      
    default:
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text("Map Data Layer", centerX, centerY, { align: "center" });
  }
  
  // Draw property marker
  doc.setFillColor(220, 38, 38);
  doc.circle(centerX, centerY, 5, "F");
  doc.setFillColor(255, 255, 255);
  doc.circle(centerX, centerY, 2, "F");
  
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

    // Layer Detail Pages
    selectedLayers.forEach((layerId: string, index: number) => {
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

      // Draw map visualization for this layer
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, layerId, 15, 40, pageWidth - 30, 100);

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
    });

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
