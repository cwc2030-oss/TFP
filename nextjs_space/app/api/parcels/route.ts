import { NextRequest, NextResponse } from "next/server";
import { getCachedParcel, setCachedParcel, CachedParcelData } from "@/lib/regrid-cache";

// Version 2.1 - Regrid Pro API with caching
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
  // Census
  censusTract: string | null;
  censusBlock: string | null;
  // County info
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

  if (!address && !lat && !lng) {
    return NextResponse.json(
      { error: "Either lat/lng or address is required" },
      { status: 400 }
    );
  }

  try {
    // Check cache first for coordinate-based lookups
    if (lat && lng) {
      const cached = await getCachedParcel(parseFloat(lat), parseFloat(lng));
      if (cached) {
        // Return cached data in the expected format
        const parcel: ParcelResponse = {
          parcelId: cached.parcelId,
          owner: cached.owner,
          mailingAddress: cached.mailingAddress,
          siteAddress: cached.siteAddress,
          acreage: cached.acreage,
          sqft: cached.sqft,
          zoning: cached.zoning,
          useDescription: cached.useDescription,
          coordinates: cached.coordinates || [],
          geometryType: "Polygon",
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          regridPath: "",
          marketValue: cached.marketValue,
          landValue: cached.landValue,
          improvementValue: cached.improvementValue,
          taxYear: cached.taxYear,
          saleDate: cached.saleDate,
          salePrice: cached.salePrice,
          lastOwnershipTransfer: null,
          yearBuilt: null,
          numStories: null,
          numBedrooms: null,
          numBathrooms: null,
          buildingSqft: null,
          legalDescription: cached.legalDescription,
          subdivision: null,
          plssTownship: cached.plssTownship,
          plssRange: cached.plssRange,
          plssSection: cached.plssSection,
          censusTract: null,
          censusBlock: null,
          county: cached.county,
          buildingFootprintSqft: null,
          buildingCount: null,
          isQualifiedOpportunityZone: cached.qozStatus === "Yes",
          qozTract: null,
          femaNriRiskRating: null,
          femaFloodZone: cached.femaFloodZone || null,
          femaFloodZoneSubtype: null,
          elementarySchoolDistrict: cached.schoolDistrict || null,
          secondarySchoolDistrict: null,
          unifiedSchoolDistrict: null,
        };
        return NextResponse.json({ parcels: [parcel], cached: true });
      }
    }

    // Use the search endpoint (more reliable than typeahead)
    let searchUrl: string;
    
    if (address) {
      // Search by address
      searchUrl = `https://app.regrid.com/api/v1/search.json?query=${encodeURIComponent(address)}&token=${apiKey}`;
    } else if (lat && lng) {
      // Search by coordinates
      searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;
    } else {
      return NextResponse.json(
        { parcels: [], message: "Address or coordinates required" },
        { status: 200 }
      );
    }
    
    const searchResponse = await fetch(searchUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!searchResponse.ok) {
      console.error("Regrid search error:", searchResponse.status);
      return NextResponse.json(
        { parcels: [], message: "Search failed" },
        { status: 200 }
      );
    }

    const searchData = await searchResponse.json();
    
    // Handle error responses from Regrid
    if (searchData.status === "error") {
      console.error("Regrid API error:", searchData.message);
      return NextResponse.json(
        { parcels: [], message: searchData.message || "Search failed" },
        { status: 200 }
      );
    }
    
    const results = searchData.results || [];
    
    if (results.length === 0) {
      return NextResponse.json(
        { parcels: [], message: "No parcels found at this location" },
        { status: 200 }
      );
    }

    // Get the first (best matching) result
    const feature = results[0];
    const fields = feature.properties?.fields || {};
    
    // Build mailing address
    const mailParts = [
      fields.mailadd || fields.mail_address,
      fields.mail_unit,
      fields.mail_city,
      fields.mail_state2,
      fields.mail_zip
    ].filter(Boolean);
    
    // Build site address
    const siteParts = [
      fields.address,
      fields.city || fields.situs_city,
      fields.state2 || fields.situs_state2,
      fields.szip || fields.situs_zip
    ].filter(Boolean);

    const parcel: ParcelResponse = {
      parcelId: fields.parcelnumb || fields.parcelnumb_no_formatting || "Unknown",
      owner: fields.owner || "Unknown Owner",
      mailingAddress: mailParts.length > 0 ? mailParts.join(", ") : "Not Available",
      siteAddress: siteParts.length > 0 ? siteParts.join(", ") : feature.properties?.headline || "Not Available",
      acreage: fields.ll_gisacre || fields.gisacre || fields.acres || 0,
      sqft: fields.ll_gissqft || fields.sqft || 0,
      zoning: fields.zoning || "N/A",
      useDescription: fields.usedesc || fields.zoning_description || "N/A",
      coordinates: feature.geometry?.coordinates || [],
      geometryType: feature.geometry?.type || "Polygon",
      lat: parseFloat(fields.lat) || 0,
      lng: parseFloat(fields.lon) || 0,
      regridPath: fields.path || feature.properties?.path || "",
      // Valuation & Tax
      marketValue: fields.parval || fields.market_value || null,
      landValue: fields.landval || fields.land_value || null,
      improvementValue: fields.improvval || fields.improvement_value || null,
      taxYear: fields.taxyear || null,
      // Sales History
      saleDate: fields.saledate || fields.sale_date || null,
      salePrice: fields.saleprice || fields.sale_price || null,
      lastOwnershipTransfer: fields.last_ownership_transfer_date || null,
      // Building Details
      yearBuilt: fields.yearbuilt || fields.year_built || null,
      numStories: fields.numstories || fields.stories || null,
      numBedrooms: fields.num_bedrooms || fields.bedrooms || null,
      numBathrooms: fields.num_bath || fields.bathrooms || null,
      buildingSqft: fields.area_building || fields.building_sqft || null,
      // Legal
      legalDescription: fields.legaldesc || fields.legal_description || null,
      subdivision: fields.subdivision || null,
      plssTownship: fields.plss_township || null,
      plssRange: fields.plss_range || null,
      plssSection: fields.plss_section || null,
      // Census
      censusTract: fields.census_tract || null,
      censusBlock: fields.census_block || null,
      // County
      county: fields.county || null,
      // Premium Data - Building Footprints
      buildingFootprintSqft: fields.recrdareano || fields.area_building || null,
      buildingCount: fields.ll_address_count || null,
      // Premium Data - Qualified Opportunity Zone
      isQualifiedOpportunityZone: fields.qoz === "Yes" || fields.qoz === "1" || fields.qoz === true,
      qozTract: fields.qoz_tract || null,
      // Premium Data - FEMA Risk
      femaNriRiskRating: fields.fema_nri_risk_rating || null,
      femaFloodZone: fields.fema_flood_zone || null,
      femaFloodZoneSubtype: fields.fema_flood_zone_subtype || null,
      // Premium Data - School Districts
      elementarySchoolDistrict: fields.census_elementary_school_district || null,
      secondarySchoolDistrict: fields.census_secondary_school_district || null,
      unifiedSchoolDistrict: fields.census_unified_school_district || null,
    };

    // Cache the result for future lookups
    const parcelLat = parseFloat(fields.lat) || (lat ? parseFloat(lat) : 0);
    const parcelLng = parseFloat(fields.lon) || (lng ? parseFloat(lng) : 0);
    
    if (parcelLat && parcelLng) {
      const cacheData: CachedParcelData = {
        parcelId: parcel.parcelId,
        owner: parcel.owner,
        mailingAddress: parcel.mailingAddress,
        siteAddress: parcel.siteAddress,
        acreage: parcel.acreage,
        sqft: parcel.sqft,
        zoning: parcel.zoning,
        useDescription: parcel.useDescription,
        coordinates: feature.geometry?.coordinates as number[][][] || null,
        marketValue: parcel.marketValue,
        landValue: parcel.landValue,
        improvementValue: parcel.improvementValue,
        taxYear: parcel.taxYear,
        saleDate: parcel.saleDate,
        salePrice: parcel.salePrice,
        county: parcel.county || "",
        state: fields.state2 || "",
        legalDescription: parcel.legalDescription,
        plssTownship: parcel.plssTownship,
        plssRange: parcel.plssRange,
        plssSection: parcel.plssSection,
        buildingFootprints: parcel.buildingFootprintSqft?.toString() || null,
        qozStatus: parcel.isQualifiedOpportunityZone ? "Yes" : "No",
        femaFloodZone: parcel.femaFloodZone,
        schoolDistrict: parcel.unifiedSchoolDistrict || parcel.elementarySchoolDistrict,
      };
      
      // Cache in background (don't await)
      setCachedParcel(parcelLat, parcelLng, cacheData).catch(console.error);
    }

    return NextResponse.json({ parcels: [parcel] });

  } catch (error) {
    console.error("Error fetching parcel data:", error);
    return NextResponse.json(
      { error: "Failed to fetch parcel data" },
      { status: 500 }
    );
  }
}

// Also support getting neighboring parcels using radius search
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
    const { lat, lng, radius = 0.002 } = body;
    
    if (!lat || !lng) {
      return NextResponse.json(
        { error: "lat and lng are required" },
        { status: 400 }
      );
    }

    // Use the v1 search endpoint with multiple offset points to find neighbors
    // This is more reliable than the v2 bbox query which can be problematic
    const offsets = [
      { latOff: radius, lngOff: 0 },      // North
      { latOff: -radius, lngOff: 0 },     // South
      { latOff: 0, lngOff: radius },      // East
      { latOff: 0, lngOff: -radius },     // West
      { latOff: radius, lngOff: radius }, // NE
      { latOff: radius, lngOff: -radius },// NW
      { latOff: -radius, lngOff: radius },// SE
      { latOff: -radius, lngOff: -radius },// SW
    ];

    const uniqueParcels = new Map<string, any>();
    
    // Fetch parcels at each offset point
    const fetchPromises = offsets.map(async ({ latOff, lngOff }) => {
      const searchLat = lat + latOff;
      const searchLng = lng + lngOff;
      
      try {
        const url = `https://app.regrid.com/api/v1/search.json?lat=${searchLat}&lon=${searchLng}&token=${apiKey}`;
        const response = await fetch(url, {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) return [];
        
        const data = await response.json();
        return data.results || [];
      } catch {
        return [];
      }
    });

    const allResults = await Promise.all(fetchPromises);
    
    // Combine and dedupe by parcel ID
    allResults.flat().forEach((feature: any) => {
      const fields = feature.properties?.fields || {};
      const parcelId = fields.parcelnumb || fields.parcelnumb_no_formatting;
      
      if (parcelId && !uniqueParcels.has(parcelId)) {
        const mailParts = [
          fields.mailadd || fields.mail_address,
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

        uniqueParcels.set(parcelId, {
          parcelId,
          owner: fields.owner || "Unknown Owner",
          mailingAddress: mailParts.length > 0 ? mailParts.join(", ") : "Not Available",
          siteAddress: siteParts.length > 0 ? siteParts.join(", ") : feature.properties?.headline || "Not Available",
          acreage: fields.ll_gisacre || fields.gisacre || fields.acres || 0,
          sqft: fields.ll_gissqft || fields.sqft || 0,
          zoning: fields.zoning || "N/A",
          useDescription: fields.usedesc || fields.zoning_description || "N/A",
          coordinates: feature.geometry?.coordinates || [],
          geometryType: feature.geometry?.type || "Polygon",
          lat: parseFloat(fields.lat) || 0,
          lng: parseFloat(fields.lon) || 0,
          regridPath: fields.path || feature.properties?.path || "",
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
        });
      }
    });

    const parcels = Array.from(uniqueParcels.values());
    
    return NextResponse.json({ parcels });

  } catch (error) {
    console.error("Error fetching neighboring parcels:", error);
    return NextResponse.json(
      { parcels: [], error: "Failed to fetch neighboring parcels" },
      { status: 200 } // Return 200 with empty array to avoid breaking the UI
    );
  }
}
