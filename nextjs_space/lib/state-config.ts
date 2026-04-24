/**
 * State Configuration System
 * Controls which features are available per state for national expansion.
 * 
 * EXPANSION CHECKLIST:
 * 1. Add state to STATE_CONFIGS with feature flags
 * 2. Create state-specific hunting data file (if enabling hunting_intel)
 * 3. Add CWD zone data to hunting file
 * 4. Test Quick Look + 3D Preview first (lowest friction)
 */

export interface StateConfig {
  code: string;
  name: string;
  enabled: boolean;
  
  // Product availability
  products: {
    free_look: boolean;      // 3D terrain preview (national-ready)
    quick_look: boolean;     // Legacy broker report flag — product discontinued (kept for config compat)
    hunting_intel: boolean;  // $79 deer intel (state-specific)
    full_report: boolean;    // $350 custom (requires hunting_intel)
  };
  
  // Data source availability
  dataSources: {
    regrid: boolean;         // Parcel data (national)
    usda_soil: boolean;      // Soil data (national)
    fema_flood: boolean;     // Flood zones (national)
    cwd_zones: boolean;      // CWD management zones (state-specific)
    season_dates: boolean;   // Hunting season calendar (state-specific)
    harvest_data: boolean;   // County harvest stats (state-specific)
  };
  
  // Contact/resource links
  resources: {
    dnr_url: string;
    dnr_name: string;
    cwd_info_url: string;
  };
  
  // Timezone for season dates
  timezone: string;
}

// Full Missouri config (our gold standard)
const MISSOURI_CONFIG: StateConfig = {
  code: 'MO',
  name: 'Missouri',
  enabled: true,
  products: {
    free_look: true,
    quick_look: true,
    hunting_intel: true,
    full_report: true,
  },
  dataSources: {
    regrid: true,
    usda_soil: true,
    fema_flood: true,
    cwd_zones: true,
    season_dates: true,
    harvest_data: true,
  },
  resources: {
    dnr_url: 'https://mdc.mo.gov',
    dnr_name: 'Missouri Department of Conservation',
    cwd_info_url: 'https://mdc.mo.gov/hunting-trapping/species/deer/chronic-wasting-disease',
  },
  timezone: 'America/Chicago',
};

// Kansas - Phase 1 expansion candidate (similar terrain, adjacent)
const KANSAS_CONFIG: StateConfig = {
  code: 'KS',
  name: 'Kansas',
  enabled: true, // Enable for Quick Look + 3D Preview
  products: {
    free_look: true,
    quick_look: true,
    hunting_intel: false, // TODO: Build KS hunting data
    full_report: false,
  },
  dataSources: {
    regrid: true,
    usda_soil: true,
    fema_flood: true,
    cwd_zones: false,  // TODO: Add KS CWD zones
    season_dates: false,
    harvest_data: false,
  },
  resources: {
    dnr_url: 'https://ksoutdoors.com',
    dnr_name: 'Kansas Department of Wildlife & Parks',
    cwd_info_url: 'https://ksoutdoors.com/Hunting/Big-Game/Deer/CWD',
  },
  timezone: 'America/Chicago',
};

// Iowa - Phase 1 expansion candidate
const IOWA_CONFIG: StateConfig = {
  code: 'IA',
  name: 'Iowa',
  enabled: true,
  products: {
    free_look: true,
    quick_look: true,
    hunting_intel: false,
    full_report: false,
  },
  dataSources: {
    regrid: true,
    usda_soil: true,
    fema_flood: true,
    cwd_zones: false,
    season_dates: false,
    harvest_data: false,
  },
  resources: {
    dnr_url: 'https://www.iowadnr.gov',
    dnr_name: 'Iowa Department of Natural Resources',
    cwd_info_url: 'https://www.iowadnr.gov/Hunting/Deer-Hunting/Chronic-Wasting-Disease',
  },
  timezone: 'America/Chicago',
};

// Arkansas - Phase 1 expansion candidate
const ARKANSAS_CONFIG: StateConfig = {
  code: 'AR',
  name: 'Arkansas',
  enabled: true,
  products: {
    free_look: true,
    quick_look: true,
    hunting_intel: false,
    full_report: false,
  },
  dataSources: {
    regrid: true,
    usda_soil: true,
    fema_flood: true,
    cwd_zones: false,
    season_dates: false,
    harvest_data: false,
  },
  resources: {
    dnr_url: 'https://www.agfc.com',
    dnr_name: 'Arkansas Game and Fish Commission',
    cwd_info_url: 'https://www.agfc.com/en/hunting/big-game/deer/cwd/',
  },
  timezone: 'America/Chicago',
};

// Illinois - Phase 1 expansion candidate
const ILLINOIS_CONFIG: StateConfig = {
  code: 'IL',
  name: 'Illinois',
  enabled: true,
  products: {
    free_look: true,
    quick_look: true,
    hunting_intel: false,
    full_report: false,
  },
  dataSources: {
    regrid: true,
    usda_soil: true,
    fema_flood: true,
    cwd_zones: false,
    season_dates: false,
    harvest_data: false,
  },
  resources: {
    dnr_url: 'https://www2.illinois.gov/dnr',
    dnr_name: 'Illinois Department of Natural Resources',
    cwd_info_url: 'https://www2.illinois.gov/dnr/programs/CWD',
  },
  timezone: 'America/Chicago',
};

// Generic template for unsupported states (3D Preview only)
const GENERIC_CONFIG: StateConfig = {
  code: 'XX',
  name: 'Unknown',
  enabled: true, // 3D Preview works everywhere
  products: {
    free_look: true,  // Always available (Mapbox is global)
    quick_look: false,
    hunting_intel: false,
    full_report: false,
  },
  dataSources: {
    regrid: true,     // Regrid covers all 50 states
    usda_soil: true,  // USDA is federal
    fema_flood: true, // FEMA is federal
    cwd_zones: false,
    season_dates: false,
    harvest_data: false,
  },
  resources: {
    dnr_url: '',
    dnr_name: 'State Wildlife Agency',
    cwd_info_url: '',
  },
  timezone: 'America/New_York',
};

// Master config map
export const STATE_CONFIGS: Record<string, StateConfig> = {
  MO: MISSOURI_CONFIG,
  KS: KANSAS_CONFIG,
  IA: IOWA_CONFIG,
  AR: ARKANSAS_CONFIG,
  IL: ILLINOIS_CONFIG,
};

// ============ HELPER FUNCTIONS ============

/**
 * Get config for a state. Returns generic config if state not explicitly configured.
 */
export function getStateConfig(stateCode: string): StateConfig {
  const code = stateCode?.toUpperCase()?.trim();
  if (code && STATE_CONFIGS[code]) {
    return STATE_CONFIGS[code];
  }
  return { ...GENERIC_CONFIG, code: code || 'XX', name: stateCode || 'Unknown' };
}

/**
 * Check if a specific product is available in a state
 */
export function isProductAvailable(
  stateCode: string,
  product: keyof StateConfig['products']
): boolean {
  const config = getStateConfig(stateCode);
  return config.enabled && config.products[product];
}

/**
 * Check if a data source is available in a state
 */
export function isDataSourceAvailable(
  stateCode: string,
  source: keyof StateConfig['dataSources']
): boolean {
  const config = getStateConfig(stateCode);
  return config.dataSources[source];
}

/**
 * Get available products for a state (for UI display)
 */
export function getAvailableProducts(stateCode: string): string[] {
  const config = getStateConfig(stateCode);
  return Object.entries(config.products)
    .filter(([_, available]) => available)
    .map(([product]) => product);
}

/**
 * Get CWD status message - graceful degradation for unsupported states
 */
export function getCWDStatusMessage(stateCode: string, county?: string): string {
  const config = getStateConfig(stateCode);
  
  if (config.dataSources.cwd_zones) {
    // State has CWD data - use actual lookup (import from state-specific file)
    return ''; // Let the state-specific function handle it
  }
  
  // Graceful fallback
  const dnrName = config.resources.dnr_name;
  const cwd_url = config.resources.cwd_info_url;
  
  if (cwd_url) {
    return `CWD Status: Check ${dnrName}`;
  }
  return 'CWD Status: Verify with state wildlife agency';
}

/**
 * List all enabled states (for marketing/footer)
 */
export function getEnabledStates(): StateConfig[] {
  return Object.values(STATE_CONFIGS).filter(s => s.enabled);
}

/**
 * List states with full hunting intel (for marketing)
 */
export function getHuntingIntelStates(): StateConfig[] {
  return Object.values(STATE_CONFIGS).filter(s => s.products.hunting_intel);
}

// ============ STATE DETECTION ============

/**
 * Extract state code from address string
 * Handles formats like "City, MO 12345" or "City, Missouri"
 */
export function extractStateFromAddress(address: string): string | null {
  if (!address) return null;
  
  // Common state abbreviations pattern
  const abbrevMatch = address.match(/,\s*([A-Z]{2})\s*\d{5}/i);
  if (abbrevMatch) return abbrevMatch[1].toUpperCase();
  
  // State name to code mapping
  const stateNames: Record<string, string> = {
    'missouri': 'MO',
    'kansas': 'KS',
    'iowa': 'IA',
    'arkansas': 'AR',
    'illinois': 'IL',
    'nebraska': 'NE',
    'oklahoma': 'OK',
    'tennessee': 'TN',
    'kentucky': 'KY',
    'texas': 'TX',
    // Add more as needed
  };
  
  const lowerAddress = address.toLowerCase();
  for (const [name, code] of Object.entries(stateNames)) {
    if (lowerAddress.includes(name)) return code;
  }
  
  return null;
}
