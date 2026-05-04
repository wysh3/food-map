// Test coordinate conversion
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
    
    return { x: xInTile, y: yInTile };
}

// Test with Indian cities
const cities = [
    { name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
    { name: 'Delhi', lat: 28.6139, lon: 77.2090 },
    { name: 'Bangalore', lat: 12.9716, lon: 77.5946 },
    { name: 'Hyderabad', lat: 17.3850, lon: 78.4867 },
    { name: 'Chennai', lat: 13.0827, lon: 80.2707 }
];

// Test at zoom 6, tile 46, 28 (India overview)
const z = 6, x = 46, y = 28;

console.log(`Testing tile ${z}/${x}/${y}\n`);

cities.forEach(city => {
    const coords = latLonToTileCoords(city.lat, city.lon, z, x, y);
    console.log(`${city.name}:`);
    console.log(`  Lat/Lon: ${city.lat}, ${city.lon}`);
    console.log(`  Tile coords: x=${coords.x.toFixed(4)}, y=${coords.y.toFixed(4)}`);
    console.log(`  In bounds: ${coords.x >= 0 && coords.x <= 1 && coords.y >= 0 && coords.y <= 1}`);
    console.log();
});
