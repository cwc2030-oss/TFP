import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface RegridParcel {
  type: string;
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    fields: {
      parcelnumb?: string;
      parcelnumb_no_formatting?: string;
      owner?: string;
      mail_address?: string;
      mail_city?: string;
      mail_state2?: string;
      mail_zip?: string;
      address?: string;
      city?: string;
      state2?: string;
      szip?: string;
      ll_gisacre?: number;
      ll_gissqft?: number;
      sqft?: number;
      acres?: number;
      zoning?: string;
      zoning_description?: string;
      usecode?: string;
      usedesc?: string;
      lat?: number;
      lon?: number;
      path?: string;
    };
  };
}

interface ParcelResponse {
  parcelId: string;
  owner: string;
  mailingAddress: string;
  siteAddress: string;
  acreage: number;
  sqft: number;
  zoning: string;
  useDescription: string;
  coordinates: number[][][] | number[][][][];
  geometryType: string;
  lat: number;
  lng: number;
  regridPath: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const address = searchParams.get("address");
  
  const apiKey = process.env.REGRID_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json(
      { error: "Regrid API key not configured" },
      { status: 500 }
    );
  }

  try {
    let url: string;
    
    if (lat && lng) {
      // Search by coordinates
      url = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&token=${apiKey}`;
    } else if (address) {
      // Search by address
      url = `https://app.regrid.com/api/v2/parcels/address?query=${encodeURIComponent(address)}&token=${apiKey}`;
    } else {
      return NextResponse.json(
        { error: "Either lat/lng or address is required" },
        { status: 400 }
      );
    }

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Regrid API error:", response.status, errorText);
      return NextResponse.json(
        { error: `Regrid API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
      return NextResponse.json(
        { parcels: [], message: "No parcels found at this location" },
        { status: 200 }
      );
    }

    // Transform Regrid response to our format
    const parcels: ParcelResponse[] = data.results.map((feature: RegridParcel) => {
      const fields = feature.properties?.fields || {};
      
      // Build mailing address
      const mailParts = [
        fields.mail_address,
        fields.mail_city,
        fields.mail_state2,
        fields.mail_zip
      ].filter(Boolean);
      
      // Build site address
      const siteParts = [
        fields.address,
        fields.city,
        fields.state2,
        fields.szip
      ].filter(Boolean);

      return {
        parcelId: fields.parcelnumb || fields.parcelnumb_no_formatting || "Unknown",
        owner: fields.owner || "Unknown Owner",
        mailingAddress: mailParts.length > 0 ? mailParts.join(", ") : "Not Available",
        siteAddress: siteParts.length > 0 ? siteParts.join(", ") : "Not Available",
        acreage: fields.ll_gisacre || fields.acres || 0,
        sqft: fields.ll_gissqft || fields.sqft || 0,
        zoning: fields.zoning || "N/A",
        useDescription: fields.usedesc || fields.zoning_description || "N/A",
        coordinates: feature.geometry?.coordinates || [],
        geometryType: feature.geometry?.type || "Polygon",
        lat: fields.lat || 0,
        lng: fields.lon || 0,
        regridPath: fields.path || "",
      };
    });

    return NextResponse.json({ parcels });

  } catch (error) {
    console.error("Error fetching parcel data:", error);
    return NextResponse.json(
      { error: "Failed to fetch parcel data" },
      { status: 500 }
    );
  }
}

// Also support getting neighboring parcels
export async function POST(request: NextRequest) {
  const apiKey = process.env.REGRID_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json(
      { error: "Regrid API key not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { lat, lng, radius = 0.001 } = body; // radius in degrees (~100m)
    
    if (!lat || !lng) {
      return NextResponse.json(
        { error: "lat and lng are required" },
        { status: 400 }
      );
    }

    // Create a bounding box around the point
    const bbox = [
      lng - radius, // west
      lat - radius, // south
      lng + radius, // east
      lat + radius, // north
    ].join(",");

    const url = `https://app.regrid.com/api/v2/parcels/query?bbox=${bbox}&limit=20&token=${apiKey}`;

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Regrid API error:", response.status, errorText);
      return NextResponse.json(
        { error: `Regrid API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    const parcels = (data.results || []).map((feature: RegridParcel) => {
      const fields = feature.properties?.fields || {};
      
      const mailParts = [
        fields.mail_address,
        fields.mail_city,
        fields.mail_state2,
        fields.mail_zip
      ].filter(Boolean);
      
      const siteParts = [
        fields.address,
        fields.city,
        fields.state2,
        fields.szip
      ].filter(Boolean);

      return {
        parcelId: fields.parcelnumb || fields.parcelnumb_no_formatting || "Unknown",
        owner: fields.owner || "Unknown Owner",
        mailingAddress: mailParts.length > 0 ? mailParts.join(", ") : "Not Available",
        siteAddress: siteParts.length > 0 ? siteParts.join(", ") : "Not Available",
        acreage: fields.ll_gisacre || fields.acres || 0,
        sqft: fields.ll_gissqft || fields.sqft || 0,
        zoning: fields.zoning || "N/A",
        useDescription: fields.usedesc || fields.zoning_description || "N/A",
        coordinates: feature.geometry?.coordinates || [],
        geometryType: feature.geometry?.type || "Polygon",
        lat: fields.lat || 0,
        lng: fields.lon || 0,
        regridPath: fields.path || "",
      };
    });

    return NextResponse.json({ parcels });

  } catch (error) {
    console.error("Error fetching neighboring parcels:", error);
    return NextResponse.json(
      { error: "Failed to fetch neighboring parcels" },
      { status: 500 }
    );
  }
}
