# 🍽️ Food Delivery Map - India

A high-performance vector tile map visualization of 84,000+ restaurants across 5 major Indian cities, built with React, MapLibre GL, Node.js, PostgreSQL/PostGIS, and deployed on Railway + Vercel.

## 🚀 Live Demo

**Frontend:** https://food-map-phi.vercel.app/  
**Backend API:** https://food-map-production.up.railway.app/

## ✨ Features

- **Real-time Vector Tiles**: Efficient MVT (Mapbox Vector Tiles) generation with server-side clustering
- **84,369 Restaurants**: Across Mumbai, Delhi, Bangalore, Hyderabad, and Chennai
- **Smart Clustering**: 
  - City-level clusters at low zoom (z ≤ 8)
  - Dynamic clustering at medium zoom (z 9-12)
  - Individual restaurants at high zoom (z ≥ 13)
- **Interactive Map**: Click restaurants for details (name, cuisine, rating, location)
- **Optimized Performance**: 
  - Materialized views for pre-computed clusters
  - In-memory tile caching
  - PostGIS spatial indexing

## 🏗️ Architecture

### Frontend
- **Framework**: React 18 + Vite
- **Map Library**: MapLibre GL JS 3.6
- **Styling**: Custom CSS with responsive design
- **Deployment**: Vercel (auto-deploy from GitHub)

### Backend
- **Runtime**: Node.js + Express
- **Database**: PostgreSQL 15 + PostGIS 3.7
- **Tile Generation**: Custom MVT encoder using `pbf` library
- **Caching**: LRU cache for tile responses
- **Deployment**: Railway (Docker container)

### Database Schema
```sql
CREATE TABLE restaurants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    cuisine VARCHAR(100),
    rating DECIMAL(2,1),
    lat DECIMAL(10,8),
    lon DECIMAL(11,8),
    geom GEOMETRY(Point, 4326),
    city VARCHAR(100),
    area VARCHAR(100),
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_restaurants_geom ON restaurants USING GIST(geom);
```

## 📊 Data Distribution

| City | Restaurants |
|------|-------------|
| Mumbai | 23,100 |
| Delhi | 18,720 |
| Bangalore | 18,149 |
| Hyderabad | 13,200 |
| Chennai | 11,200 |
| **Total** | **84,369** |

## 🛠️ Technical Highlights

### Vector Tile Generation
- Custom MVT encoder handling coordinate transformation (EPSG:4326 → tile coordinates)
- Efficient clustering using PostGIS `ST_ClusterDBSCAN` and `ST_SnapToGrid`
- Proper handling of tile bounds with `ST_TileEnvelope` and `ST_Transform`

### Performance Optimizations
1. **Materialized Views**: Pre-computed clusters for zoom levels 8, 10, 12
2. **Spatial Indexing**: GIST indexes on geometry columns
3. **Tile Caching**: LRU cache with configurable TTL
4. **Query Optimization**: Zoom-based query strategies

### Coordinate System Handling
- Restaurants stored in WGS84 (EPSG:4326)
- Tile bounds transformed from Web Mercator (EPSG:3857)
- Proper coordinate conversion for MVT encoding

## 🚦 API Endpoints

### Tile Endpoint
```
GET /tiles/{z}/{x}/{y}.mvt
```
Returns Mapbox Vector Tile with restaurant data

### Statistics
```
GET /api/stats
```
Returns aggregate statistics (total restaurants, cities, ratings)

### Restaurant Details
```
GET /api/restaurants/:id
```
Returns detailed information for a specific restaurant

### Health Check
```
GET /health
```
Returns server health status

## 🎨 Map Visualization

### Color Scheme
- **Clusters**: 
  - 🔴 Red (500+ restaurants)
  - 🟠 Orange (100-500)
  - 🟡 Yellow (50-100)
  - 🟢 Green (10-50)
- **Individual Restaurants**:
  - 🟢 Green (4.5+ ⭐)
  - 🔵 Blue (3-4 ⭐)
  - ⚪ Gray (<3 ⭐)

### Zoom Levels
- **Z5-8**: City-level clusters (5 cities)
- **Z9-12**: Area-level clusters (dynamic)
- **Z13+**: Individual restaurant points

## 🔧 Local Development

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ with PostGIS extension
- Docker (optional)

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/wysh3/food-map.git
cd food-map
```

2. **Backend Setup**
```bash
cd tile-server
npm install
cp .env.example .env
# Edit .env with your database credentials
npm start
```

3. **Initialize Database**
```bash
curl http://localhost:8080/api/init
curl http://localhost:8080/api/setup
curl http://localhost:8080/api/refresh-views
```

4. **Frontend Setup**
```bash
cd map-frontend
npm install
npm run dev
```

5. **Access**
- Frontend: http://localhost:5173
- Backend: http://localhost:8080

## 📦 Deployment

### Backend (Railway)
1. Connect GitHub repository
2. Set environment variables:
   - `DATABASE_URL`: PostgreSQL connection string
   - `PORT`: 8080 (auto-set by Railway)
3. Deploy automatically on push to main

### Frontend (Vercel)
1. Connect GitHub repository
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. Set environment variable:
   - `VITE_TILE_SERVER_URL`: Backend URL
5. Deploy automatically on push to main

## 🐛 Troubleshooting

### Empty tiles at low zoom
Run: `curl https://your-backend.railway.app/api/refresh-views`

### CORS errors
Ensure backend has `cors()` middleware enabled

### Coordinate mismatch
Verify `ST_Transform(..., 4326)` is used for tile bounds

## 📝 License

MIT

## 👤 Author

Built for technical interview demonstration

---

**Tech Stack**: React • Node.js • PostgreSQL • PostGIS • MapLibre GL • Railway • Vercel
