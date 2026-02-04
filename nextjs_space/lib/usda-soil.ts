// USDA Soil Data Access (SDA) API Integration
// https://sdmdataaccess.nrcs.usda.gov/

export interface SoilData {
  mapUnitName: string;           // e.g., "Grundy silt loam"
  mapUnitKey: string;            // Unique soil map unit identifier
  drainageClass: string;         // e.g., "Well drained", "Poorly drained"
  farmlandClass: string;         // e.g., "All areas are prime farmland"
  landCapabilityClass: string;   // I-VIII scale
  landCapabilitySubclass: string;
  hydrologicGroup: string;       // A, B, C, D for runoff potential
  slopeGradient: string;         // e.g., "0 to 2 percent"
  parentMaterial: string;        // e.g., "Loess over glacial till"
  taxonomicClass: string;        // Full soil taxonomy
  awsTop: number | null;         // Available water storage (top 100cm) in cm
  organicMatter: number | null;  // % organic matter in surface
  ph: number | null;             // Soil pH
  cec: number | null;            // Cation exchange capacity
  cropYieldCorn: number | null;  // Bushels/acre potential
  cropYieldSoy: number | null;   // Bushels/acre potential
  septicSuitability: string;     // "Well suited", "Limited", "Very Limited"
  buildingSuitability: string;   // "Well suited", "Limited", "Very Limited"
  floodFrequency: string;        // "None", "Rare", "Occasional", "Frequent"
}

const DEFAULT_SOIL_DATA: SoilData = {
  mapUnitName: "Data not available",
  mapUnitKey: "N/A",
  drainageClass: "Unknown",
  farmlandClass: "Not determined",
  landCapabilityClass: "N/A",
  landCapabilitySubclass: "",
  hydrologicGroup: "N/A",
  slopeGradient: "Unknown",
  parentMaterial: "Not available",
  taxonomicClass: "Not available",
  awsTop: null,
  organicMatter: null,
  ph: null,
  cec: null,
  cropYieldCorn: null,
  cropYieldSoy: null,
  septicSuitability: "Not evaluated",
  buildingSuitability: "Not evaluated",
  floodFrequency: "Unknown",
};

// Query USDA Soil Data Access API
export async function fetchSoilData(lat: number, lng: number): Promise<SoilData> {
  try {
    console.log(`[USDA Soil] Fetching soil data for ${lat}, ${lng}`);
    
    // Use the simpler spatial query that SDA supports well
    const pointQuery = `
SELECT TOP 1 
  m.mukey, m.muname, m.farmlndcl,
  c.compname, c.drainagecl, c.hydgrp, c.slope_r, c.taxclname,
  c.nirrcapcl, c.nirrcapscl
FROM mapunit m
INNER JOIN component c ON m.mukey = c.mukey
WHERE m.mukey IN (
  SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lng} ${lat})')
)
AND c.majcompflag = 'Yes'
ORDER BY c.comppct_r DESC
    `.trim();
    
    const mainResponse = await querySDA(pointQuery);
    
    if (!mainResponse || !mainResponse.Table || mainResponse.Table.length === 0) {
      console.log("[USDA Soil] No soil data found for location");
      return DEFAULT_SOIL_DATA;
    }
    
    const row = mainResponse.Table[0];
    const mukey = row[0];
    const muname = row[1] || "Unknown";
    const farmlndcl = row[2] || "Not determined";
    const drainagecl = row[4] || "Unknown";
    const hydgrp = row[5] || "N/A";
    const slope = row[6];
    const taxclname = row[7] || "Not available";
    const nirrcapcl = row[8] || "N/A";
    const nirrcapscl = row[9] || "";
    
    console.log(`[USDA Soil] Found map unit: ${muname} (${mukey})`);
    
    // Get surface horizon properties (pH, organic matter)
    let organicMatter: number | null = null;
    let ph: number | null = null;
    let cec: number | null = null;
    
    try {
      const horizonQuery = `
SELECT TOP 1 ch.om_r, ch.ph1to1h2o_r, ch.cec7_r
FROM chorizon ch
INNER JOIN component c ON ch.cokey = c.cokey
WHERE c.mukey = '${mukey}'
AND c.majcompflag = 'Yes'
AND ch.hzdept_r = 0
ORDER BY c.comppct_r DESC
      `.trim();
      
      const horizonResponse = await querySDA(horizonQuery);
      if (horizonResponse?.Table?.[0]) {
        const hRow = horizonResponse.Table[0];
        organicMatter = hRow[0] ? parseFloat(hRow[0]) : null;
        ph = hRow[1] ? parseFloat(hRow[1]) : null;
        cec = hRow[2] ? parseFloat(hRow[2]) : null;
      }
    } catch (e) {
      console.log("[USDA Soil] Horizon query failed, using defaults");
    }
    
    // Get crop yield potential - simplified query
    let cornYield: number | null = null;
    let soyYield: number | null = null;
    
    try {
      const yieldQuery = `
SELECT cy.nonirryield_r, cy.cropname
FROM cocropyld cy
INNER JOIN component c ON cy.cokey = c.cokey
WHERE c.mukey = '${mukey}'
AND c.majcompflag = 'Yes'
AND cy.cropname IN ('Corn', 'Soybeans')
      `.trim();
      
      const yieldResponse = await querySDA(yieldQuery);
      if (yieldResponse?.Table) {
        for (const yRow of yieldResponse.Table) {
          if (yRow[1] === 'Corn' && yRow[0]) cornYield = parseFloat(yRow[0]);
          if (yRow[1] === 'Soybeans' && yRow[0]) soyYield = parseFloat(yRow[0]);
        }
      }
    } catch (e) {
      console.log("[USDA Soil] Yield query failed, using defaults");
    }
    
    // Get flood frequency
    let floodFreq = "None";
    try {
      const floodQuery = `
SELECT TOP 1 cm.flodfreqcl
FROM comonth cm
INNER JOIN component c ON cm.cokey = c.cokey
WHERE c.mukey = '${mukey}'
AND c.majcompflag = 'Yes'
AND cm.flodfreqcl IS NOT NULL
      `.trim();
      
      const floodResponse = await querySDA(floodQuery);
      if (floodResponse?.Table?.[0]?.[0]) {
        floodFreq = floodResponse.Table[0][0];
      }
    } catch (e) {
      console.log("[USDA Soil] Flood query failed, using default");
    }
    
    // Derive septic/building suitability from drainage class
    const septicSuitability = getSepticSuitabilityFromDrainage(drainagecl);
    const buildingSuitability = getBuildingSuitabilityFromDrainage(drainagecl);
    
    const result: SoilData = {
      mapUnitName: muname,
      mapUnitKey: mukey,
      drainageClass: drainagecl,
      farmlandClass: farmlndcl,
      landCapabilityClass: nirrcapcl,
      landCapabilitySubclass: nirrcapscl,
      hydrologicGroup: hydgrp,
      slopeGradient: slope ? `${slope}%` : "Unknown",
      parentMaterial: "Not available",
      taxonomicClass: taxclname,
      awsTop: null,
      organicMatter,
      ph,
      cec,
      cropYieldCorn: cornYield,
      cropYieldSoy: soyYield,
      septicSuitability,
      buildingSuitability,
      floodFrequency: floodFreq,
    };
    
    console.log(`[USDA Soil] Successfully retrieved soil data:`, result.mapUnitName, result.farmlandClass);
    return result;
    
  } catch (error) {
    console.error("[USDA Soil] Error fetching soil data:", error);
    return DEFAULT_SOIL_DATA;
  }
}

// Derive septic suitability from drainage class
function getSepticSuitabilityFromDrainage(drainageClass: string): string {
  const lower = drainageClass.toLowerCase();
  if (lower.includes('well drained') && !lower.includes('somewhat')) return "Well suited";
  if (lower.includes('moderately well')) return "Moderately suited";
  if (lower.includes('somewhat poorly') || lower.includes('somewhat excessively')) return "Limited";
  if (lower.includes('poorly') || lower.includes('excessively')) return "Very limited";
  return "Not evaluated";
}

// Derive building suitability from drainage class
function getBuildingSuitabilityFromDrainage(drainageClass: string): string {
  const lower = drainageClass.toLowerCase();
  if (lower.includes('well drained') && !lower.includes('somewhat')) return "Well suited";
  if (lower.includes('moderately well')) return "Moderately suited";
  if (lower.includes('somewhat poorly')) return "Moderately limited";
  if (lower.includes('poorly') || lower.includes('very poorly')) return "Very limited";
  if (lower.includes('excessively')) return "Somewhat limited";
  return "Not evaluated";
}

// Helper function to query SDA REST API
async function querySDA(sql: string): Promise<{ Table: string[][] } | null> {
  const url = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/SDMTabularService/post.rest";
  
  const body = {
    format: "JSON",
    query: sql.replace(/\s+/g, ' ').trim()
  };
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: new URLSearchParams(body as Record<string, string>),
      signal: AbortSignal.timeout(15000),
    });
    
    if (!response.ok) {
      console.error("[USDA Soil] SDA API error:", response.status);
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("[USDA Soil] SDA query error:", error);
    return null;
  }
}

// Helper to interpret farmland class for display
export function getFarmlandRating(farmlandClass: string): { rating: number; label: string; color: string } {
  const lower = farmlandClass.toLowerCase();
  
  if (lower.includes('prime farmland')) {
    return { rating: 5, label: "Prime Farmland", color: "#22c55e" };  // Green
  }
  if (lower.includes('farmland of statewide')) {
    return { rating: 4, label: "Statewide Importance", color: "#84cc16" };  // Lime
  }
  if (lower.includes('farmland of local')) {
    return { rating: 3, label: "Local Importance", color: "#eab308" };  // Yellow
  }
  if (lower.includes('not prime')) {
    return { rating: 2, label: "Not Prime", color: "#f97316" };  // Orange
  }
  
  return { rating: 0, label: "Not Evaluated", color: "#9ca3af" };  // Gray
}

// Helper to interpret drainage for septic/building
export function getDrainageRating(drainageClass: string): { rating: number; label: string } {
  const lower = drainageClass.toLowerCase();
  
  if (lower.includes('excessively') || lower.includes('somewhat excessively')) {
    return { rating: 4, label: "Excellent Drainage" };
  }
  if (lower.includes('well drained')) {
    return { rating: 5, label: "Well Drained" };
  }
  if (lower.includes('moderately well')) {
    return { rating: 3, label: "Moderate Drainage" };
  }
  if (lower.includes('somewhat poorly')) {
    return { rating: 2, label: "Limited Drainage" };
  }
  if (lower.includes('poorly') || lower.includes('very poorly')) {
    return { rating: 1, label: "Poor Drainage" };
  }
  
  return { rating: 0, label: "Unknown" };
}

// Helper to interpret land capability class
export function getCapabilityDescription(capClass: string): string {
  const descriptions: Record<string, string> = {
    'I': 'Best for cultivation - few limitations',
    'II': 'Good for cultivation - moderate limitations',
    'III': 'Suitable for cultivation - severe limitations',
    'IV': 'Limited cultivation - very severe limitations',
    'V': 'Not for cultivation - wetness/stones (grazing OK)',
    'VI': 'Not for cultivation - steep slopes (grazing OK)',
    'VII': 'Severe limits - only grazing or forestry',
    'VIII': 'Not suitable for farming - wildlife/recreation only',
  };
  
  return descriptions[capClass] || 'Classification not available';
}
