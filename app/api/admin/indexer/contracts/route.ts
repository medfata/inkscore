import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

// Types for the indexer-v1 contracts_to_index table
interface IndexerContract {
    id: number;
    chain_id: number;
    address: string;
    name: string | null;
    deploy_block: number;
    index_type: 'COUNT_TX' | 'USD_VOLUME';
    abi: any | null;
    is_active: boolean;
    created_at: Date;
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

// GET /api/admin/indexer/contracts - List all indexer contracts
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const chainId = searchParams.get('chainId');
        const activeOnly = searchParams.get('activeOnly') === 'true';

        let whereConditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (chainId) {
            whereConditions.push(`c.chain_id = $${paramIndex++}`);
            params.push(parseInt(chainId));
        }

        if (activeOnly) {
            whereConditions.push(`c.is_active = true`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        const contracts = await query<IndexerContract & { chain_name: string; chain_display_name: string | null }>(`
      SELECT 
        c.*,
        ch.name as chain_name,
        ch.display_name as chain_display_name
      FROM contracts_to_index c
      LEFT JOIN chain_config ch ON c.chain_id = ch.chain_id
      ${whereClause}
      ORDER BY c.chain_id, c.deploy_block DESC
    `, params);

        // Get indexing progress from indexer_ranges
        const rangeProgress = await query<{
            chain_id: number;
            contract_address: string;
            total_ranges: number;
            complete_ranges: number;
            min_block: number;
            max_block: number;
            current_progress: number;
        }>(`
      SELECT 
        chain_id,
        contract_address,
        COUNT(*) as total_ranges,
        COUNT(*) FILTER (WHERE is_complete = true) as complete_ranges,
        MIN(range_start) as min_block,
        MAX(range_end) as max_block,
        COALESCE(AVG(
          CASE WHEN range_end > range_start 
          THEN ((current_block - range_start)::float / (range_end - range_start + 1)::float) * 100 
          ELSE 100 END
        ), 0) as current_progress
      FROM indexer_ranges
      GROUP BY chain_id, contract_address
    `);

        const progressMap = new Map<string, typeof rangeProgress[0]>();
        for (const p of rangeProgress) {
            progressMap.set(`${p.chain_id}:${p.contract_address.toLowerCase()}`, p);
        }

        const contractsWithProgress = contracts.map(c => {
            const progress = progressMap.get(`${c.chain_id}:${c.address.toLowerCase()}`);
            return {
                ...c,
                indexing_progress: progress ? {
                    total_ranges: Number(progress.total_ranges),
                    complete_ranges: Number(progress.complete_ranges),
                    progress_percent: Math.round(Number(progress.current_progress) * 100) / 100,
                    is_complete: Number(progress.complete_ranges) === Number(progress.total_ranges) && Number(progress.total_ranges) > 0,
                } : null,
            };
        });

        return NextResponse.json({ contracts: contractsWithProgress });
    } catch (error) {
        console.error('Failed to fetch indexer contracts:', error);
        return NextResponse.json(
            { error: 'Failed to fetch indexer contracts' },
            { status: 500 }
        );
    }
}

// POST /api/admin/indexer/contracts - Create a new indexer contract
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // Validate required fields
        if (!body.address || !body.deploy_block || !body.index_type) {
            return NextResponse.json(
                { error: 'Missing required fields: address, deploy_block, index_type' },
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

        // Validate index_type
        if (!['COUNT_TX', 'USD_VOLUME'].includes(body.index_type)) {
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

        // Check if contract already exists for this chain
        const existing = await queryOne<IndexerContract>(
            'SELECT * FROM contracts_to_index WHERE chain_id = $1 AND LOWER(address) = LOWER($2)',
            [chainId, body.address]
        );

        if (existing) {
            return NextResponse.json(
                { error: 'Contract already exists for this chain' },
                { status: 409 }
            );
        }

        // Create the contract
        const contract = await queryOne<IndexerContract>(`
      INSERT INTO contracts_to_index (chain_id, address, name, deploy_block, index_type, abi, is_active)
      VALUES ($1, LOWER($2), $3, $4, $5, $6, $7)
      RETURNING *
    `, [
            chainId,
            body.address,
            body.name || null,
            body.deploy_block,
            body.index_type,
            body.abi ? JSON.stringify(body.abi) : null,
            body.is_active ?? true,
        ]);

        return NextResponse.json({ contract }, { status: 201 });
    } catch (error) {
        console.error('Failed to create indexer contract:', error);
        return NextResponse.json(
            { error: 'Failed to create indexer contract' },
            { status: 500 }
        );
    }
}
