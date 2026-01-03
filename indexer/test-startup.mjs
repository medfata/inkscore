// Simple test script to debug startup issues
import 'dotenv/config';
import pg from 'pg';

console.log('🔍 Testing indexer startup...');

try {
    console.log('1. Checking environment variables...');
    console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');

    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not set');
    }

    console.log('2. Testing database connection...');
    const { Pool } = pg;
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    const result = await pool.query('SELECT NOW() as current_time');
    console.log('✅ Database connection successful');
    console.log('Current time:', result.rows[0].current_time);

    console.log('3. Testing contracts table...');
    const contracts = await pool.query('SELECT COUNT(*) as count FROM contracts');
    console.log('Contracts in database:', contracts.rows[0].count);

    console.log('4. Testing job_queue table...');
    const jobs = await pool.query('SELECT COUNT(*) as count FROM job_queue');
    console.log('Jobs in queue:', jobs.rows[0].count);

    await pool.end();
    console.log('✅ All tests passed - indexer should work');
    process.exit(0);

} catch (error) {
    console.error('❌ Startup test failed:', error.message);
    if (error.stack) {
        console.error('Stack:', error.stack);
    }
    process.exit(1);
}