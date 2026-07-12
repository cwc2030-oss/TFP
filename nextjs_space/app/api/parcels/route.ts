import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCachedParcel, setCachedParcel, CachedParcelData } from "@/lib/regrid-cache";
import { regridFetch } from "@/lib/regrid-client";
import { recordCacheHitAsync } from "@/lib/cache-stats";
import { geocodeAddress } from "@/lib/geocode-address";

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
    // If address provided without lat/lng, geocode it first so we can check cache
    let effectiveLat = lat;
    let effectiveLng = lng;
    if (address && !lat && !lng) {
      const geo = await geocodeAddress(address);
      if (geo) {
        effectiveLat = String(geo.lat);
        effectiveLng = String(geo.lng);
        console.log(`[PARCELS GET] Geocoded "${address}" → ${effectiveLat}, ${effectiveLng}`);
      }
    }

    // Check cache first for coordinate-based lookups (now includes geocoded addresses)
    if (effectiveLat && effectiveLng) {
      const cached = await getCachedParcel(parseFloat(effectiveLat), parseFloat(effectiveLng));
      if (cached) {
        // Validate cached geometry — if no polygon coordinates, evict and re-fetch from Regrid
        const hasValidGeometry = cached.coordinates && 
          Array.isArray(cached.coordinates) && 
          cached.coordinates.length > 0;
        if (!hasValidGeometry) {
          console.log(`[CACHE EVICT] No geometry for parcel at ${effectiveLat}, ${effectiveLng} — forcing fresh Regrid fetch`);
          const roundedLat = Math.round(parseFloat(effectiveLat) * 100000) / 100000;
          const roundedLng = Math.round(parseFloat(effectiveLng) * 100000) / 100000;
          try {
            await prisma.parcelCache.delete({
              where: { lat_lng: { lat: roundedLat, lng: roundedLng } },
            });
          } catch (e) {
            console.error('[CACHE EVICT] Delete failed (non-fatal):', e);
          }
          // Fall through to fresh Regrid fetch below
        } else {
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
          geometryType: cached.geometryType || "Polygon",
          lat: parseFloat(effectiveLat),
          lng: parseFloat(effectiveLng),
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
    }

    // Use the search endpoint (more reliable than typeahead)
    // Prefer geocoded lat/lng over raw address query to improve cache hit rates
    let searchUrl: string;
    
    if (effectiveLat && effectiveLng) {
      // Search by coordinates (original or geocoded from address)
      searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${effectiveLat}&lon=${effectiveLng}&token=${apiKey}`;
    } else if (address) {
      // Geocoding failed — fall back to raw address query
      searchUrl = `https://app.regrid.com/api/v1/search.json?query=${encodeURIComponent(address)}&token=${apiKey}`;
    } else {
      return NextResponse.json(
        { parcels: [], message: "Address or coordinates required" },
        { status: 200 }
      );
    }
    
    const searchResponse = await regridFetch(searchUrl, 'parcels-get', {
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
    const parcelLat = parseFloat(fields.lat) || (effectiveLat ? parseFloat(effectiveLat) : 0);
    const parcelLng = parseFloat(fields.lon) || (effectiveLng ? parseFloat(effectiveLng) : 0);
    
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
        coordinates: feature.geometry?.coordinates as number[][][] | number[][][][] || null,
        geometryType: feature.geometry?.type || 'Polygon',
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

// Round coordinates for consistent neighbor cache keys (4 decimal places ≈ 11m)
function roundCoord4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

// Neighboring parcels using single Regrid v2 parcels/point?radius= call + DB cache.
// Replaces the old 8-call "compass rose" v1 pattern, saving 7 Regrid calls per invocation.
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
    const { lat, lng, radius: _radius } = body;
    
    if (!lat || !lng) {
      return NextResponse.json(
        { error: "lat and lng are required" },
        { status: 400 }
      );
    }

    // Convert the old radius (in degrees, ~0.002) to meters for v2 endpoint.
    // 0.002 degrees ≈ 220m. Default to 500m for good neighbor coverage.
    const radiusMeters = 500;

    // ── Check neighbor cache ──
    const rLat = roundCoord4(lat);
    const rLng = roundCoord4(lng);
    try {
      const cached = await prisma.neighborCache.findUnique({
        where: { lat_lng_radius: { lat: rLat, lng: rLng, radius: radiusMeters } },
      });
      if (cached) {
        console.log(`[NEIGHBOR-CACHE HIT] ${rLat}, ${rLng}, r=${radiusMeters}`);
        recordCacheHitAsync('neighbors');
        const parcels = JSON.parse(cached.data);
        return NextResponse.json({ parcels, cached: true });
      }
    } catch (cacheErr) {
      console.error('[NEIGHBOR-CACHE] Read error (non-fatal):', cacheErr);
    }

    // ── Single v2 call ──
    const url = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&radius=${radiusMeters}&limit=30&token=${apiKey}`;
    console.log('[Neighbors-v2] Fetching:', url.replace(apiKey, '***'));

    const resp = await regridFetch(url, 'parcels-neighbors-v2', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      console.error('[Neighbors-v2] Regrid error:', resp.status);
      return NextResponse.json(
        { parcels: [], error: `Regrid API error: ${resp.status}` },
        { status: 200 }
      );
    }

    const data = await resp.json();
    const features: GeoJSON.Feature[] = data?.features || [];
    console.log('[Neighbors-v2] Got', features.length, 'features');

    // Map to the same shape the frontend expects
    const parcels: any[] = [];
    for (const f of features) {
      const props = f.properties || {};
      const fields = props.fields || props;
      const parcelId = fields.parcelnumb || fields.parcelnumb_no_formatting || fields.ll_uuid || '';

      if (!f.geometry) continue;

      const mailParts = [
        fields.mailadd || fields.mail_address,
        fields.mail_city,
        fields.mail_state2,
        fields.mail_zip,
      ].filter(Boolean);

      const siteParts = [
        fields.address || fields.situs_address,
        fields.city || fields.situs_city,
        fields.state2 || fields.situs_state2,
        fields.szip || fields.situs_zip,
      ].filter(Boolean);

      const geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;

      parcels.push({
        parcelId: parcelId || `unknown-${parcels.length}`,
        owner: fields.owner || 'Unknown Owner',
        mailingAddress: mailParts.length > 0 ? mailParts.join(', ') : 'Not Available',
        siteAddress: siteParts.length > 0 ? siteParts.join(', ') : props.headline || 'Not Available',
        acreage: parseFloat(fields.ll_gisacre || fields.gisacre || fields.acres || '0') || 0,
        sqft: parseFloat(fields.ll_gissqft || fields.sqft || '0') || 0,
        zoning: fields.zoning || 'N/A',
        useDescription: fields.usedesc || fields.zoning_description || 'N/A',
        coordinates: geom.coordinates || [],
        geometryType: geom.type || 'Polygon',
        lat: parseFloat(fields.lat) || 0,
        lng: parseFloat(fields.lon) || 0,
        regridPath: fields.path || props.path || '',
        buildingFootprintSqft: fields.recrdareano || fields.area_building || null,
        buildingCount: fields.ll_address_count || null,
        isQualifiedOpportunityZone: fields.qoz === 'Yes' || fields.qoz === '1' || fields.qoz === true,
        qozTract: fields.qoz_tract || null,
        femaNriRiskRating: fields.fema_nri_risk_rating || null,
        femaFloodZone: fields.fema_flood_zone || null,
        femaFloodZoneSubtype: fields.fema_flood_zone_subtype || null,
        elementarySchoolDistrict: fields.census_elementary_school_district || null,
        secondarySchoolDistrict: fields.census_secondary_school_district || null,
        unifiedSchoolDistrict: fields.census_unified_school_district || null,
      });
    }

    // ── Write neighbor cache (background, fire-and-forget) ──
    prisma.neighborCache.upsert({
      where: { lat_lng_radius: { lat: rLat, lng: rLng, radius: radiusMeters } },
      update: { data: JSON.stringify(parcels) },
      create: { lat: rLat, lng: rLng, radius: radiusMeters, data: JSON.stringify(parcels) },
    }).catch((err) => console.error('[NEIGHBOR-CACHE] Write error:', err));

    return NextResponse.json({ parcels });

  } catch (error) {
    console.error("Error fetching neighboring parcels:", error);
    return NextResponse.json(
      { parcels: [], error: "Failed to fetch neighboring parcels" },
      { status: 200 }
    );
  }
}
