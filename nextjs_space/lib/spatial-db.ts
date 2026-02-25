/**
 * Supabase Spatial Database Client
 * Secondary PostGIS-enabled Postgres connection for spatial queries
 * Server-side only - do not import in client components
 */
import { Pool, QueryResult, QueryResultRow } from 'pg';

// Singleton pool instance
let pool: Pool | null = null;

/**
 * Get or create the Supabase spatial database pool
 */
export function getSpatialPool(): Pool {
  if (!pool) {
    const connectionString = process.env.SUPABASE_SPATIAL_DB_URL;
    
    if (!connectionString) {
      throw new Error('SUPABASE_SPATIAL_DB_URL environment variable is not set');
    }

    pool = new Pool({
      connectionString,
      max: 5, // Conservative pool size for serverless
      idleTimeoutMillis: 10000, // 10 seconds
      connectionTimeoutMillis: 5000, // 5 seconds
      ssl: {
        rejectUnauthorized: false // Supabase uses self-signed certs
      }
    });

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('[spatial-db] Unexpected pool error:', err);
    });
  }

  return pool;
}

/**
 * Execute a spatial query
 */
export async function spatialQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const pool = getSpatialPool();
  const client = await pool.connect();
  
  try {
    return await client.query<T>(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Health check - returns server time and PostGIS version
 */
export async function checkHealth(): Promise<{
  connected: boolean;
  serverTime?: string;
  postgisVersion?: string;
  error?: string;
}> {
  try {
    const result = await spatialQuery<{ now: Date; postgis_version: string }>(
      'SELECT now(), postgis_version()'
    );
    
    return {
      connected: true,
      serverTime: result.rows[0].now.toISOString(),
      postgisVersion: result.rows[0].postgis_version
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * GeoJSON Feature interface
 */
export interface GeoJSONFeature {
  type: 'Feature';
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
}

/**
 * GeoJSON FeatureCollection interface
 */
export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

/**
 * Fetch parcels as GeoJSON FeatureCollection
 */
export async function getParcelsGeoJSON(): Promise<GeoJSONFeatureCollection> {
  const result = await spatialQuery<{ geojson: string }>(`
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', json_build_object(
            'id', id,
            'name', name,
            'created_at', created_at
          )
        )
      ), '[]'::json)
    )::text as geojson
    FROM public.parcels
    WHERE geom IS NOT NULL
  `);

  return JSON.parse(result.rows[0]?.geojson || '{"type":"FeatureCollection","features":[]}');
}

/**
 * Fetch corridors as GeoJSON FeatureCollection
 */
export async function getCorridorsGeoJSON(): Promise<GeoJSONFeatureCollection> {
  const result = await spatialQuery<{ geojson: string }>(`
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', json_build_object(
            'id', id,
            'parcel_id', parcel_id,
            'score', score,
            'created_at', created_at
          )
        )
      ), '[]'::json)
    )::text as geojson
    FROM public.corridors
    WHERE geom IS NOT NULL
  `);

  return JSON.parse(result.rows[0]?.geojson || '{"type":"FeatureCollection","features":[]}');
}
