# Food Delivery Map

**Live Demo:** https://food-map-phi.vercel.app/

## The Problem

Food delivery apps show restaurant pins on a map. In dense cities with thousands of restaurants, this becomes a mess:
- Map gets slow and laggy
- Too many pins overlap
- Wrong restaurants show up at different zoom levels
- Panning feels janky

## My Solution

I built a vector tile system that solves these problems:

### 1. Server-Side Clustering
Instead of sending all restaurants to the browser, I cluster them on the server based on zoom level:
- **Zoomed out (z5-8)**: Show 5 city-level clusters (one per city)
- **Medium zoom (z9-12)**: Break into neighborhood clusters
- **Zoomed in (z13+)**: Show individual restaurants

This means the browser only renders what's visible, not all 84,000 restaurants.

### 2. Vector Tiles (MVT)
I generate Mapbox Vector Tiles on-demand. Each tile contains only the restaurants in that specific map area. Benefits:
- Tiny file sizes (5-10KB per tile vs megabytes of JSON)
- Browser can cache tiles
- Smooth panning because tiles load independently

### 3. PostGIS Spatial Indexing
I use PostgreSQL with PostGIS extension:
- `GIST` indexes on geometry columns for fast spatial queries
- `ST_ClusterDBSCAN` for dynamic clustering
- `ST_TileEnvelope` to calculate tile boundaries
- Queries run in 10-50ms even with 84K restaurants

### 4. Smart Caching
- Materialized views for pre-computed clusters at z8, z10, z12
- In-memory LRU cache for frequently accessed tiles
- HTTP cache headers so browsers cache tiles

## What I Built

**Data:** 84,369 fake restaurants across 5 Indian cities (Mumbai, Delhi, Bangalore, Hyderabad, Chennai)

**Backend:** Node.js + Express + PostgreSQL/PostGIS
- Custom MVT encoder
- Zoom-based query strategies
- Tile caching layer

**Frontend:** React + MapLibre GL
- Interactive map with smooth pan/zoom
- Click restaurants for details
- City navigation buttons

## How It Works

1. User opens map at zoom 5 → Backend returns 5 city clusters
2. User zooms to Mumbai → Backend returns neighborhood clusters
3. User zooms to street level → Backend returns individual restaurants
4. User clicks restaurant → Fetch full details from API

Each zoom level shows the right amount of detail. No lag, no missing pins.

## Running Locally

```bash
# Backend
cd tile-server
npm install
# Set DATABASE_URL in .env
npm start

# Initialize data
curl http://localhost:8080/api/init
curl http://localhost:8080/api/setup
curl http://localhost:8080/api/refresh-views

# Frontend
cd map-frontend
npm install
npm run dev
```

## Tech Stack

- **Frontend:** React, MapLibre GL, Vite
- **Backend:** Node.js, Express
- **Database:** PostgreSQL 15, PostGIS 3.7
- **Deployment:** Railway (backend), Vercel (frontend)

## Key Decisions

**Why vector tiles?** They're the industry standard for performant maps. Used by Google Maps, Mapbox, etc.

**Why PostGIS?** Spatial queries are hard. PostGIS has 20 years of optimization for exactly this problem.

**Why server-side clustering?** Client-side clustering breaks down with thousands of points. Server knows the data better.

**Why materialized views?** Pre-computing common zoom levels makes those queries instant.

## What I'd Add Next

- Viewport-based queries (only query visible area)
- WebSocket for real-time restaurant updates
- Better error handling and retry logic
- Monitoring and performance metrics
- CDN for tile caching
