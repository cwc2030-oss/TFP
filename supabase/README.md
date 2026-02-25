# TFP Supabase Spatial Database

This directory contains SQL migrations for the Terra Firma Partners spatial decision engine.

## Setup Instructions

### 1. Run PostGIS Foundation Migration

1. Open your Supabase Dashboard
2. Go to **SQL Editor** > **New Query**
3. Copy the entire contents of `migrations/001_postgis_foundation.sql`
4. Click **Run**

### 2. Verify Installation

After running, you should see:

```
✅ PostGIS Foundation Complete
```

Test that PostGIS functions work without schema qualification:

```sql
-- This should work from a fresh session:
SELECT postgis_version();
SELECT ST_MakePoint(-93.5, 38.5);
```

### 3. Tables Created

| Table | Purpose |
|-------|--------|
| `parcels` | Parcel boundaries with geometry |
| `terrain_analysis` | Cached Core V1 scores per parcel |
| `bedding_areas` | Polygon bedding zones |
| `corridors` | LineString movement corridors |
| `stand_sites` | Point stand locations with ratings |
| `water_features` | Water sources (streams, ponds, draws) |

### 4. Connecting from Next.js

Add to your `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

See `/lib/supabase-spatial.ts` for the client implementation.

## Extensions Installed

- **PostGIS** (public schema) - Spatial types and functions
- **pgcrypto** (public schema) - UUID generation

## Troubleshooting

### "geometry type not found"

PostGIS may be in wrong schema. Run:

```sql
DROP EXTENSION postgis CASCADE;
CREATE EXTENSION postgis SCHEMA public;
```

### "postgis_version() not found"

Check search_path:

```sql
SHOW search_path;
-- Should include 'public'

-- If not, fix it:
ALTER DATABASE postgres SET search_path TO public, extensions;
```
