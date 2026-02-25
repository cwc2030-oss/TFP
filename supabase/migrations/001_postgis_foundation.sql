-- ============================================================
-- TFP Decision Engine: PostGIS Foundation
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- Step 1: Drop PostGIS from gis schema (if it exists there)
-- This will cascade-drop any dependent objects in gis schema
DROP EXTENSION IF EXISTS postgis CASCADE;

-- Step 2: Create PostGIS in public schema
-- This makes geometry type and all functions globally accessible
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;

-- Step 3: Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;

-- Step 4: Verify installation
SELECT 
  'PostGIS Version' as check_type, 
  PostGIS_Version() as result
UNION ALL
SELECT 
  'PostGIS Full Version', 
  PostGIS_Full_Version()
UNION ALL
SELECT 
  'pgcrypto UUID Test', 
  gen_random_uuid()::text;

-- ============================================================
-- Spatial Starter Tables for TFP Decision Engine
-- ============================================================

-- Parcels table with geometry
CREATE TABLE IF NOT EXISTS parcels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regrid_id TEXT UNIQUE,
  state_fips TEXT NOT NULL,
  county_fips TEXT NOT NULL,
  apn TEXT,  -- Assessor's Parcel Number
  owner_name TEXT,
  site_address TEXT,
  city TEXT,
  state TEXT NOT NULL DEFAULT 'MO',
  zip TEXT,
  acreage NUMERIC(10,2),
  legal_description TEXT,
  
  -- Geometry (EPSG:4326 WGS84)
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
  centroid GEOMETRY(Point, 4326) GENERATED ALWAYS AS (ST_Centroid(geometry)) STORED,
  bbox BOX2D GENERATED ALWAYS AS (Box2D(geometry)) STORED,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'regrid'
);

-- Spatial index on parcel geometry
CREATE INDEX IF NOT EXISTS idx_parcels_geometry 
  ON parcels USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_parcels_centroid 
  ON parcels USING GIST (centroid);

CREATE INDEX IF NOT EXISTS idx_parcels_state_county 
  ON parcels (state_fips, county_fips);

-- Terrain analysis results (cached from Modal)
CREATE TABLE IF NOT EXISTS terrain_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id UUID REFERENCES parcels(id) ON DELETE CASCADE,
  
  -- Core V1 scores (0.0-1.0 internal, display as 0-100)
  bedding_quality NUMERIC(4,3),
  funnel_density NUMERIC(4,3),
  corridor_coverage NUMERIC(4,3),
  water_proximity NUMERIC(4,3),
  terrain_diversity NUMERIC(4,3),
  stand_site_count NUMERIC(4,3),
  edge_habitat NUMERIC(4,3),  -- Stubbed until NLCD
  
  -- Weighted composite scores by season
  score_early NUMERIC(4,3),
  score_rut NUMERIC(4,3),
  score_late NUMERIC(4,3),
  score_annual NUMERIC(4,3),
  
  -- DEM metadata
  dem_source TEXT DEFAULT 'USGS_3DEP_10m',
  dem_resolution_m NUMERIC(5,2),
  processing_time_sec NUMERIC(6,2),
  
  -- Timestamps
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_terrain_analysis_parcel 
  ON terrain_analysis (parcel_id);

-- Bedding areas (polygons)
CREATE TABLE IF NOT EXISTS bedding_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id UUID REFERENCES parcels(id) ON DELETE CASCADE,
  
  geometry GEOMETRY(Polygon, 4326) NOT NULL,
  area_sqm NUMERIC(12,2) GENERATED ALWAYS AS (ST_Area(geometry::geography)) STORED,
  
  -- Quality metrics
  slope_mean NUMERIC(4,2),
  aspect_dominant TEXT,  -- N, NE, E, SE, S, SW, W, NW
  thermal_rating TEXT,   -- poor, fair, good, excellent
  density_score NUMERIC(4,3),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bedding_areas_geometry 
  ON bedding_areas USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_bedding_areas_parcel 
  ON bedding_areas (parcel_id);

-- Funnels/Corridors (linestrings)
CREATE TABLE IF NOT EXISTS corridors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id UUID REFERENCES parcels(id) ON DELETE CASCADE,
  
  geometry GEOMETRY(LineString, 4326) NOT NULL,
  length_m NUMERIC(10,2) GENERATED ALWAYS AS (ST_Length(geometry::geography)) STORED,
  
  -- Corridor type
  corridor_type TEXT NOT NULL,  -- 'saddle', 'draw', 'ridge', 'creek_bottom', 'field_edge'
  probability NUMERIC(4,3),     -- Movement probability 0-1
  width_m NUMERIC(6,2),
  
  -- Source
  source TEXT DEFAULT 'dem_analysis',  -- 'dem_analysis', 'nlcd_edge', 'nhd_stream'
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corridors_geometry 
  ON corridors USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_corridors_parcel 
  ON corridors (parcel_id);

-- Stand sites (points)
CREATE TABLE IF NOT EXISTS stand_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id UUID REFERENCES parcels(id) ON DELETE CASCADE,
  
  geometry GEOMETRY(Point, 4326) NOT NULL,
  
  -- Stand attributes
  stand_type TEXT,           -- 'treestand', 'ground_blind', 'saddle'
  wind_directions TEXT[],    -- Array of favorable winds: ['N', 'NW', 'W']
  season_rating JSONB,       -- {"early": 0.8, "rut": 0.95, "late": 0.7}
  
  -- Scoring factors
  corridor_proximity_m NUMERIC(6,2),
  bedding_proximity_m NUMERIC(6,2),
  water_proximity_m NUMERIC(6,2),
  elevation_advantage_m NUMERIC(5,2),
  overall_score NUMERIC(4,3),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stand_sites_geometry 
  ON stand_sites USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_stand_sites_parcel 
  ON stand_sites (parcel_id);

-- Water features (from NHD or DEM draws)
CREATE TABLE IF NOT EXISTS water_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id UUID REFERENCES parcels(id) ON DELETE CASCADE,
  
  geometry GEOMETRY(Geometry, 4326) NOT NULL,  -- Can be Point, LineString, or Polygon
  
  feature_type TEXT NOT NULL,  -- 'stream', 'pond', 'spring', 'draw', 'wetland'
  name TEXT,
  permanence TEXT,             -- 'permanent', 'intermittent', 'ephemeral'
  
  source TEXT DEFAULT 'nhd',   -- 'nhd', 'dem_derived', 'manual'
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_water_features_geometry 
  ON water_features USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_water_features_parcel 
  ON water_features (parcel_id);

-- ============================================================
-- Helper Functions
-- ============================================================

-- Function to find parcels within a bounding box
CREATE OR REPLACE FUNCTION find_parcels_in_bbox(
  min_lng DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lng DOUBLE PRECISION,
  max_lat DOUBLE PRECISION
)
RETURNS SETOF parcels AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM parcels
  WHERE geometry && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326);
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to find parcels containing a point
CREATE OR REPLACE FUNCTION find_parcel_at_point(
  lng DOUBLE PRECISION,
  lat DOUBLE PRECISION
)
RETURNS SETOF parcels AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM parcels
  WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to calculate distance to nearest water
CREATE OR REPLACE FUNCTION distance_to_nearest_water(
  point_geom GEOMETRY
)
RETURNS NUMERIC AS $$
DECLARE
  min_distance NUMERIC;
BEGIN
  SELECT MIN(ST_Distance(point_geom::geography, w.geometry::geography))
  INTO min_distance
  FROM water_features w;
  
  RETURN COALESCE(min_distance, 9999);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- Row Level Security (RLS) - Optional but recommended
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE terrain_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE bedding_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE corridors ENABLE ROW LEVEL SECURITY;
ALTER TABLE stand_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_features ENABLE ROW LEVEL SECURITY;

-- Create policies for service role (full access)
CREATE POLICY "Service role full access" ON parcels FOR ALL USING (true);
CREATE POLICY "Service role full access" ON terrain_analysis FOR ALL USING (true);
CREATE POLICY "Service role full access" ON bedding_areas FOR ALL USING (true);
CREATE POLICY "Service role full access" ON corridors FOR ALL USING (true);
CREATE POLICY "Service role full access" ON stand_sites FOR ALL USING (true);
CREATE POLICY "Service role full access" ON water_features FOR ALL USING (true);

-- ============================================================
-- Verification Queries
-- ============================================================

-- Test geometry functions work without schema qualification
SELECT 
  'Geometry Test' as test,
  ST_AsText(ST_MakePoint(-93.5, 38.5)) as result;

-- Test search_path
SHOW search_path;

-- List installed extensions
SELECT extname, extversion, extnamespace::regnamespace as schema
FROM pg_extension
WHERE extname IN ('postgis', 'pgcrypto');

SELECT '✅ PostGIS Foundation Complete' as status;
