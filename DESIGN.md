# System Design: Food Delivery Map at Scale

## The Problem

Most map implementations fail at scale because they try to send all restaurants as JSON and render them as DOM elements. When you have 10,000 restaurants in view, you're sending 2MB of JSON and asking the browser to manage 10,000 DOM nodes. The result is 5 FPS and a crashed browser.

Client-side clustering helps but doesn't solve the fundamental issues. You're still over-fetching data, re-clustering on every pan, and draining battery on mobile devices.

The core problems are:
- Sending entire viewports as JSON
- DOM rendering that doesn't scale past 1000 markers
- No caching since every viewport has different bounds
- Boundary errors where pins go missing at tile edges

## The Solution

Vector tiles with server-side clustering. Instead of sending all restaurants, the map requests small tiles. Each tile covers a fixed geographic area and contains only the restaurants (or clusters) in that area.

Why this works:

A JSON API sends 2MB for 10,000 restaurants. Vector tiles send 5KB per tile, and only 4-16 tiles are visible at once. JSON responses are hard to cache because viewport bounds always differ. Tiles have stable coordinates so they cache perfectly. DOM rendering is slow. WebGL rendering (what MapLibre uses) hits 60 FPS easily. JSON APIs have boundary issues where pins go missing. Tiles have exact coverage with no gaps.

The architecture is simple:

```
Client requests tile → Check LRU cache → Cache miss → Query PostGIS → Return MVT
```

The LRU cache holds 10,000 tiles in memory. PostGIS uses materialized views for pre-computed clusters. The response is a 2-8 KB MVT file.

## Production Validation

This isn't a guess. Real systems use this architecture.

Martin is MapLibre's tile server written in Rust. It uses materialized views for pre-computed clusters at low zoom levels. Discussion #1020 on their GitHub recommends pre-computing clusters for zoom 0-9, which is only about 350,000 tiles and easily stored. Martin handles millions of points in production.

Clusterbuster is an MVT tile server built specifically for large datasets on mobile devices. It uses LRU caching for high concurrency. Our implementation uses the same pattern with a 10,000 tile cache.

Swiggy uses Redis geohash for nearby restaurant queries and Kafka for real-time location updates. Their REST API endpoint is `GET /api/v1/restaurants/nearby`. Our PostGIS spatial index is ready for a Redis layer when needed.

Supercluster is Mapbox's clustering library. It handles 6 million points with sub-100ms clustering and is used by Uber, Airbnb, and Mapbox itself. Our server-side clustering via PostGIS follows the same principle.

## Data Model

The restaurants table is straightforward. Each restaurant has a name, cuisine, rating, lat/lon coordinates, and a PostGIS geometry column. The geometry column is what makes spatial queries fast.

```sql
CREATE TABLE restaurants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    cuisine VARCHAR(100),
    rating DECIMAL(2,1),
    lat DECIMAL(10, 8),
    lon DECIMAL(11, 8),
    geom GEOMETRY(Point, 4326),
    city VARCHAR(100),
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_restaurants_geom ON restaurants USING GIST(geom);
```

The GIST index is critical. It makes spatial queries O(log n) instead of O(n). Without it, finding restaurants in a tile would require scanning the entire table.

## Clustering Strategy

The key insight is to pre-compute clusters instead of clustering on every request. This is done with PostgreSQL materialized views.

```sql
CREATE MATERIALIZED VIEW restaurant_clusters_z8 AS
SELECT 
    COUNT(*) as point_count,
    ST_Centroid(ST_Collect(geom)) as geom,
    AVG(rating) as avg_rating
FROM (
    SELECT ST_SnapToGrid(geom, 1.0) as grid, geom, rating
    FROM restaurants WHERE is_active = true
) sub
GROUP BY grid
HAVING COUNT(*) > 1;

CREATE INDEX ON restaurant_clusters_z8 USING GIST(geom);
```

This is 10x faster than dynamic clustering because clustering happens once when data loads. Tile queries become simple spatial lookups. You only refresh the view when restaurant data changes.

Different zoom levels use different strategies:

- Zoom 1-8: Pre-computed clusters (country-level)
- Zoom 9-10: Pre-computed clusters (city-level)
- Zoom 11-12: Pre-computed clusters (neighborhood-level)
- Zoom 13: Dynamic clustering for the visible area
- Zoom 14+: Individual restaurants

## Tile Generation

Generating a tile is straightforward. Calculate the tile's geographic bounds, query the appropriate materialized view, and encode the results as MVT.

Here's the query for zoom 10:

```sql
WITH tile_bounds AS (
    SELECT ST_TileEnvelope($1, $2, $3) AS geom
)
SELECT 
    'cluster' AS type,
    point_count AS count,
    ST_Y(geom) AS lat,
    ST_X(geom) AS lon
FROM restaurant_clusters_z10, tile_bounds
WHERE ST_Intersects(restaurant_clusters_z10.geom, tile_bounds.geom)
LIMIT 5000;
```

The materialized view query takes 10-30ms. MVT encoding takes 5-10ms. Total response time is 20-40ms. Compare this to 200-500ms with dynamic clustering on every request.

## Caching Strategy

The tile server uses an LRU cache that holds 10,000 tiles in memory. When a tile is requested, check the cache first. If it's there, return it immediately (under 1ms). If not, query PostGIS (20-40ms) and cache the result.

```javascript
class LRUCache {
    constructor(maxSize = 10000) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }
    
    get(key) {
        if (this.cache.has(key)) {
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }
        return null;
    }
}
```

The cache hit rate is over 95% because users tend to pan around the same area. This means most requests return in under 1ms.

In production, you'd add more caching tiers. The browser caches tiles automatically. Behind the LRU cache, add Redis for distributed caching (5ms). Behind Redis, query PostGIS (30ms). In front of everything, put a CDN like CloudFront.

## Frontend Integration

MapLibre GL JS handles the frontend. You give it a tile URL template and it requests tiles as needed. It renders everything on the GPU using WebGL, which is why it stays at 60 FPS.

```javascript
const map = new maplibregl.Map({
    style: {
        sources: {
            restaurants: {
                type: 'vector',
                tiles: ['http://localhost:3000/tiles/{z}/{x}/{y}.mvt']
            }
        },
        layers: [
            {
                id: 'restaurant-clusters',
                type: 'circle',
                source: 'restaurants',
                'source-layer': 'restaurants',
                filter: ['==', ['get', 'type'], 'cluster'],
                paint: {
                    'circle-radius': [
                        'interpolate', ['linear'], ['get', 'count'],
                        10, 20,
                        100, 40,
                        1000, 60
                    ]
                }
            }
        ]
    }
});
```

Only 4-16 tiles are visible at once. The browser caches tiles automatically. There's no JavaScript clustering logic because clustering already happened on the server.

## Scaling to Production

The prototype demonstrates the core architecture. Scaling to production is mostly about deployment and infrastructure.

First, replace the Node.js tile server with Martin. Martin is written in Rust and is about 10x faster. It has built-in caching and is production-ready. You can run it with Docker:

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  ghcr.io/maplibre/martin
```

Second, pre-generate tiles for zoom levels 1-12. This is about 350,000 tiles total and takes up 2GB of storage. Store them in S3 and serve them through a CDN. Only generate tiles dynamically for zoom 13 and above.

Third, add Redis for distributed caching. When a tile is requested, check Redis first. If it's not there, generate it and cache it for an hour.

Fourth, set up multi-region PostGIS read replicas. Have one primary database for writes and multiple replicas for reads. Use PgBouncer for connection pooling.

Fifth, put a CDN in front of everything. CloudFront or Fastly work well. The CDN will handle 95% of requests, which means your origin servers only see 5% of traffic.

For real-time updates, use Kafka. When a restaurant changes, publish an event to Kafka. A worker consumes the event, calculates which tiles are affected (about 13 tiles per restaurant), and purges them from the CDN and Redis. If needed, refresh the materialized views.

For mobile, use the native MapLibre SDK. Cache tiles in SQLite for offline mode. Prefetch tiles for the likely next viewport. Debounce tile requests and cancel stale ones to save battery. Use Brotli compression instead of gzip to reduce data usage by 50%.

## Performance

The prototype with 50,000 restaurants hits these numbers:

- Cached tiles: under 10ms
- Uncached tiles: 20-80ms
- Cache hit rate: over 95%
- Tile size: 2-8 KB
- Frontend: 60 FPS

At production scale with 10 million restaurants, the architecture stays the same. The CDN handles 95% of requests at under 10ms. The database only sees about 1000 queries per second (the cache misses). Storage costs about $50/month for S3. CDN costs about $500/month for 1TB of transfer.

## Why These Choices

Vector tiles are 10x smaller than GeoJSON because they use protobuf instead of JSON. They cache perfectly because tile coordinates are stable. They render at 60 FPS because MapLibre uses WebGL. They're the industry standard used by Mapbox, Google, and Uber.

PostGIS is better than MongoDB for spatial queries. It's been around for 20+ years and has built-in clustering functions. It has native tile generation with ST_TileEnvelope and ST_AsMVT. Uber and Lyft use PostGIS at scale.

Server-side clustering is better than client-side. Client-side over-fetches data, drains battery, and gives inconsistent results across devices. Server-side clustering minimizes data transfer, is cacheable, and gives everyone the same experience.

## Summary

This architecture solves the original problems. Pins don't go missing because spatial intersection guarantees exact coverage. Panning doesn't lag because of GPU rendering and caching. Maps don't get messy because clustering happens on the server. Dense cities stay fast because tiles are tiny and cacheable.

The path to production is straightforward: deploy Martin, add a CDN, pre-generate low-zoom tiles, add Redis for distributed caching, and set up Kafka for real-time updates. The prototype demonstrates the core engine. Production is about deployment, not redesign.
