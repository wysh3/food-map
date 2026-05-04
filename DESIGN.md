# Design Document

## Problem Statement

Food delivery maps with thousands of restaurants become slow and messy. Users experience:
- Lag when panning/zooming
- Overlapping pins
- Wrong restaurants appearing
- Slow load times

## Solution Overview

Use vector tiles with server-side clustering to only send what's visible at each zoom level.

## Architecture

```
Browser                    Backend                     Database
--------                   --------                    ---------
MapLibre GL  <--MVT-->  Express Server  <--SQL-->  PostgreSQL
                        (Tile Generator)            + PostGIS
```

## Data Flow

1. **User opens map**
   - Browser requests tile: `/tiles/6/46/28.mvt`
   - Backend checks cache → miss
   - Backend queries PostGIS for restaurants in tile bounds
   - Backend clusters results based on zoom level
   - Backend encodes as MVT and caches
   - Browser renders tile

2. **User zooms in**
   - Browser requests new tiles at higher zoom
   - Backend returns less clustered data
   - Browser smoothly transitions

3. **User clicks restaurant**
   - Browser makes API call: `/api/restaurants/123`
   - Backend returns full restaurant details
   - Browser shows popup

## Database Schema

```sql
restaurants
  - id (primary key)
  - name, cuisine, rating
  - lat, lon (coordinates)
  - geom (PostGIS geometry, indexed)
  - city, area
  - is_active
```

**Indexes:**
- `GIST(geom)` for spatial queries
- `(city)` for city-level aggregation
- `(is_active)` for filtering

## Clustering Strategy

**Zoom 5-8:** City-level
```sql
SELECT city, COUNT(*), AVG(lat), AVG(lon)
FROM restaurants
GROUP BY city
```
Returns 5 clusters (one per city)

**Zoom 9-12:** Materialized views
```sql
-- Pre-computed clusters on 0.1 degree grid
SELECT ST_SnapToGrid(geom, 0.1), COUNT(*)
FROM restaurants
GROUP BY grid
```

**Zoom 13+:** Individual restaurants
```sql
SELECT * FROM restaurants
WHERE ST_Intersects(geom, tile_bounds)
LIMIT 5000
```

## MVT Encoding

Vector tiles use Protocol Buffers format:
1. Convert lat/lon to tile coordinates (0-4096 range)
2. Encode features with properties
3. Compress with gzip
4. Return as `application/x-protobuf`

## Performance Optimizations

1. **Spatial Indexing:** GIST indexes make spatial queries fast
2. **Materialized Views:** Pre-compute common zoom levels
3. **Tile Caching:** LRU cache with 1-hour TTL
4. **Query Limits:** Cap at 5000 features per tile
5. **Coordinate Transform:** Transform tile bounds to match data CRS

## Coordinate Systems

- **Storage:** EPSG:4326 (WGS84, lat/lon in degrees)
- **Tiles:** Web Mercator (EPSG:3857, meters)
- **Conversion:** `ST_Transform(ST_TileEnvelope(z,x,y), 4326)`

## API Endpoints

- `GET /tiles/{z}/{x}/{y}.mvt` - Vector tile
- `GET /api/stats` - Aggregate statistics
- `GET /api/restaurants/:id` - Restaurant details
- `GET /health` - Health check

## Trade-offs

**Chose:** Server-side clustering
**Over:** Client-side clustering
**Because:** Server has full dataset and can optimize queries. Client would need to download everything first.

**Chose:** Vector tiles
**Over:** GeoJSON
**Because:** 10x smaller file sizes, browser can cache tiles, industry standard.

**Chose:** PostgreSQL/PostGIS
**Over:** MongoDB with geospatial
**Because:** PostGIS is more mature, better spatial functions, proven at scale.

## Scaling Considerations

**Current:** Single server, single database
**Next steps:**
- Read replicas for tile queries
- CDN for tile caching (CloudFlare, Fastly)
- Separate tile server from API server
- Redis for distributed caching

## Testing Strategy

1. **Unit tests:** Tile coordinate conversion, MVT encoding
2. **Integration tests:** API endpoints, database queries
3. **Load tests:** Simulate 1000 concurrent tile requests
4. **Visual tests:** Verify tiles render correctly at all zoom levels

## Known Issues

- "Geometry exceeds allowed extent" warning at high zoom (cosmetic, doesn't affect functionality)
- No data for Pune/Kolkata (only 5 cities in dataset)
- Low zoom tiles show all cities regardless of viewport (acceptable for country-level view)
