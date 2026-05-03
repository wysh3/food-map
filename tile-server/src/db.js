import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/foodmap',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
});

export async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 100) {
            console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
        }
        return res;
    } catch (err) {
        console.error('Database query error:', err);
        throw err;
    }
}

export async function testConnection() {
    try {
        const res = await query('SELECT NOW(), PostGIS_Version() as postgis_version');
        console.log('✅ Database connected:', res.rows[0]);
        return true;
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        return false;
    }
}

export default { query, testConnection };
