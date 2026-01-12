import { NextRequest, NextResponse } from 'next/server';
import { analyticsService } from '@/lib/services/analytics-service';
import { query } from '@/lib/db';

// GM contract address
const GM_CONTRACT_ADDRESS = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f';

// InkyPump contract address and methods
const INKYPUMP_CONTRACT_ADDRESS = '0x1d74317d760f2c72a94386f50e8d10f2c902b899';
const INKYPUMP_CREATE_TOKEN_FUNCTION = '0xa07849e6';

// InkySwap router contract for InkyPump trading
const INKYSWAP_ROUTER_ADDRESS = '0xa8c1c38ff57428e5c3a34e0899be5cb385476507';

// Shellies contract addresses and methods
const SHELLIES_RAFFLE_CONTRACTS = [
  '0x47a27a42525fff2b7264b342f74216e37a831332',
  '0xe757e8aa82b7ad9f1ef8d4fe657d90341885c0de'
];
const SHELLIES_PAY_TO_PLAY_CONTRACT = '0x57d287dc46cb0782c4bce1e4e964cc52083bb358';
const SHELLIES_STAKING_CONTRACT = '0xb39a48d294e1530a271e712b7a19243679d320d0';

// GET /api/analytics/[wallet]/[metric] - Get specific metric for a wallet
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ wallet: string; metric: string }> }
) {
  try {
    const { wallet, metric } = await params;

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Special handling for gm_count - direct native query
    if (metric === 'gm_count') {
      const rows = await query<{ count: string }>(`
        SELECT count(tx_hash) as count 
        FROM transaction_details 
        WHERE contract_address = $1 
          AND wallet_address = lower($2)
      `, [GM_CONTRACT_ADDRESS, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

      return NextResponse.json({
        slug: 'gm_count',
        name: 'GM Count',
        icon: '👋',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // Special handling for inkypump_created_tokens - count of Create Token transactions
    if (metric === 'inkypump_created_tokens') {
      const rows = await query<{ count: string }>(`
        SELECT count(tx_hash) as count 
        FROM transaction_details 
        WHERE contract_address = $1 
          AND wallet_address = lower($2)
          AND function_name = $3
      `, [INKYPUMP_CONTRACT_ADDRESS, wallet, INKYPUMP_CREATE_TOKEN_FUNCTION]);

      const count = parseInt(rows[0]?.count || '0', 10);

      return NextResponse.json({
        slug: 'inkypump_created_tokens',
        name: 'InkyPump Created Tokens',
        icon: '🚀',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // Special handling for inkypump_buy_volume - USD volume of buy transactions
    // Buy = swapExactETHForTokens (user sends ETH, receives tokens)
    if (metric === 'inkypump_buy_volume') {
      // Buy method IDs: swapExactETHForTokens, swapETHForExactTokens
      const buyMethodIds = ['0x7ff36ab5', '0xfb3bdb41'];
      
      const rows = await query<{
        tx_hash: string;
        value: string;
        eth_price_usd: string;
        operations: string;
      }>(`
        SELECT 
          tx_hash,
          value,
          COALESCE(eth_price_usd, 3500) as eth_price_usd,
          operations
        FROM transaction_enrichment
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND method_id = ANY($3)
      `, [INKYSWAP_ROUTER_ADDRESS, wallet, buyMethodIds]);

      let totalVolume = 0;
      const count = rows.length;

      for (const row of rows) {
        const ethPrice = parseFloat(row.eth_price_usd || '3500');
        
        // For buy transactions, the ETH value is in the transaction value field
        if (row.value && row.value !== '0') {
          const ethValue = Number(BigInt(row.value)) / 1e18;
          totalVolume += ethValue * ethPrice;
        }
      }

      return NextResponse.json({
        slug: 'inkypump_buy_volume',
        name: 'InkyPump Buy Volume',
        icon: '📈',
        currency: 'USD',
        total_count: count,
        total_value: totalVolume.toFixed(2),
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // Special handling for inkypump_sell_volume - USD volume of sell transactions
    // Sell = swapExactTokensForETH (user sends tokens, receives ETH via internal tx)
    if (metric === 'inkypump_sell_volume') {
      // Sell method IDs: swapExactTokensForETH, swapTokensForExactETH, swapExactTokensForETHSupportingFeeOnTransferTokens
      const sellMethodIds = ['0x18cbafe5', '0x4a25d94a', '0x791ac947'];
      
      const rows = await query<{
        tx_hash: string;
        eth_price_usd: string;
        operations: string;
        internal_eth_out: string;
      }>(`
        SELECT 
          tx_hash,
          COALESCE(eth_price_usd, 3500) as eth_price_usd,
          operations,
          COALESCE(internal_eth_out, 0) as internal_eth_out
        FROM transaction_enrichment
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND method_id = ANY($3)
      `, [INKYSWAP_ROUTER_ADDRESS, wallet, sellMethodIds]);

      let totalVolume = 0;
      const count = rows.length;

      for (const row of rows) {
        const ethPrice = parseFloat(row.eth_price_usd || '3500');
        
        // First try the internal_eth_out column if populated
        if (row.internal_eth_out && parseFloat(row.internal_eth_out) > 0) {
          totalVolume += parseFloat(row.internal_eth_out) * ethPrice;
          continue;
        }
        
        // Otherwise parse operations to find ETH sent to the wallet
        if (row.operations) {
          try {
            const operations = typeof row.operations === 'string' 
              ? JSON.parse(row.operations) 
              : row.operations;
            
            if (Array.isArray(operations)) {
              // Find internal transactions where ETH is sent TO the wallet (user receives ETH)
              for (const op of operations) {
                const toAddress = (op.to?.id || '').toLowerCase();
                const fromAddress = (op.from?.id || '').toLowerCase();
                const value = op.value;
                
                // Look for ETH transfer to the wallet address (not from the wallet)
                if (toAddress === wallet.toLowerCase() && 
                    fromAddress !== wallet.toLowerCase() &&
                    value && value !== '0') {
                  const ethValue = Number(BigInt(value)) / 1e18;
                  totalVolume += ethValue * ethPrice;
                  break; // Take the first ETH transfer to wallet (the swap output)
                }
              }
            }
          } catch (e) {
            // Skip if parsing fails
            console.error('Failed to parse operations for tx:', row.tx_hash, e);
          }
        }
      }

      return NextResponse.json({
        slug: 'inkypump_sell_volume',
        name: 'InkyPump Sell Volume',
        icon: '📉',
        currency: 'USD',
        total_count: count,
        total_value: totalVolume.toFixed(2),
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // Special handling for nft_traded - count of NFT trading transactions by contract
    if (metric === 'nft_traded') {
      // NFT marketplace contract addresses
      const nftContracts = [
        '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5', // Net Protocol
        '0xbd6a027b85fd5285b1623563bbef6fadbe396afb', // Mintiq
        '0x9ebf93fdba9f32accab3d6716322dccd617a78f3', // Squid Market
      ];

      // Get total count across all NFT contracts
      const totalRows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = ANY($1) 
          AND wallet_address = lower($2)
          AND status = 1
      `, [nftContracts, wallet]);

      const totalCount = parseInt(totalRows[0]?.count || '0', 10);

      // Get count by contract for breakdown
      const contractRows = await query<{
        contract_address: string;
        count: string;
      }>(`
        SELECT 
          contract_address,
          COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = ANY($1) 
          AND wallet_address = lower($2)
          AND status = 1
        GROUP BY contract_address
      `, [nftContracts, wallet]);

      const byContract = contractRows.map(row => ({
        contract_address: row.contract_address.toLowerCase(),
        count: parseInt(row.count, 10),
      }));

      return NextResponse.json({
        slug: 'nft_traded',
        name: 'NFT Trading',
        icon: '🖼️',
        currency: 'COUNT',
        total_count: totalCount,
        total_value: totalCount.toString(),
        by_contract: byContract,
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // Special handling for shellies_joined_raffles - count of JoinRaffle transactions across both contracts
    if (metric === 'shellies_joined_raffles') {
      const rows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = ANY($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('JoinRaffle', 'joinRaffle')
          AND status = 1
      `, [SHELLIES_RAFFLE_CONTRACTS, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

      return NextResponse.json({
        slug: 'shellies_joined_raffles',
        name: 'Joined Raffles',
        icon: '🎟️',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // Special handling for shellies_pay_to_play - count of PayToPlay transactions
    if (metric === 'shellies_pay_to_play') {
      const rows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('PayToPlay', 'payToPlay')
          AND status = 1
      `, [SHELLIES_PAY_TO_PLAY_CONTRACT, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

      return NextResponse.json({
        slug: 'shellies_pay_to_play',
        name: 'Pay to Play',
        icon: '🎮',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // Special handling for shellies_staking - count of StakeBatch transactions
    if (metric === 'shellies_staking') {
      const rows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('StakeBatch', 'stakeBatch', '0x1e332260')
          AND status = 1
      `, [SHELLIES_STAKING_CONTRACT, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

      return NextResponse.json({
        slug: 'shellies_staking',
        name: 'Staking',
        icon: '🔒',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // For other metrics, use the existing analytics service
    // TODO: Rework this metric logic later
    const result = await analyticsService.getWalletMetric(wallet, metric);

    if (!result) {
      return NextResponse.json(
        { error: 'Metric not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching wallet metric:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet metric' },
      { status: 500 }
    );
  }
}
