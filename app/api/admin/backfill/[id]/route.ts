import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

/**
 * GET /api/admin/backfill/[id]
 * Get a specific backfill job
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const jobId = parseInt(id);

    if (isNaN(jobId)) {
      return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
    }

    const result = await pool.query(`
      SELECT 
        j.*,
        c.name as contract_name,
        c.address as contract_address
      FROM job_queue j
      LEFT JOIN contracts c ON j.contract_id = c.id
      WHERE j.id = $1 AND j.job_type = 'backfill'
    `, [jobId]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job: result.rows[0] });

  } catch (error) {
    console.error('Failed to fetch backfill job:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backfill job' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/backfill/[id]
 * Cancel a backfill job (only if pending or failed)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const jobId = parseInt(id);

    if (isNaN(jobId)) {
      return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
    }

    const result = await pool.query(`
      UPDATE job_queue 
      SET status = 'failed', 
          error_message = 'Cancelled by admin', 
          completed_at = NOW()
      WHERE id = $1 
        AND job_type = 'backfill'
        AND status IN ('pending', 'failed')
      RETURNING id
    `, [jobId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Job not found or cannot be cancelled (may be processing or completed)' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: 'Job cancelled' });

  } catch (error) {
    console.error('Failed to cancel backfill job:', error);
    return NextResponse.json(
      { error: 'Failed to cancel backfill job' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/backfill/[id]
 * Retry a failed backfill job
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const jobId = parseInt(id);

    if (isNaN(jobId)) {
      return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
    }

    const result = await pool.query(`
      UPDATE job_queue 
      SET status = 'pending', 
          error_message = NULL, 
          next_retry_at = NULL,
          attempts = 0
      WHERE id = $1 
        AND job_type = 'backfill'
        AND status = 'failed'
      RETURNING id
    `, [jobId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Job not found or cannot be retried (must be in failed status)' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: 'Job queued for retry' });

  } catch (error) {
    console.error('Failed to retry backfill job:', error);
    return NextResponse.json(
      { error: 'Failed to retry backfill job' },
      { status: 500 }
    );
  }
}
