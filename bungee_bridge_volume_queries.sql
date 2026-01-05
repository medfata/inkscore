-- Bungee Bridge Volume Calculation Queries
-- Based on transaction pattern analysis

-- =====================================================
-- BRIDGE OUT Volume (from Ink chain via Socket Gateway)
-- =====================================================
-- Users initiating bridge transactions to send funds OUT of Ink chain
-- Uses: eth_usd_value + tokens_in_usd_total + internal_eth_in_usd

WITH bridge_out_volume AS (
  SELECT 
    wallet_address,
    COUNT(*) as out_tx_count,
    SUM(
      COALESCE(eth_usd_value, 0) + 
      COALESCE(tokens_in_usd_total, 0) + 
      COALESCE(internal_eth_in_usd, 0)
    ) as total_bridged_out_usd
  FROM transaction_enrichment 
  WHERE contract_address = lower('0x3a23f943181408eac424116af7b7790c94cb97a5')  -- Socket Gateway
  AND method_id IN ('0x00000183', '0x00000181')  -- Bridge methods
  AND wallet_address = lower('WALLET_ADDRESS_PLACEHOLDER')  -- Replace with actual wallet
  GROUP BY wallet_address
),

-- =====================================================
-- BRIDGE IN Volume (to Ink chain via Across V3)
-- =====================================================
-- Relayers fulfilling bridge requests to bring funds INTO Ink chain
-- Uses: eth_usd_value + tokens_out_usd_total + internal_eth_out_usd

bridge_in_volume AS (
  SELECT 
    wallet_address,
    COUNT(*) as in_tx_count,
    SUM(
      COALESCE(eth_usd_value, 0) + 
      COALESCE(tokens_out_usd_total, 0) + 
      COALESCE(internal_eth_out_usd, 0)
    ) as total_bridged_in_usd
  FROM transaction_enrichment 
  WHERE contract_address = lower('0xef684c38f94f48775959ecf2012d7e864ffb9dd4')  -- Across V3
  AND method_id IN ('0x2e378115', '0xdeff4b24')  -- fillV3Relay, fillRelay
  AND wallet_address = lower('WALLET_ADDRESS_PLACEHOLDER')  -- Replace with actual wallet
  GROUP BY wallet_address
)

-- =====================================================
-- COMBINED RESULTS
-- =====================================================
SELECT 
  COALESCE(bo.wallet_address, bi.wallet_address) as wallet_address,
  COALESCE(bo.out_tx_count, 0) as bridge_out_tx_count,
  COALESCE(bo.total_bridged_out_usd, 0) as bridge_out_usd_volume,
  COALESCE(bi.in_tx_count, 0) as bridge_in_tx_count,
  COALESCE(bi.total_bridged_in_usd, 0) as bridge_in_usd_volume,
  COALESCE(bo.total_bridged_out_usd, 0) + COALESCE(bi.total_bridged_in_usd, 0) as total_bridge_usd_volume
FROM bridge_out_volume bo
FULL OUTER JOIN bridge_in_volume bi ON bo.wallet_address = bi.wallet_address;

-- =====================================================
-- DETAILED TRANSACTION LIST
-- =====================================================
-- Get all bridge transactions with calculated volumes
SELECT 
  tx_hash,
  wallet_address,
  method_id,
  method_full,
  eth_usd_value,
  tokens_in_usd_total,
  tokens_out_usd_total,
  internal_eth_in_usd,
  internal_eth_out_usd,
  created_at,
  CASE 
    WHEN contract_address = lower('0x3a23f943181408eac424116af7b7790c94cb97a5') 
         AND method_id IN ('0x00000183', '0x00000181') THEN 'BRIDGE_OUT'
    WHEN contract_address = lower('0xef684c38f94f48775959ecf2012d7e864ffb9dd4') 
         AND method_id IN ('0x2e378115', '0xdeff4b24') THEN 'BRIDGE_IN'
    ELSE 'UNKNOWN'
  END as bridge_direction,
  CASE 
    WHEN contract_address = lower('0x3a23f943181408eac424116af7b7790c94cb97a5') 
         AND method_id IN ('0x00000183', '0x00000181') THEN 
      COALESCE(eth_usd_value, 0) + COALESCE(tokens_in_usd_total, 0) + COALESCE(internal_eth_in_usd, 0)
    WHEN contract_address = lower('0xef684c38f94f48775959ecf2012d7e864ffb9dd4') 
         AND method_id IN ('0x2e378115', '0xdeff4b24') THEN 
      COALESCE(eth_usd_value, 0) + COALESCE(tokens_out_usd_total, 0) + COALESCE(internal_eth_out_usd, 0)
    ELSE 0
  END as calculated_usd_volume
FROM transaction_enrichment 
WHERE wallet_address = lower('WALLET_ADDRESS_PLACEHOLDER')  -- Replace with actual wallet
AND (
  (contract_address = lower('0x3a23f943181408eac424116af7b7790c94cb97a5') 
   AND method_id IN ('0x00000183', '0x00000181')) OR
  (contract_address = lower('0xef684c38f94f48775959ecf2012d7e864ffb9dd4') 
   AND method_id IN ('0x2e378115', '0xdeff4b24'))
)
ORDER BY created_at DESC;

-- =====================================================
-- AGGREGATED STATS FOR ALL WALLETS
-- =====================================================
-- Get bridge volume stats across all wallets
WITH all_bridge_volumes AS (
  -- Bridge Out
  SELECT 
    wallet_address,
    'BRIDGE_OUT' as direction,
    COUNT(*) as tx_count,
    SUM(
      COALESCE(eth_usd_value, 0) + 
      COALESCE(tokens_in_usd_total, 0) + 
      COALESCE(internal_eth_in_usd, 0)
    ) as usd_volume
  FROM transaction_enrichment 
  WHERE contract_address = lower('0x3a23f943181408eac424116af7b7790c94cb97a5')
  AND method_id IN ('0x00000183', '0x00000181')
  GROUP BY wallet_address
  
  UNION ALL
  
  -- Bridge In
  SELECT 
    wallet_address,
    'BRIDGE_IN' as direction,
    COUNT(*) as tx_count,
    SUM(
      COALESCE(eth_usd_value, 0) + 
      COALESCE(tokens_out_usd_total, 0) + 
      COALESCE(internal_eth_out_usd, 0)
    ) as usd_volume
  FROM transaction_enrichment 
  WHERE contract_address = lower('0xef684c38f94f48775959ecf2012d7e864ffb9dd4')
  AND method_id IN ('0x2e378115', '0xdeff4b24')
  GROUP BY wallet_address
)
SELECT 
  direction,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  SUM(tx_count) as total_transactions,
  SUM(usd_volume) as total_usd_volume,
  AVG(usd_volume) as avg_usd_volume_per_wallet
FROM all_bridge_volumes
GROUP BY direction
ORDER BY direction;