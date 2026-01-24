import { query, queryOne } from '../db';

// Updated interface for the consolidated contracts table
export interface Contract {
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
  
  // Metadata (from contracts_metadata)
  website_url: string | null;
  logo_url: string | null;
  category: string | null;
  
  // Indexer configuration (from contracts_to_index)
  chain_id: number;
  index_type: 'COUNT_TX' | 'USD_VOLUME';
  abi: any | null;
  
  // Status
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export class ContractsService {
  // Get all contracts with optional filtering
  async getAllContracts(options: {
    activeOnly?: boolean;
    category?: string;
    chainId?: number;
    indexingEnabled?: boolean;
  } = {}): Promise<Contract[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.activeOnly) {
      conditions.push('is_active = true');
    }

    if (options.category) {
      conditions.push(`category = $${paramIndex++}`);
      params.push(options.category);
    }

    if (options.chainId) {
      conditions.push(`chain_id = $${paramIndex++}`);
      params.push(options.chainId);
    }

    if (options.indexingEnabled !== undefined) {
      conditions.push(`indexing_enabled = $${paramIndex++}`);
      params.push(options.indexingEnabled);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    return query<Contract>(`
      SELECT * FROM contracts
      ${whereClause}
      ORDER BY category, display_order, name
    `, params);
  }

  // Get contracts by category
  async getContractsByCategory(category: string): Promise<Contract[]> {
    return this.getAllContracts({ category, activeOnly: true });
  }

  // Get single contract by address
  async getContract(address: string): Promise<Contract | null> {
    return queryOne<Contract>(`
      SELECT * FROM contracts
      WHERE LOWER(address) = LOWER($1)
    `, [address]);
  }

  // Get single contract by ID
  async getContractById(id: number): Promise<Contract | null> {
    return queryOne<Contract>(`
      SELECT * FROM contracts
      WHERE id = $1
    `, [id]);
  }

  // Create or update contract
  async upsertContract(data: Partial<Contract> & { address: string }): Promise<Contract> {
    const result = await queryOne<Contract>(`
      INSERT INTO contracts (
        address, name, deploy_block, fetch_transactions,
        website_url, logo_url, category, chain_id, index_type, abi,
        indexing_enabled, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (address) DO UPDATE SET
        name = COALESCE($2, contracts.name),
        deploy_block = GREATEST(contracts.deploy_block, $3),
        fetch_transactions = COALESCE($4, contracts.fetch_transactions),
        website_url = COALESCE($5, contracts.website_url),
        logo_url = COALESCE($6, contracts.logo_url),
        category = COALESCE($7, contracts.category),
        chain_id = COALESCE($8, contracts.chain_id),
        index_type = COALESCE($9, contracts.index_type),
        abi = COALESCE($10, contracts.abi),
        indexing_enabled = COALESCE($11, contracts.indexing_enabled),
        is_active = COALESCE($12, contracts.is_active),
        updated_at = NOW()
      RETURNING *
    `, [
      data.address.toLowerCase(),
      data.name || 'Unknown Contract',
      data.deploy_block || 0,
      data.fetch_transactions ?? true,
      data.website_url || null,
      data.logo_url || null,
      data.category || null,
      data.chain_id || 57073,
      data.index_type || 'COUNT_TX',
      data.abi ? JSON.stringify(data.abi) : null,
      data.indexing_enabled ?? true,
      data.is_active ?? true,
    ]);

    if (!result) throw new Error('Failed to upsert contract');
    return result;
  }

  // Update contract
  async updateContract(address: string, data: Partial<Contract>): Promise<Contract | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Build dynamic update query
    const updateFields = [
      'name', 'deploy_block', 'fetch_transactions', 'website_url', 'logo_url', 
      'category', 'chain_id', 'index_type', 'abi', 'indexing_enabled', 
      'indexing_status', 'error_message', 'is_active'
    ];

    for (const field of updateFields) {
      if (data[field as keyof Contract] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        values.push(data[field as keyof Contract]);
      }
    }

    if (updates.length === 0) return this.getContract(address);

    updates.push('updated_at = NOW()');
    values.push(address.toLowerCase());

    return queryOne<Contract>(`
      UPDATE contracts
      SET ${updates.join(', ')}
      WHERE LOWER(address) = $${paramIndex}
      RETURNING *
    `, values);
  }

  // Update indexing status
  async updateIndexingStatus(
    address: string,
    status: Contract['indexing_status'],
    currentBlock?: number,
    totalBlocks?: number,
    errorMessage?: string
  ): Promise<void> {
    const updates: string[] = ['indexing_status = $2', 'updated_at = NOW()'];
    const values: unknown[] = [address.toLowerCase(), status];
    let paramIndex = 3;

    if (currentBlock !== undefined) {
      updates.push(`current_block = $${paramIndex++}`);
      values.push(currentBlock);
    }
    if (totalBlocks !== undefined) {
      updates.push(`total_blocks = $${paramIndex++}`);
      values.push(totalBlocks);
    }
    if (currentBlock !== undefined && totalBlocks !== undefined && totalBlocks > 0) {
      updates.push(`progress_percent = $${paramIndex++}`);
      values.push(Math.round((currentBlock / totalBlocks) * 10000) / 100);
    }
    if (status === 'complete' || status === 'indexing') {
      updates.push('last_indexed_at = NOW()');
      updates.push('error_message = NULL');
    }
    if (errorMessage !== undefined) {
      updates.push(`error_message = $${paramIndex++}`);
      values.push(errorMessage);
    }

    await query(`
      UPDATE contracts
      SET ${updates.join(', ')}
      WHERE LOWER(address) = $1
    `, values);
  }

  // Get all categories
  async getCategories(): Promise<string[]> {
    const result = await query<{ category: string }>(`
      SELECT DISTINCT category FROM contracts
      WHERE category IS NOT NULL AND is_active = true
      ORDER BY category
    `);
    return result.map(r => r.category);
  }

  // Get contract stats (tx count from indexed data)
  async getContractStats(address: string): Promise<{ 
    tx_count: number; 
    unique_wallets: number;
    total_indexed: number;
    indexing_progress: number;
  }> {
    const contract = await this.getContract(address);
    if (!contract) {
      return { tx_count: 0, unique_wallets: 0, total_indexed: 0, indexing_progress: 0 };
    }

    const result = await queryOne<{ tx_count: string; unique_wallets: string }>(`
      SELECT 
        COUNT(*) as tx_count,
        COUNT(DISTINCT wallet_address) as unique_wallets
      FROM transaction_details
      WHERE LOWER(contract_address) = LOWER($1)
        AND status = 1
    `, [address]);

    return {
      tx_count: parseInt(result?.tx_count || '0'),
      unique_wallets: parseInt(result?.unique_wallets || '0'),
      total_indexed: contract.total_indexed,
      indexing_progress: contract.progress_percent,
    };
  }

  // Get contracts that need indexing
  async getContractsForIndexing(): Promise<Contract[]> {
    return query<Contract>(`
      SELECT * FROM contracts
      WHERE indexing_enabled = true
        AND is_active = true
        AND indexing_status IN ('pending', 'error')
      ORDER BY created_at ASC
    `);
  }

  // Get contracts currently being indexed
  async getIndexingContracts(): Promise<Contract[]> {
    return query<Contract>(`
      SELECT * FROM contracts
      WHERE indexing_enabled = true
        AND is_active = true
        AND indexing_status = 'indexing'
      ORDER BY updated_at DESC
    `);
  }

  // Get completed contracts
  async getCompletedContracts(): Promise<Contract[]> {
    return query<Contract>(`
      SELECT * FROM contracts
      WHERE indexing_enabled = true
        AND is_active = true
        AND indexing_status = 'complete'
      ORDER BY last_indexed_at DESC
    `);
  }

  // Delete contract
  async deleteContract(address: string): Promise<boolean> {
    const result = await query('DELETE FROM contracts WHERE LOWER(address) = LOWER($1) RETURNING id', [address]);
    return result.length > 0;
  }

  // Soft delete (mark as inactive)
  async deactivateContract(address: string): Promise<boolean> {
    const result = await query(`
      UPDATE contracts 
      SET is_active = false, updated_at = NOW() 
      WHERE LOWER(address) = LOWER($1) 
      RETURNING id
    `, [address]);
    return result.length > 0;
  }
}

export const contractsService = new ContractsService();