/**
 * POST /api/terrain-flow - Terrain Flow Analysis
 * 
 * Computes terrain-guided movement likelihood surfaces and extracts
 * flow lines, convergence zones, and opportunity areas.
 * 
 * This is terrain intelligence, not wildlife AI.
 * 
 * Input: Parcel AOI (GeoJSON polygon), parcel_id
 * Process:
 *   1. Attempt real DEM-based computation via Modal backend
 *   2. Fall back to geometry-based synthetic generation if needed
 *   3. Compute weighted likelihood surface
 *   4. Extract flow lines and convergence zones
 * Output: Flow FeatureCollections + metadata
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateSyntheticTerrainFlow, FLOW_WEIGHTS, FLOW_THRESHOLDS } from '@/lib/terrain-flow';
import type { TerrainFlowResponse, FlowLineProperties, ConvergenceZoneProperties, OpportunityZoneProperties } from '@/types/terrain-flow';

// Modal endpoint for DEM-based terrain flow (can reuse corridor backend for DEM access)
const CORRIDOR_API_URL = process.env.CORRIDOR_API_URL || 
  'https://cwc2030--terrain-brain-v3-corridors-corridors-web.modal.run/v1/corridors';
const REQUEST_TIMEOUT_MS = 40000;
const API_VERSION = 'v1.0-terrainflow-2026-03-11';

interface TerrainFlowRequest {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  parcel_id: string;
  bufferMeters?: number;
  options?: {
    weights?: Partial<typeof FLOW_WEIGHTS>;
    thresholds?: Partial<typeof FLOW_THRESHOLDS>;
    includeDebugLayers?: boolean;
  };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let body: TerrainFlowRequest | null = null;
  
  try {
    body = await request.json() as TerrainFlowRequest;
    const { parcel, parcel_id, bufferMeters = 400, options = {} } = body;

    // Validate input
    if (!parcel || !parcel.geometry) {
      return NextResponse.json(
        { success: false, error: 'Valid parcel GeoJSON required' },
        { status: 400 }
      );
    }

    if (!parcel_id) {
      return NextResponse.json(
        { success: false, error: 'parcel_id required' },
        { status: 400 }
      );
    }

    console.log('[TerrainFlow] Processing for parcel:', parcel_id);

    // Merge user options with defaults
    const weights = { ...FLOW_WEIGHTS, ...options.weights };
    const thresholds = { ...FLOW_THRESHOLDS, ...options.thresholds };

    // Try calling Modal backend for real DEM-based terrain flow
    let useRealDEM = false;
    let flowData: TerrainFlowResponse | null = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      console.log('[TerrainFlow] Attempting Modal endpoint for DEM data');
      
      // First, fetch corridor data which gives us DEM-derived probability surface
      const modalResponse = await fetch(CORRIDOR_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenTopo-Key': process.env.OPENTOPOGRAPHY_API_KEY || '',
        },
        body: JSON.stringify({
          parcel,
          parcel_id,
          state: 'mo',
          county: 'unknown',
          options: {
            dem_source: 'USGS3DEP1m',
            slope_preference: 'moderate',
            concavity_weight: 0.4,
            output_format: 'geojson',
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (modalResponse.ok) {
        const corridorData = await modalResponse.json();
        
        // Transform corridor data into terrain flow format
        if (corridorData.success && corridorData.corridors) {
          flowData = transformCorridorToFlow(corridorData, parcel, weights, thresholds);
          useRealDEM = true;
          console.log('[TerrainFlow] Transformed corridor data to terrain flow');
        } else {
          console.warn('[TerrainFlow] Corridor data incomplete, falling back to synthetic');
        }
      } else {
        const errorText = await modalResponse.text();
        console.warn('[TerrainFlow] Modal returned error:', errorText);
      }
    } catch (modalErr) {
      const errMsg = modalErr instanceof Error ? modalErr.message : String(modalErr);
      console.warn('[TerrainFlow] Modal call failed, using synthetic:', errMsg);
    }

    // Fall back to synthetic generation if Modal not available
    if (!flowData) {
      console.log('[TerrainFlow] Generating synthetic terrain flow');
      flowData = generateSyntheticTerrainFlow(parcel);
    }

    const processingTime = (Date.now() - startTime) / 1000;
    
    // Update metadata with actual processing time
    flowData.metadata.processing_time_seconds = processingTime;
    if (useRealDEM) {
      flowData.metadata.mode = 'real_dem';
      flowData.metadata.dem_source = 'USGS_3DEP_1m';
    }

    console.log('[TerrainFlow] Complete:', {
      mode: flowData.metadata.mode,
      primary: flowData.flow_primary.features.length,
      secondary: flowData.flow_secondary.features.length,
      convergence: flowData.convergence_zones.features.length,
      opportunity: flowData.opportunity_zones.features.length,
      processingTime: processingTime.toFixed(2) + 's',
    });

    return NextResponse.json({
      ...flowData,
      version: API_VERSION,
      request_id: `flow_${Date.now().toString(36)}`,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[TerrainFlow] Error:', errMsg);
    
    return NextResponse.json(
      {
        success: false,
        error: errMsg,
        version: API_VERSION,
      },
      { status: 500 }
    );
  }
}

/**
 * Transform corridor API response into terrain flow format
 */
function transformCorridorToFlow(
  corridorData: any,
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  weights: typeof FLOW_WEIGHTS,
  thresholds: typeof FLOW_THRESHOLDS
): TerrainFlowResponse {
  const corridors = corridorData.corridors?.features || [];
  const bbox = corridorData.bbox || [0, 0, 0, 0];
  
  // Sort corridors by probability and split into primary/secondary
  const sorted = [...corridors].sort(
    (a: any, b: any) => (b.properties?.probability || 0) - (a.properties?.probability || 0)
  );
  
  const primaryThreshold = thresholds.primary_min * 100;
  const secondaryThreshold = thresholds.secondary_min * 100;
  
  const primaryFlows: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondaryFlows: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  sorted.forEach((corridor: any, idx: number) => {
    const prob = corridor.properties?.probability || 0;
    const lengthM = corridor.properties?.length_m || 100;
    
    const flowProps: FlowLineProperties = {
      id: `flow_${idx}`,
      tier: prob >= primaryThreshold ? 'primary' : 'secondary',
      likelihood: prob / 100,
      lengthM: Math.round(lengthM),
      avgSlope: corridor.properties?.avg_slope || 10,
      convergenceScore: Math.min(1, prob / 80),
    };
    
    const feature: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties> = {
      type: 'Feature',
      properties: flowProps,
      geometry: corridor.geometry,
    };
    
    if (prob >= primaryThreshold) {
      primaryFlows.push(feature);
    } else if (prob >= secondaryThreshold) {
      secondaryFlows.push(feature);
    }
  });
  
  // Identify convergence zones where flows cluster
  const convergenceZones = identifyConvergenceZones(primaryFlows, secondaryFlows, thresholds);
  
  // Identify opportunity zones at high-convergence areas
  const opportunityZones = identifyOpportunityZones(convergenceZones, thresholds);
  
  const totalLength = [...primaryFlows, ...secondaryFlows].reduce(
    (sum, f) => sum + (f.properties.lengthM || 0), 0
  );
  
  return {
    success: true,
    bbox,
    flow_primary: { type: 'FeatureCollection', features: primaryFlows },
    flow_secondary: { type: 'FeatureCollection', features: secondaryFlows },
    convergence_zones: { type: 'FeatureCollection', features: convergenceZones },
    opportunity_zones: { type: 'FeatureCollection', features: opportunityZones },
    metadata: {
      processing_time_seconds: 0,
      mode: 'real_dem',
      dem_source: corridorData.metadata?.dem_source || 'USGS_3DEP',
      resolution_m: corridorData.metadata?.resolution_m || 10,
      weights,
      thresholds,
      stats: {
        flow_count_primary: primaryFlows.length,
        flow_count_secondary: secondaryFlows.length,
        convergence_count: convergenceZones.length,
        opportunity_count: opportunityZones.length,
        total_flow_length_m: totalLength,
        coverage_pct: 0,
      },
      fallback_reason: null,
    },
  };
}

/**
 * Identify convergence zones where multiple flows come together
 */
function identifyConvergenceZones(
  primaryFlows: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  secondaryFlows: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  thresholds: typeof FLOW_THRESHOLDS
): GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] {
  const zones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] = [];
  const allFlows = [...primaryFlows, ...secondaryFlows];
  
  if (allFlows.length < 2) return zones;
  
  // Check for endpoint proximity (simple convergence detection)
  const endpoints: { coord: [number, number]; flowId: string; likelihood: number }[] = [];
  
  allFlows.forEach(flow => {
    const coords = flow.geometry.coordinates;
    if (coords.length >= 2) {
      endpoints.push({
        coord: coords[0] as [number, number],
        flowId: flow.properties.id,
        likelihood: flow.properties.likelihood,
      });
      endpoints.push({
        coord: coords[coords.length - 1] as [number, number],
        flowId: flow.properties.id,
        likelihood: flow.properties.likelihood,
      });
    }
  });
  
  // Cluster nearby endpoints
  const clusterRadiusM = 100;
  const visited = new Set<number>();
  
  endpoints.forEach((ep, i) => {
    if (visited.has(i)) return;
    
    const cluster = [ep];
    visited.add(i);
    
    endpoints.forEach((other, j) => {
      if (i === j || visited.has(j)) return;
      if (ep.flowId === other.flowId) return; // Same flow
      
      const dist = haversineDistance(ep.coord, other.coord);
      if (dist < clusterRadiusM) {
        cluster.push(other);
        visited.add(j);
      }
    });
    
    // If cluster has multiple flows, it's a convergence
    const uniqueFlows = new Set(cluster.map(c => c.flowId));
    if (uniqueFlows.size >= 2) {
      const avgLng = cluster.reduce((s, c) => s + c.coord[0], 0) / cluster.length;
      const avgLat = cluster.reduce((s, c) => s + c.coord[1], 0) / cluster.length;
      const avgLikelihood = cluster.reduce((s, c) => s + c.likelihood, 0) / cluster.length;
      
      zones.push({
        type: 'Feature',
        properties: {
          id: `conv_${zones.length}`,
          intensity: Math.min(1, avgLikelihood + 0.1 * (uniqueFlows.size - 2)),
          flowCount: uniqueFlows.size,
          radiusM: 30 + uniqueFlows.size * 10,
          type: uniqueFlows.size >= 3 ? 'pinch' : 'overlap',
        },
        geometry: {
          type: 'Point',
          coordinates: [avgLng, avgLat],
        },
      });
    }
  });
  
  return zones;
}

/**
 * Identify opportunity zones at high-convergence areas
 */
function identifyOpportunityZones(
  convergenceZones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[],
  thresholds: typeof FLOW_THRESHOLDS
): GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[] {
  const zones: GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[] = [];
  
  // Filter high-intensity convergence zones
  const highIntensity = convergenceZones.filter(
    z => z.properties.intensity >= thresholds.opportunity_threshold
  );
  
  highIntensity.slice(0, 3).forEach((conv, i) => {
    zones.push({
      type: 'Feature',
      properties: {
        id: `opp_${i}`,
        score: conv.properties.intensity,
        flowIntensity: conv.properties.intensity * 0.7,
        convergenceBonus: 0.15 * conv.properties.flowCount / 3,
        benchBonus: 0.10,
        saddleBonus: conv.properties.type === 'pinch' ? 0.10 : 0.05,
        radiusM: 25,
      },
      geometry: conv.geometry,
    });
  });
  
  return zones;
}

/**
 * Calculate distance between two coordinates in meters
 */
function haversineDistance(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
