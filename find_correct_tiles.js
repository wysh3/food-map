// Find which tiles cities should be in
function lonLatToTile(lon, lat, z) {
    const n = Math.pow(2, z);
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y, z };
}

const cities = [
    { name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
    { name: 'Delhi', lat: 28.6139, lon: 77.2090 },
    { name: 'Bangalore', lat: 12.9716, lon: 77.5946 },
    { name: 'Hyderabad', lat: 17.3850, lon: 78.4867 },
    { name: 'Chennai', lat: 13.0827, lon: 80.2707 }
];

console.log('=== ZOOM 6 - Which tiles contain each city? ===\n');
cities.forEach(city => {
    const tile = lonLatToTile(city.lon, city.lat, 6);
    console.log(`${city.name}: tile ${tile.z}/${tile.x}/${tile.y}`);
});

console.log('\n=== ZOOM 12 - Mumbai area tiles ===\n');
const mumbaiAreas = [
    { name: 'Mumbai Center', lat: 19.0760, lon: 72.8777 },
    { name: 'Bandra', lat: 19.0596, lon: 72.8295 },
    { name: 'Andheri', lat: 19.1136, lon: 72.8697 }
];

mumbaiAreas.forEach(area => {
    const tile = lonLatToTile(area.lon, area.lat, 12);
    console.log(`${area.name}: tile ${tile.z}/${tile.x}/${tile.y}`);
});

// Check if all Indian cities fit in one tile at zoom 6
console.log('\n=== Do all cities fit in tile 6/46/28? ===\n');
const testTile = { z: 6, x: 46, y: 28 };

// Calculate tile bounds
function tileToBounds(z, x, y) {
    const n = Math.pow(2, z);
    const lon_min = x / n * 360 - 180;
    const lon_max = (x + 1) / n * 360 - 180;
    
    const lat_max = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    const lat_min = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
    
    return { lon_min, lon_max, lat_min, lat_max };
}

const bounds = tileToBounds(testTile.z, testTile.x, testTile.y);
console.log(`Tile ${testTile.z}/${testTile.x}/${testTile.y} bounds:`);
console.log(`  Longitude: ${bounds.lon_min.toFixed(2)} to ${bounds.lon_max.toFixed(2)}`);
console.log(`  Latitude: ${bounds.lat_min.toFixed(2)} to ${bounds.lat_max.toFixed(2)}`);
console.log();

cities.forEach(city => {
    const inBounds = city.lon >= bounds.lon_min && city.lon <= bounds.lon_max &&
                     city.lat >= bounds.lat_min && city.lat <= bounds.lat_max;
    console.log(`${city.name} (${city.lat.toFixed(2)}, ${city.lon.toFixed(2)}): ${inBounds ? 'YES' : 'NO'}`);
});
