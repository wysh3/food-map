import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

/**
 * Generate MVT (Mapbox Vector Tile) from PostGIS query results
 * 
 * @param {Array} features - Array of features from PostGIS
 * @param {number} z - Zoom level
 * @param {number} x - Tile X coordinate
 * @param {number} y - Tile Y coordinate
 * @returns {Buffer} - MVT protobuf buffer
 */
export function generateMVT(features, z, x, y) {
    const tile = {
        layers: {
            restaurants: {
                version: 2,
                name: 'restaurants',
                extent: 4096,
                length: features.length,
                features: features.map((feature, idx) => ({
                    id: idx,
                    type: feature.type === 'cluster' ? 1 : 1, // 1 = Point
                    geometry: [
                        [
                            Math.round(feature.x * 4096),
                            Math.round(feature.y * 4096)
                        ]
                    ],
                    properties: feature.properties
                }))
            }
        }
    };

    // Encode to protobuf
    const pbf = new Pbf();
    writeTile(tile, pbf);
    return Buffer.from(pbf.finish());
}

/**
 * Convert lat/lon to tile pixel coordinates
 * 
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} z - Zoom level
 * @param {number} x - Tile X coordinate
 * @param {number} y - Tile Y coordinate
 * @returns {Object} - {x, y} in tile coordinates (0-1)
 */
export function latLonToTileCoords(lat, lon, z, x, y) {
    const n = Math.pow(2, z);
    
    // Convert lat/lon to tile coordinates
    const xtile = (lon + 180) / 360 * n;
    const ytile = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
    
    // Get position within this specific tile (0-1)
    let xInTile = xtile - x;
    let yInTile = ytile - y;
    
    // Clamp to valid range (0-1) to prevent "geometry exceeds extent" errors
    xInTile = Math.max(0, Math.min(1, xInTile));
    yInTile = Math.max(0, Math.min(1, yInTile));
    
    return { x: xInTile, y: yInTile };
}

/**
 * Simple MVT encoder (writes protobuf format)
 */
function writeTile(tile, pbf) {
    for (const layerName in tile.layers) {
        const layer = tile.layers[layerName];
        pbf.writeMessage(3, writeLayer, layer);
    }
}

function writeLayer(layer, pbf) {
    pbf.writeVarintField(15, layer.version || 1);
    pbf.writeStringField(1, layer.name || '');
    pbf.writeVarintField(5, layer.extent || 4096);
    
    const keys = [];
    const values = [];
    const keysMap = {};
    const valuesMap = {};
    
    for (const feature of layer.features) {
        if (feature.properties) {
            for (const key in feature.properties) {
                if (!keysMap[key]) {
                    keysMap[key] = keys.length;
                    keys.push(key);
                }
                
                const value = feature.properties[key];
                const valueKey = JSON.stringify(value);
                if (!valuesMap[valueKey]) {
                    valuesMap[valueKey] = values.length;
                    values.push(value);
                }
            }
        }
    }
    
    for (const key of keys) {
        pbf.writeStringField(3, key);
    }
    
    for (const value of values) {
        pbf.writeMessage(4, writeValue, value);
    }
    
    for (const feature of layer.features) {
        pbf.writeMessage(2, writeFeature, { feature, keys: keysMap, values: valuesMap });
    }
}

function writeFeature(ctx, pbf) {
    const { feature, keys, values } = ctx;
    
    if (feature.id !== undefined) {
        pbf.writeVarintField(1, feature.id);
    }
    
    if (feature.properties) {
        const tags = [];
        for (const key in feature.properties) {
            tags.push(keys[key]);
            tags.push(values[JSON.stringify(feature.properties[key])]);
        }
        pbf.writePackedVarint(2, tags);
    }
    
    pbf.writeVarintField(3, feature.type || 1);
    
    if (feature.geometry) {
        const geometry = [];
        for (const ring of feature.geometry) {
            geometry.push(9); // MoveTo command
            let x = 0, y = 0;
            for (let i = 0; i < ring.length; i++) {
                const dx = ring[i][0] - x;
                const dy = ring[i][1] - y;
                geometry.push((dx << 1) ^ (dx >> 31));
                geometry.push((dy << 1) ^ (dy >> 31));
                x = ring[i][0];
                y = ring[i][1];
            }
        }
        pbf.writePackedVarint(4, geometry);
    }
}

function writeValue(value, pbf) {
    if (typeof value === 'string') {
        pbf.writeStringField(1, value);
    } else if (typeof value === 'number') {
        if (value % 1 === 0) {
            pbf.writeVarintField(6, value);
        } else {
            pbf.writeDoubleField(3, value);
        }
    } else if (typeof value === 'boolean') {
        pbf.writeBooleanField(7, value);
    }
}

export default { generateMVT, latLonToTileCoords };
