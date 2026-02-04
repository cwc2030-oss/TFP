// Missouri Hunting & Conservation Data
// Updated for 2025-2026 Season

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
