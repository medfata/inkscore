import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { priceService } from '@/lib/services/price-service';
import { decodeFunctionData, parseAbi, createPublicClient, http, erc20Abi } from 'viem';

// RPC endpoint for fetching token info
const RPC_URL = process.env.RPC_URL || 'https://rpc-gel.inkonchain.com';

// Tydro contract addresses
const TYDRO_CONTRACTS = [
  '0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2', // WrappedTokenGatewayV3 (ETH functions)
  '0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba', // TydroPool (token functions)
];

// Function selectors
const SUPPLY_SELECTORS = ['0x474cf53d', '0x617ba037']; // depositETH, supply
const WITHDRAW_SELECTORS = ['0x80500d20', '0x69328dec']; // withdrawETH, withdraw
const BORROW_SELECTORS = ['0xe74f7b85', '0xa415bcad']; // borrowETH, borrow
const REPAY_SELECTORS = ['0xbcc3c255', '0x573ade81']; // repayETH, repay

// Virtual ETH address for tracking native ETH
const VIRTUAL_ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// Known tokens on Ink chain - Tydro supported tokens (lowercase addresses)
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; usdPegged?: boolean; ethPegged?: boolean; btcPegged?: boolean }> = {
  // Stablecoins
  '0xe343167631d89b6ffc58b88d6b7fb0228795491d': { symbol: 'USDG', decimals: 18, usdPegged: true },
  '0x0200c29006150606b650577bbe7b6248f58470c1': { symbol: 'USDT', decimals: 6, usdPegged: true },
  '0x2d270e6886d130d724215a266106e6832161eaed': { symbol: 'USDC', decimals: 6, usdPegged: true },
  '0xfc421ad3c883bf9e7c4f42de845c4e4405799e73': { symbol: 'GHO', decimals: 18, usdPegged: true },
  '0xeb466342c4d449bc9f53a865d5cb90586f405215': { symbol: 'axlUSDC', decimals: 6, usdPegged: true },
  // ETH
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18, ethPegged: true },
  [VIRTUAL_ETH]: { symbol: 'ETH', decimals: 18, ethPegged: true },
  // ETH LSTs
  '0x2416092f143378750bb29b79ed961ab195cceea5': { symbol: 'ezETH', decimals: 18, ethPegged: true },
  '0xa3d68b74bf0528fdd07263c60d6488749044914b': { symbol: 'weETH', decimals: 18, ethPegged: true },
  '0x9f0a74a92287e323eb95c1cd9ecdbeb0e397cae4': { symbol: 'wrsETH', decimals: 18, ethPegged: true },
  // BTC
  '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98': { symbol: 'kBTC', decimals: 8, btcPegged: true },
};

// BTC price cache
let btcPriceCache: { price: number; timestamp: number } | null = null;
const BTC_PRICE_CACHE_TTL = 5 * 60 * 1000;

async function getBtcPrice(): Promise<number> {
  if (btcPriceCache && Date.now() - btcPriceCache.timestamp < BTC_PRICE_CACHE_TTL) {
    return btcPriceCache.price;
  }
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    if (response.ok) {
      const data = await response.json();
      const price = data.bitcoin?.usd || 95000;
      btcPriceCache = { price, timestamp: Date.now() };
      return price;
    }
  } catch (error) {
    console.error('Failed to fetch BTC price:', error);
  }
  return btcPriceCache?.price || 95000;
}

// ABI for decoding
const DECODE_ABI = parseAbi([
  'function depositETH(address, address onBehalfOf, uint16 referralCode)',
  'function withdrawETH(address, uint256 amount, address to)',
  'function borrowETH(address, uint256 amount, uint16 referralCode)',
  'function repayETH(address, uint256 amount, address onBehalfOf)',
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)',
]);

const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const ZERO = BigInt(0);

// RPC client
const rpcClient = createPublicClient({ transport: http(RPC_URL) });
const tokenInfoCache: Map<string, { decimals: number; symbol: string }> = new Map();

async function getTokenInfo(tokenAddress: string): Promise<{ decimals: number; symbol: string }> {
  const addr = tokenAddress.toLowerCase();
  if (KNOWN_TOKENS[addr]) return { decimals: KNOWN_TOKENS[addr].decimals, symbol: KNOWN_TOKENS[addr].symbol };
  if (tokenInfoCache.has(addr)) return tokenInfoCache.get(addr)!;
  try {
    const [decimals, symbol] = await Promise.all([
      rpcClient.readContract({ address: tokenAddress as `0x${string}`, abi: erc20Abi, functionName: 'decimals' }),
      rpcClient.readContract({ address: tokenAddress as `0x${string}`, abi: erc20Abi, functionName: 'symbol' }),
    ]);
    const info = { decimals: Number(decimals), symbol: symbol as string };
    tokenInfoCache.set(addr, info);
    return info;
  } catch {
    return { decimals: 18, symbol: 'UNKNOWN' };
  }
}

async function getTokenPriceUsd(tokenAddress: string, ethPrice: number): Promise<number> {
  const addr = tokenAddress.toLowerCase();
  const token = KNOWN_TOKENS[addr];
  if (token?.usdPegged) return 1;
  if (token?.ethPegged) return ethPrice;
  if (token?.btcPegged) return await getBtcPrice();
  return 1;
}

interface TxData {
  input_data: string | null;
  tx_hash: string;
  eth_value: string;
  function_selector: string;
  block_timestamp: Date;
}

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

// Decode a single transaction and return asset + raw amount
function decodeTxAssetAndAmount(tx: TxData): { asset: string; amount: bigint; isMax: boolean } | null {
  try {
    const selector = tx.function_selector;

    // ETH functions using eth_value
    if (selector === '0x474cf53d') { // depositETH
      return { asset: VIRTUAL_ETH, amount: BigInt(tx.eth_value || '0'), isMax: false };
    }
    if (selector === '0xbcc3c255') { // repayETH
      return { asset: VIRTUAL_ETH, amount: BigInt(tx.eth_value || '0'), isMax: false };
    }

    if (!tx.input_data || tx.input_data.length <= 10) return null;

    const decoded = decodeFunctionData({ abi: DECODE_ABI, data: tx.input_data as `0x${string}` });

    // ETH functions with amount in params
    if (selector === '0x80500d20' || selector === '0xe74f7b85') { // withdrawETH, borrowETH
      const amount = decoded.args?.[1] as bigint;
      if (typeof amount !== 'bigint') return null;
      const isMax = amount === MAX_UINT256;
      return { asset: VIRTUAL_ETH, amount: isMax ? ZERO : amount, isMax };
    }

    // Token functions: asset at [0], amount at [1]
    if (['0x617ba037', '0x69328dec', '0xa415bcad', '0x573ade81'].includes(selector)) {
      const asset = decoded.args?.[0] as string;
      const amount = decoded.args?.[1] as bigint;
      if (!asset || typeof amount !== 'bigint') return null;
      const isMax = amount === MAX_UINT256;
      return { asset: asset.toLowerCase(), amount: isMax ? ZERO : amount, isMax };
    }

    return null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    const ethPrice = await priceService.getCurrentPrice();

    // Query all Tydro transactions ordered by time
    const allTxs = await query<TxData>(`
      SELECT input_data, tx_hash, eth_value, function_selector, block_timestamp
      FROM transaction_details
      WHERE wallet_address = $1
        AND contract_address = ANY($2)
        AND function_selector = ANY($3)
        AND status = 1
      ORDER BY block_timestamp ASC
    `, [wallet, TYDRO_CONTRACTS, [...SUPPLY_SELECTORS, ...WITHDRAW_SELECTORS, ...BORROW_SELECTORS, ...REPAY_SELECTORS]]);

    // Track per-token balances for supply and borrow
    const supplyBalances: Map<string, bigint> = new Map(); // asset -> raw balance
    const borrowBalances: Map<string, bigint> = new Map();

    // Track totals
    let totalSuppliedUsd = 0, totalWithdrawnUsd = 0;
    let totalBorrowedUsd = 0, totalRepaidUsd = 0;
    let supplyCount = 0, withdrawCount = 0, borrowCount = 0, repayCount = 0;

    for (const tx of allTxs) {
      const parsed = decodeTxAssetAndAmount(tx);
      if (!parsed) continue;

      const { asset, amount, isMax } = parsed;
      const selector = tx.function_selector;
      const tokenInfo = await getTokenInfo(asset);
      const tokenPrice = await getTokenPriceUsd(asset, ethPrice);

      // Supply
      if (SUPPLY_SELECTORS.includes(selector)) {
        supplyCount++;
        const currentBalance = supplyBalances.get(asset) || ZERO;
        supplyBalances.set(asset, currentBalance + amount);
        const usdValue = (Number(amount) / Math.pow(10, tokenInfo.decimals)) * tokenPrice;
        totalSuppliedUsd += usdValue;
      }
      // Withdraw
      else if (WITHDRAW_SELECTORS.includes(selector)) {
        withdrawCount++;
        const currentBalance = supplyBalances.get(asset) || ZERO;
        let withdrawAmount = amount;

        if (isMax) {
          // MAX withdrawal = withdraw entire balance
          withdrawAmount = currentBalance;
        }

        supplyBalances.set(asset, currentBalance > withdrawAmount ? currentBalance - withdrawAmount : ZERO);
        const usdValue = (Number(withdrawAmount) / Math.pow(10, tokenInfo.decimals)) * tokenPrice;
        totalWithdrawnUsd += usdValue;
      }
      // Borrow
      else if (BORROW_SELECTORS.includes(selector)) {
        borrowCount++;
        const currentBalance = borrowBalances.get(asset) || ZERO;
        borrowBalances.set(asset, currentBalance + amount);
        const usdValue = (Number(amount) / Math.pow(10, tokenInfo.decimals)) * tokenPrice;
        totalBorrowedUsd += usdValue;
      }
      // Repay
      else if (REPAY_SELECTORS.includes(selector)) {
        repayCount++;
        const currentBalance = borrowBalances.get(asset) || ZERO;
        let repayAmount = amount;

        if (isMax) {
          // MAX repay = repay entire debt
          repayAmount = currentBalance;
        }

        borrowBalances.set(asset, currentBalance > repayAmount ? currentBalance - repayAmount : ZERO);
        const usdValue = (Number(repayAmount) / Math.pow(10, tokenInfo.decimals)) * tokenPrice;
        totalRepaidUsd += usdValue;
      }
    }

    // Calculate current positions from final balances
    let currentSupplyUsd = 0, currentSupplyEth = 0;
    let currentBorrowUsd = 0, currentBorrowEth = 0;

    for (const [asset, balance] of supplyBalances) {
      if (balance <= ZERO) continue;
      const tokenInfo = await getTokenInfo(asset);
      const tokenPrice = await getTokenPriceUsd(asset, ethPrice);
      const amount = Number(balance) / Math.pow(10, tokenInfo.decimals);
      currentSupplyUsd += amount * tokenPrice;
      if (KNOWN_TOKENS[asset]?.ethPegged) currentSupplyEth += amount;
    }

    for (const [asset, balance] of borrowBalances) {
      if (balance <= ZERO) continue;
      const tokenInfo = await getTokenInfo(asset);
      const tokenPrice = await getTokenPriceUsd(asset, ethPrice);
      const amount = Number(balance) / Math.pow(10, tokenInfo.decimals);
      currentBorrowUsd += amount * tokenPrice;
      if (KNOWN_TOKENS[asset]?.ethPegged) currentBorrowEth += amount;
    }

    // Calculate total ETH from supply balances
    const totalDepositedEth = currentSupplyEth; // Simplified - actual ETH in supply

    const response: TydroResponse = {
      currentSupplyUsd,
      currentSupplyEth,
      totalDepositedUsd: totalSuppliedUsd,
      totalDepositedEth,
      totalWithdrawnUsd,
      totalWithdrawnEth: 0, // Would need separate tracking
      depositCount: supplyCount,
      withdrawCount,
      currentBorrowUsd,
      currentBorrowEth,
      totalBorrowedUsd,
      totalBorrowedEth: 0,
      totalRepaidUsd,
      totalRepaidEth: 0,
      borrowCount,
      repayCount,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching Tydro data:', error);
    return NextResponse.json({ error: 'Failed to fetch Tydro data' }, { status: 500 });
  }
}
