import { query, queryOne } from '../db';
import {
    Platform,
    PlatformWithContracts,
    Contract,
    ContractWithPlatforms,
    CreatePlatformRequest,
    UpdatePlatformRequest,
    CreateContractRequest,
    UpdateContractRequest,
} from '../types/platforms';

export class PlatformsService {
    // ============================================================================
    // PLATFORMS
    // ============================================================================

    async getAllPlatforms(activeOnly: boolean = false): Promise<Platform[]> {
        const whereClause = activeOnly ? 'WHERE is_active = true' : '';
        return query<Platform>(`
      SELECT * FROM platforms
      ${whereClause}
      ORDER BY display_order ASC, name ASC
    `);
    }

    async getPlatformById(id: number): Promise<Platform | null> {
        return queryOne<Platform>(`SELECT * FROM platforms WHERE id = $1`, [id]);
    }

    async getPlatformBySlug(slug: string): Promise<Platform | null> {
        return queryOne<Platform>(`SELECT * FROM platforms WHERE slug = $1`, [slug]);
    }

    async getPlatformWithContracts(id: number): Promise<PlatformWithContracts | null> {
        const platform = await this.getPlatformById(id);
        if (!platform) return null;

        const contracts = await query<Contract>(`
      SELECT c.* FROM contracts c
      JOIN platform_contracts pc ON c.id = pc.contract_id
      WHERE pc.platform_id = $1
      ORDER BY c.name ASC
    `, [id]);

        return { ...platform, contracts };
    }

    async createPlatform(data: CreatePlatformRequest): Promise<Platform> {
        const result = await queryOne<Platform>(`
      INSERT INTO platforms (slug, name, description, logo_url, website_url, platform_type, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
            data.slug,
            data.name,
            data.description || null,
            data.logo_url || null,
            data.website_url || null,
            data.platform_type,
            data.display_order || 0,
        ]);
        if (!result) throw new Error('Failed to create platform');
        return result;
    }

    async updatePlatform(id: number, data: UpdatePlatformRequest): Promise<Platform | null> {
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (data.slug !== undefined) { updates.push(`slug = $${paramIndex++}`); values.push(data.slug); }
        if (data.name !== undefined) { updates.push(`name = $${paramIndex++}`); values.push(data.name); }
        if (data.description !== undefined) { updates.push(`description = $${paramIndex++}`); values.push(data.description); }
        if (data.logo_url !== undefined) { updates.push(`logo_url = $${paramIndex++}`); values.push(data.logo_url); }
        if (data.website_url !== undefined) { updates.push(`website_url = $${paramIndex++}`); values.push(data.website_url); }
        if (data.platform_type !== undefined) { updates.push(`platform_type = $${paramIndex++}`); values.push(data.platform_type); }
        if (data.display_order !== undefined) { updates.push(`display_order = $${paramIndex++}`); values.push(data.display_order); }
        if (data.is_active !== undefined) { updates.push(`is_active = $${paramIndex++}`); values.push(data.is_active); }

        if (updates.length === 0) return this.getPlatformById(id);

        updates.push(`updated_at = NOW()`);
        values.push(id);

        return queryOne<Platform>(`
      UPDATE platforms SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *
    `, values);
    }

    async deletePlatform(id: number): Promise<boolean> {
        const result = await query(`DELETE FROM platforms WHERE id = $1 RETURNING id`, [id]);
        return result.length > 0;
    }

    // ============================================================================
    // CONTRACTS
    // ============================================================================

    async getAllContracts(activeOnly: boolean = false): Promise<Contract[]> {
        const whereClause = activeOnly ? 'WHERE is_active = true' : '';
        return query<Contract>(`SELECT * FROM contracts ${whereClause} ORDER BY name ASC`);
    }

    async getContractById(id: number): Promise<Contract | null> {
        return queryOne<Contract>(`SELECT * FROM contracts WHERE id = $1`, [id]);
    }

    async getContractByAddress(address: string): Promise<Contract | null> {
        const normalizedAddress = address.toLowerCase();
        let result = await queryOne<Contract>(`SELECT * FROM contracts WHERE address = $1`, [normalizedAddress]);
        if (result) return result;
        return queryOne<Contract>(`SELECT * FROM contracts WHERE LOWER(address) = $1`, [normalizedAddress]);
    }

    async getContractWithPlatforms(id: number): Promise<ContractWithPlatforms | null> {
        const contract = await this.getContractById(id);
        if (!contract) return null;

        const platforms = await query<Platform>(`
      SELECT p.* FROM platforms p
      JOIN platform_contracts pc ON p.id = pc.platform_id
      WHERE pc.contract_id = $1
      ORDER BY p.name ASC
    `, [id]);

        return { ...contract, platforms };
    }

    async getContractsForIndexing(): Promise<Contract[]> {
        return query<Contract>(`
      SELECT * FROM contracts
      WHERE indexing_enabled = true AND is_active = true AND indexing_status != 'complete'
      ORDER BY created_at ASC
    `);
    }

    async createContract(data: CreateContractRequest): Promise<Contract> {
        const result = await queryOne<Contract>(`
      INSERT INTO contracts (
        address, name, deploy_block, fetch_transactions, indexing_status,
        contract_type, creation_date, backfill_status
      )
      VALUES ($1, $2, $3, $4, 'pending', $5, $6, 'pending')
      RETURNING *
    `, [
            data.address.toLowerCase(), 
            data.name, 
            data.deploy_block, 
            data.fetch_transactions ?? true,
            data.contract_type || 'count',
            data.creation_date || new Date().toISOString()
        ]);

        if (!result) throw new Error('Failed to create contract');

        if (data.platform_ids && data.platform_ids.length > 0) {
            for (const platformId of data.platform_ids) {
                await query(`INSERT INTO platform_contracts (platform_id, contract_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [platformId, result.id]);
            }
        }

        // Queue backfill job for hybrid indexer
        if (data.fetch_transactions) {
            await query(`
                INSERT INTO job_queue (job_type, contract_id, priority, payload)
                VALUES ('backfill', $1, 5, '{}')
            `, [result.id]);
        }

        return result;
    }

    async updateContract(id: number, data: UpdateContractRequest): Promise<Contract | null> {
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (data.name !== undefined) { updates.push(`name = $${paramIndex++}`); values.push(data.name); }
        if (data.deploy_block !== undefined) { updates.push(`deploy_block = $${paramIndex++}`); values.push(data.deploy_block); }
        if (data.fetch_transactions !== undefined) { updates.push(`fetch_transactions = $${paramIndex++}`); values.push(data.fetch_transactions); }
        if (data.indexing_enabled !== undefined) { updates.push(`indexing_enabled = $${paramIndex++}`); values.push(data.indexing_enabled); }

        if (updates.length > 0) {
            updates.push(`updated_at = NOW()`);
            values.push(id);
            await query(`UPDATE contracts SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
        }

        if (data.platform_ids !== undefined) {
            await query(`DELETE FROM platform_contracts WHERE contract_id = $1`, [id]);
            for (const platformId of data.platform_ids) {
                await query(`INSERT INTO platform_contracts (platform_id, contract_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [platformId, id]);
            }
        }
        return this.getContractById(id);
    }

    async updateContractIndexingStatus(
        address: string,
        status: Contract['indexing_status'],
        currentBlock?: number,
        totalBlocks?: number,
        errorMessage?: string
    ): Promise<void> {
        const normalizedAddress = address.toLowerCase();
        const updates: string[] = ['indexing_status = $2', 'updated_at = NOW()'];
        const values: unknown[] = [normalizedAddress, status];
        let paramIndex = 3;

        if (currentBlock !== undefined) { updates.push(`current_block = $${paramIndex++}`); values.push(currentBlock); }
        if (totalBlocks !== undefined) { updates.push(`total_blocks = $${paramIndex++}`); values.push(totalBlocks); }
        if (currentBlock !== undefined && totalBlocks !== undefined && totalBlocks > 0) {
            updates.push(`progress_percent = $${paramIndex++}`);
            values.push(Math.round((currentBlock / totalBlocks) * 10000) / 100);
        }
        if (status === 'complete' || status === 'indexing') { updates.push(`last_indexed_at = NOW()`); }
        if (errorMessage !== undefined) { updates.push(`error_message = $${paramIndex++}`); values.push(errorMessage); }

        const result = await query(`UPDATE contracts SET ${updates.join(', ')} WHERE address = $1 RETURNING id`, values);
        if (result.length === 0) {
            await query(`UPDATE contracts SET ${updates.join(', ')} WHERE LOWER(address) = $1`, values);
        }
    }

    async deleteContract(id: number): Promise<boolean> {
        const result = await query(`DELETE FROM contracts WHERE id = $1 RETURNING id`, [id]);
        return result.length > 0;
    }


    // ============================================================================
    // STATS - Using pre-computed data from indexer cursors (FAST!)
    // ============================================================================

    /**
     * Get tx_count and unique_wallets for all contracts using the tx_indexer_cursors table
     * This is instant because the indexer already tracks total_indexed per contract
     */
    async getAllContractStats(): Promise<Map<string, { tx_count: number; unique_wallets: number }>> {
        // Get pre-computed tx counts from the indexer cursor table
        const cursorStats = await query<{ contract_address: string; total_indexed: number }>(`
      SELECT contract_address, total_indexed FROM tx_indexer_cursors
    `);

        // For unique_wallets, we need a different approach - use a summary table or estimate
        // For now, get unique wallet counts per contract (this query is fast with proper index)
        const walletStats = await query<{ contract_address: string; unique_wallets: string }>(`
      SELECT contract_address, COUNT(DISTINCT wallet_address) as unique_wallets
      FROM transaction_details
      WHERE status = 1
      GROUP BY contract_address
    `);

        const statsMap = new Map<string, { tx_count: number; unique_wallets: number }>();

        // First, set tx_count from cursor table
        for (const row of cursorStats) {
            statsMap.set(row.contract_address.toLowerCase(), {
                tx_count: row.total_indexed,
                unique_wallets: 0,
            });
        }

        // Then update with unique_wallets
        for (const row of walletStats) {
            const existing = statsMap.get(row.contract_address.toLowerCase());
            if (existing) {
                existing.unique_wallets = parseInt(row.unique_wallets);
            } else {
                statsMap.set(row.contract_address.toLowerCase(), {
                    tx_count: 0,
                    unique_wallets: parseInt(row.unique_wallets),
                });
            }
        }

        return statsMap;
    }

    /**
     * Get all contracts with stats and platforms - OPTIMIZED version
     * Uses 3 simple queries instead of N+1
     */
    async getAllContractsWithStatsAndPlatforms(activeOnly: boolean = false): Promise<Array<Contract & {
        tx_count: number;
        unique_wallets: number;
        platforms: Platform[];
    }>> {
        // 1. Get all contracts
        const contracts = await this.getAllContracts(activeOnly);
        if (contracts.length === 0) return [];

        // 2. Get stats from cursor table (instant - no counting)
        const cursorStats = await query<{ contract_address: string; total_indexed: number }>(`
      SELECT contract_address, total_indexed FROM tx_indexer_cursors
    `);
        const txCountMap = new Map<string, number>();
        for (const row of cursorStats) {
            txCountMap.set(row.contract_address.toLowerCase(), row.total_indexed);
        }

        // 3. Get all platform mappings in one query
        const platformMappings = await query<{
            contract_id: number;
            platform_id: number;
            platform_name: string;
            platform_slug: string;
            platform_type: string;
            logo_url: string | null;
            website_url: string | null;
            description: string | null;
            is_active: boolean;
            display_order: number;
            created_at: Date;
            updated_at: Date;
        }>(`
      SELECT 
        pc.contract_id, p.id as platform_id, p.name as platform_name, p.slug as platform_slug,
        p.platform_type, p.logo_url, p.website_url, p.description, p.is_active, p.display_order,
        p.created_at, p.updated_at
      FROM platform_contracts pc
      JOIN platforms p ON pc.platform_id = p.id
    `);

        const platformsByContract = new Map<number, Platform[]>();
        for (const m of platformMappings) {
            const platforms = platformsByContract.get(m.contract_id) || [];
            platforms.push({
                id: m.platform_id,
                name: m.platform_name,
                slug: m.platform_slug,
                platform_type: m.platform_type as Platform['platform_type'],
                logo_url: m.logo_url,
                website_url: m.website_url,
                description: m.description,
                is_active: m.is_active,
                display_order: m.display_order,
                created_at: m.created_at,
                updated_at: m.updated_at,
            });
            platformsByContract.set(m.contract_id, platforms);
        }

        // 4. Combine - use tx_count from cursor, skip unique_wallets for now (or estimate)
        return contracts.map(contract => ({
            ...contract,
            tx_count: txCountMap.get(contract.address.toLowerCase()) || 0,
            unique_wallets: 0, // Skip for performance - can add later with proper index
            platforms: platformsByContract.get(contract.id) || [],
        }));
    }

    async getContractStats(address: string): Promise<{ tx_count: number; unique_wallets: number }> {
        // Use cursor table for tx_count (instant)
        const cursor = await queryOne<{ total_indexed: number }>(`
      SELECT total_indexed FROM tx_indexer_cursors WHERE contract_address = $1
    `, [address.toLowerCase()]);

        return {
            tx_count: cursor?.total_indexed || 0,
            unique_wallets: 0, // Skip for performance
        };
    }

    async getPlatformStats(platformId: number): Promise<{ tx_count: number; unique_wallets: number; usd_volume: number }> {
        // Get contract addresses for this platform
        const contracts = await query<{ address: string }>(`
      SELECT LOWER(c.address) as address
      FROM platform_contracts pc
      JOIN contracts c ON pc.contract_id = c.id
      WHERE pc.platform_id = $1
    `, [platformId]);

        if (contracts.length === 0) {
            return { tx_count: 0, unique_wallets: 0, usd_volume: 0 };
        }

        const addresses = contracts.map(c => c.address);
        const placeholders = addresses.map((_, i) => '$' + (i + 1)).join(', ');

        // Get tx_count from cursor table (instant)
        const cursorResult = await query<{ total_indexed: number }>(`
      SELECT total_indexed FROM tx_indexer_cursors WHERE contract_address IN (${placeholders})
    `, addresses);

        const txCount = cursorResult.reduce((sum, r) => sum + r.total_indexed, 0);

        return {
            tx_count: txCount,
            unique_wallets: 0, // Skip for performance
            usd_volume: 0,
        };
    }

    async getGlobalStats(): Promise<{
        total_contracts: number;
        contracts_complete: number;
        contracts_indexing: number;
        total_transactions: number;
        total_unique_wallets: number;
    }> {
        // Contract stats from contracts table (small table, instant)
        const contractStats = await queryOne<{ total: string; complete: string; indexing: string }>(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE indexing_status = 'complete') as complete,
        COUNT(*) FILTER (WHERE indexing_status = 'indexing') as indexing
      FROM contracts WHERE is_active = true
    `);

        // Total transactions from cursor table (instant - just sum the pre-computed counts)
        const txStats = await queryOne<{ total_tx: string }>(`
      SELECT COALESCE(SUM(total_indexed), 0) as total_tx FROM tx_indexer_cursors
    `);

        return {
            total_contracts: parseInt(contractStats?.total || '0'),
            contracts_complete: parseInt(contractStats?.complete || '0'),
            contracts_indexing: parseInt(contractStats?.indexing || '0'),
            total_transactions: parseInt(txStats?.total_tx || '0'),
            total_unique_wallets: 0, // Skip for performance - would need separate tracking
        };
    }
}

export const platformsService = new PlatformsService();
