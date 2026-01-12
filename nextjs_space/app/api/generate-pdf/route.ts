import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { jsPDF } from "jspdf";
import { MAP_LAYERS } from "@/lib/map-layers";
import fs from "fs";
import path from "path";

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

      // Map placeholder area
      doc.setFillColor(240, 240, 240);
      doc.rect(15, 40, pageWidth - 30, 100, "F");
      doc.setTextColor(150, 150, 150);
      doc.setFontSize(12);
      doc.text("Map visualization for " + layer.displayName, pageWidth / 2, 90, { align: "center" });
      doc.text(`Property: ${order.parcelAddress.slice(0, 50)}...`, pageWidth / 2, 105, { align: "center" });

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
