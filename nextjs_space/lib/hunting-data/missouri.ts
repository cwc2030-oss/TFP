/**
 * Missouri Hunting Data
 * Source: Missouri Department of Conservation (mdc.mo.gov)
 * 
 * This is the reference implementation for state hunting data.
 * Copy this structure when adding new states.
 */

import type { CWDZone, SeasonDate, CountyHarvestData } from './index';

// ============ CWD ZONES ============
// Updated for 2025-2026 season
// Source: https://mdc.mo.gov/hunting-trapping/species/deer/chronic-wasting-disease

const CWD_MANAGEMENT_COUNTIES = [
  'Adair', 'Cedar', 'Chariton', 'Clark', 'Cole', 'Crawford', 'Dade',
  'Franklin', 'Gasconade', 'Hickory', 'Jefferson', 'Knox', 'Linn',
  'Livingston', 'Macon', 'Mercer', 'Miller', 'Moniteau', 'Morgan',
  'Osage', 'Perry', 'Polk', 'Putnam', 'St. Charles', 'St. Clair',
  'St. Francois', 'Ste. Genevieve', 'Schuyler', 'Scotland', 'Sullivan',
  'Warren', 'Washington',
];

const CWD_SURVEILLANCE_COUNTIES = [
  'Boone', 'Callaway', 'Camden', 'Cooper', 'Dallas', 'Howard',
  'Laclede', 'Phelps', 'Pulaski', 'Randolph',
];

export function getCWDStatus(county: string): CWDZone | null {
  const normalized = county?.trim();
  if (!normalized) return null;
  
  if (CWD_MANAGEMENT_COUNTIES.some(c => 
    c.toLowerCase() === normalized.toLowerCase()
  )) {
    return {
      county: normalized,
      status: 'management',
      restrictions: 'Mandatory CWD testing. No whole carcass transport out of zone.',
    };
  }
  
  if (CWD_SURVEILLANCE_COUNTIES.some(c => 
    c.toLowerCase() === normalized.toLowerCase()
  )) {
    return {
      county: normalized,
      status: 'surveillance',
      restrictions: 'Voluntary CWD testing available.',
    };
  }
  
  return {
    county: normalized,
    status: 'clear',
  };
}

export function getCWDZones(): CWDZone[] {
  const zones: CWDZone[] = [];
  
  CWD_MANAGEMENT_COUNTIES.forEach(county => {
    zones.push({ county, status: 'management' });
  });
  
  CWD_SURVEILLANCE_COUNTIES.forEach(county => {
    zones.push({ county, status: 'surveillance' });
  });
  
  return zones;
}

// ============ SEASON DATES ============
// 2025-2026 Missouri Deer Season
// Source: https://mdc.mo.gov/hunting-trapping/species/deer/deer-hunting-seasons

const SEASONS_2025_2026: SeasonDate[] = [
  {
    name: 'Archery',
    startDate: 'September 15',
    endDate: 'November 14',
    weapon: 'Bow/Crossbow',
    notes: 'Resumes November 26 - January 15',
  },
  {
    name: 'Early Youth',
    startDate: 'November 1',
    endDate: 'November 2',
    weapon: 'Any legal method',
    notes: 'Ages 6-15 with adult mentor',
  },
  {
    name: 'November Firearms',
    startDate: 'November 15',
    endDate: 'November 25',
    weapon: 'Firearms',
    notes: 'Peak rut timing',
  },
  {
    name: 'Late Youth',
    startDate: 'November 28',
    endDate: 'November 30',
    weapon: 'Any legal method',
  },
  {
    name: 'Antlerless',
    startDate: 'December 6',
    endDate: 'December 14',
    weapon: 'Firearms',
    notes: 'Doe management',
  },
  {
    name: 'Alternative Methods',
    startDate: 'December 27',
    endDate: 'January 6',
    weapon: 'Muzzleloader/Atlatl/Bow',
  },
];

export function getSeasonDates(year?: number): SeasonDate[] {
  // For now, return current seasons
  // TODO: Add historical data support
  return SEASONS_2025_2026;
}

export function getCurrentSeason(): SeasonDate | null {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  
  // Simple date matching (could be more sophisticated)
  if (month === 9 && day >= 15) return SEASONS_2025_2026[0]; // Archery
  if (month === 10) return SEASONS_2025_2026[0]; // Archery
  if (month === 11 && day <= 2) return SEASONS_2025_2026[1]; // Early Youth
  if (month === 11 && day >= 15 && day <= 25) return SEASONS_2025_2026[2]; // Firearms
  if (month === 11 && day >= 26) return SEASONS_2025_2026[0]; // Archery resumes
  if (month === 12 && day >= 6 && day <= 14) return SEASONS_2025_2026[4]; // Antlerless
  if (month === 12 && day >= 27) return SEASONS_2025_2026[5]; // Alt Methods
  if (month === 1 && day <= 6) return SEASONS_2025_2026[5]; // Alt Methods
  if (month === 1 && day <= 15) return SEASONS_2025_2026[0]; // Late Archery
  
  return null; // Off-season
}

// ============ HARVEST DATA ============
// County-level harvest statistics
// Source: MDC Annual Harvest Reports

const HARVEST_DATA_2024: Record<string, CountyHarvestData> = {
  'Franklin': { county: 'Franklin', totalHarvest: 4521, buckHarvest: 2105, doeHarvest: 2416, year: 2024, trend: 'stable' },
  'Jefferson': { county: 'Jefferson', totalHarvest: 3892, buckHarvest: 1834, doeHarvest: 2058, year: 2024, trend: 'up' },
  'St. Charles': { county: 'St. Charles', totalHarvest: 2156, buckHarvest: 1012, doeHarvest: 1144, year: 2024, trend: 'stable' },
  'Gasconade': { county: 'Gasconade', totalHarvest: 2834, buckHarvest: 1298, doeHarvest: 1536, year: 2024, trend: 'stable' },
  'Osage': { county: 'Osage', totalHarvest: 2567, buckHarvest: 1189, doeHarvest: 1378, year: 2024, trend: 'down' },
  'Maries': { county: 'Maries', totalHarvest: 1923, buckHarvest: 892, doeHarvest: 1031, year: 2024, trend: 'stable' },
  'Crawford': { county: 'Crawford', totalHarvest: 3102, buckHarvest: 1445, doeHarvest: 1657, year: 2024, trend: 'up' },
  'Washington': { county: 'Washington', totalHarvest: 2789, buckHarvest: 1312, doeHarvest: 1477, year: 2024, trend: 'stable' },
  'Phelps': { county: 'Phelps', totalHarvest: 2234, buckHarvest: 1045, doeHarvest: 1189, year: 2024, trend: 'stable' },
  'Dent': { county: 'Dent', totalHarvest: 2456, buckHarvest: 1134, doeHarvest: 1322, year: 2024, trend: 'up' },
  'Texas': { county: 'Texas', totalHarvest: 4123, buckHarvest: 1912, doeHarvest: 2211, year: 2024, trend: 'stable' },
  'Howell': { county: 'Howell', totalHarvest: 3567, buckHarvest: 1656, doeHarvest: 1911, year: 2024, trend: 'stable' },
  'Shannon': { county: 'Shannon', totalHarvest: 2012, buckHarvest: 934, doeHarvest: 1078, year: 2024, trend: 'down' },
  'Carter': { county: 'Carter', totalHarvest: 1534, buckHarvest: 712, doeHarvest: 822, year: 2024, trend: 'stable' },
  'Reynolds': { county: 'Reynolds', totalHarvest: 1423, buckHarvest: 661, doeHarvest: 762, year: 2024, trend: 'stable' },
  'Iron': { county: 'Iron', totalHarvest: 1289, buckHarvest: 598, doeHarvest: 691, year: 2024, trend: 'stable' },
  'Madison': { county: 'Madison', totalHarvest: 1567, buckHarvest: 728, doeHarvest: 839, year: 2024, trend: 'up' },
  // Add more counties as needed
};

export function getCountyHarvest(county: string): CountyHarvestData | null {
  const normalized = county?.trim();
  if (!normalized) return null;
  
  // Try exact match first
  if (HARVEST_DATA_2024[normalized]) {
    return HARVEST_DATA_2024[normalized];
  }
  
  // Try case-insensitive
  const key = Object.keys(HARVEST_DATA_2024).find(
    k => k.toLowerCase() === normalized.toLowerCase()
  );
  
  return key ? HARVEST_DATA_2024[key] : null;
}

export function getHarvestPressure(county: string): 'low' | 'moderate' | 'high' {
  const data = getCountyHarvest(county);
  
  if (!data) return 'moderate'; // Default assumption
  
  // Based on total harvest volume
  if (data.totalHarvest > 3500) return 'high';
  if (data.totalHarvest > 2000) return 'moderate';
  return 'low';
}
