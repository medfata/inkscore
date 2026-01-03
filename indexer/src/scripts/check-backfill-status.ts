#!/usr/bin/env node

import { pool } from '../db/index.js';

async function main() {
  console.log('🔍 Checking backfill job status...\n');

  try {
    // Show job stats
    const statsResult = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM job_queue
      WHERE job_type = 'backfill'
      GROUP BY status
    `);

    console.log('📊 Job Statistics:');
    statsResult.rows.forEach((row: { status: string; count: string }) => {
      const icon = row.status === 'completed' ? '✅' :
                   row.status === 'processing' ? '🔄' :
                   row.status === 'failed' ? '❌' : '⏳';
      console.log(`   ${icon} ${row.status}: ${row.count}`);
    });
    console.log('');

    // Show recent jobs
    const jobsResult = await pool.query(`
      SELECT 
        j.id,
        j.status,
        j.payload,
        j.attempts,
        j.error_message,
        j.created_at,
        j.started_at,
        j.completed_at,
        c.name as contract_name
      FROM job_queue j
      LEFT JOIN contracts c ON j.contract_id = c.id
      WHERE j.job_type = 'backfill'
      ORDER BY j.created_at DESC
      LIMIT 20
    `);

    if (jobsResult.rows.length > 0) {
      console.log(`📋 Recent Backfill Jobs:\n`);

      for (const job of jobsResult.rows) {
        const statusIcon = job.status === 'completed' ? '✅' :
                          job.status === 'processing' ? '🔄' :
                          job.status === 'failed' ? '❌' : '⏳';

        const payload = job.payload || {};
        const fromDate = payload.fromDate ? new Date(payload.fromDate).toLocaleDateString() : 'N/A';
        const toDate = payload.toDate ? new Date(payload.toDate).toLocaleDateString() : 'N/A';
        const progress = payload.progress !== undefined ? `${payload.progress.toFixed(1)}%` : 'N/A';

        console.log(`${statusIcon} Job #${job.id}: ${job.contract_name || 'Unknown'}`);
        console.log(`   Status: ${job.status} | Progress: ${progress}`);
        console.log(`   Date Range: ${fromDate} → ${toDate}`);
        console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
        if (job.error_message) {
          console.log(`   Error: ${job.error_message}`);
        }
        console.log('');
      }
    } else {
      console.log('📋 No backfill jobs found');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking backfill status:', error);
    process.exit(1);
  }
}

main();
