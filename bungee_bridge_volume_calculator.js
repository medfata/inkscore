// Bungee Bridge Volume Calculator
// Based on analysis of transaction patterns

const SOCKET_GATEWAY = '0x3a23f943181408eac424116af7b7790c94cb97a5';
const ACROSS_V3_BRIDGE = '0xef684c38f94f48775959ecf2012d7e864ffb9dd4';

/**
 * Calculate bridge volumes for a specific wallet
 * @param {string} walletAddress - The wallet address to analyze
 * @returns {Object} Bridge volume data
 */
async function calculateBridgeVolumes(walletAddress) {
  
  // BRIDGE OUT (from Ink chain) - Socket Gateway transactions
  // These are user-initiated deposits/swaps that bridge funds OUT of Ink chain
  const bridgeOutQuery = `
    SELECT 
      wallet_address,
      COUNT(*) as transaction_count,
      SUM(
        COALESCE(eth_usd_value, 0) + 
        COALESCE(tokens_in_usd_total, 0) + 
        COALESCE(internal_eth_in_usd, 0)
      ) as total_bridged_out_usd
    FROM transaction_enrichment 
    WHERE contract_address = $1
    AND wallet_address = $2
    AND method_id IN ('0x00000183', '0x00000181')  -- Socket Gateway bridge methods
    GROUP BY wallet_address
  `;

  // BRIDGE IN (to Ink chain) - Across V3 relay fulfillments
  // These are relayer transactions that bring funds INTO Ink chain
  const bridgeInQuery = `
    SELECT 
      wallet_address,
      COUNT(*) as transaction_count,
      SUM(
        COALESCE(eth_usd_value, 0) + 
        COALESCE(tokens_out_usd_total, 0) + 
        COALESCE(internal_eth_out_usd, 0)
      ) as total_bridged_in_usd
    FROM transaction_enrichment 
    WHERE contract_address = $1
    AND wallet_address = $2
    AND method_id IN ('0x2e378115', '0xdeff4b24')  -- fillV3Relay, fillRelay
    GROUP BY wallet_address
  `;

  try {
    const [bridgeOutResult, bridgeInResult] = await Promise.all([
      pool.query(bridgeOutQuery, [SOCKET_GATEWAY.toLowerCase(), walletAddress.toLowerCase()]),
      pool.query(bridgeInQuery, [ACROSS_V3_BRIDGE.toLowerCase(), walletAddress.toLowerCase()])
    ]);

    const bridgeOut = bridgeOutResult.rows[0] || { 
      transaction_count: 0, 
      total_bridged_out_usd: 0 
    };
    
    const bridgeIn = bridgeInResult.rows[0] || { 
      transaction_count: 0, 
      total_bridged_in_usd: 0 
    };

    return {
      wallet_address: walletAddress,
      bridge_out: {
        transaction_count: parseInt(bridgeOut.transaction_count),
        total_usd_volume: parseFloat(bridgeOut.total_bridged_out_usd || 0)
      },
      bridge_in: {
        transaction_count: parseInt(bridgeIn.transaction_count),
        total_usd_volume: parseFloat(bridgeIn.total_bridged_in_usd || 0)
      },
      total_bridge_volume: parseFloat(bridgeOut.total_bridged_out_usd || 0) + parseFloat(bridgeIn.total_bridged_in_usd || 0)
    };

  } catch (error) {
    console.error('Error calculating bridge volumes:', error);
    throw error;
  }
}

/**
 * Get all bridge transactions for a wallet with details
 * @param {string} walletAddress - The wallet address to analyze
 * @returns {Array} Detailed transaction list
 */
async function getBridgeTransactionDetails(walletAddress) {
  const detailsQuery = `
    SELECT 
      tx_hash,
      contract_address,
      wallet_address,
      method_id,
      method_full,
      eth_usd_value,
      tokens_in_usd_total,
      tokens_out_usd_total,
      internal_eth_in_usd,
      internal_eth_out_usd,
      total_usd_volume,
      created_at,
      CASE 
        WHEN contract_address = $1 AND method_id IN ('0x00000183', '0x00000181') THEN 'BRIDGE_OUT'
        WHEN contract_address = $2 AND method_id IN ('0x2e378115', '0xdeff4b24') THEN 'BRIDGE_IN'
        ELSE 'UNKNOWN'
      END as bridge_direction,
      CASE 
        WHEN contract_address = $1 AND method_id IN ('0x00000183', '0x00000181') THEN 
          COALESCE(eth_usd_value, 0) + COALESCE(tokens_in_usd_total, 0) + COALESCE(internal_eth_in_usd, 0)
        WHEN contract_address = $2 AND method_id IN ('0x2e378115', '0xdeff4b24') THEN 
          COALESCE(eth_usd_value, 0) + COALESCE(tokens_out_usd_total, 0) + COALESCE(internal_eth_out_usd, 0)
        ELSE 0
      END as calculated_usd_volume
    FROM transaction_enrichment 
    WHERE wallet_address = $3
    AND (
      (contract_address = $1 AND method_id IN ('0x00000183', '0x00000181')) OR
      (contract_address = $2 AND method_id IN ('0x2e378115', '0xdeff4b24'))
    )
    ORDER BY created_at DESC
  `;

  try {
    const result = await pool.query(detailsQuery, [
      SOCKET_GATEWAY.toLowerCase(),
      ACROSS_V3_BRIDGE.toLowerCase(),
      walletAddress.toLowerCase()
    ]);

    return result.rows.map(row => ({
      ...row,
      calculated_usd_volume: parseFloat(row.calculated_usd_volume || 0)
    }));

  } catch (error) {
    console.error('Error getting bridge transaction details:', error);
    throw error;
  }
}

/**
 * Analysis based on the Socket Gateway transaction sample:
 * 
 * TX: 0xfc8691ef4653a4200d87e3004ab43bcdd2d05fb0ea194e2eb583f0abe52616f4
 * - Method: 0x00000183 (Socket Gateway bridge method)
 * - Value: 150000000000000 wei (0.00015 ETH)
 * - This is a BRIDGE OUT transaction (user sending funds from Ink chain)
 * 
 * USD Volume Calculation for BRIDGE OUT:
 * - eth_usd_value: Direct ETH value sent
 * - tokens_in_usd_total: USD value of tokens being bridged out
 * - internal_eth_in_usd: Internal ETH transfers (swaps, etc.)
 * 
 * For BRIDGE IN (Across V3 fillRelay transactions):
 * - eth_usd_value: ETH received
 * - tokens_out_usd_total: USD value of tokens received
 * - internal_eth_out_usd: Internal ETH transfers out
 */

module.exports = {
  calculateBridgeVolumes,
  getBridgeTransactionDetails,
  SOCKET_GATEWAY,
  ACROSS_V3_BRIDGE
};