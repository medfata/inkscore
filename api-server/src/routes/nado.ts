import { Router, Request, Response } from 'express';
import { query } from '../db';
import { responseCache } from '../cache';

const router = Router();

// Nado Finance contract address
const NADO_CONTRACT = '0x05ec92d78ed421f3d3ada77ffde167106565974e';

interface NadoMetrics {
  totalDeposits: number;
  totalTransactions: number;
  nadoVolumeUSD: number; // Calculated volume from Nado API - this is the main volume to display
  dbTotalVolume?: number; // Database volume (kept for reference/fallback)
  tokenBreakdown?: Array<{
    tokenAddress: string;
    symbol: string;
    name: string;
    depositAmount: number;
    rawAmount: number;
  }>;
}

/**
 * Generate Nado subaccount from wallet address
 * Format: wallet_address + "default" + padding
 */
function generateNadoSubaccount(walletAddress: string): string {
  // Remove 0x prefix if present
  const cleanAddress = walletAddress.replace(/^0x/, '');

  // Convert "default" to hex: 64656661756c74
  const defaultHex = '64656661756c74';

  // Add padding zeros to make total 64 characters (32 bytes)
  const padding = '0000000000';

  const subaccount = cleanAddress + defaultHex + padding;

  return subaccount;
}

/**
 * Fetch wallet volume from Nado API
 */
async function getWalletVolume(subaccount: string) {
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const response = await fetch("https://archive.prod.nado.xyz/v1", {
      method: "POST",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account_snapshots: {
          subaccounts: [subaccount],
          timestamps: [currentTimestamp]
        }
      }),
    });

    if (!response.ok) {
      console.error(`[Nado API] HTTP error! status: ${response.status}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: any = await response.json();

    // Extract volumes from all snapshots
    let totalVolume = 0;

    // The API returns subaccounts with 0x prefix, but we generate without it
    const subaccountWithPrefix = `0x${subaccount}`;

    if (data.snapshots && data.snapshots[subaccountWithPrefix]) {
      const timestamp = Object.keys(data.snapshots[subaccountWithPrefix])[0];
      const events = data.snapshots[subaccountWithPrefix][timestamp];


      if (Array.isArray(events)) {
        events.forEach((event: any, index: number) => {
          const volumeCumulative = parseFloat(event.quote_volume_cumulative || 0);
          totalVolume += volumeCumulative;
        });
      }
    }

    const volumeInDollars = totalVolume / 1e18;

    return {
      totalVolumeRaw: totalVolume,
      totalVolumeUSD: parseFloat(volumeInDollars.toFixed(2)),
      rawData: data
    };
  } catch (error) {
    console.error("Error fetching wallet volume from Nado API:", error);
    return {
      totalVolumeRaw: 0,
      totalVolumeUSD: 0,
      rawData: null
    };
  }
}

/**
 * Get Nado volume for a wallet address
 */
async function getNadoVolumeForWallet(walletAddress: string) {
  const subaccount = generateNadoSubaccount(walletAddress);
  return await getWalletVolume(subaccount);
}

// GET /api/nado/:wallet - Get Nado Finance metrics for a wallet
router.get('/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const walletAddress = wallet.toLowerCase();

    // Validate wallet address
    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check cache
    const cacheKey = `nado:${walletAddress}`;
    const cached = responseCache.get<NadoMetrics>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get total transactions for the Nado contract
    const totalResult = await query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM transaction_enrichment
      WHERE LOWER(contract_address) = LOWER($1)
        AND LOWER(wallet_address) = LOWER($2)
    `, [NADO_CONTRACT, walletAddress]);

    const totalTransactions = parseInt(totalResult[0]?.count || '0');

    // Get deposit transactions (depositCollateral function)
    // Method ID 0x8e5d588c is for depositCollateral
    // Parse logs to extract token transfer information since tokens_out_raw may be null
    const depositResult = await query<{
      logs: string;
      tx_hash: string;
    }>(`
      SELECT 
        logs,
        tx_hash
      FROM transaction_enrichment
      WHERE LOWER(contract_address) = LOWER($1)
        AND LOWER(wallet_address) = LOWER($2)
        AND method_id = '0x8e5d588c'
        AND logs IS NOT NULL
    `, [NADO_CONTRACT, walletAddress]);

    // Parse logs to extract token transfer information and calculate USD values
    let totalDeposits = 0;
    const tokenDeposits = new Map<string, { amount: number; symbol: string; name: string; rawAmount: number }>();

    for (const row of depositResult) {
      if (row.logs) {
        try {
          const logs = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;

          if (Array.isArray(logs)) {
            for (let i = 0; i < logs.length; i++) {
              const log = logs[i];

              // Look for Transfer events that indicate token deposits
              if (log.event && log.event.includes('Transfer') &&
                log.address && log.address.id &&
                log.topics && log.topics.length >= 3 &&
                log.data) {

                const tokenAddress = log.address.id.toLowerCase();
                const tokenSymbol = log.address.alias || log.address.name || 'Unknown';
                const tokenName = log.address.name || tokenSymbol;

                // Check if this is a transfer FROM the wallet TO the Nado contract
                // topics[1] is _from, topics[2] is _to
                const fromAddress = log.topics[1];
                const toAddress = log.topics[2];

                if (fromAddress && toAddress &&
                  fromAddress.toLowerCase().includes(walletAddress.slice(2)) &&
                  toAddress.toLowerCase().includes(NADO_CONTRACT.slice(2).toLowerCase())) {

                  // Extract amount from log.data (hex string)
                  const rawAmount = BigInt(log.data);
                  const amount = Number(rawAmount);

                  if (amount > 0) {
                    // Get token decimals (default to 18 if not available)
                    const decimals = getTokenDecimals(tokenAddress);
                    const decimalAmount = amount / Math.pow(10, decimals);

                    // Calculate USD value
                    const usdValue = await calculateTokenUsdValue(tokenAddress, decimalAmount);

                    totalDeposits += usdValue;

                    // Track by token
                    if (!tokenDeposits.has(tokenAddress)) {
                      tokenDeposits.set(tokenAddress, {
                        amount: 0,
                        symbol: tokenSymbol,
                        name: tokenName,
                        rawAmount: 0
                      });
                    }

                    const existing = tokenDeposits.get(tokenAddress)!;
                    existing.amount += usdValue;
                    existing.rawAmount += decimalAmount;
                    break; // Only count once per transaction
                  }
                }
              }
            }
          }
        } catch (e) {
          // Silent error handling
        }
      }
    }

    // Helper function to get token decimals
    function getTokenDecimals(tokenAddress: string): number {
      const addr = tokenAddress.toLowerCase();
      const knownDecimals: Record<string, number> = {
        '0x0200c29006150606b650577bbe7b6248f58470c1': 6,  // USDT0
        '0x2d270e6886d130d724215a266106e6832161eaed': 6,  // USDC
        '0xeb466342c4d449bc9f53a865d5cb90586f405215': 6,  // axlUSDC
        '0xe343167631d89b6ffc58b88d6b7fb0228795491d': 18, // USDGLO
        '0x4200000000000000000000000000000000000006': 18, // WETH
        '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98': 8,  // KBtc
      };
      return knownDecimals[addr] || 18; // Default to 18 decimals
    }

    // Helper function to calculate USD value for a token
    async function calculateTokenUsdValue(tokenAddress: string, decimalAmount: number): Promise<number> {
      const addr = tokenAddress.toLowerCase();

      // Known token prices
      const knownPrices: Record<string, number> = {
        // Stablecoins
        '0x0200c29006150606b650577bbe7b6248f58470c1': 1.0, // USDT0
        '0x2d270e6886d130d724215a266106e6832161eaed': 1.0, // USDC
        '0xeb466342c4d449bc9f53a865d5cb90586f405215': 1.0, // axlUSDC
        '0xe343167631d89b6ffc58b88d6b7fb0228795491d': 1.0, // USDGLO
        // WETH - use ETH price (approximate)
        '0x4200000000000000000000000000000000000006': 3500.0, // WETH ≈ $3500
        // KBtc - use BTC price (approximate)
        '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98': 95000.0, // KBtc ≈ $95000
      };

      const price = knownPrices[addr] || 0;
      return decimalAmount * price;
    }

    // Get total volume (all USD activity)
    const volumeResult = await query<{
      total_volume: string;
    }>(`
      SELECT 
        COALESCE(SUM(COALESCE(total_usd_volume, 0)), 0) as total_volume
      FROM transaction_enrichment
      WHERE LOWER(contract_address) = LOWER($1)
        AND LOWER(wallet_address) = LOWER($2)
        AND COALESCE(total_usd_volume, 0) > 0
    `, [NADO_CONTRACT, walletAddress]);

    const finalTotalDeposits = totalDeposits; // Use the calculated totalDeposits from token parsing
    const totalVolume = parseFloat(volumeResult[0]?.total_volume || '0');

    // Get calculated volume from Nado API
    const nadoVolumeData = await getNadoVolumeForWallet(walletAddress);

    // Convert token deposits map to array
    const tokenBreakdown = Array.from(tokenDeposits.entries()).map(([address, data]) => ({
      tokenAddress: address,
      symbol: data.symbol,
      name: data.name,
      depositAmount: Math.round(data.amount * 100) / 100,
      rawAmount: data.rawAmount,
    }));

    const metrics: NadoMetrics = {
      totalDeposits: Math.round(finalTotalDeposits * 100) / 100,
      totalTransactions,
      nadoVolumeUSD: nadoVolumeData.totalVolumeUSD, // Main volume from Nado API
      dbTotalVolume: Math.round(totalVolume * 100) / 100, // Database volume (fallback)
      tokenBreakdown: tokenBreakdown.length > 0 ? tokenBreakdown : undefined,
    };

    // Cache for 5 minutes
    responseCache.set(cacheKey, metrics);
    return res.json(metrics);

  } catch (error) {
    console.error('Failed to fetch Nado metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch Nado metrics' });
  }
});

export default router;