/**
 * Water Proximity Component
 * 
 * Calculates average distance from stand sites to water sources.
 * Uses real hydro data when available, estimates from terrain draws otherwise.
 * 
 * Normalization: 0-1000m range, inverted (closer = higher score)
 * Formula: normalized = 1 - (avgDistanceMeters / 1000)
 */

import type { ComponentInput, ComponentResult, StandMetrics } from './types';
import type { StandPointProperties, FunnelProperties } from '@/types/terrain';

// Constants for water proximity calculation
const MAX_WATER_DISTANCE_METERS = 1000;
const DRAW_WATER_LIKELIHOOD = 0.7; // 70% of draws have seasonal water
const DRAW_PROXIMITY_ESTIMATE_METERS = 150; // Assume water ~150m from draw center

/**
 * Calculate water proximity score from terrain analysis data
 * 
 * Priority:
 * 1. Real hydro features (NHD streams, ponds) - if available
 * 2. Terrain draws as water proxy (draws often contain streams)
 * 3. Default estimate if no water indicators
 */
export function calculateWaterProximity(input: ComponentInput): ComponentResult {
  const { layers, summary, parcelAcres, hydroFeatures } = input;
  const stands = layers.standPoints.features;
  const funnels = layers.funnels.features;
  
  // Extract draws from funnels (draws often have water)
  const draws = funnels.filter(f => {
    const props = f.properties as FunnelProperties;
    return props.funnelType === 'draw';
  });
  
  let avgDistanceMeters: number;
  let dataSource: 'real' | 'estimated' | 'stubbed';
  let notes: string;
  let metadata: Record<string, unknown> = {};
  
  if (hydroFeatures && (hydroFeatures.streams.features.length > 0 || hydroFeatures.waterBodies.features.length > 0)) {
    // Real hydro data available
    const distances = calculateDistancesToHydro(stands, hydroFeatures);
    avgDistanceMeters = distances.length > 0 
      ? distances.reduce((a, b) => a + b, 0) / distances.length 
      : MAX_WATER_DISTANCE_METERS;
    dataSource = 'real';
    notes = `Real hydro data: ${hydroFeatures.streams.features.length} streams, ${hydroFeatures.waterBodies.features.length} water bodies`;
    metadata = {
      streamCount: hydroFeatures.streams.features.length,
      waterBodyCount: hydroFeatures.waterBodies.features.length,
      springCount: hydroFeatures.springs?.features.length || 0,
      standDistances: distances
    };
  } else if (draws.length > 0) {
    // Estimate from terrain draws
    const estimatedDistances = estimateDistancesFromDraws(stands, draws);
    avgDistanceMeters = estimatedDistances.avg;
    dataSource = 'estimated';
    notes = `Estimated from ${draws.length} terrain draws (${Math.round(DRAW_WATER_LIKELIHOOD * 100)}% water likelihood)`;
    metadata = {
      drawCount: draws.length,
      estimatedDistances: estimatedDistances.individual,
      method: 'terrain_draw_proxy'
    };
  } else {
    // No water indicators - use parcel size estimate
    // Larger parcels more likely to have water features
    avgDistanceMeters = estimateFromParcelSize(parcelAcres);
    dataSource = 'estimated';
    notes = `No water features detected; estimated from ${parcelAcres.toFixed(1)} acre parcel`;
    metadata = {
      method: 'parcel_size_estimate',
      parcelAcres
    };
  }
  
  // Clamp to range
  avgDistanceMeters = Math.max(0, Math.min(MAX_WATER_DISTANCE_METERS, avgDistanceMeters));
  
  // Normalize: inverted (0m = 1.0, 1000m = 0.0)
  const normalized = 1 - (avgDistanceMeters / MAX_WATER_DISTANCE_METERS);
  
  // Generate quality note
  const qualityLabel = getQualityLabel(normalized);
  const fullNotes = `${qualityLabel}: avg ${Math.round(avgDistanceMeters)}m to water. ${notes}`;
  
  return {
    componentId: 'water_proximity',
    raw: Math.round(avgDistanceMeters),
    normalized: Math.round(normalized * 10000) / 10000,
    unit: 'meters',
    notes: fullNotes,
    dataSource,
    metadata
  };
}

/**
 * Calculate actual distances from stands to hydro features
 */
function calculateDistancesToHydro(
  stands: GeoJSON.Feature<GeoJSON.Point, StandPointProperties>[],
  hydro: NonNullable<ComponentInput['hydroFeatures']>
): number[] {
  const distances: number[] = [];
  
  for (const stand of stands) {
    const [standLng, standLat] = stand.geometry.coordinates;
    let minDist = MAX_WATER_DISTANCE_METERS;
    
    // Check streams
    for (const stream of hydro.streams.features) {
      const dist = distanceToLineString(standLng, standLat, stream.geometry.coordinates);
      minDist = Math.min(minDist, dist);
    }
    
    // Check water bodies
    for (const body of hydro.waterBodies.features) {
      const dist = distanceToPolygon(standLng, standLat, body.geometry.coordinates[0]);
      minDist = Math.min(minDist, dist);
    }
    
    // Check springs
    if (hydro.springs) {
      for (const spring of hydro.springs.features) {
        const [springLng, springLat] = spring.geometry.coordinates;
        const dist = haversineDistance(standLat, standLng, springLat, springLng);
        minDist = Math.min(minDist, dist);
      }
    }
    
    distances.push(minDist);
  }
  
  return distances;
}

/**
 * Estimate distances from stands to draws (water proxy)
 */
function estimateDistancesFromDraws(
  stands: GeoJSON.Feature<GeoJSON.Point, StandPointProperties>[],
  draws: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[]
): { avg: number; individual: number[] } {
  const distances: number[] = [];
  
  for (const stand of stands) {
    const [standLng, standLat] = stand.geometry.coordinates;
    let minDist = MAX_WATER_DISTANCE_METERS;
    
    for (const draw of draws) {
      let dist: number;
      if (draw.geometry.type === 'LineString') {
        dist = distanceToLineString(standLng, standLat, draw.geometry.coordinates);
      } else {
        dist = distanceToPolygon(standLng, standLat, draw.geometry.coordinates[0]);
      }
      // Add estimate for water within draw
      dist = Math.max(0, dist - DRAW_PROXIMITY_ESTIMATE_METERS);
      minDist = Math.min(minDist, dist);
    }
    
    // Apply water likelihood factor (some draws are dry)
    const adjustedDist = minDist / DRAW_WATER_LIKELIHOOD;
    distances.push(Math.min(adjustedDist, MAX_WATER_DISTANCE_METERS));
  }
  
  const avg = distances.length > 0 
    ? distances.reduce((a, b) => a + b, 0) / distances.length 
    : MAX_WATER_DISTANCE_METERS;
  
  return { avg, individual: distances };
}

/**
 * Estimate water distance from parcel size
 * Larger parcels more likely to contain water
 */
function estimateFromParcelSize(acres: number): number {
  // Heuristic: larger parcels tend to have water features
  // 40 acres: ~400m, 160 acres: ~250m, 640 acres: ~150m
  if (acres >= 640) return 150;
  if (acres >= 320) return 200;
  if (acres >= 160) return 250;
  if (acres >= 80) return 350;
  if (acres >= 40) return 450;
  return 600; // Small parcels often don't have water on-site
}

/**
 * Haversine distance in meters
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Distance from point to LineString
 */
function distanceToLineString(lng: number, lat: number, coords: number[][]): number {
  let minDist = Infinity;
  for (const [cLng, cLat] of coords) {
    const dist = haversineDistance(lat, lng, cLat, cLng);
    minDist = Math.min(minDist, dist);
  }
  return minDist;
}

/**
 * Distance from point to Polygon (exterior ring)
 */
function distanceToPolygon(lng: number, lat: number, coords: number[][]): number {
  let minDist = Infinity;
  for (const [cLng, cLat] of coords) {
    const dist = haversineDistance(lat, lng, cLat, cLng);
    minDist = Math.min(minDist, dist);
  }
  return minDist;
}

/**
 * Quality label based on normalized score
 */
function getQualityLabel(normalized: number): string {
  if (normalized >= 0.85) return 'Excellent water access';
  if (normalized >= 0.70) return 'Good water access';
  if (normalized >= 0.55) return 'Adequate water access';
  if (normalized >= 0.40) return 'Limited water access';
  return 'Poor water access';
}
