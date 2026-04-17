import { NextRequest, NextResponse } from "next/server";
import { getCachedParcel, setCachedParcel, CachedParcelData } from "@/lib/regrid-cache";
import { normalizeToOuterRing, validateParcelGeometry, logGeometryDebug } from "@/lib/geometry-validation";

export const dynamic = "force-dynamic";

// Supported states for QA validation
const SUPPORTED_STATES = ['KS', 'MO', 'kansas', 'missouri', 'Kansas', 'Missouri'];

// Calculate acreage from polygon coordinates
function calculateAcreage(coords: number[][]): number {
  if (!coords || coords.length < 3) return 0;
  
  // Shoelace formula for area in square degrees, then convert
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    area += coords[i][0] * coords[j][1];
    area -= coords[j][0] * coords[i][1];
  }
  area = Math.abs(area) / 2;
  
  // Convert square degrees to acres (approximate for mid-latitudes)
  // At ~38° lat: 1 degree lon ≈ 87.8 km, 1 degree lat ≈ 111 km
  const latMid = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const lonKm = 111.32 * Math.cos(latMid * Math.PI / 180);
  const latKm = 111.32;
  const sqKm = area * lonKm * latKm;
  const acres = sqKm * 247.105; // 1 sq km = 247.105 acres
  
  return Math.round(acres * 10) / 10;
}

// Calculate centroid of polygon
function calculateCentroid(coords: number[][]): [number, number] {
  if (!coords?.length) return [0, 0];
  const sum = coords.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length];
}

// Calculate bounding box
function calculateBounds(coords: number[][]): [[number, number], [number, number]] {
  if (!coords?.length) return [[0, 0], [0, 0]];
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const c of coords) {
    if (c[0] < minLng) minLng = c[0];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

export interface ParcelLookupResponse {
  found: boolean;
  parcel?: {
    parcelId: string;
    address: string;
    county: string;
    state: string;
    acreage: number;
    owner: string;
    zoning: string;
    coordinates: number[][] | number[][][] | number[][][][];
    centroid: [number, number];
    bounds: [[number, number], [number, number]];
    geometryType: 'Polygon' | 'MultiPolygon';
    legalDescription?: string;
    plss?: string;
  };
  error?: string;
  cached?: boolean;
  // Debug info returned when debug=true query param is set
  debug?: {
    rawCoords: number[][] | null; // Raw outer ring from Regrid before any transformation
    rawGeometryType: 'Polygon' | 'MultiPolygon';
    normalizedCoords: number[][] | null; // After normalizeToOuterRing
    coordOrder: 'lng_lat' | 'lat_lng' | 'unknown';
    validation: {
      valid: boolean;
      errors: string[];
      warnings: string[];
    };
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const debugMode = searchParams.get("debug") === "true";
  
  if (!lat || !lng) {
    return NextResponse.json(
      { found: false, error: "lat and lng parameters required" },
      { status: 400 }
    );
  }
  
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  
  if (isNaN(latNum) || isNaN(lngNum)) {
    return NextResponse.json(
      { found: false, error: "Invalid lat/lng values" },
      { status: 400 }
    );
  }
  
  // Quick bounds check for supported-region box (core + adjacent states).
  // Each box is a generous outer envelope — Regrid handles fine-grained in/out on its side.
  // KS: lat 36.99-40.00, lng -102.05 to -94.59
  // MO: lat 35.99-40.61, lng -95.77 to -89.10
  // OK: lat 33.62-37.00, lng -103.00 to -94.43
  // AR: lat 33.00-36.50, lng -94.62 to -89.64
  // NE: lat 39.99-43.00, lng -104.06 to -95.30
  // IA: lat 40.37-43.51, lng -96.64 to -90.14
  // TX panhandle: lat 34.30-36.51, lng -103.05 to -99.99
  // CO east (plains): lat 37.00-41.01, lng -105.80 to -102.04
  const inKS = latNum >= 36.99 && latNum <= 40.00 && lngNum >= -102.05 && lngNum <= -94.59;
  const inMO = latNum >= 35.99 && latNum <= 40.61 && lngNum >= -95.77 && lngNum <= -89.10;
  const inOK = latNum >= 33.62 && latNum <= 37.00 && lngNum >= -103.00 && lngNum <= -94.43;
  const inAR = latNum >= 33.00 && latNum <= 36.50 && lngNum >= -94.62 && lngNum <= -89.64;
  const inNE = latNum >= 39.99 && latNum <= 43.00 && lngNum >= -104.06 && lngNum <= -95.30;
  const inIA = latNum >= 40.37 && latNum <= 43.51 && lngNum >= -96.64 && lngNum <= -90.14;
  const inTXPanhandle = latNum >= 34.30 && latNum <= 36.51 && lngNum >= -103.05 && lngNum <= -99.99;
  const inCOEast = latNum >= 37.00 && latNum <= 41.01 && lngNum >= -105.80 && lngNum <= -102.04;

  const inSupportedRegion =
    inKS || inMO || inOK || inAR || inNE || inIA || inTXPanhandle || inCOEast;

  if (!inSupportedRegion) {
    // Tag best-guess state for server-log correlation (rough prox only)
    let likelyState = 'OUT_OF_REGION';
    if (latNum >= 33.0 && latNum <= 37.0 && lngNum >= -103.1 && lngNum <= -94.3) likelyState = 'OK_EDGE';
    else if (latNum >= 32.5 && latNum <= 36.6 && lngNum >= -94.7 && lngNum <= -89.5) likelyState = 'AR_EDGE';
    else if (latNum >= 39.5 && latNum <= 43.5 && lngNum >= -104.2 && lngNum <= -95.2) likelyState = 'NE_EDGE';
    else if (latNum >= 40.0 && latNum <= 43.6 && lngNum >= -96.8 && lngNum <= -90.0) likelyState = 'IA_EDGE';
    else if (latNum >= 34.0 && latNum <= 36.7 && lngNum >= -103.2 && lngNum <= -99.8) likelyState = 'TX_PANHANDLE_EDGE';
    else if (latNum >= 36.8 && latNum <= 41.1 && lngNum >= -105.9 && lngNum <= -101.9) likelyState = 'CO_EAST_EDGE';

    console.warn('[PARCEL LOOKUP] Region gate blocked request', {
      lat: latNum,
      lng: lngNum,
      likelyState,
      inKS,
      inMO,
      inOK,
      inAR,
      inNE,
      inIA,
      inTXPanhandle,
      inCOEast,
    });
    return NextResponse.json(
      {
        found: false,
        error:
          "Location outside current coverage area. Supported states: KS, MO, OK, AR, NE, IA, TX panhandle, eastern CO.",
        likelyState,
      },
      { status: 200 }
    );
  }

  const apiKey = process.env.REGRID_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json(
      { found: false, error: "Regrid API not configured" },
      { status: 500 }
    );
  }
  
  // Helper to detect coordinate order
  const detectCoordOrder = (coords: number[][]): 'lng_lat' | 'lat_lng' | 'unknown' => {
    if (!coords?.length) return 'unknown';
    const [a, b] = coords[0];
    if (a < 0 && a > -140 && b > 20 && b < 55) return 'lng_lat';
    if (b < 0 && b > -140 && a > 20 && a < 55) return 'lat_lng';
    return 'unknown';
  };

  try {
    // Check cache first
    const cached = await getCachedParcel(latNum, lngNum);
    if (cached && cached.coordinates) {
      // Use stored geometry type or infer from coordinate structure
      const geoType = cached.geometryType || 
        (Array.isArray(cached.coordinates[0]?.[0]?.[0]) ? 'MultiPolygon' : 'Polygon');
      
      const normalizedCoords = normalizeToOuterRing(
        cached.coordinates as number[][][] | number[][][][],
        geoType
      );
      
      if (normalizedCoords) {
        // Validate the geometry
        const validation = validateParcelGeometry(cached.coordinates, geoType);
        if (!validation.valid) {
          console.warn('[PARCEL LOOKUP] Invalid cached geometry:', validation.errors);
          // Continue to fetch fresh data instead of returning invalid cached data
        } else {
          console.log('[PARCEL LOOKUP] Cache hit, valid geometry:', validation.area?.toFixed(1), 'ac');
          const response: ParcelLookupResponse = {
            found: true,
            cached: true,
            parcel: {
              parcelId: cached.parcelId || 'Unknown',
              address: cached.siteAddress || 'Unknown Address',
              county: cached.county || 'Unknown',
              state: cached.state || (inMO ? 'MO' : 'KS'),
              acreage: cached.acreage || validation.area || calculateAcreage(normalizedCoords),
              owner: cached.owner || 'Unknown',
              zoning: cached.zoning || 'N/A',
              coordinates: cached.coordinates || [normalizedCoords],
              centroid: validation.centroid || calculateCentroid(normalizedCoords),
              bounds: validation.bounds || calculateBounds(normalizedCoords),
              geometryType: geoType === 'MultiPolygon' ? 'MultiPolygon' : 'Polygon',
              legalDescription: cached.legalDescription || undefined,
              plss: [cached.plssTownship, cached.plssRange, cached.plssSection]
                .filter(Boolean).join(', ') || undefined,
            }
          };
          return NextResponse.json(response);
        }
      }
    }

    // Fetch from Regrid
    const searchUrl = `https://app.regrid.com/api/v1/search.json?lat=${lat}&lon=${lng}&token=${apiKey}`;

    const searchResponse = await fetch(searchUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    // Read body once as text so we can log it on any failure path
    const searchBodyText = await searchResponse.text();
    let searchData: any = null;
    try {
      searchData = JSON.parse(searchBodyText);
    } catch (parseErr) {
      console.error("[PARCEL LOOKUP] Regrid returned non-JSON", {
        lat: latNum,
        lng: lngNum,
        httpStatus: searchResponse.status,
        httpStatusText: searchResponse.statusText,
        rawBody: searchBodyText.slice(0, 2000),
      });
      return NextResponse.json(
        { found: false, error: `Regrid API returned non-JSON (${searchResponse.status})` },
        { status: 200 }
      );
    }

    if (!searchResponse.ok) {
      console.error("[PARCEL LOOKUP] Regrid HTTP error", {
        lat: latNum,
        lng: lngNum,
        httpStatus: searchResponse.status,
        httpStatusText: searchResponse.statusText,
        regridBody: searchData,
      });
      return NextResponse.json(
        { found: false, error: `Regrid API error: ${searchResponse.status}`, regrid: searchData },
        { status: 200 }
      );
    }

    if (searchData.status === "error") {
      console.error("[PARCEL LOOKUP] Regrid status=error", {
        lat: latNum,
        lng: lngNum,
        regridStatus: searchData.status,
        regridMessage: searchData.message,
        regridBody: searchData,
      });
      return NextResponse.json(
        { found: false, error: searchData.message || "Regrid lookup failed", regrid: searchData },
        { status: 200 }
      );
    }

    const results = searchData.results || [];

    if (results.length === 0) {
      console.warn("[PARCEL LOOKUP] Regrid returned 0 results (likely coverage gap or click on non-parcel)", {
        lat: latNum,
        lng: lngNum,
        regridBody: searchData,
      });
      return NextResponse.json(
        { found: false, error: "No parcel found at this location" },
        { status: 200 }
      );
    }

    const feature = results[0];
    const fields = feature.properties?.fields || {};
    const geoType = (feature.geometry?.type || 'Polygon') as 'Polygon' | 'MultiPolygon';
    const rawCoords = feature.geometry?.coordinates;
    
    if (!rawCoords) {
      return NextResponse.json(
        { found: false, error: "Parcel found but no geometry available" },
        { status: 200 }
      );
    }
    
    // Log raw geometry for debugging
    logGeometryDebug('Regrid response', rawCoords, geoType);
    
    // Validate the raw geometry
    const validation = validateParcelGeometry(rawCoords, geoType);
    if (!validation.valid) {
      console.error('[PARCEL LOOKUP] Invalid Regrid geometry:', validation.errors);
      return NextResponse.json(
        { found: false, error: `Parcel geometry invalid: ${validation.errors.join(', ')}` },
        { status: 200 }
      );
    }
    
    const normalizedCoords = normalizeToOuterRing(rawCoords, geoType);
    
    if (!normalizedCoords) {
      return NextResponse.json(
        { found: false, error: "Could not process parcel geometry" },
        { status: 200 }
      );
    }
    
    console.log('[PARCEL LOOKUP] Valid geometry:', validation.area?.toFixed(1), 'ac, bounds:', JSON.stringify(validation.bounds));
    
    // Build address
    const siteParts = [
      fields.address,
      fields.city || fields.situs_city,
      fields.state2 || fields.situs_state2,
      fields.szip || fields.situs_zip
    ].filter(Boolean);
    
    const parcelState = fields.state2 || (inMO ? 'MO' : 'KS');
    
    // Build PLSS string
    const plssParts = [
      fields.plss_township ? `T${fields.plss_township}` : null,
      fields.plss_range ? `R${fields.plss_range}` : null,
      fields.plss_section ? `S${fields.plss_section}` : null,
    ].filter(Boolean);
    
    // Extract raw outer ring for debug comparison
    let rawOuterRing: number[][] | null = null;
    if (geoType === 'Polygon') {
      rawOuterRing = rawCoords[0] as number[][];
    } else if (geoType === 'MultiPolygon') {
      // Get largest polygon's outer ring
      const polygons = rawCoords as number[][][][];
      let maxLen = 0;
      for (const poly of polygons) {
        if (poly[0] && poly[0].length > maxLen) {
          maxLen = poly[0].length;
          rawOuterRing = poly[0];
        }
      }
    }
    
    const response: ParcelLookupResponse = {
      found: true,
      parcel: {
        parcelId: fields.parcelnumb || fields.parcelnumb_no_formatting || 'Unknown',
        address: siteParts.length > 0 ? siteParts.join(', ') : feature.properties?.headline || 'Unknown Address',
        county: fields.county || 'Unknown',
        state: parcelState,
        acreage: fields.ll_gisacre || fields.gisacre || fields.acres || validation.area || calculateAcreage(normalizedCoords),
        owner: fields.owner || 'Unknown',
        zoning: fields.zoning || 'N/A',
        coordinates: feature.geometry?.coordinates || [normalizedCoords],
        centroid: validation.centroid || calculateCentroid(normalizedCoords),
        bounds: validation.bounds || calculateBounds(normalizedCoords),
        geometryType: feature.geometry?.type === 'MultiPolygon' ? 'MultiPolygon' : 'Polygon',
        legalDescription: fields.legaldesc || fields.legal_description || undefined,
        plss: plssParts.length > 0 ? plssParts.join(' ') : undefined,
      },
      // Add debug info if requested
      ...(debugMode && {
        debug: {
          rawCoords: rawOuterRing,
          rawGeometryType: geoType === 'MultiPolygon' ? 'MultiPolygon' as const : 'Polygon' as const,
          normalizedCoords,
          coordOrder: detectCoordOrder(normalizedCoords),
          validation: {
            valid: validation.valid,
            errors: validation.errors,
            warnings: validation.warnings,
          },
        }
      })
    };
    
    // Cache in background - store raw coordinates AND geometry type
    const cacheData: CachedParcelData = {
      parcelId: response.parcel!.parcelId,
      owner: response.parcel!.owner,
      mailingAddress: '',
      siteAddress: response.parcel!.address,
      acreage: response.parcel!.acreage,
      sqft: response.parcel!.acreage * 43560,
      zoning: response.parcel!.zoning,
      useDescription: fields.usedesc || '',
      coordinates: rawCoords as number[][][] | number[][][][],
      geometryType: geoType, // Store the actual geometry type!
      marketValue: fields.parval || null,
      landValue: fields.landval || null,
      improvementValue: fields.improvval || null,
      taxYear: fields.taxyear || null,
      saleDate: fields.saledate || null,
      salePrice: fields.saleprice || null,
      county: response.parcel!.county,
      state: parcelState,
      legalDescription: response.parcel!.legalDescription || null,
      plssTownship: fields.plss_township || null,
      plssRange: fields.plss_range || null,
      plssSection: fields.plss_section || null,
      buildingFootprints: null,
      qozStatus: null,
      femaFloodZone: fields.fema_flood_zone || null,
      schoolDistrict: null,
    };
    setCachedParcel(latNum, lngNum, cacheData).catch(console.error);

    return NextResponse.json(response);

  } catch (error: any) {
    console.error("Parcel lookup error:", error);
    
    // Handle rate limiting
    if (error.message?.includes('429') || error.message?.includes('rate')) {
      return NextResponse.json(
        { found: false, error: "Rate limit reached. Please wait a moment and try again." },
        { status: 200 }
      );
    }
    
    return NextResponse.json(
      { found: false, error: "Failed to lookup parcel" },
      { status: 500 }
    );
  }
}