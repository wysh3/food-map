import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '../tile-server/.env' });

const { Client } = pg;

// Indian cities with realistic coordinates and density
const INDIAN_CITIES = [
    {
        name: 'Mumbai',
        center: { lat: 19.0760, lon: 72.8777 },
        radius: 0.15,
        density: 15000, // Most restaurants
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
            { name: 'MG Road', lat: 12.9750, lon: 77.6069, density: 1.5 },
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
            { name: 'Gachibowli', lat: 17.4399, lon: 78.3487, density: 1.3 },
            { name: 'Jubilee Hills', lat: 17.4326, lon: 78.4071, density: 1.4 },
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
            { name: 'Velachery', lat: 12.9750, lon: 80.2210, density: 1.2 },
            { name: 'Adyar', lat: 13.0067, lon: 80.2570, density: 1.4 },
        ]
    },
    {
        name: 'Pune',
        center: { lat: 18.5204, lon: 73.8567 },
        radius: 0.12,
        density: 6000,
        areas: [
            { name: 'Koregaon Park', lat: 18.5362, lon: 73.8958, density: 1.4 },
            { name: 'Hinjewadi', lat: 18.5912, lon: 73.7389, density: 1.3 },
            { name: 'Viman Nagar', lat: 18.5679, lon: 73.9143, density: 1.2 },
        ]
    },
    {
        name: 'Kolkata',
        center: { lat: 22.5726, lon: 88.3639 },
        radius: 0.12,
        density: 5500,
        areas: [
            { name: 'Park Street', lat: 22.5535, lon: 88.3525, density: 1.5 },
            { name: 'Salt Lake', lat: 22.5804, lon: 88.4160, density: 1.2 },
            { name: 'Howrah', lat: 22.5958, lon: 88.2636, density: 1.1 },
        ]
    }
];

// Indian cuisine types
const CUISINES = [
    'North Indian', 'South Indian', 'Chinese', 'Mughlai', 'Bengali',
    'Punjabi', 'Gujarati', 'Maharashtrian', 'Hyderabadi', 'Kerala',
    'Fast Food', 'Street Food', 'Biryani', 'Tandoori', 'Vegetarian',
    'Continental', 'Italian', 'Mexican', 'Thai', 'Japanese',
    'Cafe', 'Bakery', 'Desserts', 'Ice Cream', 'Juice Bar'
];

// Restaurant name patterns
const NAME_PREFIXES = [
    'Taj', 'Royal', 'Spice', 'Curry', 'Masala', 'Biryani', 'Tandoor',
    'Paradise', 'Golden', 'Silver', 'Grand', 'Classic', 'Modern',
    'Urban', 'Desi', 'Punjabi', 'Mumbai', 'Delhi', 'Bangalore'
];

const NAME_SUFFIXES = [
    'Kitchen', 'Restaurant', 'Dhaba', 'Corner', 'House', 'Palace',
    'Express', 'Hub', 'Point', 'Junction', 'Cafe', 'Bistro', 'Grill'
];

function generateRestaurantName() {
    const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
    const suffix = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
    return `${prefix} ${suffix}`;
}

function generateRating() {
    // Skewed towards higher ratings (3.5-4.5)
    const base = 3.0 + Math.random() * 2.0;
    return Math.round(base * 10) / 10;
}

function generateRandomPoint(center, radius, densityMultiplier = 1.0) {
    // Generate points with clustering (not uniform distribution)
    // Use normal distribution for more realistic clustering
    const angle = Math.random() * 2 * Math.PI;
    
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const normalDist = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Scale by density (higher density = tighter clustering)
    const distance = Math.abs(normalDist) * radius * 0.3 / densityMultiplier;
    
    const lat = center.lat + distance * Math.cos(angle);
    const lon = center.lon + distance * Math.sin(angle);
    
    return { lat, lon };
}

async function generateRestaurants() {
    const restaurants = [];
    let id = 1;
    
    console.log('🏙️  Generating restaurants for Indian cities...\n');
    
    for (const city of INDIAN_CITIES) {
        console.log(`📍 ${city.name}: Generating ${city.density} restaurants`);
        
        // Generate restaurants in dense areas
        for (const area of city.areas) {
            const areaCount = Math.floor(city.density * area.density / city.areas.length);
            
            for (let i = 0; i < areaCount; i++) {
                const point = generateRandomPoint(
                    { lat: area.lat, lon: area.lon },
                    city.radius / 3,
                    area.density
                );
                
                restaurants.push({
                    id: id++,
                    name: generateRestaurantName(),
                    cuisine: CUISINES[Math.floor(Math.random() * CUISINES.length)],
                    rating: generateRating(),
                    lat: point.lat,
                    lon: point.lon,
                    city: city.name,
                    area: area.name,
                    is_active: Math.random() > 0.05 // 95% active
                });
            }
        }
        
        // Generate some restaurants in less dense areas
        const sparseCount = Math.floor(city.density * 0.2);
        for (let i = 0; i < sparseCount; i++) {
            const point = generateRandomPoint(city.center, city.radius, 0.5);
            
            restaurants.push({
                id: id++,
                name: generateRestaurantName(),
                cuisine: CUISINES[Math.floor(Math.random() * CUISINES.length)],
                rating: generateRating(),
                lat: point.lat,
                lon: point.lon,
                city: city.name,
                area: 'Other',
                is_active: Math.random() > 0.05
            });
        }
        
        console.log(`   ✅ Generated ${restaurants.filter(r => r.city === city.name).length} restaurants`);
    }
    
    return restaurants;
}

async function loadDataToPostGIS(restaurants) {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/foodmap'
    });
    
    try {
        await client.connect();
        console.log('\n📦 Connected to PostgreSQL');
        
        // Clear existing data
        console.log('🗑️  Clearing existing restaurants...');
        await client.query('TRUNCATE TABLE restaurants RESTART IDENTITY CASCADE');
        
        // Insert in batches
        const batchSize = 1000;
        let inserted = 0;
        
        console.log(`📥 Inserting ${restaurants.length} restaurants in batches of ${batchSize}...`);
        
        for (let i = 0; i < restaurants.length; i += batchSize) {
            const batch = restaurants.slice(i, i + batchSize);
            
            const values = batch.map((r, idx) => {
                const base = i + idx;
                return `($${base * 7 + 1}, $${base * 7 + 2}, $${base * 7 + 3}, $${base * 7 + 4}, $${base * 7 + 5}, $${base * 7 + 6}, $${base * 7 + 7})`;
            }).join(',');
            
            const params = batch.flatMap(r => [
                r.name, r.cuisine, r.rating, r.lat, r.lon, r.city, r.area
            ]);
            
            await client.query(`
                INSERT INTO restaurants (name, cuisine, rating, lat, lon, city, area)
                VALUES ${values}
            `, params);
            
            inserted += batch.length;
            process.stdout.write(`\r   Progress: ${inserted}/${restaurants.length} (${Math.round(inserted/restaurants.length*100)}%)`);
        }
        
        console.log('\n✅ Data loaded successfully!');
        
        // Show statistics
        const stats = await client.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT city) as cities,
                AVG(rating)::numeric(10,2) as avg_rating
            FROM restaurants
        `);
        
        const cityBreakdown = await client.query(`
            SELECT city, COUNT(*) as count
            FROM restaurants
            GROUP BY city
            ORDER BY count DESC
        `);
        
        console.log('\n📊 Statistics:');
        console.log(`   Total restaurants: ${stats.rows[0].total}`);
        console.log(`   Cities: ${stats.rows[0].cities}`);
        console.log(`   Average rating: ${stats.rows[0].avg_rating}`);
        console.log('\n📍 Breakdown by city:');
        cityBreakdown.rows.forEach(row => {
            console.log(`   ${row.city}: ${row.count} restaurants`);
        });
        
        // Refresh materialized views for clustering
        console.log('\n🔄 Refreshing cluster materialized views...');
        await client.query('SELECT refresh_clusters()');
        console.log('✅ Clusters refreshed');
        
    } catch (err) {
        console.error('❌ Error loading data:', err);
        throw err;
    } finally {
        await client.end();
    }
}

async function main() {
    console.log('🚀 Starting data generation for Indian food delivery map\n');
    console.log('=' .repeat(60));
    
    const restaurants = await generateRestaurants();
    
    console.log('\n' + '='.repeat(60));
    console.log(`\n✨ Generated ${restaurants.length} restaurants total`);
    
    await loadDataToPostGIS(restaurants);
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Done! Your database is ready.');
    console.log('\nNext steps:');
    console.log('  1. cd ../tile-server && npm start');
    console.log('  2. cd ../map-frontend && npm run dev');
    console.log('  3. Open http://localhost:5173\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
