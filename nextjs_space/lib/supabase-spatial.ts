/**
 * Supabase Spatial Client for TFP Decision Engine
 * 
 * This client handles all PostGIS-enabled queries for terrain analysis,
 * corridor computation, and parcel geometry operations.
 * 
 * Requires:
 * - SUPABASE_URL in .env
 * - SUPABASE_SERVICE_KEY in .env (for server-side operations)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Types for spatial tables
export interface Parcel {
  id: string;
  regrid_id: string | null;
  state_fips: string;
  county_fips: string;
  apn: string | null;
  owner_name: string | null;
  site_address: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  acreage: number | null;
  legal_description: string | null;
  geometry: GeoJSON.MultiPolygon;
  centroid: GeoJSON.Point;
  created_at: string;
  updated_at: string;
  source: string;
}

export interface TerrainAnalysis {
  id: string;
  parcel_id: string;
  bedding_quality: number;
  funnel_density: number;
  corridor_coverage: number;
  water_proximity: number;
  terrain_diversity: number;
  stand_site_count: number;
  edge_habitat: number;
  score_early: number;
  score_rut: number;
  score_late: number;
  score_annual: number;
  dem_source: string;
  dem_resolution_m: number;
  processing_time_sec: number;
  analyzed_at: string;
  expires_at: string;
}

export interface Corridor {
  id: string;
  parcel_id: string;
  geometry: GeoJSON.LineString;
  length_m: number;
  corridor_type: 'saddle' | 'draw' | 'ridge' | 'creek_bottom' | 'field_edge';
  probability: number;
  width_m: number;
  source: string;
  created_at: string;
}

export interface StandSite {
  id: string;
  parcel_id: string;
  geometry: GeoJSON.Point;
  stand_type: string;
  wind_directions: string[];
  season_rating: { early: number; rut: number; late: number };
  corridor_proximity_m: number;
  bedding_proximity_m: number;
  water_proximity_m: number;
  elevation_advantage_m: number;
  overall_score: number;
  created_at: string;
}

// Singleton client instance
let supabaseClient: SupabaseClient | null = null;

/**
 * Get the Supabase client for spatial queries
 */
export function getSupabaseSpatialClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return null;
  }
  
  supabaseClient = createClient(url, key, {
    db: {
      schema: 'public',
    },
  });
  
  return supabaseClient;
}

/**
 * Find parcel containing a lat/lng point
 */
export async function findParcelAtPoint(
  lng: number,
  lat: number
): Promise<Parcel | null> {
  const client = getSupabaseSpatialClient();
  if (!client) return null;
  
  const { data, error } = await client
    .rpc('find_parcel_at_point', { lng, lat })
    .single();
  
  if (error) {
    console.error('[Supabase] findParcelAtPoint error:', error);
    return null;
  }
  
  return data as Parcel;
}

/**
 * Find parcels within a bounding box
 */
export async function findParcelsInBbox(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number
): Promise<Parcel[]> {
  const client = getSupabaseSpatialClient();
  if (!client) return [];
  
  const { data, error } = await client
    .rpc('find_parcels_in_bbox', {
      min_lng: minLng,
      min_lat: minLat,
      max_lng: maxLng,
      max_lat: maxLat,
    });
  
  if (error) {
    console.error('[Supabase] findParcelsInBbox error:', error);
    return [];
  }
  
  return data as Parcel[];
}

/**
 * Get terrain analysis for a parcel (with caching)
 */
export async function getTerrainAnalysis(
  parcelId: string
): Promise<TerrainAnalysis | null> {
  const client = getSupabaseSpatialClient();
  if (!client) return null;
  
  const { data, error } = await client
    .from('terrain_analysis')
    .select('*')
    .eq('parcel_id', parcelId)
    .gt('expires_at', new Date().toISOString())
    .order('analyzed_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
    console.error('[Supabase] getTerrainAnalysis error:', error);
  }
  
  return data as TerrainAnalysis | null;
}

/**
 * Save terrain analysis results
 */
export async function saveTerrainAnalysis(
  analysis: Omit<TerrainAnalysis, 'id' | 'analyzed_at' | 'expires_at'>
): Promise<TerrainAnalysis | null> {
  const client = getSupabaseSpatialClient();
  if (!client) return null;
  
  const { data, error } = await client
    .from('terrain_analysis')
    .insert(analysis)
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] saveTerrainAnalysis error:', error);
    return null;
  }
  
  return data as TerrainAnalysis;
}

/**
 * Get corridors for a parcel
 */
export async function getCorridors(
  parcelId: string
): Promise<Corridor[]> {
  const client = getSupabaseSpatialClient();
  if (!client) return [];
  
  const { data, error } = await client
    .from('corridors')
    .select('*')
    .eq('parcel_id', parcelId)
    .order('probability', { ascending: false });
  
  if (error) {
    console.error('[Supabase] getCorridors error:', error);
    return [];
  }
  
  return data as Corridor[];
}

/**
 * Save corridors for a parcel (bulk insert)
 */
export async function saveCorridors(
  parcelId: string,
  corridors: Array<Omit<Corridor, 'id' | 'parcel_id' | 'length_m' | 'created_at'>>
): Promise<boolean> {
  const client = getSupabaseSpatialClient();
  if (!client) return false;
  
  // Delete existing corridors for this parcel
  await client
    .from('corridors')
    .delete()
    .eq('parcel_id', parcelId);
  
  // Insert new corridors
  const { error } = await client
    .from('corridors')
    .insert(corridors.map(c => ({ ...c, parcel_id: parcelId })));
  
  if (error) {
    console.error('[Supabase] saveCorridors error:', error);
    return false;
  }
  
  return true;
}

/**
 * Get stand sites for a parcel
 */
export async function getStandSites(
  parcelId: string
): Promise<StandSite[]> {
  const client = getSupabaseSpatialClient();
  if (!client) return [];
  
  const { data, error } = await client
    .from('stand_sites')
    .select('*')
    .eq('parcel_id', parcelId)
    .order('overall_score', { ascending: false });
  
  if (error) {
    console.error('[Supabase] getStandSites error:', error);
    return [];
  }
  
  return data as StandSite[];
}

/**
 * Upsert a parcel (insert or update by regrid_id)
 */
export async function upsertParcel(
  parcel: Omit<Parcel, 'id' | 'centroid' | 'bbox' | 'created_at' | 'updated_at'>
): Promise<Parcel | null> {
  const client = getSupabaseSpatialClient();
  if (!client) return null;
  
  const { data, error } = await client
    .from('parcels')
    .upsert(parcel, { onConflict: 'regrid_id' })
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] upsertParcel error:', error);
    return null;
  }
  
  return data as Parcel;
}

/**
 * Check if Supabase spatial is configured
 */
export function isSupabaseSpatialConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && 
    (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY));
}
