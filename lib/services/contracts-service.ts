import { query, queryOne } from '../db';
import { ContractMetadata } from '../types/analytics';

export class ContractsService {
  // Get all contracts
  async getAllContracts(activeOnly: boolean = false): Promise<ContractMetadata[]> {
    const whereClause = activeOnly ? 'WHERE is_active = true' : '';
    
    return query<ContractMetadata>(`
      SELECT * FROM contracts_metadata
      ${whereClause}
      ORDER BY category, name
    `);
  }

  // Get contracts by category
  async getContractsByCategory(category: string): Promise<ContractMetadata[]> {
    return query<ContractMetadata>(`
      SELECT * FROM contracts_metadata
      WHERE category = $1 AND is_active = true
      ORDER BY name
    `, [category]);
  }

  // Get single contract
  async getContract(address: string): Promise<ContractMetadata | null> {
    return queryOne<ContractMetadata>(`
      SELECT * FROM contracts_metadata
      WHERE address = $1
    `, [address.toLowerCase()]);
  }

  // Create or update contract
  async upsertContract(data: Partial<ContractMetadata> & { address: string }): Promise<ContractMetadata> {
    const result = await queryOne<ContractMetadata>(`
      INSERT INTO contracts_metadata (address, name, website_url, logo_url, category, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (address) DO UPDATE SET
        name = COALESCE($2, contracts_metadata.name),
        website_url = COALESCE($3, contracts_metadata.website_url),
        logo_url = COALESCE($4, contracts_metadata.logo_url),
        category = COALESCE($5, contracts_metadata.category),
        is_active = COALESCE($6, contracts_metadata.is_active)
      RETURNING *
    `, [
      data.address.toLowerCase(),
      data.name || 'Unknown',
      data.website_url || null,
      data.logo_url || null,
      data.category || null,
      data.is_active ?? true,
    ]);

    if (!result) throw new Error('Failed to upsert contract');
    return result;
  }

  // Update contract
  async updateContract(address: string, data: Partial<ContractMetadata>): Promise<ContractMetadata | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.website_url !== undefined) {
      updates.push(`website_url = $${paramIndex++}`);
      values.push(data.website_url);
    }
    if (data.logo_url !== undefined) {
      updates.push(`logo_url = $${paramIndex++}`);
      values.push(data.logo_url);
    }
    if (data.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(data.category);
    }
    if (data.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(data.is_active);
    }

    if (updates.length === 0) return this.getContract(address);

    values.push(address.toLowerCase());

    return queryOne<ContractMetadata>(`
      UPDATE contracts_metadata
      SET ${updates.join(', ')}
      WHERE address = $${paramIndex}
      RETURNING *
    `, values);
  }

  // Get all categories
  async getCategories(): Promise<string[]> {
    const result = await query<{ category: string }>(`
      SELECT DISTINCT category FROM contracts_metadata
      WHERE category IS NOT NULL
      ORDER BY category
    `);
    return result.map(r => r.category);
  }

  // Get contract stats (tx count from indexed data)
  async getContractStats(address: string): Promise<{ tx_count: number; unique_wallets: number }> {
    const result = await queryOne<{ tx_count: string; unique_wallets: string }>(`
      SELECT 
        COUNT(*) as tx_count,
        COUNT(DISTINCT wallet_address) as unique_wallets
      FROM wallet_interactions
      WHERE contract_address = $1
        AND status = 1
    `, [address.toLowerCase()]);

    return {
      tx_count: parseInt(result?.tx_count || '0'),
      unique_wallets: parseInt(result?.unique_wallets || '0'),
    };
  }
}

export const contractsService = new ContractsService();
