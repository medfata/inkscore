import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/admin/platforms/types - Get all unique platform types
export async function GET() {
  try {
    const result = await query<{ platform_type: string }>(`
      SELECT DISTINCT platform_type 
      FROM platforms 
      WHERE platform_type IS NOT NULL AND platform_type != ''
      ORDER BY platform_type ASC
    `);
    
    const types = result.map(r => r.platform_type);
    return NextResponse.json({ types });
  } catch (error) {
    console.error('Failed to fetch platform types:', error);
    return NextResponse.json(
      { error: 'Failed to fetch platform types' },
      { status: 500 }
    );
  }
}
