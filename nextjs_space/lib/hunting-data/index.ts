/**
 * Hunting Data Index
 * Central registry for state-specific hunting data modules.
 * 
 * To add a new state:
 * 1. Create a new file: /lib/hunting-data/{state-code}.ts
 * 2. Export functions matching the HuntingDataModule interface
 * 3. Register it in HUNTING_DATA_MODULES below
 */

import * as missouri from './missouri';

export interface CWDZone {
  county: string;
  status: 'management' | 'surveillance' | 'clear';
  restrictions?: string;
}

export interface SeasonDate {
  name: string;
  startDate: string;  // ISO format or "Month Day"
  endDate: string;
  weapon: string;
  notes?: string;
}

export interface CountyHarvestData {
  county: string;
  totalHarvest: number;
  buckHarvest: number;
  doeHarvest: number;
  year: number;
  trend?: 'up' | 'down' | 'stable';
}

export interface HuntingDataModule {
  // CWD
  getCWDStatus: (county: string) => CWDZone | null;
  getCWDZones: () => CWDZone[];
  
  // Seasons
  getSeasonDates: (year?: number) => SeasonDate[];
  getCurrentSeason: () => SeasonDate | null;
  
  // Harvest
  getCountyHarvest: (county: string) => CountyHarvestData | null;
  getHarvestPressure: (county: string) => 'low' | 'moderate' | 'high';
}

// Registry of state hunting data modules
const HUNTING_DATA_MODULES: Record<string, HuntingDataModule> = {
  MO: missouri,
};

/**
 * Get hunting data module for a state
 */
export function getHuntingData(stateCode: string): HuntingDataModule | null {
  const code = stateCode?.toUpperCase();
  return HUNTING_DATA_MODULES[code] || null;
}

/**
 * Check if hunting data exists for a state
 */
export function hasHuntingData(stateCode: string): boolean {
  return !!getHuntingData(stateCode);
}

/**
 * Get CWD status with graceful fallback
 */
export function getCWDStatusSafe(
  stateCode: string,
  county: string
): { status: string; hasData: boolean } {
  const module = getHuntingData(stateCode);
  
  if (module) {
    const zone = module.getCWDStatus(county);
    if (zone) {
      return {
        status: zone.status === 'management' 
          ? '⚠️ CWD Management Zone' 
          : zone.status === 'surveillance'
            ? '👁️ CWD Surveillance Zone'
            : '✅ No CWD Restrictions',
        hasData: true,
      };
    }
  }
  
  return {
    status: 'Check state DNR for CWD status',
    hasData: false,
  };
}
