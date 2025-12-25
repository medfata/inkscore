import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { priceService } from '@/lib/services/price-service';
import { decodeFunctionData, parseAbi } from 'viem';

// Tydro contract addresses
const TYDRO_CONTRACTS = [
  '0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2', // WrappedTokenGatewayV3
  '0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba', // TydroPool
];

// Function selectors for supply (deposits) - ETH value is in tx.value
const SUPPLY_SELECTORS = [
  '0x474cf53d', // depositETH
  '0x617ba037', // supply
];

// Function selectors for withdraw - ETH amount is in input params
const WITHDRAW_SELECTORS = [
  '0x80500d20', // withdrawETH
  '0x69328dec', // withdraw
];

// Function selectors for borrow - ETH amount is in input params
const BORROW_SELECTORS = [
  '0x1a4d01d2', // borrowETH
  '0xa415bcad', // borrow
];

// Function selectors for repay - ETH value is in tx.value for repayETH
const REPAY_SELECTORS = [
  '0x02c5fcf8', // repayETH
  '0x573ade81', // repay
];

// ABI for decoding functions with amount in input params
const DECODE_ABI = parseAbi([
  'function withdrawETH(address, uint256 amount, address to)',
  'function withdraw(address asset, uint256 amount, address to)',
  'function borrowETH(address, uint256 amount, uint16 referralCode)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function repayETH(address, uint256 amount, address onBehalfOf)',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)',
]);

interface TydroResponse {
  currentSupplyUsd: number;
  currentSupplyEth: number;
  totalDepositedUsd: number;
  totalDepositedEth: number;
  totalWithdrawnUsd: number;
  totalWithdrawnEth: number;
  depositCount: number;
  withdrawCount: number;
  currentBorrowUsd: number;
  currentBorrowEth: number;
  totalBorrowedUsd: number;
  totalBorrowedEth: number;
  totalRepaidUsd: number;
  totalRepaidEth: number;
  borrowCount: number;
  repayCount: number;
}

// Max uint256 value - used when users want to withdraw/repay entire balance
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
// Threshold to detect "max" values (anything above 1e50 ETH is clearly invalid)
const MAX_REASONABLE_ETH = BigInt('1000000000000000000000000000000000000000000000000000'); // 1e50 wei

// Helper to decode amount from input data (counts all txs, decodes amount when possible)
async function decodeAmountFromTxs(
  txs: { input_data: string | null; tx_hash: string; eth_value?: string }[],
  useEthValue: boolean = false
): Promise<{ totalEth: number; count: number }> {
  let totalEth = 0;
  const count = txs.length; // Count all transactions

  for (const tx of txs) {
    try {
      if (useEthValue && tx.eth_value) {
        // Use eth_value from transaction (for supply/repayETH)
        totalEth += parseFloat(tx.eth_value) / 1e18;
      } else if (tx.input_data && tx.input_data.length > 10) {
        const decoded = decodeFunctionData({
          abi: DECODE_ABI,
          data: tx.input_data as `0x${string}`,
        });
        // Amount is at index 1 for all these functions
        const amount = decoded.args?.[1] as bigint;
        if (typeof amount === 'bigint') {
          // Skip max uint256 values - these mean "withdraw all" and the actual
          // amount is determined by the contract, not the input parameter
          if (amount === MAX_UINT256 || amount > MAX_REASONABLE_ETH) {
            console.log(`Skipping max/unreasonable amount in tx ${tx.tx_hash}: ${amount.toString()}`);
            continue;
          }
          totalEth += Number(amount) / 1e18;
        }
      }
      // If no input_data, we still count the tx but can't get the amount
    } catch (err) {
      console.error(`Failed to decode tx ${tx.tx_hash}:`, err);
    }
  }

  return { totalEth, count };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Get current ETH price
    const ethPrice = await priceService.getCurrentPrice();

    // Query total deposits (supply) - sum ETH value from transactions
    const depositResult = await query<{ total_eth: string; tx_count: string }>(`
      SELECT 
        COALESCE(SUM(CAST(eth_value AS NUMERIC) / 1e18), 0) as total_eth,
        COUNT(*) as tx_count
      FROM transaction_details
      WHERE wallet_address = $1
        AND contract_address = ANY($2)
        AND function_selector = ANY($3)
        AND status = 1
    `, [wallet, TYDRO_CONTRACTS, SUPPLY_SELECTORS]);

    // Query withdrawals - get all txs, decode amount from input_data if available
    const withdrawTxs = await query<{ input_data: string | null; tx_hash: string }>(`
      SELECT input_data, tx_hash
      FROM transaction_details
      WHERE wallet_address = $1
        AND contract_address = ANY($2)
        AND function_selector = ANY($3)
        AND status = 1
    `, [wallet, TYDRO_CONTRACTS, WITHDRAW_SELECTORS]);

    // Query borrows - get all txs, decode amount from input_data if available
    const borrowTxs = await query<{ input_data: string | null; tx_hash: string }>(`
      SELECT input_data, tx_hash
      FROM transaction_details
      WHERE wallet_address = $1
        AND contract_address = ANY($2)
        AND function_selector = ANY($3)
        AND status = 1
    `, [wallet, TYDRO_CONTRACTS, BORROW_SELECTORS]);

    // Query repays - ETH value is in tx.value for repayETH
    const repayTxs = await query<{ input_data: string; tx_hash: string; eth_value: string }>(`
      SELECT input_data, tx_hash, eth_value
      FROM transaction_details
      WHERE wallet_address = $1
        AND contract_address = ANY($2)
        AND function_selector = ANY($3)
        AND status = 1
    `, [wallet, TYDRO_CONTRACTS, REPAY_SELECTORS]);

    // Decode amounts
    const withdrawData = await decodeAmountFromTxs(withdrawTxs);
    const borrowData = await decodeAmountFromTxs(borrowTxs);
    const repayData = await decodeAmountFromTxs(repayTxs, true); // Use eth_value for repay

    const totalDepositedEth = parseFloat(depositResult[0]?.total_eth || '0');
    const depositCount = parseInt(depositResult[0]?.tx_count || '0');

    // Current supply = Total deposited - Total withdrawn
    const currentSupplyEth = Math.max(0, totalDepositedEth - withdrawData.totalEth);
    
    // Current borrow = Total borrowed - Total repaid
    const currentBorrowEth = Math.max(0, borrowData.totalEth - repayData.totalEth);

    const response: TydroResponse = {
      currentSupplyUsd: currentSupplyEth * ethPrice,
      currentSupplyEth,
      totalDepositedUsd: totalDepositedEth * ethPrice,
      totalDepositedEth,
      totalWithdrawnUsd: withdrawData.totalEth * ethPrice,
      totalWithdrawnEth: withdrawData.totalEth,
      depositCount,
      withdrawCount: withdrawData.count,
      currentBorrowUsd: currentBorrowEth * ethPrice,
      currentBorrowEth,
      totalBorrowedUsd: borrowData.totalEth * ethPrice,
      totalBorrowedEth: borrowData.totalEth,
      totalRepaidUsd: repayData.totalEth * ethPrice,
      totalRepaidEth: repayData.totalEth,
      borrowCount: borrowData.count,
      repayCount: repayData.count,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching Tydro data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Tydro data' },
      { status: 500 }
    );
  }
}
