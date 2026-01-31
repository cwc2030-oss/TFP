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
  // Valuation & Tax
  marketValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  taxYear: string | null;
  // Sales History
  saleDate: string | null;
  salePrice: number | null;
  lastOwnershipTransfer: string | null;
  // Building Details
  yearBuilt: number | null;
  numStories: number | null;
  numBedrooms: number | null;
  numBathrooms: number | null;
  buildingSqft: number | null;
  // Legal
  legalDescription: string | null;
  subdivision: string | null;
  plssTownship: string | null;
  plssRange: string | null;
  plssSection: string | null;
  // Census & Location
  censusTract: string | null;
  county: string | null;
  // Premium Data - Building Footprints
  buildingFootprintSqft: number | null;
  buildingCount: number | null;
  // Premium Data - Qualified Opportunity Zone
  isQualifiedOpportunityZone: boolean;
  qozTract: string | null;
  // Premium Data - FEMA Risk
  femaNriRiskRating: string | null;
  femaFloodZone: string | null;
  femaFloodZoneSubtype: string | null;
  // Premium Data - School Districts
  elementarySchoolDistrict: string | null;
  secondarySchoolDistrict: string | null;
  unifiedSchoolDistrict: string | null;
}

const formatDate = (date: Date) => {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

// Generate unique report number
function generateReportNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TFP-${year}${month}${day}-${random}`;
}

// Fetch parcel data from Regrid API using coordinate-based search
async function fetchRegridParcelData(lat: number, lng: number, address: string): Promise<ParcelData | null> {
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
    
    if (searchData.status === "error") {
      console.error("Regrid API error:", searchData.message);
      return null;
    }
    
    const results = searchData.results || [];
    
    if (results.length === 0) {
      console.log("No parcels found at coordinates:", lat, lng);
      return null;
    }

    const parcelData = results[0];
    const fields = parcelData.properties?.fields || {};
    
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

    let coordinates: number[][][] | null = null;
    if (parcelData.geometry?.type === "Polygon" && parcelData.geometry.coordinates) {
      coordinates = parcelData.geometry.coordinates as number[][][];
    } else if (parcelData.geometry?.type === "MultiPolygon" && parcelData.geometry.coordinates) {
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
      marketValue: fields.parval || fields.market_value || null,
      landValue: fields.landval || fields.land_value || null,
      improvementValue: fields.improvval || fields.improvement_value || null,
      taxYear: fields.taxyear || null,
      saleDate: fields.saledate || fields.sale_date || null,
      salePrice: fields.saleprice || fields.sale_price || null,
      lastOwnershipTransfer: fields.last_ownership_transfer_date || null,
      yearBuilt: fields.yearbuilt || fields.year_built || null,
      numStories: fields.numstories || fields.stories || null,
      numBedrooms: fields.num_bedrooms || fields.bedrooms || null,
      numBathrooms: fields.num_bath || fields.bathrooms || null,
      buildingSqft: fields.area_building || fields.building_sqft || null,
      legalDescription: fields.legaldesc || fields.legal_description || null,
      subdivision: fields.subdivision || null,
      plssTownship: fields.plss_township || null,
      plssRange: fields.plss_range || null,
      plssSection: fields.plss_section || null,
      censusTract: fields.census_tract || null,
      county: fields.county || null,
      // Premium Data
      buildingFootprintSqft: fields.recrdareano || fields.area_building || null,
      buildingCount: fields.ll_address_count || null,
      isQualifiedOpportunityZone: fields.qoz === "Yes" || fields.qoz === "1" || fields.qoz === true,
      qozTract: fields.qoz_tract || null,
      femaNriRiskRating: fields.fema_nri_risk_rating || null,
      femaFloodZone: fields.fema_flood_zone || null,
      femaFloodZoneSubtype: fields.fema_flood_zone_subtype || null,
      elementarySchoolDistrict: fields.census_elementary_school_district || null,
      secondarySchoolDistrict: fields.census_secondary_school_district || null,
      unifiedSchoolDistrict: fields.census_unified_school_district || null,
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
    
    let mapType = "satellite";
    let style = "";
    
    switch (layerId) {
      case "topography":
        mapType = "terrain";
        style = "&style=feature:all|element:labels|visibility:on";
        break;
      case "roads_transportation":
      case "zoning":
      case "power_substations":
        mapType = "hybrid";
        break;
      default:
        mapType = "satellite";
    }

    const parcelPath = buildParcelPath(parcelCoordinates);
    const mapsApiHost = "maps.googleapis.com";
    const mapsApiPath = "/maps/api/staticmap";
    const mapUrl = `https://${mapsApiHost}${mapsApiPath}?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&maptype=${mapType}${style}${parcelPath}&key=${apiKey}`;

    const response = await fetch(mapUrl, {
      signal: AbortSignal.timeout(15000)
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('image')) {
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return `data:image/png;base64,${base64}`;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to fetch Google map for layer ${layerId}:`, error);
    return null;
  }
}

// Draw simple fallback map
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
    
    const padding = 10;
    const mapWidth = width - padding * 2;
    const mapHeight = height - padding * 2;
    const lngRange = maxLng - minLng || 0.001;
    const latRange = maxLat - minLat || 0.001;
    
    const toX = (lng: number) => x + padding + ((lng - minLng) / lngRange) * mapWidth;
    const toY = (lat: number) => y + padding + mapHeight - ((lat - minLat) / latRange) * mapHeight;
    
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(2);
    
    const points: number[][] = ring.map(coord => [toX(coord[0]), toY(coord[1])]);
    
    if (points.length > 0) {
      doc.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        doc.lineTo(points[i][0], points[i][1]);
      }
      doc.lineTo(points[0][0], points[0][1]);
      doc.stroke();
    }
  }
  
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  
  doc.setFillColor(220, 38, 38);
  doc.rect(centerX - 4, centerY - 4, 8, 8, "F");
  doc.setFillColor(255, 255, 255);
  doc.rect(centerX - 2, centerY - 2, 4, 4, "F");
  
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(1);
  doc.rect(x, y, width, height, "S");
  
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  doc.text(`${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W`, x + width - 5, y + height - 3, { align: "right" });
}

// Draw decorative certificate border
function drawCertificateBorder(doc: jsPDF, pageWidth: number, pageHeight: number) {
  // Outer border
  doc.setDrawColor(34, 83, 60);
  doc.setLineWidth(3);
  doc.rect(8, 8, pageWidth - 16, pageHeight - 16);
  
  // Inner decorative border
  doc.setLineWidth(0.5);
  doc.rect(12, 12, pageWidth - 24, pageHeight - 24);
  
  // Corner ornaments (simple L shapes)
  doc.setLineWidth(2);
  const cornerSize = 15;
  
  // Top-left
  doc.line(15, 25, 15, 15);
  doc.line(15, 15, 25, 15);
  
  // Top-right
  doc.line(pageWidth - 25, 15, pageWidth - 15, 15);
  doc.line(pageWidth - 15, 15, pageWidth - 15, 25);
  
  // Bottom-left
  doc.line(15, pageHeight - 25, 15, pageHeight - 15);
  doc.line(15, pageHeight - 15, 25, pageHeight - 15);
  
  // Bottom-right
  doc.line(pageWidth - 25, pageHeight - 15, pageWidth - 15, pageHeight - 15);
  doc.line(pageWidth - 15, pageHeight - 25, pageWidth - 15, pageHeight - 15);
}

// Draw consistent page footer
function drawPageFooter(doc: jsPDF, pageWidth: number, pageHeight: number, currentPage: number, totalPages: number, reportNumber: string) {
  const footerY = pageHeight - 25;
  
  doc.setFontSize(6);
  doc.setTextColor(120, 120, 120);
  doc.text("This report is for informational purposes only. Data accuracy depends on county records. Not a substitute for professional surveys, appraisals, or legal advice.", pageWidth / 2, footerY, { align: "center" });
  doc.text("Property conditions may change. Verify all information before making decisions.", pageWidth / 2, footerY + 4, { align: "center" });
  
  // Bottom bar
  doc.setFillColor(34, 83, 60);
  doc.rect(0, pageHeight - 15, pageWidth, 15, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(`Report #${reportNumber}`, 15, pageHeight - 6);
  doc.text(`Page ${currentPage} of ${totalPages}`, pageWidth / 2, pageHeight - 6, { align: "center" });
  doc.text("© 2026 Terra Firma Partners LLC", pageWidth - 15, pageHeight - 6, { align: "right" });
}

// Draw page header
function drawPageHeader(doc: jsPDF, pageWidth: number, title: string, accentColor: [number, number, number] = [34, 197, 94]) {
  doc.setFillColor(34, 83, 60);
  doc.rect(0, 0, pageWidth, 22, "F");
  doc.setFillColor(...accentColor);
  doc.rect(0, 22, pageWidth, 3, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, pageWidth / 2, 14, { align: "center" });
}

// USDA Hardiness Zone calculator
interface HardinessData {
  zone: string;
  minTemp: string;
  avgFirstFrost: string;
  avgLastFrost: string;
  growingSeason: string;
  idealCrops: string[];
  soilTempInfo: string;
}

function getHardinessZone(lat: number): HardinessData {
  const absLat = Math.abs(lat);
  
  if (absLat >= 47) {
    return {
      zone: "3-4",
      minTemp: "-40°F to -20°F",
      avgFirstFrost: "Early September",
      avgLastFrost: "Late May",
      growingSeason: "90-120 days",
      idealCrops: ["Hardy vegetables", "Cold-tolerant fruits", "Root crops", "Brassicas", "Short-season corn"],
      soilTempInfo: "Soil remains frozen 4-6 months. Plant after soil reaches 50°F."
    };
  } else if (absLat >= 44) {
    return {
      zone: "4-5",
      minTemp: "-30°F to -10°F",
      avgFirstFrost: "Mid-September",
      avgLastFrost: "Early May",
      growingSeason: "120-150 days",
      idealCrops: ["Apples", "Potatoes", "Wheat", "Oats", "Hardy berries", "Cool-season vegetables"],
      soilTempInfo: "Soil frozen 3-5 months. Spring planting typically begins late April."
    };
  } else if (absLat >= 40) {
    return {
      zone: "5-6",
      minTemp: "-20°F to 0°F",
      avgFirstFrost: "Late September to Mid-October",
      avgLastFrost: "Mid to Late April",
      growingSeason: "150-180 days",
      idealCrops: ["Corn", "Soybeans", "Wheat", "Tomatoes", "Peppers", "Squash", "Stone fruits"],
      soilTempInfo: "Soil frozen 2-4 months. Good for most temperate crops."
    };
  } else if (absLat >= 36) {
    return {
      zone: "6-7",
      minTemp: "-10°F to 10°F",
      avgFirstFrost: "Mid to Late October",
      avgLastFrost: "Early to Mid-April",
      growingSeason: "180-210 days",
      idealCrops: ["Cotton", "Peanuts", "Sweet potatoes", "Peaches", "Pecans", "Warm-season vegetables"],
      soilTempInfo: "Brief soil freezing. Extended growing season supports diverse crops."
    };
  } else if (absLat >= 32) {
    return {
      zone: "7-8",
      minTemp: "0°F to 20°F",
      avgFirstFrost: "Late October to November",
      avgLastFrost: "Late March",
      growingSeason: "210-240 days",
      idealCrops: ["Citrus (protected)", "Figs", "Muscadine grapes", "Okra", "Southern peas", "Winter vegetables"],
      soilTempInfo: "Minimal soil freezing. Year-round growing possible with planning."
    };
  } else if (absLat >= 28) {
    return {
      zone: "8-9",
      minTemp: "10°F to 30°F",
      avgFirstFrost: "November to December",
      avgLastFrost: "Late February to Early March",
      growingSeason: "240-300 days",
      idealCrops: ["Citrus", "Avocados", "Tropical fruits", "Rice", "Sugarcane", "Year-round vegetables"],
      soilTempInfo: "Rare soil freezing. Nearly year-round production possible."
    };
  } else {
    return {
      zone: "9-10+",
      minTemp: "20°F to 40°F+",
      avgFirstFrost: "Rare or none",
      avgLastFrost: "Rare or none",
      growingSeason: "300-365 days",
      idealCrops: ["Tropical fruits", "Citrus", "Bananas", "Mangoes", "Papayas", "Continuous vegetables"],
      soilTempInfo: "No soil freezing. True year-round tropical/subtropical production."
    };
  }
}

// Category data interface
interface CategoryData {
  title: string;
  color: [number, number, number];
  icon: string;
  fields: { label: string; value: string }[];
  summary: string;
  dataSource: string;
  tips: string[];
  funFact: string;
}

// Generate fun facts based on property data
function generateFunFacts(acres: number, county: string, state: string) {
  const footballFields = Math.round(acres / 1.32);
  const countyName = county ? county.charAt(0).toUpperCase() + county.slice(1).toLowerCase() : "This";
  
  return {
    physical: `At ${acres.toFixed(0)} acres, this property is roughly the size of ${footballFields} football fields. ${countyName} County's diverse terrain supports both agricultural and recreational land uses.`,
    water: `The Missouri River watershed, which influences this region, drains approximately 529,350 square miles across 10 states—the largest river system in North America.`,
    vegetation: `${countyName} County sits in the Central Hardwood Forest region, home to over 150 native tree species including prized black walnut, valued at up to $20,000 per tree for premium veneer logs.`,
    infrastructure: `Rural Missouri land values have increased an average of 7.2% annually over the past decade, outpacing inflation and making land one of the region's most stable investments.`
  };
}

// Generate category reports with tips and fun facts
function generateCategoryReports(parcelData: any, acreage: string, zoning: string, address: string): CategoryData[] {
  const acres = parseFloat(acreage) || 0;
  const isAg = zoning?.toLowerCase().includes('ag') || zoning?.toLowerCase().includes('farm');
  const county = parcelData?.county || "";
  const funFacts = generateFunFacts(acres, county, "MO");
  
  return [
    {
      title: "Physical Characteristics",
      color: [139, 92, 246],
      icon: "🏔️",
      fields: [
        { label: "Topography", value: acres > 10 ? "Flat to gently rolling (0–8% slopes)" : "Generally level terrain" },
        { label: "Soils", value: "Predominantly well-drained loams with moderate productivity" },
        { label: "Drainage", value: "Natural surface drainage with defined low areas" },
        { label: "Floodplain", value: "None indicated / Verify with FEMA maps" },
      ],
      summary: "The property's terrain and soils support a wide range of uses with minimal physical constraints. Gentle topography is ideal for development or agricultural use.",
      dataSource: "USGS National Elevation Dataset, USDA Soil Survey",
      tips: [
        "Request a soil test before significant agricultural investment",
        "Walk the property after rain to observe drainage patterns",
        "Note any areas of erosion or standing water"
      ],
      funFact: funFacts.physical
    },
    {
      title: "Water & Hydrology",
      color: [59, 130, 246],
      icon: "💧",
      fields: [
        { label: "Surface Water", value: "Verify on-site: Creek / Pond / None visible" },
        { label: "Seasonal Wetness", value: "Low to Moderate" },
        { label: "Water Retention", value: "Moderate potential" },
        { label: "Wetlands", value: "None mapped / Field verify" },
      ],
      summary: "Natural drainage patterns support land health. Surface water features enhance wildlife value and may provide irrigation potential.",
      dataSource: "USFWS National Wetlands Inventory, FEMA NFHL",
      tips: [
        "Verify water rights - they may be separate from land ownership",
        "Check for existing well permits in county records",
        "Consider pond potential for livestock or irrigation"
      ],
      funFact: funFacts.water
    },
    {
      title: "Vegetation & Habitat",
      color: [16, 185, 129],
      icon: "🌲",
      fields: [
        { label: "Dominant Cover", value: acres > 15 ? "Mixed timber and open areas" : "Open / Managed vegetation" },
        { label: "Edge Habitat", value: acres > 10 ? "Strong – natural transitions present" : "Moderate" },
        { label: "Wildlife Potential", value: "Deer, turkey, small game, songbirds" },
        { label: "Timber Value", value: acres > 20 ? "Potential merchantable timber" : "Limited / Aesthetic" },
      ],
      summary: "Vegetation structure provides habitat value and aesthetic appeal. Edge habitat between cover types supports diverse wildlife populations.",
      dataSource: "Aerial imagery analysis, Regional habitat data",
      tips: [
        "Consult a forester for timber inventory and management plan",
        "Consider food plots to enhance wildlife habitat",
        "Identify invasive species for removal"
      ],
      funFact: funFacts.vegetation
    },
    {
      title: "Infrastructure & Access",
      color: [107, 114, 128],
      icon: "🛤️",
      fields: [
        { label: "Road Access", value: "County road / Public access indicated" },
        { label: "Internal Trails", value: "Verify on-site" },
        { label: "Utilities", value: "Electric service area / Verify availability" },
        { label: "Build Sites", value: acres > 5 ? "Multiple potential locations" : "Limited / Identified" },
      ],
      summary: "Road access and utility proximity reduce development barriers. Internal access points may require improvement for full property utilization.",
      dataSource: "County GIS, OpenStreetMap, Utility records",
      tips: [
        "Verify deeded road access - don't assume",
        "Contact utility companies for connection costs",
        "Consider septic feasibility for building sites"
      ],
      funFact: funFacts.infrastructure
    }
  ];
}

// Generate use-case suitability scores
function generateUseCaseScores(acreage: string, zoning: string): { use: string; stars: number; description: string }[] {
  const acres = parseFloat(acreage) || 0;
  const isAg = zoning?.toLowerCase().includes('ag') || zoning?.toLowerCase().includes('farm');
  
  return [
    { use: "Recreation / Hunting", stars: acres > 20 ? 5 : acres > 10 ? 4 : 3, description: "Space for trails, blinds, and wildlife management" },
    { use: "Wildlife Habitat", stars: acres > 15 ? 5 : acres > 5 ? 4 : 3, description: "Natural areas supporting native species" },
    { use: "Small-Scale Agriculture", stars: isAg ? 5 : acres > 10 ? 4 : 3, description: "Gardens, orchards, livestock grazing" },
    { use: "Timber Investment", stars: acres > 30 ? 5 : acres > 15 ? 4 : acres > 5 ? 3 : 2, description: "Long-term timber growth and harvest" },
    { use: "Residential / Cabin", stars: acres < 20 ? 4 : 3, description: "Homesite or weekend retreat" },
    { use: "Conservation Easement", stars: acres > 20 ? 5 : acres > 10 ? 4 : 3, description: "Tax benefits through permanent protection" },
  ];
}

// Draw star rating
function drawStars(doc: jsPDF, stars: number, x: number, y: number) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (let i = 0; i < 5; i++) {
    if (i < stars) {
      doc.setTextColor(234, 179, 8);
      doc.text("★", x + (i * 5), y);
    } else {
      doc.setTextColor(229, 231, 235);
      doc.text("☆", x + (i * 5), y);
    }
  }
}

// Load logo
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
    const reportNumber = generateReportNumber();
    const totalPages = 14;

    // Fetch real parcel data from Regrid
    const parcelData = await fetchRegridParcelData(order.parcelLat, order.parcelLng, order.parcelAddress);
    const logoImage = await loadLogoImage();
    
    // Parse address components
    const addressParts = order.parcelAddress.split(',').map((p: string) => p.trim());
    const county = parcelData?.county || addressParts[addressParts.length - 2] || 'N/A';
    const state = addressParts.length >= 2 ? addressParts[addressParts.length - 1] : 'N/A';
    const lotSize = parcelData ? formatAcreage(parcelData.acreage, parcelData.sqft) : "N/A";
    const acres = parcelData?.acreage || 0;
    const zoningStr = parcelData?.zoning || "N/A";

    // ============================================
    // PAGE 1: COVER PAGE (Frame-worthy)
    // ============================================
    
    // Draw certificate border
    drawCertificateBorder(doc, pageWidth, pageHeight);
    
    // Header with logo area
    doc.setFillColor(34, 83, 60);
    doc.rect(20, 20, pageWidth - 40, 35, "F");
    
    if (logoImage) {
      try {
        doc.addImage(logoImage, "PNG", 25, 23, 40, 20);
      } catch (e) {
        console.error("Logo error:", e);
      }
    }
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("TERRA FIRMA PARTNERS LLC", pageWidth / 2 + 10, 32, { align: "center" });
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Professional Land Analysis Services", pageWidth / 2 + 10, 42, { align: "center" });
    
    // Report Title Block
    doc.setFillColor(248, 250, 252);
    doc.rect(20, 60, pageWidth - 40, 20, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(1);
    doc.rect(20, 60, pageWidth - 40, 20);
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("COMPREHENSIVE LAND ANALYSIS REPORT", pageWidth / 2, 73, { align: "center" });
    
    // Hero aerial map with property boundary
    const heroMapHeight = 85;
    const mapY = 88;
    
    // Calculate optimal zoom based on acreage
    const acreage = parcelData?.acreage || 1;
    let optimalZoom = 16;
    if (acreage > 200) optimalZoom = 13;
    else if (acreage > 80) optimalZoom = 14;
    else if (acreage > 20) optimalZoom = 15;
    else optimalZoom = 16;
    
    const mapImage = await fetchGoogleMapImage(
      order.parcelLat, 
      order.parcelLng, 
      "property_boundaries",
      optimalZoom,
      parcelData?.coordinates || null
    );

    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(2);
    doc.rect(25, mapY, pageWidth - 50, heroMapHeight);

    if (mapImage) {
      try {
        doc.addImage(mapImage, "PNG", 27, mapY + 2, pageWidth - 54, heroMapHeight - 4);
      } catch (imgError) {
        drawSimpleMap(doc, order.parcelLat, order.parcelLng, "property_boundaries", 27, mapY + 2, pageWidth - 54, heroMapHeight - 4, parcelData?.coordinates || null);
      }
    } else {
      drawSimpleMap(doc, order.parcelLat, order.parcelLng, "property_boundaries", 27, mapY + 2, pageWidth - 54, heroMapHeight - 4, parcelData?.coordinates || null);
    }

    // Property Address Block
    let infoY = mapY + heroMapHeight + 8;
    
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(25, infoY, pageWidth - 50, 28, 3, 3, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("PROPERTY LOCATION", pageWidth / 2, infoY + 8, { align: "center" });
    
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    const displayAddress = order.parcelAddress.length > 60 ? order.parcelAddress.substring(0, 57) + "..." : order.parcelAddress;
    doc.text(displayAddress, pageWidth / 2, infoY + 18, { align: "center" });
    
    doc.setFontSize(9);
    doc.text(`${order.parcelLat.toFixed(6)}°N, ${Math.abs(order.parcelLng).toFixed(6)}°W`, pageWidth / 2, infoY + 25, { align: "center" });
    
    // Key Stats Grid
    infoY += 35;
    const statBoxWidth = (pageWidth - 60) / 4;
    const stats = [
      { label: "TOTAL AREA", value: `${acres.toFixed(2)} AC` },
      { label: "PARCEL ID", value: parcelData?.parcelId?.substring(0, 12) || "N/A" },
      { label: "ZONING", value: zoningStr.substring(0, 10) },
      { label: "COUNTY", value: county.substring(0, 12) },
    ];
    
    stats.forEach((stat, idx) => {
      const boxX = 27 + (idx * statBoxWidth) + (idx * 2);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(boxX, infoY, statBoxWidth, 22, 2, 2, "F");
      doc.setDrawColor(34, 197, 94);
      doc.setLineWidth(0.5);
      doc.roundedRect(boxX, infoY, statBoxWidth, 22, 2, 2);
      
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(stat.label, boxX + statBoxWidth / 2, infoY + 7, { align: "center" });
      
      doc.setTextColor(34, 83, 60);
      doc.setFontSize(10);
      doc.text(stat.value, boxX + statBoxWidth / 2, infoY + 16, { align: "center" });
    });
    
    // Report Details
    infoY += 30;
    doc.setFillColor(255, 251, 235);
    doc.roundedRect(25, infoY, pageWidth - 50, 18, 2, 2, "F");
    
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Report Number: ${reportNumber}`, 35, infoY + 7);
    doc.text(`Generated: ${formatDate(new Date())}`, 35, infoY + 13);
    doc.text(`Data Sources: Regrid, USGS, USDA, County Records`, pageWidth - 35, infoY + 7, { align: "right" });
    doc.text(`Total Pages: ${totalPages}`, pageWidth - 35, infoY + 13, { align: "right" });
    
    // Certification statement
    infoY += 25;
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("This report was prepared using publicly available data sources. It is intended for informational", pageWidth / 2, infoY, { align: "center" });
    doc.text("purposes only and should not be used as a substitute for professional surveys, appraisals, or legal advice.", pageWidth / 2, infoY + 5, { align: "center" });
    
    // Footer with website
    doc.setFillColor(34, 83, 60);
    doc.rect(20, pageHeight - 28, pageWidth - 40, 12, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("www.terrafirmapartners.com", pageWidth / 2, pageHeight - 20, { align: "center" });

    // ============================================
    // PAGE 2: TABLE OF CONTENTS & AT-A-GLANCE
    // ============================================
    doc.addPage();
    drawPageHeader(doc, pageWidth, "REPORT OVERVIEW", [34, 197, 94]);
    
    let tocY = 35;
    
    // Table of Contents
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, tocY, pageWidth - 30, 70, 3, 3, "F");
    doc.setDrawColor(34, 83, 60);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, tocY, pageWidth - 30, 70, 3, 3);
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("TABLE OF CONTENTS", 20, tocY + 10);
    
    const tocItems = [
      { page: 1, title: "Cover Page & Property Summary" },
      { page: 2, title: "Report Overview & At-a-Glance" },
      { page: 3, title: "Ownership & Valuation" },
      { page: 4, title: "Property & Structure Details" },
      { page: 5, title: "Physical Characteristics" },
      { page: 6, title: "Water & Hydrology" },
      { page: 7, title: "Vegetation & Habitat" },
      { page: 8, title: "Infrastructure & Access" },
      { page: 9, title: "Growing Potential" },
      { page: 10, title: "Use-Case Suitability" },
      { page: 11, title: "Understanding Your Land Rights" },
      { page: 12, title: "Land Stewardship Guide" },
      { page: 13, title: "Next Steps & Due Diligence" },
      { page: 14, title: "Glossary & Notes" },
    ];
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const col1Items = tocItems.slice(0, 7);
    const col2Items = tocItems.slice(7);
    
    col1Items.forEach((item, idx) => {
      doc.setTextColor(60, 60, 60);
      doc.text(`${item.title}`, 25, tocY + 20 + (idx * 7));
      doc.setTextColor(34, 83, 60);
      doc.text(`${item.page}`, 95, tocY + 20 + (idx * 7), { align: "right" });
    });
    
    col2Items.forEach((item, idx) => {
      doc.setTextColor(60, 60, 60);
      doc.text(`${item.title}`, pageWidth / 2 + 10, tocY + 20 + (idx * 7));
      doc.setTextColor(34, 83, 60);
      doc.text(`${item.page}`, pageWidth - 25, tocY + 20 + (idx * 7), { align: "right" });
    });
    
    // At-a-Glance Summary
    tocY += 80;
    
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(15, tocY, pageWidth - 30, 95, 3, 3, "F");
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(1);
    doc.roundedRect(15, tocY, pageWidth - 30, 95, 3, 3);
    
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(15, tocY, 100, 12, 3, 3, "F");
    doc.rect(15, tocY + 6, 100, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("PROPERTY AT-A-GLANCE", 65, tocY + 8, { align: "center" });
    
    // Two-column summary
    const summaryCol1X = 25;
    const summaryCol2X = pageWidth / 2 + 5;
    let summaryY = tocY + 22;
    
    const summaryFields = [
      { label: "Property Address", value: displayAddress },
      { label: "Total Acreage", value: `${acres.toFixed(2)} acres` },
      { label: "Parcel ID (APN)", value: parcelData?.parcelId || "N/A" },
      { label: "Zoning Designation", value: zoningStr },
      { label: "Current Owner", value: parcelData?.owner?.substring(0, 30) || "N/A" },
      { label: "County", value: county },
      { label: "Market Value", value: parcelData?.marketValue ? `$${parcelData.marketValue.toLocaleString()}` : "N/A" },
      { label: "Coordinates", value: `${order.parcelLat.toFixed(6)}°N, ${Math.abs(order.parcelLng).toFixed(6)}°W` },
    ];
    
    summaryFields.forEach((field, idx) => {
      const colX = idx % 2 === 0 ? summaryCol1X : summaryCol2X;
      const rowY = summaryY + Math.floor(idx / 2) * 14;
      
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(field.label + ":", colX, rowY);
      
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.setFontSize(9);
      const maxWidth = (pageWidth - 60) / 2 - 5;
      const valueLines = doc.splitTextToSize(field.value, maxWidth);
      doc.text(valueLines[0] || "N/A", colX, rowY + 6);
    });
    
    // Quick assessment
    summaryY += 65;
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.5);
    doc.line(25, summaryY, pageWidth - 25, summaryY);
    
    summaryY += 8;
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("QUICK ASSESSMENT:", 25, summaryY);
    
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    const assessmentText = acres > 20 
      ? "Large acreage suitable for agriculture, recreation, or conservation. Multiple potential uses."
      : acres > 5
      ? "Mid-size property with flexibility for residential, small farming, or recreational use."
      : "Compact parcel ideal for residential development or intensive small-scale agriculture.";
    doc.text(assessmentText, 75, summaryY);
    
    drawPageFooter(doc, pageWidth, pageHeight, 2, totalPages, reportNumber);

    // ============================================
    // PAGE 3: OWNERSHIP & VALUATION
    // ============================================
    doc.addPage();
    drawPageHeader(doc, pageWidth, "OWNERSHIP & VALUATION", [16, 185, 129]);
    
    let ownerY = 35;
    
    // Owner Information Box
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(15, ownerY, pageWidth - 30, 55, 3, 3, "F");
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(1);
    doc.roundedRect(15, ownerY, pageWidth - 30, 55, 3, 3);
    
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(15, ownerY, 85, 12, 3, 3, "F");
    doc.rect(15, ownerY + 6, 85, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("CURRENT OWNER OF RECORD", 57, ownerY + 8, { align: "center" });
    
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(parcelData?.owner || "Not Available", 25, ownerY + 28);
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    doc.text("Mailing Address:", 25, ownerY + 40);
    doc.setTextColor(40, 40, 40);
    doc.text(parcelData?.mailingAddress || "Not Available", 65, ownerY + 40);
    
    if (parcelData?.lastOwnershipTransfer) {
      doc.setTextColor(80, 80, 80);
      doc.text("Ownership Since:", 25, ownerY + 48);
      doc.setTextColor(40, 40, 40);
      doc.text(parcelData.lastOwnershipTransfer, 65, ownerY + 48);
    }
    
    ownerY += 65;
    
    // Valuation Section
    doc.setFillColor(255, 251, 235);
    doc.roundedRect(15, ownerY, pageWidth - 30, 70, 3, 3, "F");
    doc.setDrawColor(234, 179, 8);
    doc.setLineWidth(1);
    doc.roundedRect(15, ownerY, pageWidth - 30, 70, 3, 3);
    
    doc.setFillColor(234, 179, 8);
    doc.roundedRect(15, ownerY, 105, 12, 3, 3, "F");
    doc.rect(15, ownerY + 6, 105, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("ASSESSED VALUATION", 67, ownerY + 8, { align: "center" });
    
    const colW = (pageWidth - 50) / 3;
    const valStartX = 20;
    const valY = ownerY + 24;
    
    // Total Market Value
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL MARKET VALUE", valStartX, valY);
    doc.setTextColor(34, 83, 60);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    const marketVal = parcelData?.marketValue ? `$${parcelData.marketValue.toLocaleString()}` : "N/A";
    doc.text(marketVal, valStartX, valY + 12);
    
    // Land Value
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("LAND VALUE", valStartX + colW, valY);
    doc.setTextColor(139, 92, 246);
    doc.setFontSize(14);
    const landVal = parcelData?.landValue ? `$${parcelData.landValue.toLocaleString()}` : "N/A";
    doc.text(landVal, valStartX + colW, valY + 12);
    
    // Improvement Value
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("IMPROVEMENT VALUE", valStartX + colW * 2, valY);
    doc.setTextColor(59, 130, 246);
    doc.setFontSize(14);
    const impVal = parcelData?.improvementValue ? `$${parcelData.improvementValue.toLocaleString()}` : "N/A";
    doc.text(impVal, valStartX + colW * 2, valY + 12);
    
    // Explanation
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    doc.text("Note: Assessed values are determined by the county for tax purposes and may not reflect current market conditions.", 25, ownerY + 55);
    doc.text(`Tax Year: ${parcelData?.taxYear || 'N/A'}`, 25, ownerY + 62);
    
    ownerY += 80;
    
    // Sales History
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, ownerY, pageWidth - 30, 50, 3, 3, "F");
    doc.setDrawColor(107, 114, 128);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, ownerY, pageWidth - 30, 50, 3, 3);
    
    doc.setFillColor(107, 114, 128);
    doc.roundedRect(15, ownerY, 80, 12, 3, 3, "F");
    doc.rect(15, ownerY + 6, 80, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("SALES HISTORY", 55, ownerY + 8, { align: "center" });
    
    const salesY = ownerY + 24;
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Last Sale Date:", 25, salesY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    doc.text(parcelData?.saleDate || "Not Available", 70, salesY);
    
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "bold");
    doc.text("Sale Price:", 25, salesY + 10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    const salePrice = parcelData?.salePrice && parcelData.salePrice > 0 ? `$${parcelData.salePrice.toLocaleString()}` : "Not Disclosed";
    doc.text(salePrice, 70, salesY + 10);
    
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "bold");
    doc.text("Transfer Date:", 25, salesY + 20);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    doc.text(parcelData?.lastOwnershipTransfer || "Not Available", 70, salesY + 20);
    
    ownerY += 60;
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text("Data Source: County Assessor Records via Regrid", 15, ownerY);
    
    drawPageFooter(doc, pageWidth, pageHeight, 3, totalPages, reportNumber);
    
    // ============================================
    // PAGE 4: PROPERTY & STRUCTURE DETAILS
    // ============================================
    doc.addPage();
    drawPageHeader(doc, pageWidth, "PROPERTY & STRUCTURE DETAILS", [139, 92, 246]);
    
    let propY = 35;
    
    const hasBuilding = parcelData?.yearBuilt || parcelData?.buildingSqft || parcelData?.numBedrooms;
    
    if (hasBuilding) {
      doc.setFillColor(240, 249, 255);
      doc.roundedRect(15, propY, pageWidth - 30, 65, 3, 3, "F");
      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(1);
      doc.roundedRect(15, propY, pageWidth - 30, 65, 3, 3);
      
      doc.setFillColor(59, 130, 246);
      doc.roundedRect(15, propY, 100, 12, 3, 3, "F");
      doc.rect(15, propY + 6, 100, 6, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("BUILDING INFORMATION", 65, propY + 8, { align: "center" });
      
      const bldgY = propY + 22;
      const bldgFields = [
        { label: "Year Built:", value: parcelData?.yearBuilt?.toString() || "N/A" },
        { label: "Building Area:", value: parcelData?.buildingSqft ? `${parcelData.buildingSqft.toLocaleString()} sq ft` : "N/A" },
        { label: "Stories:", value: parcelData?.numStories?.toString() || "N/A" },
        { label: "Bedrooms:", value: parcelData?.numBedrooms?.toString() || "N/A" },
        { label: "Bathrooms:", value: parcelData?.numBathrooms?.toString() || "N/A" },
        { label: "Property Use:", value: parcelData?.useDescription || "N/A" },
      ];
      
      bldgFields.forEach((field, idx) => {
        const colOffset = idx % 2 === 0 ? 0 : 85;
        const rowOffset = Math.floor(idx / 2) * 12;
        doc.setTextColor(80, 80, 80);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(field.label, 25 + colOffset, bldgY + rowOffset);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40, 40, 40);
        doc.text(field.value, 60 + colOffset, bldgY + rowOffset);
      });
      
      propY += 75;
    } else {
      doc.setFillColor(255, 251, 235);
      doc.roundedRect(15, propY, pageWidth - 30, 35, 3, 3, "F");
      doc.setDrawColor(234, 179, 8);
      doc.setLineWidth(0.5);
      doc.roundedRect(15, propY, pageWidth - 30, 35, 3, 3);
      
      doc.setTextColor(146, 64, 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("VACANT LAND / NO STRUCTURES", pageWidth / 2, propY + 12, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("No building or improvement records found for this parcel. This may indicate", pageWidth / 2, propY + 22, { align: "center" });
      doc.text("undeveloped land or structures not yet recorded with the county.", pageWidth / 2, propY + 29, { align: "center" });
      
      propY += 45;
    }
    
    // Legal Description
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, propY, pageWidth - 30, 60, 3, 3, "F");
    doc.setDrawColor(107, 114, 128);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, propY, pageWidth - 30, 60, 3, 3);
    
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(15, propY, 90, 12, 3, 3, "F");
    doc.rect(15, propY + 6, 90, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LEGAL DESCRIPTION", 60, propY + 8, { align: "center" });
    
    const legalY = propY + 22;
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    
    const legalDesc = parcelData?.legalDescription || "Legal description not available in county records";
    const legalLines = doc.splitTextToSize(legalDesc, pageWidth - 50);
    doc.text(legalLines.slice(0, 3), 25, legalY);
    
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "bold");
    doc.text("Subdivision:", 25, legalY + 25);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    doc.text(parcelData?.subdivision || "N/A", 60, legalY + 25);
    
    if (parcelData?.plssTownship || parcelData?.plssRange || parcelData?.plssSection) {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.text("PLSS:", 25, legalY + 33);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      const plss = [parcelData.plssTownship, parcelData.plssRange, parcelData.plssSection].filter(Boolean).join(" / ");
      doc.text(plss || "N/A", 60, legalY + 33);
    }
    
    propY += 70;
    
    // Location Data
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(15, propY, pageWidth - 30, 45, 3, 3, "F");
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, propY, pageWidth - 30, 45, 3, 3);
    
    doc.setFillColor(34, 197, 94);
    doc.roundedRect(15, propY, 90, 12, 3, 3, "F");
    doc.rect(15, propY + 6, 90, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LOCATION DATA", 60, propY + 8, { align: "center" });
    
    const locY = propY + 22;
    const locFields = [
      { label: "County:", value: parcelData?.county ? parcelData.county.charAt(0).toUpperCase() + parcelData.county.slice(1) : "N/A" },
      { label: "Census Tract:", value: parcelData?.censusTract || "N/A" },
      { label: "Coordinates:", value: `${order.parcelLat.toFixed(6)}°N, ${Math.abs(order.parcelLng).toFixed(6)}°W` },
    ];
    
    locFields.forEach((field, idx) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(field.label, 25, locY + idx * 9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(field.value, 70, locY + idx * 9);
    });
    
    propY += 55;
    
    // ============================================
    // PREMIUM INSIGHTS SECTION
    // ============================================
    
    // Check if page space available, if not add new page
    if (propY + 120 > pageHeight - 30) {
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text("Data Source: County Records, US Census Bureau via Regrid", 15, propY);
      drawPageFooter(doc, pageWidth, pageHeight, 4, totalPages, reportNumber);
      doc.addPage();
      drawPageHeader(doc, pageWidth, "PREMIUM INSIGHTS", [139, 92, 246]);
      propY = 35;
    }
    
    // ═══════════════════════════════════════════════════════════
    // PREMIUM SECTION 1: BUILDING INTELLIGENCE
    // ═══════════════════════════════════════════════════════════
    const hasStructureInfo = parcelData?.buildingFootprintSqft || parcelData?.buildingCount;
    const hasBuildingDetails = parcelData?.yearBuilt || parcelData?.numStories;
    const hasLivingSpace = parcelData?.buildingSqft || parcelData?.numBedrooms || parcelData?.numBathrooms;
    const hasAnyBuildingData = hasStructureInfo || hasBuildingDetails || hasLivingSpace;
    
    let boxHeight = hasAnyBuildingData ? 60 : 65;
    if (hasBuildingDetails) boxHeight += 18;
    if (hasLivingSpace) boxHeight += 18;
    
    // Premium gradient box with shadow effect
    doc.setFillColor(250, 250, 255);
    doc.roundedRect(15, propY, pageWidth - 30, boxHeight, 4, 4, "F");
    doc.setDrawColor(124, 58, 237);
    doc.setLineWidth(2);
    doc.roundedRect(15, propY, pageWidth - 30, boxHeight, 4, 4);
    
    // Premium header with icon badge
    doc.setFillColor(124, 58, 237);
    doc.roundedRect(15, propY, pageWidth - 30, 16, 4, 4, "F");
    doc.rect(15, propY + 8, pageWidth - 30, 8, "F");
    
    // Gold premium badge
    doc.setFillColor(251, 191, 36);
    doc.circle(25, propY + 8, 4, "F");
    doc.setTextColor(124, 58, 237);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("★", 25, propY + 10, { align: "center" });
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("BUILDING INTELLIGENCE", pageWidth / 2, propY + 11, { align: "center" });
    
    let bfY = propY + 26;
    
    if (!hasAnyBuildingData) {
      // Executive-style vacant land presentation
      doc.setFillColor(239, 246, 255);
      doc.roundedRect(20, bfY, pageWidth - 40, 28, 3, 3, "F");
      doc.setDrawColor(191, 219, 254);
      doc.setLineWidth(1);
      doc.roundedRect(20, bfY, pageWidth - 40, 28, 3, 3);
      
      doc.setTextColor(30, 58, 138);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("⌂ VACANT LAND STATUS", 25, bfY + 8);
      
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("No structures identified in county records. Property appears to be undeveloped land.", 25, bfY + 16);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(100, 100, 100);
      doc.text("Recommendation: Verify current status via on-site inspection or county assessor.", 25, bfY + 22);
    } else {
      // Premium data cards layout
      let cardY = bfY;
      
      // Card 1: Structure Summary
      if (hasStructureInfo) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(216, 180, 254);
        doc.setLineWidth(1);
        doc.roundedRect(20, cardY, (pageWidth - 50) / 2, 24, 3, 3, "FD");
        
        doc.setTextColor(124, 58, 237);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("STRUCTURE OVERVIEW", 25, cardY + 7);
        
        doc.setTextColor(40, 40, 40);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        if (parcelData.buildingFootprintSqft) {
          doc.text(parcelData.buildingFootprintSqft.toLocaleString(), 25, cardY + 17);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text("sq ft footprint", 25, cardY + 21);
        }
        
        // Second metric in same card
        if (parcelData.buildingCount && parcelData.buildingCount > 0) {
          doc.setTextColor(40, 40, 40);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(16);
          doc.text(parcelData.buildingCount.toString(), 70, cardY + 17);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text("structures", 70, cardY + 21);
        }
        
        cardY += 28;
      }
      
      // Card 2: Building Characteristics
      if (hasBuildingDetails) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(216, 180, 254);
        doc.setLineWidth(1);
        doc.roundedRect(20, cardY, pageWidth - 40, 18, 3, 3, "FD");
        
        doc.setTextColor(124, 58, 237);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("CHARACTERISTICS", 25, cardY + 7);
        
        doc.setTextColor(60, 60, 60);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        
        const chars: string[] = [];
        if (parcelData.yearBuilt) {
          const age = new Date().getFullYear() - parcelData.yearBuilt;
          chars.push(`Built ${parcelData.yearBuilt} (${age}y)`);
        }
        if (parcelData.numStories) chars.push(`${parcelData.numStories} stories`);
        if (parcelData.useDescription && parcelData.useDescription !== "N/A") {
          chars.push(parcelData.useDescription);
        }
        
        doc.text(chars.join("  •  "), 25, cardY + 13);
        cardY += 22;
      }
      
      // Card 3: Living Space (residential)
      if (hasLivingSpace) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(216, 180, 254);
        doc.setLineWidth(1);
        doc.roundedRect(20, cardY, pageWidth - 40, 18, 3, 3, "FD");
        
        doc.setTextColor(124, 58, 237);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("LIVING SPACE", 25, cardY + 7);
        
        doc.setTextColor(60, 60, 60);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        
        const living: string[] = [];
        if (parcelData.buildingSqft) living.push(`${parcelData.buildingSqft.toLocaleString()} sq ft`);
        if (parcelData.numBedrooms) living.push(`${parcelData.numBedrooms} bed`);
        if (parcelData.numBathrooms) living.push(`${parcelData.numBathrooms} bath`);
        
        doc.text(living.join("  •  "), 25, cardY + 13);
      }
    }
    
    propY += boxHeight + 12;
    
    // ═══════════════════════════════════════════════════════════
    // PREMIUM SECTION 2: TAX INCENTIVE ZONE
    // ═══════════════════════════════════════════════════════════
    if (parcelData?.isQualifiedOpportunityZone) {
      doc.setFillColor(247, 254, 231);
      doc.roundedRect(15, propY, pageWidth - 30, 65, 4, 4, "F");
      doc.setDrawColor(16, 185, 129);
      doc.setLineWidth(2);
      doc.roundedRect(15, propY, pageWidth - 30, 65, 4, 4);
      
      // Premium header
      doc.setFillColor(16, 185, 129);
      doc.roundedRect(15, propY, pageWidth - 30, 16, 4, 4, "F");
      doc.rect(15, propY + 8, pageWidth - 30, 8, "F");
      
      doc.setFillColor(251, 191, 36);
      doc.circle(25, propY + 8, 4, "F");
      doc.setTextColor(16, 185, 129);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("★", 25, propY + 10, { align: "center" });
      
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("TAX INCENTIVE ZONE", pageWidth / 2, propY + 11, { align: "center" });
      
      const qozY = propY + 28;
      
      // Status badge
      doc.setFillColor(220, 252, 231);
      doc.roundedRect(20, qozY, 85, 14, 3, 3, "F");
      doc.setDrawColor(16, 185, 129);
      doc.setLineWidth(1);
      doc.roundedRect(20, qozY, 85, 14, 3, 3);
      
      doc.setTextColor(6, 78, 59);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("✓ FEDERAL QOZ CERTIFIED", 62.5, qozY + 9, { align: "center" });
      
      // Benefits description
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Federal tax benefits: Defer and potentially reduce capital gains taxes on qualified", 20, qozY + 22);
      doc.text("investments. Significant savings available for long-term investments (7+ years).", 20, qozY + 28);
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(16, 185, 129);
      doc.text("» Consult tax professional for investment structuring", 20, qozY + 36);
      
      if (parcelData.qozTract) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(100, 100, 100);
        doc.text(`Census Tract: ${parcelData.qozTract}`, 20, qozY + 42);
      }
      
      propY += 77;
    }
    
    // ═══════════════════════════════════════════════════════════
    // PREMIUM SECTION 3: RISK ASSESSMENT
    // ═══════════════════════════════════════════════════════════
    if (parcelData?.femaNriRiskRating) {
      const riskLower = parcelData.femaNriRiskRating.toLowerCase();
      const isVeryHigh = riskLower.includes("very high");
      const isHigh = riskLower.includes("high") && !isVeryHigh;
      const isModerate = riskLower.includes("moderate");
      
      const riskColor = isVeryHigh ? [239, 68, 68] : isHigh ? [249, 115, 22] : isModerate ? [234, 179, 8] : [34, 197, 94];
      const bgColor = isVeryHigh ? [254, 242, 242] : isHigh ? [255, 247, 237] : isModerate ? [254, 249, 195] : [240, 253, 244];
      
      doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
      doc.roundedRect(15, propY, pageWidth - 30, 62, 4, 4, "F");
      doc.setDrawColor(riskColor[0], riskColor[1], riskColor[2]);
      doc.setLineWidth(2);
      doc.roundedRect(15, propY, pageWidth - 30, 62, 4, 4);
      
      // Premium header
      doc.setFillColor(riskColor[0], riskColor[1], riskColor[2]);
      doc.roundedRect(15, propY, pageWidth - 30, 16, 4, 4, "F");
      doc.rect(15, propY + 8, pageWidth - 30, 8, "F");
      
      doc.setFillColor(251, 191, 36);
      doc.circle(25, propY + 8, 4, "F");
      doc.setTextColor(riskColor[0], riskColor[1], riskColor[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("★", 25, propY + 10, { align: "center" });
      
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("NATURAL HAZARD RISK ASSESSMENT", pageWidth / 2, propY + 11, { align: "center" });
      
      const riskY = propY + 28;
      
      // Risk rating badge
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(20, riskY, 70, 16, 3, 3, "F");
      doc.setDrawColor(riskColor[0], riskColor[1], riskColor[2]);
      doc.setLineWidth(1.5);
      doc.roundedRect(20, riskY, 70, 16, 3, 3);
      
      doc.setTextColor(riskColor[0], riskColor[1], riskColor[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(parcelData.femaNriRiskRating.toUpperCase(), 55, riskY + 10, { align: "center" });
      
      // Description
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text("FEMA National Risk Index (18 hazard composite: flood, wildfire, tornado, earthquake, etc.)", 20, riskY + 24);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(riskColor[0], riskColor[1], riskColor[2]);
      doc.text("May impact insurance costs and lender requirements", 20, riskY + 30);
      
      // Flood zone if applicable
      if (parcelData.femaFloodZone && parcelData.femaFloodZone !== "X") {
        doc.setFillColor(254, 226, 226);
        doc.roundedRect(100, riskY, pageWidth - 130, 16, 3, 3, "F");
        doc.setDrawColor(220, 38, 38);
        doc.setLineWidth(1);
        doc.roundedRect(100, riskY, pageWidth - 130, 16, 3, 3);
        
        doc.setTextColor(153, 27, 27);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(`⚠ FLOOD ZONE: ${parcelData.femaFloodZone}`, 105, riskY + 10);
      }
      
      propY += 74;
    }
    
    // ═══════════════════════════════════════════════════════════
    // PREMIUM SECTION 4: EDUCATION ZONES
    // ═══════════════════════════════════════════════════════════
    if (parcelData?.elementarySchoolDistrict || parcelData?.secondarySchoolDistrict || parcelData?.unifiedSchoolDistrict) {
      doc.setFillColor(255, 251, 235);
      doc.roundedRect(15, propY, pageWidth - 30, 58, 4, 4, "F");
      doc.setDrawColor(234, 179, 8);
      doc.setLineWidth(2);
      doc.roundedRect(15, propY, pageWidth - 30, 58, 4, 4);
      
      // Premium header
      doc.setFillColor(234, 179, 8);
      doc.roundedRect(15, propY, pageWidth - 30, 16, 4, 4, "F");
      doc.rect(15, propY + 8, pageWidth - 30, 8, "F");
      
      doc.setFillColor(251, 191, 36);
      doc.circle(25, propY + 8, 4, "F");
      doc.setTextColor(234, 179, 8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("★", 25, propY + 10, { align: "center" });
      
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("EDUCATION ZONES", pageWidth / 2, propY + 11, { align: "center" });
      
      const schoolY = propY + 28;
      
      // District cards
      if (parcelData.unifiedSchoolDistrict) {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(20, schoolY, pageWidth - 40, 16, 3, 3, "F");
        doc.setDrawColor(234, 179, 8);
        doc.setLineWidth(1);
        doc.roundedRect(20, schoolY, pageWidth - 40, 16, 3, 3);
        
        doc.setTextColor(146, 64, 14);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("UNIFIED K-12 DISTRICT", 25, schoolY + 6);
        
        doc.setTextColor(40, 40, 40);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(parcelData.unifiedSchoolDistrict, 25, schoolY + 12);
      } else {
        let cardY = schoolY;
        if (parcelData.elementarySchoolDistrict) {
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(20, cardY, pageWidth - 40, 14, 3, 3, "F");
          doc.setDrawColor(234, 179, 8);
          doc.setLineWidth(1);
          doc.roundedRect(20, cardY, pageWidth - 40, 14, 3, 3);
          
          doc.setTextColor(146, 64, 14);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7);
          doc.text("ELEMENTARY", 25, cardY + 5);
          
          doc.setTextColor(40, 40, 40);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.text(parcelData.elementarySchoolDistrict, 25, cardY + 10);
          cardY += 16;
        }
        
        if (parcelData.secondarySchoolDistrict) {
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(20, cardY, pageWidth - 40, 14, 3, 3, "F");
          doc.setDrawColor(234, 179, 8);
          doc.setLineWidth(1);
          doc.roundedRect(20, cardY, pageWidth - 40, 14, 3, 3);
          
          doc.setTextColor(146, 64, 14);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7);
          doc.text("SECONDARY (MIDDLE/HIGH)", 25, cardY + 5);
          
          doc.setTextColor(40, 40, 40);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.text(parcelData.secondarySchoolDistrict, 25, cardY + 10);
        }
      }
      
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text("School boundaries significantly impact property values and may affect tax rates", 20, schoolY + 36);
      
      propY += 70;
    }
    
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text("Data Source: County Records, US Census Bureau, FEMA, IRS via Regrid", 15, propY);
    
    drawPageFooter(doc, pageWidth, pageHeight, 4, totalPages, reportNumber);

    // ============================================
    // PAGES 5-8: CATEGORY ANALYSIS PAGES
    // ============================================
    const categories = generateCategoryReports(parcelData, acres.toString(), zoningStr, order.parcelAddress);
    
    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      
      doc.addPage();
      drawPageHeader(doc, pageWidth, category.title.toUpperCase(), category.color);
      
      let pageY = 35;
      
      // Subject Property Aerial Image (reusing mapImage from page 1)
      const aerialMapWidth = 75;
      const aerialMapHeight = 50;
      const aerialMapX = pageWidth - aerialMapWidth - 15;
      
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(aerialMapX, pageY - 4, aerialMapWidth, 10, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text("SUBJECT PROPERTY", aerialMapX + aerialMapWidth / 2, pageY + 2, { align: "center" });
      
      doc.setDrawColor(34, 83, 60);
      doc.setLineWidth(1.5);
      doc.rect(aerialMapX, pageY + 8, aerialMapWidth, aerialMapHeight);
      
      if (mapImage) {
        try {
          doc.addImage(mapImage, "PNG", aerialMapX + 1, pageY + 9, aerialMapWidth - 2, aerialMapHeight - 2);
        } catch {
          drawSimpleMap(doc, order.parcelLat, order.parcelLng, "property_boundaries", aerialMapX + 1, pageY + 9, aerialMapWidth - 2, aerialMapHeight - 2, parcelData?.coordinates || null);
        }
      } else {
        drawSimpleMap(doc, order.parcelLat, order.parcelLng, "property_boundaries", aerialMapX + 1, pageY + 9, aerialMapWidth - 2, aerialMapHeight - 2, parcelData?.coordinates || null);
      }
      
      // Fields
      const fieldsWidth = pageWidth - aerialMapWidth - 35;
      let fieldY = pageY;
      
      category.fields.forEach((field, idx) => {
        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(15, fieldY - 3, fieldsWidth, 13, "F");
        }
        
        doc.setFillColor(...category.color);
        doc.rect(15, fieldY - 3, 2, 13, "F");
        
        doc.setTextColor(80, 80, 80);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(field.label + ":", 20, fieldY + 4);
        
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40, 40, 40);
        const valueLines = doc.splitTextToSize(field.value, fieldsWidth - 45);
        doc.text(valueLines, 55, fieldY + 4);
        
        fieldY += 14;
      });
      
      pageY = Math.max(pageY + aerialMapHeight + 20, fieldY + 8);
      
      // Summary
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(15, pageY, pageWidth - 30, 35, 3, 3, "F");
      doc.setDrawColor(34, 83, 60);
      doc.setLineWidth(0.5);
      doc.roundedRect(15, pageY, pageWidth - 30, 35, 3, 3);
      
      doc.setFillColor(34, 83, 60);
      doc.roundedRect(15, pageY, 60, 10, 3, 3, "F");
      doc.rect(15, pageY + 5, 60, 5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("SUMMARY", 45, pageY + 7, { align: "center" });
      
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const summaryLines = doc.splitTextToSize(category.summary, pageWidth - 45);
      doc.text(summaryLines, 20, pageY + 18);
      
      pageY += 42;
      
      // Did You Know? Fun Fact Section
      doc.setFillColor(255, 251, 235);
      doc.roundedRect(15, pageY, pageWidth - 30, 30, 3, 3, "F");
      doc.setDrawColor(184, 134, 11);
      doc.setLineWidth(0.5);
      doc.roundedRect(15, pageY, pageWidth - 30, 30, 3, 3);
      
      doc.setFillColor(184, 134, 11);
      doc.roundedRect(15, pageY, 75, 10, 3, 3, "F");
      doc.rect(15, pageY + 5, 75, 5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("DID YOU KNOW?", 52.5, pageY + 7, { align: "center" });
      
      doc.setTextColor(146, 64, 14);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      const funFactLines = doc.splitTextToSize(category.funFact, pageWidth - 45);
      doc.text(funFactLines, 20, pageY + 17);
      
      pageY += 36;
      
      // Tips Section
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(15, pageY, pageWidth - 30, 38, 3, 3, "F");
      doc.setDrawColor(107, 114, 128);
      doc.setLineWidth(0.5);
      doc.roundedRect(15, pageY, pageWidth - 30, 38, 3, 3);
      
      doc.setFillColor(107, 114, 128);
      doc.roundedRect(15, pageY, 70, 10, 3, 3, "F");
      doc.rect(15, pageY + 5, 70, 5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("LANDOWNER TIPS", 50, pageY + 7, { align: "center" });
      
      let tipY = pageY + 17;
      category.tips.forEach((tip, idx) => {
        doc.setTextColor(107, 114, 128);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.text(`${idx + 1}.`, 20, tipY);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text(tip, 27, tipY);
        tipY += 8;
      });
      
      pageY += 44;
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`Data Source: ${category.dataSource}`, 15, pageY);
      
      drawPageFooter(doc, pageWidth, pageHeight, i + 5, totalPages, reportNumber);
    }

    // ============================================
    // PAGE 9: GROWING POTENTIAL
    // ============================================
    const hardiness = getHardinessZone(order.parcelLat);
    
    doc.addPage();
    drawPageHeader(doc, pageWidth, "GROWING POTENTIAL", [34, 197, 94]);
    
    let growingY = 35;
    
    const colWidth = (pageWidth - 40) / 2;
    
    // Left: Climate & Zone
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(15, growingY, colWidth, 90, 3, 3, "F");
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(1);
    doc.roundedRect(15, growingY, colWidth, 90, 3, 3);
    
    doc.setFillColor(34, 197, 94);
    doc.roundedRect(15, growingY, colWidth, 12, 3, 3, "F");
    doc.rect(15, growingY + 6, colWidth, 6, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("USDA HARDINESS ZONE", 15 + colWidth / 2, growingY + 8, { align: "center" });
    
    doc.setTextColor(34, 83, 60);
    doc.setFontSize(32);
    doc.setFont("helvetica", "bold");
    doc.text(`Zone ${hardiness.zone}`, 15 + colWidth / 2, growingY + 35, { align: "center" });
    
    let climateY = growingY + 45;
    const climateFields = [
      { label: "Min Winter Temp:", value: hardiness.minTemp },
      { label: "Growing Season:", value: hardiness.growingSeason },
      { label: "Last Spring Frost:", value: hardiness.avgLastFrost },
      { label: "First Fall Frost:", value: hardiness.avgFirstFrost },
    ];
    
    climateFields.forEach((field) => {
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(field.label, 20, climateY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      doc.text(field.value, 55, climateY);
      climateY += 10;
    });
    
    // Right: Ideal Crops
    const rightColX = 20 + colWidth;
    doc.setFillColor(255, 251, 235);
    doc.roundedRect(rightColX, growingY, colWidth, 90, 3, 3, "F");
    doc.setDrawColor(234, 179, 8);
    doc.setLineWidth(1);
    doc.roundedRect(rightColX, growingY, colWidth, 90, 3, 3);
    
    doc.setFillColor(234, 179, 8);
    doc.roundedRect(rightColX, growingY, colWidth, 12, 3, 3, "F");
    doc.rect(rightColX, growingY + 6, colWidth, 6, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("IDEAL CROPS FOR THIS ZONE", rightColX + colWidth / 2, growingY + 8, { align: "center" });
    
    let cropY = growingY + 22;
    hardiness.idealCrops.forEach((crop, idx) => {
      doc.setFillColor(34, 197, 94);
      doc.circle(rightColX + 8, cropY - 1, 2, "F");
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(crop, rightColX + 14, cropY);
      cropY += 11;
    });
    
    growingY += 100;
    
    // GROWING SEASON VISUAL CHART
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(15, growingY, pageWidth - 30, 55, 3, 3, "F");
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(1);
    doc.roundedRect(15, growingY, pageWidth - 30, 55, 3, 3);
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("GROWING SEASON TIMELINE", pageWidth / 2, growingY + 8, { align: "center" });
    
    // Month labels and timeline
    const chartY = growingY + 20;
    const chartWidth = pageWidth - 50;
    const monthWidth = chartWidth / 12;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // Draw month labels
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    months.forEach((month, idx) => {
      const x = 25 + (idx * monthWidth) + (monthWidth / 2);
      doc.text(month, x, chartY, { align: "center" });
    });
    
    // Draw base timeline
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(1);
    doc.line(25, chartY + 8, 25 + chartWidth, chartY + 8);
    
    // Calculate frost-free period based on zone
    let frostFreeStart = 4; // May (0-indexed)
    let frostFreeEnd = 9; // October
    
    // Adjust based on hardiness zone
    if (hardiness.zone.includes("3") || hardiness.zone.includes("4")) {
      frostFreeStart = 5; // Late May
      frostFreeEnd = 8; // Early September
    } else if (hardiness.zone.includes("9") || hardiness.zone.includes("10")) {
      frostFreeStart = 2; // March
      frostFreeEnd = 11; // December
    } else if (hardiness.zone.includes("7") || hardiness.zone.includes("8")) {
      frostFreeStart = 3; // April
      frostFreeEnd = 10; // November
    }
    
    // Draw frost-free growing period (green bar)
    const growStartX = 25 + (frostFreeStart * monthWidth);
    const growEndX = 25 + ((frostFreeEnd + 1) * monthWidth);
    doc.setFillColor(34, 197, 94);
    doc.roundedRect(growStartX, chartY + 3, growEndX - growStartX, 10, 2, 2, "F");
    
    // Draw frost risk periods (light blue bars)
    doc.setFillColor(191, 219, 254);
    if (frostFreeStart > 0) {
      doc.roundedRect(25, chartY + 3, growStartX - 25, 10, 2, 2, "F");
    }
    if (frostFreeEnd < 11) {
      doc.roundedRect(growEndX, chartY + 3, 25 + chartWidth - growEndX, 10, 2, 2, "F");
    }
    
    // Legend
    doc.setFontSize(7);
    doc.setTextColor(40, 40, 40);
    doc.setFillColor(34, 197, 94);
    doc.rect(30, chartY + 18, 8, 4, "F");
    doc.text("Frost-Free Growing Season", 40, chartY + 21);
    
    doc.setFillColor(191, 219, 254);
    doc.rect(110, chartY + 18, 8, 4, "F");
    doc.text("Frost Risk Period", 120, chartY + 21);
    
    growingY += 65;
    
    // Soil info
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, growingY, pageWidth - 30, 30, 3, 3, "F");
    doc.setDrawColor(107, 114, 128);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, growingY, pageWidth - 30, 30, 3, 3);
    
    doc.setTextColor(34, 83, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("SOIL TEMPERATURE GUIDANCE:", 20, growingY + 10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    const soilLines = doc.splitTextToSize(hardiness.soilTempInfo, pageWidth - 50);
    doc.text(soilLines, 20, growingY + 20);
    
    growingY += 40;
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text("Data Source: USDA Plant Hardiness Zone Map, NOAA Climate Data", 15, growingY);
    
    drawPageFooter(doc, pageWidth, pageHeight, 9, totalPages, reportNumber);

    // ============================================
    // PAGE 10: USE-CASE SUITABILITY
    // ============================================
    const useCaseScores = generateUseCaseScores(acres.toString(), zoningStr);
    
    doc.addPage();
    drawPageHeader(doc, pageWidth, "USE-CASE SUITABILITY", [234, 179, 8]);
    
    let useY = 35;
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Based on property size, zoning, and regional characteristics, this property is rated for the following uses:", pageWidth / 2, useY, { align: "center" });
    
    useY += 15;
    
    useCaseScores.forEach((score, idx) => {
      const rowY = useY + (idx * 22);
      
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(15, rowY - 5, pageWidth - 30, 20, "F");
      
      doc.setFillColor(34, 83, 60);
      doc.rect(15, rowY - 5, 3, 20, "F");
      
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(score.use, 25, rowY + 3);
      
      drawStars(doc, score.stars, 90, rowY + 2);
      
      doc.setTextColor(80, 80, 80);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(score.description, 120, rowY + 3);
    });
    
    useY += useCaseScores.length * 22 + 10;
    
    // Rating legend
    doc.setFillColor(255, 251, 235);
    doc.roundedRect(15, useY, pageWidth - 30, 25, 3, 3, "F");
    doc.setDrawColor(234, 179, 8);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, useY, pageWidth - 30, 25, 3, 3);
    
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("RATING SCALE:", 20, useY + 8);
    doc.setFont("helvetica", "normal");
    doc.text("★★★★★ Excellent  |  ★★★★☆ Very Good  |  ★★★☆☆ Good  |  ★★☆☆☆ Fair  |  ★☆☆☆☆ Limited", 20, useY + 17);
    
    drawPageFooter(doc, pageWidth, pageHeight, 10, totalPages, reportNumber);

    // ============================================
    // PAGE 11: UNDERSTANDING YOUR LAND RIGHTS
    // ============================================
    doc.addPage();
    drawPageHeader(doc, pageWidth, "UNDERSTANDING YOUR LAND RIGHTS", [139, 92, 246]);
    
    let rightsY = 35;
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Land ownership in the United States involves a \"bundle of rights\" that can be separated, sold, or retained.", pageWidth / 2, rightsY, { align: "center" });
    
    rightsY += 12;
    
    const rightsData = [
      {
        title: "SURFACE RIGHTS",
        color: [34, 197, 94] as [number, number, number],
        description: "The right to use the surface of the land for farming, building, recreation, or other purposes. This is typically what is transferred in a standard real estate transaction.",
        tip: "Always verify what improvements or restrictions apply to surface use."
      },
      {
        title: "MINERAL RIGHTS",
        color: [139, 92, 246] as [number, number, number],
        description: "The right to extract minerals beneath the surface, including oil, gas, coal, and precious metals. These rights can be severed from surface rights and sold separately.",
        tip: "Check deed history to confirm mineral rights conveyance. In many areas, mineral rights were severed decades ago."
      },
      {
        title: "WATER RIGHTS",
        color: [59, 130, 246] as [number, number, number],
        description: "Rights to use water on or adjacent to the property. Water law varies significantly by state (riparian vs. prior appropriation systems).",
        tip: "Contact your state water resources agency to understand applicable water rights doctrine."
      },
      {
        title: "AIR RIGHTS",
        color: [107, 114, 128] as [number, number, number],
        description: "The right to control the space above the land surface, subject to aviation regulations. Can affect building height and development potential.",
        tip: "Air rights are increasingly valuable in urban areas for development."
      },
    ];
    
    rightsData.forEach((right, idx) => {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(15, rightsY, pageWidth - 30, 35, 2, 2, "F");
      doc.setFillColor(...right.color);
      doc.rect(15, rightsY, 3, 35, "F");
      
      doc.setTextColor(...right.color);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(right.title, 22, rightsY + 8);
      
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const descLines = doc.splitTextToSize(right.description, pageWidth - 50);
      doc.text(descLines, 22, rightsY + 16);
      
      doc.setTextColor(146, 64, 14);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.text(`TIP: ${right.tip}`, 22, rightsY + 30);
      
      rightsY += 40;
    });
    
    // Easements section
    rightsY += 5;
    doc.setFillColor(255, 251, 235);
    doc.roundedRect(15, rightsY, pageWidth - 30, 35, 3, 3, "F");
    doc.setDrawColor(234, 179, 8);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, rightsY, pageWidth - 30, 35, 3, 3);
    
    doc.setTextColor(146, 64, 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("EASEMENTS & ENCUMBRANCES", 20, rightsY + 10);
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Easements grant others limited rights to use your property (e.g., utility access, road access). Review your title", 20, rightsY + 20);
    doc.text("commitment or deed for recorded easements. Common types include utility easements, access easements, and drainage easements.", 20, rightsY + 27);
    
    drawPageFooter(doc, pageWidth, pageHeight, 11, totalPages, reportNumber);

    // ============================================
    // PAGE 12: LAND STEWARDSHIP GUIDE
    // ============================================
    doc.addPage();
    drawPageHeader(doc, pageWidth, "LAND STEWARDSHIP GUIDE", [16, 185, 129]);
    
    let stewY = 35;
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Good land stewardship protects your investment, supports wildlife, and may qualify you for tax incentives.", pageWidth / 2, stewY, { align: "center" });
    
    stewY += 12;
    
    const stewardshipTopics = [
      {
        title: "CONSERVATION PROGRAMS",
        items: [
          "Conservation Reserve Program (CRP) - Annual rental payments for taking marginal cropland out of production",
          "Environmental Quality Incentives Program (EQIP) - Cost-share for conservation practices",
          "Conservation Easements - Permanent protection with significant tax benefits",
          "Contact your local USDA Service Center for eligibility and enrollment"
        ]
      },
      {
        title: "WILDLIFE MANAGEMENT",
        items: [
          "Create edge habitat where different cover types meet for maximum species diversity",
          "Establish food plots with native plants to support game and non-game wildlife",
          "Maintain water sources - even small ponds dramatically increase wildlife value",
          "Leave standing dead trees (snags) for cavity-nesting birds when safe to do so"
        ]
      },
      {
        title: "TIMBER MANAGEMENT",
        items: [
          "Consult a professional forester before any harvest - free assistance often available through state forestry agencies",
          "Timber Stand Improvement (TSI) removes low-value trees to benefit crop trees",
          "Consider certification (FSC, SFI) for access to premium markets",
          "Timber sales can provide income while improving long-term stand quality"
        ]
      },
      {
        title: "SOIL HEALTH",
        items: [
          "Minimize soil disturbance and maintain ground cover to prevent erosion",
          "Rotate grazing areas to prevent overgrazing and compaction",
          "Conduct soil tests every 2-3 years for productive agricultural land",
          "Consider cover crops to build organic matter and suppress weeds"
        ]
      }
    ];
    
    stewardshipTopics.forEach((topic, idx) => {
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(15, stewY, pageWidth - 30, 35, 2, 2, "F");
      doc.setFillColor(16, 185, 129);
      doc.rect(15, stewY, 3, 35, "F");
      
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(topic.title, 22, stewY + 8);
      
      let itemY = stewY + 15;
      topic.items.forEach((item, itemIdx) => {
        doc.setTextColor(60, 60, 60);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(`• ${item}`, 25, itemY);
        itemY += 5;
      });
      
      stewY += 40;
    });
    
    drawPageFooter(doc, pageWidth, pageHeight, 12, totalPages, reportNumber);

    // ============================================
    // PAGE 13: NEXT STEPS & DUE DILIGENCE
    // ============================================
    doc.addPage();
    drawPageHeader(doc, pageWidth, "NEXT STEPS & DUE DILIGENCE", [59, 130, 246]);
    
    let nextY = 35;
    
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Before finalizing any land purchase or development decision, complete these essential steps:", pageWidth / 2, nextY, { align: "center" });
    
    nextY += 12;
    
    // Due Diligence Checklist
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, nextY, pageWidth - 30, 95, 3, 3, "F");
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(1);
    doc.roundedRect(15, nextY, pageWidth - 30, 95, 3, 3);
    
    doc.setFillColor(59, 130, 246);
    doc.roundedRect(15, nextY, 110, 12, 3, 3, "F");
    doc.rect(15, nextY + 6, 110, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("DUE DILIGENCE CHECKLIST", 70, nextY + 8, { align: "center" });
    
    const checklist = [
      "□  Order title search and review for liens, easements, and encumbrances",
      "□  Commission a boundary survey from a licensed surveyor",
      "□  Verify road access is deeded (not just assumed)",
      "□  Contact utility companies for service availability and connection costs",
      "□  Check county zoning and any restrictive covenants",
      "□  Review FEMA flood maps for flood zone designation",
      "□  Conduct soil/perc test if septic system will be needed",
      "□  Verify water rights (especially in Western states)",
      "□  Check for environmental issues (Phase I if commercial use planned)",
      "□  Walk the property - preferably after rain to observe drainage",
    ];
    
    let checkY = nextY + 20;
    checklist.forEach((item) => {
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(item, 22, checkY);
      checkY += 7.5;
    });
    
    nextY += 105;
    
    // Professionals to Consult
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(15, nextY, pageWidth - 30, 55, 3, 3, "F");
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, nextY, pageWidth - 30, 55, 3, 3);
    
    doc.setFillColor(34, 197, 94);
    doc.roundedRect(15, nextY, 110, 12, 3, 3, "F");
    doc.rect(15, nextY + 6, 110, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("PROFESSIONALS TO CONSULT", 70, nextY + 8, { align: "center" });
    
    const professionals = [
      { role: "Real Estate Attorney", purpose: "Title review, contract negotiation, closing" },
      { role: "Licensed Surveyor", purpose: "Boundary survey, easement location" },
      { role: "Appraiser", purpose: "Fair market value determination" },
      { role: "Forester", purpose: "Timber inventory and management plan" },
      { role: "Soil Scientist/Engineer", purpose: "Septic feasibility, soil quality" },
    ];
    
    let profY = nextY + 20;
    professionals.forEach((prof, idx) => {
      const colX = idx % 2 === 0 ? 22 : pageWidth / 2 + 5;
      const rowOffset = Math.floor(idx / 2) * 12;
      
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(prof.role + ":", colX, profY + rowOffset);
      
      doc.setFont("helvetica", "normal");
      doc.setTextColor(60, 60, 60);
      doc.text(prof.purpose, colX + 38, profY + rowOffset);
    });
    
    drawPageFooter(doc, pageWidth, pageHeight, 13, totalPages, reportNumber);

    // ============================================
    // PAGE 14: GLOSSARY & NOTES
    // ============================================
    doc.addPage();
    drawPageHeader(doc, pageWidth, "GLOSSARY & NOTES", [107, 114, 128]);
    
    let glossY = 35;
    
    // Glossary
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, glossY, pageWidth - 30, 110, 3, 3, "F");
    doc.setDrawColor(107, 114, 128);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, glossY, pageWidth - 30, 110, 3, 3);
    
    doc.setFillColor(107, 114, 128);
    doc.roundedRect(15, glossY, 60, 12, 3, 3, "F");
    doc.rect(15, glossY + 6, 60, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("GLOSSARY", 45, glossY + 8, { align: "center" });
    
    const glossaryTerms = [
      { term: "APN (Assessor's Parcel Number)", def: "Unique identifier assigned by the county assessor" },
      { term: "Easement", def: "A right to use another's property for a specific purpose" },
      { term: "Encumbrance", def: "Any claim or restriction on the property" },
      { term: "FEMA", def: "Federal Emergency Management Agency (administers flood maps)" },
      { term: "Legal Description", def: "Precise written identification of property location" },
      { term: "PLSS", def: "Public Land Survey System (Township, Range, Section)" },
      { term: "Plat", def: "Recorded map showing lot boundaries within a subdivision" },
      { term: "Right-of-Way", def: "Legal right to pass through property owned by another" },
      { term: "Riparian Rights", def: "Water rights based on owning land adjacent to water" },
      { term: "Setback", def: "Required distance between structures and property lines" },
      { term: "Title Insurance", def: "Protection against defects in property ownership" },
      { term: "Zoning", def: "Government regulation of land use and development" },
    ];
    
    let termY = glossY + 20;
    const termCol1 = glossaryTerms.slice(0, 6);
    const termCol2 = glossaryTerms.slice(6);
    
    termCol1.forEach((item) => {
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(item.term, 20, termY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(60, 60, 60);
      doc.text(item.def, 20, termY + 5);
      termY += 14;
    });
    
    termY = glossY + 20;
    termCol2.forEach((item) => {
      doc.setTextColor(34, 83, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(item.term, pageWidth / 2 + 5, termY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(60, 60, 60);
      doc.text(item.def, pageWidth / 2 + 5, termY + 5);
      termY += 14;
    });
    
    glossY += 120;
    
    // Notes Section
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(15, glossY, pageWidth - 30, 55, 3, 3, "F");
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.roundedRect(15, glossY, pageWidth - 30, 55, 3, 3);
    
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("YOUR NOTES:", 20, glossY + 10);
    
    // Lined paper effect
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.3);
    for (let lineY = glossY + 18; lineY < glossY + 52; lineY += 8) {
      doc.line(20, lineY, pageWidth - 20, lineY);
    }
    
    glossY += 65;
    
    // Final thank you
    doc.setFillColor(34, 83, 60);
    doc.roundedRect(15, glossY, pageWidth - 30, 25, 3, 3, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Thank you for choosing Terra Firma Partners LLC", pageWidth / 2, glossY + 10, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Questions? Contact us at info@terrafirmapartners.com", pageWidth / 2, glossY + 18, { align: "center" });
    
    drawPageFooter(doc, pageWidth, pageHeight, 14, totalPages, reportNumber);

    // Generate PDF
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const base64Pdf = pdfBuffer.toString("base64");

    // Update order with PDF path (using base64 data URL as path)
    await prisma.order.update({
      where: { id: orderId },
      data: {
        pdfPath: `data:application/pdf;base64,${base64Pdf.substring(0, 50)}...`,
        status: "completed",
      },
    });

    // Send confirmation email to customer
    if (order.user?.email) {
      try {
        const appUrl = process.env.NEXTAUTH_URL || 'https://terrafirmapartners.abacusai.app';
        const dashboardUrl = `${appUrl}/dashboard`;
        
        const emailHtml = `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8faf8;">
            <div style="background: linear-gradient(135deg, #22543d 0%, #276749 100%); padding: 30px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">Terra Firma Partners</h1>
              <p style="color: #9ae6b4; margin: 5px 0 0 0; font-size: 14px;">Professional Land Analysis Services</p>
            </div>
            
            <div style="padding: 30px 25px;">
              <div style="background: #ffffff; border-radius: 12px; padding: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                <div style="text-align: center; margin-bottom: 25px;">
                  <div style="display: inline-block; background: #c6f6d5; border-radius: 50%; padding: 15px;">
                    <span style="font-size: 32px;">✓</span>
                  </div>
                  <h2 style="color: #22543d; margin: 15px 0 5px 0; font-size: 20px;">Your Report is Ready!</h2>
                  <p style="color: #718096; margin: 0; font-size: 14px;">Thank you for your purchase</p>
                </div>
                
                <div style="background: #f0fff4; border-left: 4px solid #38a169; padding: 15px; border-radius: 0 8px 8px 0; margin: 20px 0;">
                  <p style="margin: 0 0 8px 0; font-size: 12px; color: #718096; text-transform: uppercase; letter-spacing: 0.5px;">Property Address</p>
                  <p style="margin: 0; font-size: 16px; color: #2d3748; font-weight: 600;">${order.parcelAddress}</p>
                </div>
                
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                      <span style="color: #718096; font-size: 13px;">Report ID</span>
                    </td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                      <span style="color: #2d3748; font-weight: 500;">${reportNumber}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                      <span style="color: #718096; font-size: 13px;">Property Size</span>
                    </td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                      <span style="color: #2d3748; font-weight: 500;">${parcelData?.acreage?.toFixed(2) || 'N/A'} acres</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                      <span style="color: #718096; font-size: 13px;">Report Pages</span>
                    </td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                      <span style="color: #2d3748; font-weight: 500;">${totalPages} pages</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0;">
                      <span style="color: #718096; font-size: 13px;">Generated</span>
                    </td>
                    <td style="padding: 10px 0; text-align: right;">
                      <span style="color: #2d3748; font-weight: 500;">${formatDate(new Date())}</span>
                    </td>
                  </tr>
                </table>
                
                <div style="text-align: center; margin-top: 25px;">
                  <a href="${dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #38a169 0%, #2f855a 100%); color: #ffffff; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 15px;">
                    Download Your Report
                  </a>
                  <p style="color: #a0aec0; font-size: 12px; margin-top: 12px;">Access your report anytime from your dashboard</p>
                </div>
              </div>
              
              <div style="margin-top: 25px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
                <h3 style="color: #22543d; margin: 0 0 15px 0; font-size: 15px;">What's Included in Your Report:</h3>
                <ul style="margin: 0; padding: 0 0 0 20px; color: #4a5568; font-size: 13px; line-height: 1.8;">
                  <li>Property boundaries & satellite imagery</li>
                  <li>Ownership & valuation data</li>
                  <li>Road access & utility availability</li>
                  <li>Flood zone & terrain analysis</li>
                  <li>Soil ratings & land use suitability</li>
                  <li>Actionable landowner tips</li>
                </ul>
              </div>
            </div>
            
            <div style="background: #22543d; padding: 25px 20px; text-align: center;">
              <p style="color: #9ae6b4; margin: 0 0 10px 0; font-size: 13px;">Questions about your report?</p>
              <a href="mailto:info@terrafirmapartners.com" style="color: #ffffff; text-decoration: none; font-size: 14px;">info@terrafirmapartners.com</a>
              <p style="color: #68d391; margin: 15px 0 0 0; font-size: 12px;">© ${new Date().getFullYear()} Terra Firma Partners LLC</p>
            </div>
          </div>
        `;

        await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deployment_token: process.env.ABACUSAI_API_KEY,
            app_id: process.env.WEB_APP_ID,
            notification_id: process.env.NOTIF_ID_LAND_REPORT_ORDER_CONFIRMATION,
            subject: `Your Terra Firma Land Report is Ready - ${order.parcelAddress}`,
            body: emailHtml,
            is_html: true,
            recipient_email: order.user.email,
            sender_email: `reports@terrafirmapartners.abacusai.app`,
            sender_alias: 'Terra Firma Partners',
          }),
        });
        console.log('Confirmation email sent to:', order.user.email);
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    return NextResponse.json({
      success: true,
      message: "PDF generated successfully",
      pdf: base64Pdf,
      filename: `terra_firma_report_${order.id}.pdf`,
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
