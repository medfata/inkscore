import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

/**
 * GET /api/admin/backfill
 * Get all backfill jobs with their status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status'); // pending, processing, completed, failed

    let query = `
      SELECT 
        j.id,
        j.job_type,
        j.contract_id,
        j.priority,
        j.status,
        j.payload,
        j.error_message,
        j.attempts,
        j.max_attempts,
        j.created_at,
        j.started_at,
        j.completed_at,
        j.next_retry_at,
        c.name as contract_name,
        c.address as contract_address
      FROM job_queue j
      LEFT JOIN contracts c ON j.contract_id = c.id
      WHERE j.job_type = 'backfill'
    `;

    const values: any[] = [];

    if (status) {
      values.push(status);
      query += ` AND j.status = $${values.length}`;
    }

    query += ` ORDER BY j.created_at DESC LIMIT $${values.length + 1}`;
    values.push(limit);

    const result = await pool.query(query, values);

    // Get stats
    const statsResult = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM job_queue
      WHERE job_type = 'backfill'
      GROUP BY status
    `);

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    statsResult.rows.forEach((row: { status: string; count: string }) => {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = parseInt(row.count);
      }
    });

    return NextResponse.json({
      jobs: result.rows,
      stats
    });

  } catch (error) {
    console.error('Failed to fetch backfill jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backfill jobs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/backfill
 * Create a new backfill job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contractAddress, fromDate, toDate, priority = 5 } = body;

    // Validate required fields
    if (!contractAddress) {
      return NextResponse.json(
        { error: 'contractAddress is required' },
        { status: 400 }
      );
    }

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: 'fromDate and toDate are required' },
        { status: 400 }
      );
    }

    // Validate dates
    const from = new Date(fromDate);
    const to = new Date(toDate);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use ISO 8601 format.' },
        { status: 400 }
      );
    }

    if (from >= to) {
      return NextResponse.json(
        { error: 'fromDate must be before toDate' },
        { status: 400 }
      );
    }

    // Get contract ID
    const contractResult = await pool.query(
      'SELECT id, name FROM contracts WHERE LOWER(address) = LOWER($1)',
      [contractAddress]
    );

    if (contractResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      );
    }

    const contract = contractResult.rows[0];

    // Check for existing pending/processing job with same parameters
    const existingJob = await pool.query(`
      SELECT id FROM job_queue 
      WHERE job_type = 'backfill' 
        AND contract_id = $1 
        AND status IN ('pending', 'processing')
        AND payload->>'fromDate' = $2
        AND payload->>'toDate' = $3
      LIMIT 1
    `, [contract.id, from.toISOString(), to.toISOString()]);

    if (existingJob.rows.length > 0) {
      return NextResponse.json(
        { error: 'A job with the same parameters already exists', existingJobId: existingJob.rows[0].id },
        { status: 409 }
      );
    }

    // Create the job
    const payload = {
      contractId: contract.id,
      contractAddress: contractAddress.toLowerCase(),
      fromDate: from.toISOString(),
      toDate: to.toISOString()
    };

    const result = await pool.query(`
      INSERT INTO job_queue (job_type, contract_id, priority, payload, max_attempts)
      VALUES ('backfill', $1, $2, $3, 3)
      RETURNING id, created_at
    `, [contract.id, priority, JSON.stringify(payload)]);

    const job = result.rows[0];

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        contractId: contract.id,
        contractName: contract.name,
        contractAddress,
        fromDate: from.toISOString(),
        toDate: to.toISOString(),
        priority,
        status: 'pending',
        createdAt: job.created_at
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Failed to create backfill job:', error);
    return NextResponse.json(
      { error: 'Failed to create backfill job' },
      { status: 500 }
    );
  }
}
