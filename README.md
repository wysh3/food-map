# Food Delivery Map

This is a working prototype that shows how to build a restaurant map that stays fast even with thousands of restaurants. Think Swiggy or Zomato's map view.

The problem: Most map implementations break down when you have 10,000+ restaurants. Pins go missing, panning gets laggy, and the map becomes a mess at low zoom levels.

This prototype solves that using vector tiles and server-side clustering. It handles 50,000+ restaurants across Indian cities without breaking a sweat.

## Running It

```bash
chmod +x setup.sh
./setup.sh

# Start the tile server
cd tile-server && npm start

# In another terminal, start the frontend
cd map-frontend && npm run dev

# Open http://localhost:5173
```

You'll see restaurants across Mumbai, Delhi, Bangalore, Hyderabad, Chennai, Pune, and Kolkata. Try zooming from country-level down to street-level. Notice how clusters break apart smoothly and panning stays responsive.

## How It Works

**The stack:**
- PostGIS for spatial queries and clustering
- Node.js tile server with an LRU cache
- MapLibre GL JS for rendering
- Mapbox Vector Tiles (MVT) format

**The key ideas:**

Instead of sending all restaurants as JSON (which would be huge), the map requests small tiles. Each tile covers a specific geographic area at a specific zoom level. The tiles are tiny (2-8 KB) and cacheable.

At low zoom levels, restaurants are pre-clustered using PostgreSQL materialized views. This means clustering happens once when data loads, not on every request. At high zoom levels, you see individual restaurants.

The tile server has an LRU cache that keeps the 10,000 most recently used tiles in memory. This gives a 95%+ cache hit rate, which means most requests return in under 10ms.

## Performance

Cached tiles respond in under 10ms. Uncached tiles take 20-80ms. The frontend renders at 60fps even when panning aggressively. Tiles are 2-8 KB each, and spatial indexing guarantees no pins go missing.

## Why This Approach

This architecture is used by production systems. Martin (MapLibre's tile server) uses materialized views for clustering. Clusterbuster uses LRU caching for high concurrency. Swiggy uses Redis geohash for nearby queries. Supercluster (by Mapbox) handles millions of points the same way.

The prototype demonstrates the core patterns. Scaling to production means deploying Martin (a Rust tile server that's 10x faster), adding Redis for distributed caching, pre-generating tiles for low zoom levels, putting a CDN in front, and setting up read replicas.

See [DESIGN.md](./DESIGN.md) for the full architecture and scaling strategy.
