// Deep analysis of coordinate conversion

function latLonToTileCoords(lat, lon, z, x, y) {
    lat = parseFloat(lat);
    lon = parseFloat(lon);
    
    const n = Math.pow(2, z);
    
    // Convert lat/lon to global tile coordinates (Web Mercator projection)
    const xtile = (lon + 180) / 360 * n;
    const latRad = lat * Math.PI / 180;
    const ytile = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    
    // Get position within this specific tile (0-1)
    const xInTile = xtile - x;
    const yInTile = ytile - y;
    
    return { x: xInTile, y: yInTile, xtile, ytile };
}

// Test cities at different zoom levels
const cities = [
    { name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
    { name: 'Delhi', lat: 28.6139, lon: 77.2090 },
    { name: 'Bangalore', lat: 12.9716, lon: 77.5946 },
];

console.log('=== ZOOM 6 (India overview) ===');
let z = 6, x = 46, y = 28;
cities.forEach(city => {
    const c = latLonToTileCoords(city.lat, city.lon, z, x, y);
    console.log(`${city.name}: tile_x=${c.x.toFixed(3)}, tile_y=${c.y.toFixed(3)} (global: ${c.xtile.toFixed(2)}, ${c.ytile.toFixed(2)})`);
});

console.log('\n=== ZOOM 12 (City level) ===');
// Mumbai at zoom 12
z = 12; x = 2876; y = 1826;
const mumbai = cities[0];
const mc = latLonToTileCoords(mumbai.lat, mumbai.lon, z, x, y);
console.log(`Mumbai: tile_x=${mc.x.toFixed(3)}, tile_y=${mc.y.toFixed(3)}`);

// Test a few restaurants around Mumbai
const restaurants = [
    { name: 'Bandra', lat: 19.0596, lon: 72.8295 },
    { name: 'Andheri', lat: 19.1136, lon: 72.8697 },
    { name: 'Colaba', lat: 18.9067, lon: 72.8147 },
];

restaurants.forEach(r => {
    const rc = latLonToTileCoords(r.lat, r.lon, z, x, y);
    console.log(`${r.name}: tile_x=${rc.x.toFixed(3)}, tile_y=${rc.y.toFixed(3)}`);
});

console.log('\n=== TESTING STRING VS NUMBER ===');
const testLat = "19.0760";
const testLon = "72.8777";
console.log('String input:', latLonToTileCoords(testLat, testLon, 12, 2876, 1826));
console.log('Number input:', latLonToTileCoords(19.0760, 72.8777, 12, 2876, 1826));
