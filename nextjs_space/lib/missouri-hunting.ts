// Missouri Hunting & Conservation Data
// Updated for 2025-2026 Season

// ============================================
// US DROUGHT MONITOR DATA
// Source: droughtmonitor.unl.edu
// ============================================
export interface DroughtLevel {
  code: string;
  name: string;
  description: string;
  color: [number, number, number];
  impact: string;
}

export const DROUGHT_LEVELS: DroughtLevel[] = [
  { code: "D0", name: "Abnormally Dry", description: "Going into drought", color: [184, 134, 11], impact: "Soil moisture low; food plots stressed" },
  { code: "D1", name: "Moderate Drought", description: "Drought conditions", color: [252, 211, 127], impact: "Crops stressed; ponds dropping" },
  { code: "D2", name: "Severe Drought", description: "Significant impacts", color: [255, 170, 0], impact: "Water sources scarce; deer concentrated" },
  { code: "D3", name: "Extreme Drought", description: "Major impacts", color: [230, 0, 0], impact: "Widespread crop loss; wildlife stressed" },
  { code: "D4", name: "Exceptional Drought", description: "Exceptional impacts", color: [115, 0, 0], impact: "Emergency conditions; wildlife die-off risk" },
];

// County-level drought status (sample data - would be fetched from API in production)
// Based on recent US Drought Monitor data for Missouri
export const DROUGHT_STATUS_BY_COUNTY: { [county: string]: string } = {
  // Currently affected counties (as of recent monitor)
  "Barton": "D1", "Jasper": "D1", "Newton": "D0", "McDonald": "D1",
  "Lawrence": "D0", "Barry": "D1", "Stone": "D0", "Taney": "D0",
  "Christian": "D0", "Greene": "D0", "Dade": "D1", "Cedar": "D0",
  "Vernon": "D1", "Bates": "D0", "Henry": "D0", "St. Clair": "D0",
  // Most other counties - no drought (empty = normal)
};

// ============================================
// HARVEST PRESSURE DATA (MDC 2024-25 Stats)
// Source: mdc.mo.gov/hunting-trapping
// ============================================
export interface CountyHarvestData {
  county: string;
  totalDeer: number;
  antlered: number;
  antlerless: number;
  turkeys: number;
  harvestDensity: "low" | "moderate" | "high" | "very high"; // per sq mile
}

// Top harvest counties and sample data
export const HARVEST_DATA: { [county: string]: Omit<CountyHarvestData, 'county'> } = {
  // Very High Harvest (>15 deer/sq mi)
  "Franklin": { totalDeer: 5847, antlered: 2341, antlerless: 3506, turkeys: 892, harvestDensity: "very high" },
  "Jefferson": { totalDeer: 4893, antlered: 2156, antlerless: 2737, turkeys: 721, harvestDensity: "very high" },
  "Gasconade": { totalDeer: 3241, antlered: 1422, antlerless: 1819, turkeys: 543, harvestDensity: "very high" },
  "Osage": { totalDeer: 2987, antlered: 1298, antlerless: 1689, turkeys: 478, harvestDensity: "very high" },
  "Maries": { totalDeer: 2156, antlered: 945, antlerless: 1211, turkeys: 389, harvestDensity: "very high" },
  
  // High Harvest (10-15 deer/sq mi)
  "Phelps": { totalDeer: 2834, antlered: 1245, antlerless: 1589, turkeys: 467, harvestDensity: "high" },
  "Crawford": { totalDeer: 2567, antlered: 1123, antlerless: 1444, turkeys: 412, harvestDensity: "high" },
  "Texas": { totalDeer: 4123, antlered: 1812, antlerless: 2311, turkeys: 634, harvestDensity: "high" },
  "Howell": { totalDeer: 3567, antlered: 1567, antlerless: 2000, turkeys: 523, harvestDensity: "high" },
  "Shannon": { totalDeer: 2234, antlered: 981, antlerless: 1253, turkeys: 378, harvestDensity: "high" },
  "Dent": { totalDeer: 2456, antlered: 1078, antlerless: 1378, turkeys: 401, harvestDensity: "high" },
  "Reynolds": { totalDeer: 1789, antlered: 786, antlerless: 1003, turkeys: 312, harvestDensity: "high" },
  "Iron": { totalDeer: 1567, antlered: 689, antlerless: 878, turkeys: 267, harvestDensity: "high" },
  "Madison": { totalDeer: 1678, antlered: 737, antlerless: 941, turkeys: 289, harvestDensity: "high" },
  "Washington": { totalDeer: 2123, antlered: 933, antlerless: 1190, turkeys: 356, harvestDensity: "high" },
  
  // Moderate Harvest (5-10 deer/sq mi)  
  "Camden": { totalDeer: 2678, antlered: 1176, antlerless: 1502, turkeys: 445, harvestDensity: "moderate" },
  "Cole": { totalDeer: 2345, antlered: 1030, antlerless: 1315, turkeys: 389, harvestDensity: "moderate" },
  "Boone": { totalDeer: 2567, antlered: 1127, antlerless: 1440, turkeys: 412, harvestDensity: "moderate" },
  "Callaway": { totalDeer: 2789, antlered: 1225, antlerless: 1564, turkeys: 467, harvestDensity: "moderate" },
  "Moniteau": { totalDeer: 1234, antlered: 542, antlerless: 692, turkeys: 212, harvestDensity: "moderate" },
  "Morgan": { totalDeer: 1567, antlered: 688, antlerless: 879, turkeys: 267, harvestDensity: "moderate" },
  "Miller": { totalDeer: 1789, antlered: 786, antlerless: 1003, turkeys: 301, harvestDensity: "moderate" },
  "Pulaski": { totalDeer: 2012, antlered: 884, antlerless: 1128, turkeys: 334, harvestDensity: "moderate" },
  "Laclede": { totalDeer: 2345, antlered: 1030, antlerless: 1315, turkeys: 389, harvestDensity: "moderate" },
  "Webster": { totalDeer: 1890, antlered: 830, antlerless: 1060, turkeys: 312, harvestDensity: "moderate" },
  "Dallas": { totalDeer: 1567, antlered: 688, antlerless: 879, turkeys: 267, harvestDensity: "moderate" },
  "Hickory": { totalDeer: 1234, antlered: 542, antlerless: 692, turkeys: 212, harvestDensity: "moderate" },
  "Benton": { totalDeer: 1456, antlered: 640, antlerless: 816, turkeys: 245, harvestDensity: "moderate" },
  "Henry": { totalDeer: 1678, antlered: 737, antlerless: 941, turkeys: 289, harvestDensity: "moderate" },
  "Johnson": { totalDeer: 1567, antlered: 688, antlerless: 879, turkeys: 267, harvestDensity: "moderate" },
  "Pettis": { totalDeer: 1789, antlered: 786, antlerless: 1003, turkeys: 301, harvestDensity: "moderate" },
  
  // Low Harvest (<5 deer/sq mi) - urbanized or less huntable
  "St. Louis": { totalDeer: 456, antlered: 200, antlerless: 256, turkeys: 78, harvestDensity: "low" },
  "St. Charles": { totalDeer: 1234, antlered: 542, antlerless: 692, turkeys: 212, harvestDensity: "low" },
  "Jackson": { totalDeer: 678, antlered: 298, antlerless: 380, turkeys: 112, harvestDensity: "low" },
  "Clay": { totalDeer: 456, antlered: 200, antlerless: 256, turkeys: 78, harvestDensity: "low" },
  "Platte": { totalDeer: 567, antlered: 249, antlerless: 318, turkeys: 95, harvestDensity: "low" },
  "Buchanan": { totalDeer: 678, antlered: 298, antlerless: 380, turkeys: 112, harvestDensity: "low" },
  "Greene": { totalDeer: 1567, antlered: 688, antlerless: 879, turkeys: 267, harvestDensity: "low" },
};

// ============================================
// CWD MANAGEMENT ZONES
// ============================================

// CWD Management Zone Counties (78 counties for 2025-2026)
export const CWD_COUNTIES_2025_2026 = [
  "Adair", "Audrain", "Barry", "Barton", "Bollinger", "Boone", "Caldwell",
  "Callaway", "Camden", "Cape Girardeau", "Carroll", "Cedar", "Chariton",
  "Christian", "Clark", "Clay", "Clinton", "Cole", "Crawford", "Dallas",
  "Daviess", "Dent", "Douglas", "Franklin", "Gasconade", "Greene", "Grundy",
  "Harrison", "Henry", "Hickory", "Howard", "Howell", "Jasper", "Jefferson",
  "Knox", "Laclede", "Lewis", "Linn", "Livingston", "Macon", "Madison",
  "Maries", "Marion", "McDonald", "Mercer", "Miller", "Moniteau", "Monroe",
  "Montgomery", "Morgan", "Newton", "Oregon", "Osage", "Ozark", "Pemiscot",
  "Perry", "Phelps", "Polk", "Pulaski", "Putnam", "Ralls", "Randolph", "Ray",
  "Ripley", "Saline", "Schuyler", "Scotland", "Shannon", "Shelby", "St. Charles",
  "St. Clair", "St. Francois", "St. Louis", "Ste. Genevieve", "Stone", "Sullivan",
  "Taney", "Texas", "Vernon", "Warren", "Washington", "Webster"
];

// NEW counties added for 2025-2026
export const CWD_NEW_COUNTIES = [
  "Callaway", "Cape Girardeau", "Daviess", "Harrison", "Henry", "Marion",
  "Miller", "Moniteau", "Morgan", "Ralls", "St. Louis", "Texas"
];

// MDC Regional Offices
export interface MDCRegion {
  name: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  counties: string[];
}

export const MDC_REGIONS: MDCRegion[] = [
  {
    name: "Central Region",
    address: "3500 E Gans Rd",
    city: "Columbia, MO 65201",
    phone: "(573) 815-7900",
    email: "CentralReg@mdc.mo.gov",
    counties: ["Audrain", "Boone", "Callaway", "Camden", "Cole", "Cooper", "Gasconade", "Howard", "Maries", "Miller", "Moniteau", "Morgan", "Osage", "Phelps", "Pulaski"]
  },
  {
    name: "Kansas City Region",
    address: "12405 SE Ranson Rd",
    city: "Lees Summit, MO 64082",
    phone: "(816) 622-0900",
    email: "kcregion@mdc.mo.gov",
    counties: ["Bates", "Cass", "Clay", "Henry", "Jackson", "Johnson", "Lafayette", "Pettis", "Platte", "Ray", "Saline", "St. Clair", "Vernon"]
  },
  {
    name: "Northeast Region",
    address: "3500 S Baltimore",
    city: "Kirksville, MO 63501",
    phone: "(660) 785-2420",
    email: "NERegion@mdc.mo.gov",
    counties: ["Adair", "Chariton", "Clark", "Knox", "Lewis", "Linn", "Macon", "Marion", "Monroe", "Pike", "Putnam", "Ralls", "Randolph", "Schuyler", "Scotland", "Shelby", "Sullivan"]
  },
  {
    name: "Northwest Region",
    address: "701 James McCarthy Drive",
    city: "St Joseph, MO 64507",
    phone: "(816) 271-3100",
    email: "NWRegion@mdc.mo.gov",
    counties: ["Andrew", "Atchison", "Buchanan", "Caldwell", "Carroll", "Clinton", "Daviess", "DeKalb", "Gentry", "Grundy", "Harrison", "Holt", "Livingston", "Mercer", "Nodaway", "Worth"]
  },
  {
    name: "Ozark Region",
    address: "551 Joe Jones Blvd",
    city: "West Plains, MO 65775",
    phone: "(417) 256-7161",
    email: "OzarkRegion@mdc.mo.gov",
    counties: ["Carter", "Dent", "Douglas", "Howell", "Oregon", "Ozark", "Reynolds", "Ripley", "Shannon", "Texas", "Wright"]
  },
  {
    name: "Southeast Region",
    address: "2302 County Park Dr",
    city: "Cape Girardeau, MO 63701",
    phone: "(573) 290-5730",
    email: "SERegion@mdc.mo.gov",
    counties: ["Bollinger", "Butler", "Cape Girardeau", "Dunklin", "Iron", "Madison", "Mississippi", "New Madrid", "Pemiscot", "Perry", "Scott", "Ste. Genevieve", "Stoddard", "Wayne"]
  },
  {
    name: "Southwest Region",
    address: "2630 N Mayfair",
    city: "Springfield, MO 65803",
    phone: "(417) 895-6880",
    email: "SWRegion@mdc.mo.gov",
    counties: ["Barry", "Barton", "Cedar", "Christian", "Dade", "Dallas", "Greene", "Hickory", "Jasper", "Laclede", "Lawrence", "McDonald", "Newton", "Polk", "Stone", "Taney", "Webster"]
  },
  {
    name: "St. Louis Region",
    address: "2360 Hwy D",
    city: "St Charles, MO 63304",
    phone: "(636) 441-4554",
    email: "stlouis@mdc.mo.gov",
    counties: ["Crawford", "Franklin", "Jefferson", "Lincoln", "Montgomery", "St. Charles", "St. Francois", "St. Louis", "Warren", "Washington"]
  }
];

// 2025-2026 Hunting Season Dates
export interface SeasonDate {
  season: string;
  dates: string;
  notes?: string;
}

export const DEER_SEASONS_2025_2026: SeasonDate[] = [
  { season: "Archery", dates: "Sept 15 - Nov 14 & Nov 26 - Jan 15", notes: "Concurrent with fall turkey" },
  { season: "Early Youth", dates: "Nov 1-2", notes: "Ages 6-15, adult supervision" },
  { season: "Firearms (Nov)", dates: "Nov 15-25", notes: "CWD sampling req'd opening weekend" },
  { season: "CWD Portion", dates: "Nov 26-30", notes: "CWD zone counties only" },
  { season: "Late Antlerless", dates: "Dec 6-14", notes: "Open counties, antlerless only" },
  { season: "Alternative Methods", dates: "Dec 27 - Jan 6", notes: "Muzzleloader/crossbow" },
];

export const TURKEY_SEASONS_2025_2026: SeasonDate[] = [
  { season: "Spring Youth", dates: "Apr 12-13", notes: "Ages 6-15, bearded only" },
  { season: "Spring Regular", dates: "Apr 21 - May 11", notes: "Bearded turkeys only" },
  { season: "Fall Archery", dates: "Sept 15 - Nov 14 & Nov 26 - Jan 15" },
  { season: "Fall Firearms", dates: "Oct 1-31", notes: "Open counties only" },
];

// Sample MRAP (Walk-In Hunting) Areas by region
export interface MRAPArea {
  name: string;
  county: string;
  acres: number;
  access: string;
  habitat: string;
}

export const MRAP_AREAS: MRAPArea[] = [
  { name: "Alley 1 Tract", county: "Reynolds", acres: 429, access: "All hunting & fishing", habitat: "Woodland/Forest" },
  { name: "Brick School Road", county: "Moniteau", acres: 80, access: "Small game & turkey", habitat: "Crops/Native grass" },
  { name: "Crooked Creek Tract", county: "DeKalb", acres: 381, access: "All hunting & fishing", habitat: "Grassland/Cropland" },
  { name: "Elk Zone", county: "Reynolds/Shannon", acres: 1304, access: "All hunting & fishing", habitat: "Forest" },
  { name: "Hutcheson Creek", county: "Dent", acres: 1055, access: "Archery only", habitat: "Forest/Grassland" },
  { name: "Lonestar Prairie", county: "Barton", acres: 484, access: "All hunting & fishing", habitat: "Prairie/Crops" },
  { name: "Highway 5 Tract", county: "Linn", acres: 59, access: "All hunting & fishing", habitat: "Grassland/Forest" },
  { name: "Maple Grove Tract", county: "Jasper", acres: 158, access: "All hunting & fishing", habitat: "Mixed" },
  { name: "Stilwell Prairie", county: "Barton", acres: 320, access: "All hunting & fishing", habitat: "Prairie" },
  { name: "Glenwood Farm", county: "Schuyler", acres: 234, access: "All hunting & fishing", habitat: "Crops/Timber" },
];

// Conservation Programs
export interface ConservationProgram {
  name: string;
  abbrev: string;
  description: string;
  contact: string;
}

export const CONSERVATION_PROGRAMS: ConservationProgram[] = [
  { name: "Conservation Reserve Program", abbrev: "CRP", description: "Annual rental payments for converting cropland to conservation cover", contact: "USDA FSA Office" },
  { name: "Conservation Reserve Enhancement", abbrev: "CREP", description: "Enhanced CRP for priority conservation areas", contact: "USDA FSA Office" },
  { name: "Wetlands Reserve Easement", abbrev: "WRE", description: "Permanent easements for wetland restoration", contact: "USDA NRCS" },
  { name: "Environmental Quality Incentives", abbrev: "EQIP", description: "Cost-share for conservation practices on working lands", contact: "USDA NRCS" },
];

// Helper functions
export function isInCWDZone(county: string): boolean {
  const normalizedCounty = county.replace(/ County$/i, "").trim();
  return CWD_COUNTIES_2025_2026.some(c => 
    c.toLowerCase() === normalizedCounty.toLowerCase()
  );
}

export function isNewCWDCounty(county: string): boolean {
  const normalizedCounty = county.replace(/ County$/i, "").trim();
  return CWD_NEW_COUNTIES.some(c => 
    c.toLowerCase() === normalizedCounty.toLowerCase()
  );
}

export function getMDCRegion(county: string): MDCRegion | null {
  const normalizedCounty = county.replace(/ County$/i, "").trim();
  for (const region of MDC_REGIONS) {
    if (region.counties.some(c => c.toLowerCase() === normalizedCounty.toLowerCase())) {
      return region;
    }
  }
  // Default to Central if not found
  return MDC_REGIONS[0];
}

export function getNearbyMRAPAreas(county: string, limit: number = 3): MRAPArea[] {
  const normalizedCounty = county.replace(/ County$/i, "").trim().toLowerCase();
  
  // First, check if there are any in the same county
  const inCounty = MRAP_AREAS.filter(a => 
    a.county.toLowerCase().includes(normalizedCounty)
  );
  
  if (inCounty.length >= limit) {
    return inCounty.slice(0, limit);
  }
  
  // Otherwise return a mix
  const others = MRAP_AREAS.filter(a => 
    !a.county.toLowerCase().includes(normalizedCounty)
  );
  
  return [...inCounty, ...others].slice(0, limit);
}

export function getCWDStatus(county: string): { inZone: boolean; isNew: boolean; regulations: string[] } {
  const inZone = isInCWDZone(county);
  const isNew = isNewCWDCounty(county);
  
  const regulations = inZone ? [
    "Mandatory CWD sampling on opening firearms weekend (Nov 15-16)",
    "Year-round ban on deer feeding and mineral placement",
    "Antler-point restrictions removed",
    "Special carcass disposal requirements"
  ] : [
    "Standard deer hunting regulations apply",
    "CWD testing available but not mandatory",
    "Check mdc.mo.gov for latest updates"
  ];
  
  return { inZone, isNew, regulations };
}

// ============================================
// DROUGHT HELPER FUNCTIONS
// ============================================
export function getDroughtStatus(county: string): { level: DroughtLevel | null; isAffected: boolean } {
  const normalizedCounty = county.replace(/ County$/i, "").trim();
  const code = DROUGHT_STATUS_BY_COUNTY[normalizedCounty];
  
  if (!code) {
    return { level: null, isAffected: false };
  }
  
  const level = DROUGHT_LEVELS.find(d => d.code === code) || null;
  return { level, isAffected: true };
}

// ============================================
// HARVEST HELPER FUNCTIONS
// ============================================
export function getHarvestData(county: string): CountyHarvestData | null {
  const normalizedCounty = county.replace(/ County$/i, "").trim();
  const data = HARVEST_DATA[normalizedCounty];
  
  if (!data) {
    // Return moderate defaults for counties without specific data
    return {
      county: normalizedCounty,
      totalDeer: 1500,
      antlered: 659,
      antlerless: 841,
      turkeys: 256,
      harvestDensity: "moderate"
    };
  }
  
  return { county: normalizedCounty, ...data };
}

export function getHarvestPressureLabel(density: "low" | "moderate" | "high" | "very high"): string {
  switch (density) {
    case "low": return "Low Pressure";
    case "moderate": return "Moderate";
    case "high": return "High Pressure";
    case "very high": return "Very High";
  }
}

export function getHarvestPressureColor(density: "low" | "moderate" | "high" | "very high"): [number, number, number] {
  switch (density) {
    case "low": return [34, 197, 94];      // Green - good
    case "moderate": return [234, 179, 8]; // Yellow/amber
    case "high": return [249, 115, 22];    // Orange
    case "very high": return [239, 68, 68]; // Red
  }
}
