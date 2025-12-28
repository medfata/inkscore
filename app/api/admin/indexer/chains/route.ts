import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

interface ChainConfig {
  chain_id: number;
  name: string;
  display_name: string | null;
  rpc_http: string[];
  rpc_ws: string[];
  block_time_ms: number;
  is_active: boolean;
  created_at: Date;
}

// GET /api/admin/indexer/chains - List all chain configs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const whereClause = activeOnly ? 'WHERE is_active = true' : '';

    const chains = await query<ChainConfig>(`
      SELECT * FROM chain_config
      ${whereClause}
      ORDER BY chain_id
    `);

    // Get contract counts per chain
    const contractCounts = await query<{ chain_id: number; count: string }>(`
      SELECT chain_id, COUNT(*) as count
      FROM contracts_to_index
      WHERE is_active = true
      GROUP BY chain_id
    `);

    const countMap = new Map<number, number>();
    for (const c of contractCounts) {
      countMap.set(c.chain_id, parseInt(c.count));
    }

    const chainsWithCounts = chains.map(chain => ({
      ...chain,
      contract_count: countMap.get(chain.chain_id) || 0,
    }));

    return NextResponse.json({ chains: chainsWithCounts });
  } catch (error) {
    console.error('Failed to fetch chains:', error);
    return NextResponse.json({ error: 'Failed to fetch chains' }, { status: 500 });
  }
}

// POST /api/admin/indexer/chains - Create a new chain config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.chain_id || !body.name || !body.rpc_http || !body.rpc_ws) {
      return NextResponse.json(
        { error: 'Missing required fields: chain_id, name, rpc_http, rpc_ws' },
        { status: 400 }
      );
    }

    // Check if chain already exists
    const existing = await queryOne<ChainConfig>(
      'SELECT * FROM chain_config WHERE chain_id = $1',
      [body.chain_id]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Chain config already exists for this chain_id' },
        { status: 409 }
      );
    }

    const chain = await queryOne<ChainConfig>(`
      INSERT INTO chain_config (chain_id, name, display_name, rpc_http, rpc_ws, block_time_ms, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      body.chain_id,
      body.name,
      body.display_name || null,
      body.rpc_http,
      body.rpc_ws,
      body.block_time_ms || 2000,
      body.is_active ?? true,
    ]);

    // Also create indexer_state entry
    await query(`
      INSERT INTO indexer_state (chain_id, last_indexed_block)
      VALUES ($1, 0)
      ON CONFLICT (chain_id) DO NOTHING
    `, [body.chain_id]);

    return NextResponse.json({ chain }, { status: 201 });
  } catch (error) {
    console.error('Failed to create chain:', error);
    return NextResponse.json({ error: 'Failed to create chain' }, { status: 500 });
  }
}
