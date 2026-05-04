import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query, testConnection } from './db.js';
import { latLonToTileCoords } from './tile-generator.js';
import { tileCache } from './cache.js';
import Pbf from 'pbf';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
    const dbOk = await testConnection();
    res.json({ 
        status: dbOk ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString()
    });
});

// Get restaurant details
app.get('/api/restaurants/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await query(
            'SELECT id, name, cuisine, rating, lat, lon, city, area FROM restaurants WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching restaurant:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Vector tile endpoint with caching and optimized clustering
app.get('/tiles/:z/:x/:y.mvt', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const z = parseInt(req.params.z);
        const x = parseInt(req.params.x);
        const y = parseInt(req.params.y);
        
        // Validate tile coordinates
        if (isNaN(z) || isNaN(x) || isNaN(y)) {
            return res.status(400).json({ error: 'Invalid tile coordinates' });
        }
        
        if (z < 0 || z > 20) {
            return res.status(400).json({ error: 'Invalid zoom level' });
        }
        
        const maxTile = Math.pow(2, z);
        if (x < 0 || x >= maxTile || y < 0 || y >= maxTile) {
            return res.status(400).json({ error: 'Tile coordinates out of range' });
        }
        
        // Check cache first (production approach)
        const cacheKey = `${z}:${x}:${y}`;
        const cached = tileCache.get(cacheKey);
        if (cached) {
            res.setHeader('Content-Type', 'application/x-protobuf');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('X-Response-Time', `${Date.now() - startTime}ms`);
            return res.send(cached);
        }
        
        // Use materialized views for low zoom (production optimization)
        // This is 10x faster than dynamic clustering
        let sqlQuery;
        
        if (z <= 8) {
            // Use pre-computed clusters for very low zoom
            sqlQuery = `
                WITH tile_bounds AS (
                    SELECT ST_TileEnvelope($1, $2, $3) AS geom
                )
                SELECT 
                    'cluster' AS type,
                    NULL::integer AS id,
                    NULL AS name,
                    NULL AS cuisine,
                    restaurant_clusters_z8.avg_rating AS rating,
                    NULL AS city,
                    restaurant_clusters_z8.point_count AS count,
                    ST_Y(restaurant_clusters_z8.geom) AS lat,
                    ST_X(restaurant_clusters_z8.geom) AS lon
                FROM restaurant_clusters_z8, tile_bounds
                WHERE ST_Intersects(restaurant_clusters_z8.geom, tile_bounds.geom)
                LIMIT 5000;
            `;
        } else if (z <= 10) {
            sqlQuery = `
                WITH tile_bounds AS (
                    SELECT ST_TileEnvelope($1, $2, $3) AS geom
                )
                SELECT 
                    'cluster' AS type,
                    NULL::integer AS id,
                    NULL AS name,
                    NULL AS cuisine,
                    restaurant_clusters_z10.avg_rating AS rating,
                    NULL AS city,
                    restaurant_clusters_z10.point_count AS count,
                    ST_Y(restaurant_clusters_z10.geom) AS lat,
                    ST_X(restaurant_clusters_z10.geom) AS lon
                FROM restaurant_clusters_z10, tile_bounds
                WHERE ST_Intersects(restaurant_clusters_z10.geom, tile_bounds.geom)
                LIMIT 5000;
            `;
        } else if (z <= 12) {
            sqlQuery = `
                WITH tile_bounds AS (
                    SELECT ST_TileEnvelope($1, $2, $3) AS geom
                )
                SELECT 
                    'cluster' AS type,
                    NULL::integer AS id,
                    NULL AS name,
                    NULL AS cuisine,
                    restaurant_clusters_z12.avg_rating AS rating,
                    NULL AS city,
                    restaurant_clusters_z12.point_count AS count,
                    ST_Y(restaurant_clusters_z12.geom) AS lat,
                    ST_X(restaurant_clusters_z12.geom) AS lon
                FROM restaurant_clusters_z12, tile_bounds
                WHERE ST_Intersects(restaurant_clusters_z12.geom, tile_bounds.geom)
                LIMIT 5000;
            `;
        } else if (z <= 13) {
            // Light dynamic clustering for medium zoom
            sqlQuery = `
                WITH tile_bounds AS (
                    SELECT ST_TileEnvelope($1, $2, $3) AS geom
                ),
                restaurants_in_tile AS (
                    SELECT id, name, cuisine, rating, lat, lon, city, geom
                    FROM restaurants
                    WHERE is_active = true
                      AND ST_Intersects(geom, (SELECT geom FROM tile_bounds))
                ),
                clustered AS (
                    SELECT 
                        ST_ClusterDBSCAN(geom, eps := 0.01, minpoints := 3) OVER () AS cluster_id,
                        id, 
                        name, 
                        cuisine, 
                        rating, 
                        lat, 
                        lon, 
                        city, 
                        geom
                    FROM restaurants_in_tile
                )
                SELECT 
                    CASE WHEN cluster_id IS NOT NULL THEN 'cluster' ELSE 'restaurant' END AS type,
                    CASE WHEN cluster_id IS NOT NULL THEN NULL ELSE id END AS id,
                    CASE WHEN cluster_id IS NOT NULL THEN NULL ELSE name END AS name,
                    CASE WHEN cluster_id IS NOT NULL THEN NULL ELSE cuisine END AS cuisine,
                    CASE WHEN cluster_id IS NOT NULL THEN AVG(rating) ELSE rating END AS rating,
                    CASE WHEN cluster_id IS NOT NULL THEN NULL ELSE city END AS city,
                    CASE WHEN cluster_id IS NOT NULL THEN COUNT(*) ELSE NULL END AS count,
                    CASE WHEN cluster_id IS NOT NULL THEN ST_Y(ST_Centroid(ST_Collect(geom))) ELSE lat END AS lat,
                    CASE WHEN cluster_id IS NOT NULL THEN ST_X(ST_Centroid(ST_Collect(geom))) ELSE lon END AS lon
                FROM clustered
                GROUP BY cluster_id, id, name, cuisine, rating, lat, lon, city, geom
                LIMIT 5000;
            `;
        } else {
            // Individual restaurants at high zoom
            sqlQuery = `
                WITH tile_bounds AS (
                    SELECT ST_TileEnvelope($1, $2, $3) AS geom
                )
                SELECT 
                    'restaurant' AS type,
                    restaurants.id,
                    restaurants.name,
                    restaurants.cuisine,
                    restaurants.rating,
                    restaurants.city,
                    NULL::bigint AS count,
                    restaurants.lat,
                    restaurants.lon
                FROM restaurants, tile_bounds
                WHERE restaurants.is_active = true
                  AND ST_Intersects(restaurants.geom, tile_bounds.geom)
                LIMIT 5000;
            `;
        }
        
        const result = await query(sqlQuery, [z, x, y]);
        
        // Convert to tile coordinates and build features
        const features = result.rows.map(row => {
            const tileCoords = latLonToTileCoords(row.lat, row.lon, z, x, y);
            
            return {
                type: row.type,
                x: tileCoords.x,
                y: tileCoords.y,
                properties: row.type === 'cluster' 
                    ? { 
                        type: 'cluster',
                        count: parseInt(row.count),
                        point_count: parseInt(row.count)
                    }
                    : {
                        type: 'restaurant',
                        id: row.id,
                        name: row.name,
                        cuisine: row.cuisine || 'Unknown',
                        rating: parseFloat(row.rating) || 0,
                        city: row.city || ''
                    }
            };
        });
        
        // Generate MVT tile
        const tile = generateSimpleMVT(features);
        
        // Cache the tile (production approach)
        tileCache.set(cacheKey, tile);
        
        const duration = Date.now() - startTime;
        
        // Set headers
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-Cache', 'MISS');
        res.setHeader('X-Tile-Features', features.length);
        res.setHeader('X-Response-Time', `${duration}ms`);
        
        if (features.length === 0) {
            // Return empty tile
            return res.send(Buffer.alloc(0));
        }
        
        res.send(tile);
        
        if (duration > 100) {
            console.warn(`Slow tile generation: ${z}/${x}/${y} took ${duration}ms (${features.length} features)`);
        }
        
    } catch (err) {
        console.error('Error generating tile:', err);
        res.status(500).json({ error: 'Failed to generate tile' });
    }
});

// Cache stats endpoint
app.get('/api/cache/stats', (req, res) => {
    res.json(tileCache.getStats());
});

// Clear cache endpoint (for testing)
app.post('/api/cache/clear', (req, res) => {
    tileCache.clear();
    res.json({ message: 'Cache cleared' });
});

// Simple MVT generator using correct pbf API
function generateSimpleMVT(features) {
    const pbf = new Pbf();
    
    // Collect all unique keys and values first
    const keys = [];
    const keyIndex = {};
    const values = [];
    const valueIndex = {};
    
    features.forEach(function(f) {
        Object.keys(f.properties).forEach(function(k) {
            if (keyIndex[k] === undefined) {
                keyIndex[k] = keys.length;
                keys.push(k);
            }
        });
        Object.values(f.properties).forEach(function(v) {
            const vKey = typeof v + ':' + v;
            if (valueIndex[vKey] === undefined) {
                valueIndex[vKey] = values.length;
                values.push(v);
            }
        });
    });
    
    // Write layer with tag 3 (layer message in MVT spec)
    pbf.writeMessage(3, writeLayer, { features, keys, keyIndex, values, valueIndex });
    
    return Buffer.from(pbf.finish());
}

// Layer writer function - receives (obj, pbf)
function writeLayer(data, pbf) {
    const { features, keys, keyIndex, values, valueIndex } = data;
    
    // Layer name (tag 1)
    pbf.writeStringField(1, 'restaurants');
    
    // Version (tag 15)
    pbf.writeVarintField(15, 2);
    
    // Extent (tag 5)
    pbf.writeVarintField(5, 4096);
    
    // Write keys (tag 3)
    keys.forEach(function(key) {
        pbf.writeStringField(3, key);
    });
    
    // Write values (tag 4)
    values.forEach(function(value) {
        pbf.writeMessage(4, writeValue, value);
    });
    
    // Write features (tag 2)
    features.forEach(function(feature, idx) {
        pbf.writeMessage(2, writeFeature, { feature, idx, keyIndex, valueIndex });
    });
}

// Value writer function - receives (value, pbf)
function writeValue(value, pbf) {
    if (typeof value === 'string') {
        pbf.writeStringField(1, value);
    } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            pbf.writeVarintField(6, value);
        } else {
            pbf.writeDoubleField(3, value);
        }
    } else if (typeof value === 'boolean') {
        pbf.writeBooleanField(7, value);
    }
}

// Feature writer function - receives (data, pbf)
function writeFeature(data, pbf) {
    const { feature, idx, keyIndex, valueIndex } = data;
    
    // ID (tag 1)
    pbf.writeVarintField(1, idx);
    
    // Tags (tag 2) - property key-value pairs
    const tags = [];
    Object.entries(feature.properties).forEach(function(entry) {
        const key = entry[0];
        const value = entry[1];
        tags.push(keyIndex[key]);
        tags.push(valueIndex[typeof value + ':' + value]);
    });
    pbf.writePackedVarint(2, tags);
    
    // Type (tag 3) - 1 = point
    pbf.writeVarintField(3, 1);
    
    // Geometry (tag 4)
    const x = Math.round(feature.x * 4096);
    const y = Math.round(feature.y * 4096);
    
    const geometry = [
        9, // MoveTo command (1 point)
        (x << 1) ^ (x >> 31), // Zigzag encode x
        (y << 1) ^ (y >> 31)  // Zigzag encode y
    ];
    
    pbf.writePackedVarint(4, geometry);
}

// Stats endpoint
app.get('/api/stats', async (req, res) => {
    try {
        const result = await query(`
            SELECT 
                COUNT(*) as total_restaurants,
                COUNT(DISTINCT city) as total_cities,
                AVG(rating) as avg_rating,
                COUNT(*) FILTER (WHERE is_active = true) as active_restaurants
            FROM restaurants
        `);
        
        const cityStats = await query(`
            SELECT city, COUNT(*) as count
            FROM restaurants
            WHERE is_active = true
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        `);
        
        res.json({
            ...result.rows[0],
            top_cities: cityStats.rows
        });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Debug endpoint to test tile queries
app.get('/api/debug/tile/:z/:x/:y', async (req, res) => {
    try {
        const z = parseInt(req.params.z);
        const x = parseInt(req.params.x);
        const y = parseInt(req.params.y);
        
        // Test if ST_TileEnvelope exists and get bounds
        let boundsQuery = `
            SELECT 
                ST_TileEnvelope($1, $2, $3) as geom,
                ST_AsText(ST_TileEnvelope($1, $2, $3)) as bounds_text,
                ST_XMin(ST_TileEnvelope($1, $2, $3)) as xmin,
                ST_YMin(ST_TileEnvelope($1, $2, $3)) as ymin,
                ST_XMax(ST_TileEnvelope($1, $2, $3)) as xmax,
                ST_YMax(ST_TileEnvelope($1, $2, $3)) as ymax
        `;
        let boundsResult = await query(boundsQuery, [z, x, y]);
        
        // Count restaurants in Mumbai area
        const mumbaiCount = await query(`
            SELECT COUNT(*) as count 
            FROM restaurants 
            WHERE city = 'Mumbai'
        `);
        
        // Get sample Mumbai restaurants
        const mumbaiSample = await query(`
            SELECT id, name, lat, lon, 
                   ST_AsText(geom) as geom_text
            FROM restaurants 
            WHERE city = 'Mumbai'
            LIMIT 3
        `);
        
        // Test actual tile query
        const sqlQuery = `
            WITH tile_bounds AS (
                SELECT ST_TileEnvelope($1, $2, $3) AS geom
            )
            SELECT 
                'restaurant' AS type,
                id, name, cuisine, rating, city,
                NULL::integer AS count,
                lat, lon,
                ST_AsText(restaurants.geom) as geom_text
            FROM restaurants, tile_bounds
            WHERE ST_Intersects(restaurants.geom, tile_bounds.geom)
            LIMIT 10;
        `;
        
        const result = await query(sqlQuery, [z, x, y]);
        
        res.json({
            tile: `${z}/${x}/${y}`,
            tile_bounds: boundsResult.rows[0],
            mumbai_restaurants: mumbaiCount.rows[0].count,
            mumbai_sample: mumbaiSample.rows,
            features_found: result.rows.length,
            sample_features: result.rows.slice(0, 3)
        });
    } catch (err) {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

// Init endpoint - creates tables and schema
app.get('/api/init', async (req, res) => {
    try {
        console.log('Creating database schema...');
        
        // Create tables and functions
        await query(`
            CREATE EXTENSION IF NOT EXISTS postgis;

            CREATE TABLE IF NOT EXISTS restaurants (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                cuisine VARCHAR(100),
                rating DECIMAL(2,1) CHECK (rating >= 0 AND rating <= 5),
                lat DECIMAL(10, 8) NOT NULL,
                lon DECIMAL(11, 8) NOT NULL,
                geom GEOMETRY(Point, 4326),
                city VARCHAR(100),
                area VARCHAR(100),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_restaurants_geom ON restaurants USING GIST(geom);
            CREATE INDEX IF NOT EXISTS idx_restaurants_city ON restaurants(city);
            CREATE INDEX IF NOT EXISTS idx_restaurants_active ON restaurants(is_active) WHERE is_active = true;
        `);
        
        await query(`
            CREATE OR REPLACE FUNCTION update_geom()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        
        await query(`
            DROP TRIGGER IF EXISTS restaurants_geom_trigger ON restaurants;
            CREATE TRIGGER restaurants_geom_trigger
                BEFORE INSERT OR UPDATE ON restaurants
                FOR EACH ROW
                EXECUTE FUNCTION update_geom();
        `);
        
        await query(`
            CREATE OR REPLACE FUNCTION tile_bounds(z INTEGER, x INTEGER, y INTEGER)
            RETURNS GEOMETRY AS $$
            DECLARE
                max_val INTEGER;
                resolution FLOAT;
                x_min FLOAT;
                y_min FLOAT;
                x_max FLOAT;
                y_max FLOAT;
            BEGIN
                max_val := (1 << z);
                resolution := 360.0 / max_val;
                
                x_min := -180.0 + x * resolution;
                x_max := x_min + resolution;
                
                y_max := 85.0511 - y * resolution * (170.1022 / 360.0);
                y_min := y_max - resolution * (170.1022 / 360.0);
                
                RETURN ST_MakeEnvelope(x_min, y_min, x_max, y_max, 4326);
            END;
            $$ LANGUAGE plpgsql IMMUTABLE;
        `);
        
        console.log('Schema created successfully');
        res.json({ message: 'Database schema initialized. Now call /api/setup to load data.' });
        
    } catch (err) {
        console.error('Init error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Setup endpoint - loads sample data (call this once after deployment)
app.get('/api/setup', async (req, res) => {
    try {
        console.log('Starting data generation...');
        
        // Check if data already exists
        const existing = await query('SELECT COUNT(*) as count FROM restaurants');
        if (parseInt(existing.rows[0].count) > 0) {
            return res.json({ 
                message: 'Data already exists', 
                count: existing.rows[0].count 
            });
        }
        
        // Generate restaurants
        const restaurants = await generateRestaurantsData();
        
        console.log(`Generated ${restaurants.length} restaurants, inserting...`);
        
        // Insert in batches
        const batchSize = 1000;
        let inserted = 0;
        
        for (let i = 0; i < restaurants.length; i += batchSize) {
            const batch = restaurants.slice(i, i + batchSize);
            
            const values = batch.map((r, idx) => {
                const base = idx;
                return `($${base * 7 + 1}, $${base * 7 + 2}, $${base * 7 + 3}, $${base * 7 + 4}, $${base * 7 + 5}, $${base * 7 + 6}, $${base * 7 + 7})`;
            }).join(',');
            
            const params = batch.flatMap(r => [
                r.name, r.cuisine, r.rating, r.lat, r.lon, r.city, r.area
            ]);
            
            await query(`
                INSERT INTO restaurants (name, cuisine, rating, lat, lon, city, area)
                VALUES ${values}
            `, params);
            
            inserted += batch.length;
        }
        
        console.log('Refreshing materialized views...');
        
        // Create materialized views
        await query(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS restaurant_clusters_z8 AS
            SELECT 
                row_number() OVER () as id,
                COUNT(*) as point_count,
                ST_Centroid(ST_Collect(geom)) as geom,
                ROUND(AVG(rating)::numeric, 1) as avg_rating
            FROM (
                SELECT 
                    ST_SnapToGrid(geom, 1.0) as grid,
                    geom, rating
                FROM restaurants 
                WHERE is_active = true
            ) sub
            GROUP BY grid
            HAVING COUNT(*) > 1;
        `);
        
        await query(`CREATE INDEX IF NOT EXISTS idx_clusters_z8_geom ON restaurant_clusters_z8 USING GIST(geom);`);
        
        await query(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS restaurant_clusters_z10 AS
            SELECT 
                row_number() OVER () as id,
                COUNT(*) as point_count,
                ST_Centroid(ST_Collect(geom)) as geom,
                ROUND(AVG(rating)::numeric, 1) as avg_rating
            FROM (
                SELECT 
                    ST_SnapToGrid(geom, 0.1) as grid,
                    geom, rating
                FROM restaurants 
                WHERE is_active = true
            ) sub
            GROUP BY grid
            HAVING COUNT(*) > 1;
        `);
        
        await query(`CREATE INDEX IF NOT EXISTS idx_clusters_z10_geom ON restaurant_clusters_z10 USING GIST(geom);`);
        
        await query(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS restaurant_clusters_z12 AS
            SELECT 
                row_number() OVER () as id,
                COUNT(*) as point_count,
                ST_Centroid(ST_Collect(geom)) as geom,
                ROUND(AVG(rating)::numeric, 1) as avg_rating
            FROM (
                SELECT 
                    ST_SnapToGrid(geom, 0.01) as grid,
                    geom, rating
                FROM restaurants 
                WHERE is_active = true
            ) sub
            GROUP BY grid
            HAVING COUNT(*) > 1;
        `);
        
        await query(`CREATE INDEX IF NOT EXISTS idx_clusters_z12_geom ON restaurant_clusters_z12 USING GIST(geom);`);
        
        await query(`
            CREATE OR REPLACE FUNCTION refresh_clusters()
            RETURNS void AS $$
            BEGIN
                REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_clusters_z8;
                REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_clusters_z10;
                REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_clusters_z12;
            END;
            $$ LANGUAGE plpgsql;
        `);
        
        await query('SELECT refresh_clusters()');
        
        console.log('Setup complete!');
        
        res.json({ 
            message: 'Setup complete', 
            restaurants_created: inserted 
        });
        
    } catch (err) {
        console.error('Setup error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Helper function to generate restaurant data
async function generateRestaurantsData() {
    const INDIAN_CITIES = [
        {
            name: 'Mumbai',
            center: { lat: 19.0760, lon: 72.8777 },
            radius: 0.15,
            density: 15000,
            areas: [
                { name: 'Bandra', lat: 19.0596, lon: 72.8295, density: 1.5 },
                { name: 'Andheri', lat: 19.1136, lon: 72.8697, density: 1.3 },
                { name: 'Powai', lat: 19.1176, lon: 72.9060, density: 1.2 },
                { name: 'Colaba', lat: 18.9067, lon: 72.8147, density: 1.4 },
                { name: 'Juhu', lat: 19.0990, lon: 72.8265, density: 1.3 },
            ]
        },
        {
            name: 'Delhi',
            center: { lat: 28.6139, lon: 77.2090 },
            radius: 0.18,
            density: 12000,
            areas: [
                { name: 'Connaught Place', lat: 28.6315, lon: 77.2167, density: 1.6 },
                { name: 'Saket', lat: 28.5244, lon: 77.2066, density: 1.4 },
                { name: 'Dwarka', lat: 28.5921, lon: 77.0460, density: 1.2 },
                { name: 'Rohini', lat: 28.7495, lon: 77.0736, density: 1.1 },
                { name: 'Karol Bagh', lat: 28.6519, lon: 77.1909, density: 1.5 },
            ]
        },
        {
            name: 'Bangalore',
            center: { lat: 12.9716, lon: 77.5946 },
            radius: 0.16,
            density: 11000,
            areas: [
                { name: 'Koramangala', lat: 12.9352, lon: 77.6245, density: 1.6 },
                { name: 'Indiranagar', lat: 12.9784, lon: 77.6408, density: 1.5 },
                { name: 'Whitefield', lat: 12.9698, lon: 77.7499, density: 1.3 },
                { name: 'Jayanagar', lat: 12.9250, lon: 77.5838, density: 1.4 },
            ]
        },
        {
            name: 'Hyderabad',
            center: { lat: 17.3850, lon: 78.4867 },
            radius: 0.14,
            density: 8000,
            areas: [
                { name: 'Hitech City', lat: 17.4435, lon: 78.3772, density: 1.5 },
                { name: 'Banjara Hills', lat: 17.4239, lon: 78.4738, density: 1.4 },
            ]
        },
        {
            name: 'Chennai',
            center: { lat: 13.0827, lon: 80.2707 },
            radius: 0.13,
            density: 7000,
            areas: [
                { name: 'T Nagar', lat: 13.0418, lon: 80.2341, density: 1.5 },
                { name: 'Anna Nagar', lat: 13.0850, lon: 80.2101, density: 1.3 },
            ]
        }
    ];
    
    const CUISINES = [
        'North Indian', 'South Indian', 'Chinese', 'Mughlai', 'Bengali',
        'Punjabi', 'Gujarati', 'Maharashtrian', 'Hyderabadi', 'Kerala',
        'Fast Food', 'Street Food', 'Biryani', 'Tandoori', 'Vegetarian'
    ];
    
    const NAME_PREFIXES = ['Taj', 'Royal', 'Spice', 'Curry', 'Masala', 'Paradise', 'Golden', 'Grand'];
    const NAME_SUFFIXES = ['Kitchen', 'Restaurant', 'Dhaba', 'Corner', 'House', 'Palace', 'Express', 'Hub'];
    
    function generateName() {
        return NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)] + ' ' +
               NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
    }
    
    function generateRating() {
        return Math.round((3.0 + Math.random() * 2.0) * 10) / 10;
    }
    
    function generatePoint(center, radius, densityMultiplier = 1.0) {
        const angle = Math.random() * 2 * Math.PI;
        const u1 = Math.random();
        const u2 = Math.random();
        const normalDist = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const distance = Math.abs(normalDist) * radius * 0.3 / densityMultiplier;
        
        return {
            lat: center.lat + distance * Math.cos(angle),
            lon: center.lon + distance * Math.sin(angle)
        };
    }
    
    const restaurants = [];
    
    for (const city of INDIAN_CITIES) {
        for (const area of city.areas) {
            const areaCount = Math.floor(city.density * area.density / city.areas.length);
            
            for (let i = 0; i < areaCount; i++) {
                const point = generatePoint({ lat: area.lat, lon: area.lon }, city.radius / 3, area.density);
                
                restaurants.push({
                    name: generateName(),
                    cuisine: CUISINES[Math.floor(Math.random() * CUISINES.length)],
                    rating: generateRating(),
                    lat: point.lat,
                    lon: point.lon,
                    city: city.name,
                    area: area.name
                });
            }
        }
        
        const sparseCount = Math.floor(city.density * 0.2);
        for (let i = 0; i < sparseCount; i++) {
            const point = generatePoint(city.center, city.radius, 0.5);
            
            restaurants.push({
                name: generateName(),
                cuisine: CUISINES[Math.floor(Math.random() * CUISINES.length)],
                rating: generateRating(),
                lat: point.lat,
                lon: point.lon,
                city: city.name,
                area: 'Other'
            });
        }
    }
    
    return restaurants;
}

// Start server
async function start() {
    const dbOk = await testConnection();
    if (!dbOk) {
        console.error('Failed to connect to database. Exiting...');
        process.exit(1);
    }
    
    app.listen(PORT, () => {
        console.log(`🚀 Tile server running on http://localhost:${PORT}`);
        console.log(`📍 Tiles: http://localhost:${PORT}/tiles/{z}/{x}/{y}.mvt`);
        console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
        console.log(`❤️  Health: http://localhost:${PORT}/health`);
    });
}

start();
