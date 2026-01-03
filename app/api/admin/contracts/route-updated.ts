import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

// Updated interface for the consolidated contracts table
interface Contract {
  id: number;
  address: string;
  name: string;
  deploy_block: number;
  fetch_transactions: boolean;
  
  // Indexing status
  indexing_enabled: boolean;
  indexing_status: 'pending' | 'indexing' | 'complete' | 'paused' | 'error';
  current_block: number;
  total_blocks: number;
  progress_percent: number;
  last_indexed_at: Date | null;
  error_message: string | null;
  total_indexed: number;
  
  // Metadata
  website_url: string | null;
  logo_url: string | null;
  category: string | null;
  
  // Indexer configuration
  chain_id: number;
  index_type: 'COUNT_TX' | 'USD_VOLUME';
  abi: any | null;
  
  // Status
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ChainConfig {
  chain_id: number;
  name: string;
  display_name: string | null;
  rpc_http: string[];
  rpc_ws: string[];
  block_time_ms: number;
  is_active: boolean;
}

// GET /api/admin/contracts - List all contracts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const chainId = searchParams.get('chainId');
    const activeOnly = searchParams.get('active') === 'true';
    const indexingEnabled = searchParams.get('indexingEnabled');

    let whereConditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (category) {
      whereConditions.push(`c.category = $${paramIndex++}`);
      params.push(category);
    }

    if (chainId) {
      whereConditions.push(`c.chain_id = $${paramIndex++}`);
      params.push(parseInt(chainId));
    }

    if (activeOnly) {
      whereConditions.push(`c.is_active = true`);
    }

    if (indexingEnabled !== null) {
      whereConditions.push(`c.indexing_enabled = $${paramIndex++}`);
      params.push(indexingEnabled === 'true');
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const contracts = await query<Contract & { chain_name: string; chain_display_name: string | null }>(`
      SELECT 
        c.*,
        ch.name as chain_name,
        ch.display_name as chain_display_name
      FROM contracts c
      LEFT JOIN chain_config ch ON c.chain_id = ch.chain_id
      ${whereClause}
      ORDER BY c.chain_id, c.category, c.name
    `, params);

    // Get transaction counts from tx_indexer_cursors for performance
    const cursorStats = await query<{
      contract_address: string;
      total_indexed: number;
      is_complete: boolean;
    }>(`
      SELECT contract_address, total_indexed, is_complete
      FROM tx_indexer_cursors
    `);

    const cursorMap = new Map<string, typeof cursorStats[0]>();
    for (const cursor of cursorStats) {
      cursorMap.set(cursor.contract_address.toLowerCase(), cursor);
    }

    const contractsWithStats = contracts.map(c => {
      const cursor = cursorMap.get(c.address.toLowerCase());
      return {
        ...c,
        cursor_stats: cursor ? {
          total_indexed: cursor.total_indexed,
          is_complete: cursor.is_complete,
        } : null,
      };
    });

    return NextResponse.json({ contracts: contractsWithStats });
  } catch (error) {
    console.error('Failed to fetch contracts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contracts' },
      { status: 500 }
    );
  }
}

// POST /api/admin/contracts - Create a new contract
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.address || !body.name) {
      return NextResponse.json(
        { error: 'Missing required fields: address, name' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.address)) {
      return NextResponse.json(
        { error: 'Invalid contract address format' },
        { status: 400 }
      );
    }

    // Validate index_type if provided
    if (body.index_type && !['COUNT_TX', 'USD_VOLUME'].includes(body.index_type)) {
      return NextResponse.json(
        { error: 'Invalid index_type. Must be COUNT_TX or USD_VOLUME' },
        { status: 400 }
      );
    }

    const chainId = body.chain_id || 57073; // Default to Ink

    // Check if chain config exists
    const chainConfig = await queryOne<ChainConfig>(
      'SELECT * FROM chain_config WHERE chain_id = $1',
      [chainId]
    );

    if (!chainConfig) {
      return NextResponse.json(
        { error: `Chain config not found for chain_id ${chainId}. Please add chain config first.` },
        { status: 400 }
      );
    }

    // Check if contract already exists
    const existing = await queryOne<Contract>(
      'SELECT * FROM contracts WHERE LOWER(address) = LOWER($1)',
      [body.address]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Contract already exists' },
        { status: 409 }
      );
    }

    // Create the contract
    const contract = await queryOne<Contract>(`
      INSERT INTO contracts (
        address, name, deploy_block, fetch_transactions,
        website_url, logo_url, category, chain_id, index_type, abi,
        indexing_enabled, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      body.address.toLowerCase(),
      body.name,
      body.deploy_block || 0,
      body.fetch_transactions ?? true,
      body.website_url || null,
      body.logo_url || null,
      body.category || null,
      chainId,
      body.index_type || 'COUNT_TX',
      body.abi ? JSON.stringify(body.abi) : null,
      body.indexing_enabled ?? true,
      body.is_active ?? true,
    ]);

    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    console.error('Failed to create contract:', error);
    return NextResponse.json(
      { error: 'Failed to create contract' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/contracts/[address] - Update a contract
export async function PUT(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const address = url.pathname.split('/').pop();
    
    if (!address) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const updateFields = [
      'name', 'deploy_block', 'fetch_transactions', 'website_url', 'logo_url', 
      'category', 'chain_id', 'index_type', 'abi', 'indexing_enabled', 'is_active'
    ];

    for (const field of updateFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        if (field === 'abi' && body[field]) {
          values.push(JSON.stringify(body[field]));
        } else {
          values.push(body[field]);
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push('updated_at = NOW()');
    values.push(address.toLowerCase());

    const contract = await queryOne<Contract>(`
      UPDATE contracts
      SET ${updates.join(', ')}
      WHERE LOWER(address) = $${paramIndex}
      RETURNING *
    `, values);

    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ contract });
  } catch (error) {
    console.error('Failed to update contract:', error);
    return NextResponse.json(
      { error: 'Failed to update contract' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/contracts/[address] - Delete a contract
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const address = url.pathname.split('/').pop();
    
    if (!address) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400 }
      );
    }

    const result = await query(
      'DELETE FROM contracts WHERE LOWER(address) = LOWER($1) RETURNING id',
      [address]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete contract:', error);
    return NextResponse.json(
      { error: 'Failed to delete contract' },
      { status: 500 }
    );
  }
}