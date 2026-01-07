import { NextRequest, NextResponse } from 'next/server';
import { analyticsService } from '@/lib/services/analytics-service';
import { query } from '@/lib/db';

// GM contract address
const GM_CONTRACT_ADDRESS = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f';

// InkyPump contract address and methods
const INKYPUMP_CONTRACT_ADDRESS = '0x1d74317d760f2c72a94386f50e8d10f2c902b899';
const INKYPUMP_CREATE_TOKEN_FUNCTION = '0xa07849e6';

// InkySwap router contract and methods for InkyPump trading
const INKYSWAP_ROUTER_ADDRESS = '0xa8c1c38ff57428e5c3a34e0899be5cb385476507';
const SWAP_EXACT_TOKENS_FOR_ETH = '0x18cbafe5'; // Sell tokens

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
    if (metric === 'inkypump_buy_volume') {
      const rows = await query<{
        total_volume: string;
        count: string;
      }>(`
        SELECT 
          COALESCE(SUM(value_in_eth * historical_eth_price), 0) as total_volume,
          COUNT(*) as count
        FROM transaction_details
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('SwapExactETHForTokens', 'SwapETHForExactTokens')
          AND value_in_eth > 0
          AND historical_eth_price > 0
      `, [INKYSWAP_ROUTER_ADDRESS, wallet]);

      const totalVolume = parseFloat(rows[0]?.total_volume || '0');
      const count = parseInt(rows[0]?.count || '0', 10);

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
    if (metric === 'inkypump_sell_volume') {
      const rows = await query<{
        count: string;
      }>(`
        SELECT 
          COUNT(*) as count
        FROM transaction_details
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('SwapExactTokensForETH', 'SwapTokensForExactETH', 'SwapExactTokensForETHSupportingFeeOnTransferTokens')
      `, [INKYSWAP_ROUTER_ADDRESS, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);
      // For now, we can't calculate USD volume for sell transactions without ETH amounts
      // This would require parsing transaction logs or having value_out_eth populated
      const totalVolume = 0;

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
          AND function_name = 'JoinRaffle'
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
          AND function_name = 'StakeBatch'
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
