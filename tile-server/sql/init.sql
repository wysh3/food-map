-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create restaurants table
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

-- Create spatial index (critical for performance)
CREATE INDEX IF NOT EXISTS idx_restaurants_geom ON restaurants USING GIST(geom);

-- Create additional indexes
CREATE INDEX IF NOT EXISTS idx_restaurants_city ON restaurants(city);
CREATE INDEX IF NOT EXISTS idx_restaurants_active ON restaurants(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_restaurants_rating ON restaurants(rating DESC);

-- Function to automatically update geom from lat/lon
CREATE OR REPLACE FUNCTION update_geom()
RETURNS TRIGGER AS $$
BEGIN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update geom on insert/update
DROP TRIGGER IF EXISTS restaurants_geom_trigger ON restaurants;
CREATE TRIGGER restaurants_geom_trigger
    BEFORE INSERT OR UPDATE ON restaurants
    FOR EACH ROW
    EXECUTE FUNCTION update_geom();

-- Create a function to get tile bounds
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
    max_val := (1 << z); -- 2^z
    resolution := 360.0 / max_val;
    
    x_min := -180.0 + x * resolution;
    x_max := x_min + resolution;
    
    y_max := 85.0511 - y * resolution * (170.1022 / 360.0);
    y_min := y_max - resolution * (170.1022 / 360.0);
    
    RETURN ST_MakeEnvelope(x_min, y_min, x_max, y_max, 4326);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Pre-computed clusters for low zoom levels (zoom 8-12)
-- This is the production approach used by Martin and other tile servers
-- Refresh these materialized views when restaurant data changes

CREATE MATERIALIZED VIEW restaurant_clusters_z8 AS
SELECT 
    row_number() OVER () as id,
    COUNT(*) as point_count,
    ST_Centroid(ST_Collect(geom)) as geom,
    ROUND(AVG(rating)::numeric, 1) as avg_rating,
    array_agg(DISTINCT city) as cities
FROM (
    SELECT 
        ST_SnapToGrid(geom, 1.0) as grid,
        geom, rating, city
    FROM restaurants 
    WHERE is_active = true
) sub
GROUP BY grid
HAVING COUNT(*) > 1;

CREATE INDEX idx_clusters_z8_geom ON restaurant_clusters_z8 USING GIST(geom);

CREATE MATERIALIZED VIEW restaurant_clusters_z10 AS
SELECT 
    row_number() OVER () as id,
    COUNT(*) as point_count,
    ST_Centroid(ST_Collect(geom)) as geom,
    ROUND(AVG(rating)::numeric, 1) as avg_rating,
    array_agg(DISTINCT city) as cities
FROM (
    SELECT 
        ST_SnapToGrid(geom, 0.1) as grid,
        geom, rating, city
    FROM restaurants 
    WHERE is_active = true
) sub
GROUP BY grid
HAVING COUNT(*) > 1;

CREATE INDEX idx_clusters_z10_geom ON restaurant_clusters_z10 USING GIST(geom);

CREATE MATERIALIZED VIEW restaurant_clusters_z12 AS
SELECT 
    row_number() OVER () as id,
    COUNT(*) as point_count,
    ST_Centroid(ST_Collect(geom)) as geom,
    ROUND(AVG(rating)::numeric, 1) as avg_rating,
    array_agg(DISTINCT city) as cities
FROM (
    SELECT 
        ST_SnapToGrid(geom, 0.01) as grid,
        geom, rating, city
    FROM restaurants 
    WHERE is_active = true
) sub
GROUP BY grid
HAVING COUNT(*) > 1;

CREATE INDEX idx_clusters_z12_geom ON restaurant_clusters_z12 USING GIST(geom);

-- Function to refresh clusters (call this when restaurant data changes)
CREATE OR REPLACE FUNCTION refresh_clusters()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_clusters_z8;
    REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_clusters_z10;
    REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_clusters_z12;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE restaurants IS 'Restaurant locations for food delivery map';
COMMENT ON FUNCTION tile_bounds IS 'Calculate geographic bounds for a tile coordinate';
COMMENT ON FUNCTION refresh_clusters IS 'Refresh pre-computed cluster materialized views';
