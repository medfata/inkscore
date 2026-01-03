import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { priceService } from '@/lib/services/price-service';

// Tydro contract addresses (lowercase)
const TYDRO_CONTRACTS = [
  '0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2', // WrappedTokenGatewayV3 (ETH functions)
  '0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba', // TydroPool (token functions)
];

// Method IDs for categorization
const SUPPLY_METHODS = ['0x474cf53d', '0x617ba037']; // depositETH, supply
const WITHDRAW_METHODS = ['0x80500d20', '0x69328dec']; // withdrawETH, withdraw
const BORROW_METHODS = ['0xe74f7b85', '0xa415bcad']; // borrowETH, borrow
const REPAY_METHODS = ['0xbcc3c255', '0x573ade81']; // repayETH, repay

// Event signatures (topic[0])
const SUPPLY_EVENT_TOPIC = '0x2b627736bca15cd5381dcf80b0bf11fd197d01a037c52b927a881a10fb73ba61';
const WITHDRAW_EVENT_TOPIC = '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7';
const BORROW_EVENT_TOPIC = '0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0';
const REPAY_EVENT_TOPIC = '0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051'; // Fixed!

// Known tokens for price calculation
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; usdPegged?: boolean; ethPegged?: boolean; btcPegged?: boolean }> = {
  '0xe343167631d89b6ffc58b88d6b7fb0228795491d': { symbol: 'USDG', decimals: 18, usdPegged: true },
  '0x0200c29006150606b650577bbe7b6248f58470c1': { symbol: 'USDT', decimals: 6, usdPegged: true },
  '0x2d270e6886d130d724215a266106e6832161eaed': { symbol: 'USDC', decimals: 6, usdPegged: true },
  '0xfc421ad3c883bf9e7c4f42de845c4e4405799e73': { symbol: 'GHO', decimals: 18, usdPegged: true },
  '0xeb466342c4d449bc9f53a865d5cb90586f405215': { symbol: 'axlUSDC', decimals: 6, usdPegged: true },
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18, ethPegged: true },
  '0x2416092f143378750bb29b79ed961ab195cceea5': { symbol: 'ezETH', decimals: 18, ethPegged: true },
  '0xa3d68b74bf0528fdd07263c60d6488749044914b': { symbol: 'weETH', decimals: 18, ethPegged: true },
  '0x9f0a74a92287e323eb95c1cd9ecdbeb0e397cae4': { symbol: 'wrsETH', decimals: 18, ethPegged: true },
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

interface LogEntry {
  event?: string;
  data?: string;
  topics?: string[];
  address?: { id?: string };
}

interface EnrichedTx {
  tx_hash: string;
  method_id: string;
  value: string | null;
  logs: LogEntry[] | null;
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

// Parse amount from event log data field
// Supply event data: user (32 bytes) + amount (32 bytes)
// Withdraw event data: user (32 bytes) + to (32 bytes) + amount (32 bytes)
// Borrow event data: user (32 bytes) + amount (32 bytes) + interestRateMode (32) + borrowRate (32)
// Repay event data: user (32 bytes) + repayer (32 bytes) + amount (32 bytes) + useATokens (32)
function parseAmountFromEventData(
  data: string,
  reserve: string,
  eventType: 'supply' | 'withdraw' | 'borrow' | 'repay'
): { amount: bigint; decimals: number } | null {
  try {
    if (!data || data.length < 66) return null;

    const cleanData = data.startsWith('0x') ? data.slice(2) : data;

    let amountHex: string;

    if (eventType === 'supply') {
      // Supply: data = user (32) + amount (32) = 128 hex chars
      // Amount is at bytes 32-64 (hex chars 64-128)
      if (cleanData.length >= 128) {
        amountHex = cleanData.slice(64, 128);
      } else {
        amountHex = cleanData.slice(-64);
      }
    } else if (eventType === 'withdraw') {
      // Withdraw: data = user (32) + to (32) + amount (32) = 192 hex chars
      // Amount is at bytes 64-96 (hex chars 128-192)
      if (cleanData.length >= 192) {
        amountHex = cleanData.slice(128, 192);
      } else {
        amountHex = cleanData.slice(-64);
      }
    } else if (eventType === 'borrow') {
      // Borrow: data = user (32) + amount (32) + interestRateMode (32) + borrowRate (32)
      // Amount is at bytes 32-64 (hex chars 64-128)
      if (cleanData.length >= 128) {
        amountHex = cleanData.slice(64, 128);
      } else {
        amountHex = cleanData.slice(-64);
      }
    } else if (eventType === 'repay') {
      // Repay event: Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)
      // All addresses are indexed (in topics), so data = amount (32) + useATokens (32) = 128 hex chars
      // Amount is at bytes 0-32 (hex chars 0-64)
      if (cleanData.length >= 64) {
        amountHex = cleanData.slice(0, 64);
      } else {
        amountHex = cleanData;
      }
    } else {
      amountHex = cleanData.slice(-64);
    }

    const amount = BigInt('0x' + amountHex);

    const token = KNOWN_TOKENS[reserve.toLowerCase()];
    const decimals = token?.decimals || 18;

    console.log(`[Tydro] parseAmount: eventType=${eventType}, reserve=${reserve}, dataLen=${cleanData.length}, amountHex=${amountHex.slice(0, 16)}..., amount=${amount}, decimals=${decimals}`);

    return { amount, decimals };
  } catch (e) {
    console.error(`[Tydro] parseAmount error:`, e);
    return null;
  }
}

// Extract reserve address from event topics
function getReserveFromTopics(topics: string[]): string | null {
  // Reserve is typically topic[1] for Tydro events
  if (topics && topics.length > 1) {
    const reserveTopic = topics[1];
    // Extract address from topic (last 40 chars)
    return '0x' + reserveTopic.slice(-40).toLowerCase();
  }
  return null;
}

// Get token price in USD
async function getTokenPriceUsd(tokenAddress: string, ethPrice: number): Promise<number> {
  const addr = tokenAddress.toLowerCase();
  const token = KNOWN_TOKENS[addr];
  if (token?.usdPegged) return 1;
  if (token?.ethPegged) return ethPrice;
  if (token?.btcPegged) return await getBtcPrice();
  return ethPrice; // Default to ETH price for unknown tokens
}

// Parse a transaction's logs to extract Tydro action and amount
async function parseTydroTransaction(
  tx: EnrichedTx,
  ethPrice: number
): Promise<{ action: 'supply' | 'withdraw' | 'borrow' | 'repay'; amountUsd: number; amountEth: number; reserve: string } | null> {
  const methodId = tx.method_id?.toLowerCase();

  // Determine action type from method
  let action: 'supply' | 'withdraw' | 'borrow' | 'repay';
  let eventTopic: string;

  if (SUPPLY_METHODS.includes(methodId)) {
    action = 'supply';
    eventTopic = SUPPLY_EVENT_TOPIC;
  } else if (WITHDRAW_METHODS.includes(methodId)) {
    action = 'withdraw';
    eventTopic = WITHDRAW_EVENT_TOPIC;
  } else if (BORROW_METHODS.includes(methodId)) {
    action = 'borrow';
    eventTopic = BORROW_EVENT_TOPIC;
  } else if (REPAY_METHODS.includes(methodId)) {
    action = 'repay';
    eventTopic = REPAY_EVENT_TOPIC;
  } else {
    return null;
  }

  // For ETH deposit (depositETH), use tx value directly
  if (methodId === '0x474cf53d') {
    const valueWei = BigInt(tx.value || '0');
    const amountEth = Number(valueWei) / 1e18;
    const amountUsd = amountEth * ethPrice;
    return { action, amountUsd, amountEth, reserve: '0x4200000000000000000000000000000000000006' };
  }

  // For ETH repay (repayETH), use tx value directly
  if (methodId === '0xbcc3c255') {
    const valueWei = BigInt(tx.value || '0');
    const amountEth = Number(valueWei) / 1e18;
    const amountUsd = amountEth * ethPrice;
    console.log(`[Tydro] repayETH: rawValue=${tx.value}, valueWei=${valueWei}, amountEth=${amountEth}, amountUsd=${amountUsd}, ethPrice=${ethPrice}`);
    
    // If value is 0, try to get amount from Repay event in logs
    if (amountEth === 0 && tx.logs && Array.isArray(tx.logs)) {
      console.log(`[Tydro] repayETH value is 0, checking logs for Repay event...`);
      for (const log of tx.logs) {
        const topics = log.topics;
        if (!topics || topics.length === 0) continue;
        
        if (topics[0]?.toLowerCase() === REPAY_EVENT_TOPIC.toLowerCase()) {
          const reserve = getReserveFromTopics(topics);
          if (!reserve) continue;
          
          const parsed = parseAmountFromEventData(log.data || '', reserve, 'repay');
          if (!parsed) continue;
          
          const token = KNOWN_TOKENS[reserve];
          const tokenPrice = await getTokenPriceUsd(reserve, ethPrice);
          const amount = Number(parsed.amount) / Math.pow(10, parsed.decimals);
          const amountUsdFromLog = amount * tokenPrice;
          const amountEthFromLog = token?.ethPegged ? amount : 0;
          
          console.log(`[Tydro] repayETH from log: amount=${amount}, usd=${amountUsdFromLog}`);
          return { action, amountUsd: amountUsdFromLog, amountEth: amountEthFromLog, reserve };
        }
      }
    }
    
    return { action, amountUsd, amountEth, reserve: '0x4200000000000000000000000000000000000006' };
  }

  // For ETH borrow (borrowETH) and withdraw (withdrawETH), amount is in logs, not tx value
  // These functions don't send ETH, they receive it

  // Parse logs to find the relevant event
  if (!tx.logs || !Array.isArray(tx.logs)) return null;

  for (const log of tx.logs) {
    const topics = log.topics;
    if (!topics || topics.length === 0) continue;

    // Check if this is the event we're looking for
    if (topics[0]?.toLowerCase() === eventTopic.toLowerCase()) {
      const reserve = getReserveFromTopics(topics);
      if (!reserve) continue;

      const parsed = parseAmountFromEventData(log.data || '', reserve, action);
      if (!parsed) continue;

      const token = KNOWN_TOKENS[reserve];
      const tokenPrice = await getTokenPriceUsd(reserve, ethPrice);
      const amount = Number(parsed.amount) / Math.pow(10, parsed.decimals);
      const amountUsd = amount * tokenPrice;
      const amountEth = token?.ethPegged ? amount : 0;

      return { action, amountUsd, amountEth, reserve };
    }
  }

  // Fallback: try to find Supply/Withdraw event by name in logs
  for (const log of tx.logs) {
    const eventName = log.event?.toLowerCase() || '';

    if (action === 'supply' && eventName.includes('supply')) {
      const reserve = getReserveFromTopics(log.topics || []);
      if (!reserve) continue;

      const parsed = parseAmountFromEventData(log.data || '', reserve, 'supply');
      if (!parsed) continue;

      const token = KNOWN_TOKENS[reserve];
      const tokenPrice = await getTokenPriceUsd(reserve, ethPrice);
      const amount = Number(parsed.amount) / Math.pow(10, parsed.decimals);
      const amountUsd = amount * tokenPrice;
      const amountEth = token?.ethPegged ? amount : 0;

      return { action, amountUsd, amountEth, reserve };
    }

    if (action === 'withdraw' && eventName.includes('withdraw')) {
      const reserve = getReserveFromTopics(log.topics || []);
      if (!reserve) continue;

      const parsed = parseAmountFromEventData(log.data || '', reserve, 'withdraw');
      if (!parsed) continue;

      const token = KNOWN_TOKENS[reserve];
      const tokenPrice = await getTokenPriceUsd(reserve, ethPrice);
      const amount = Number(parsed.amount) / Math.pow(10, parsed.decimals);
      const amountUsd = amount * tokenPrice;
      const amountEth = token?.ethPegged ? amount : 0;

      return { action, amountUsd, amountEth, reserve };
    }

    if (action === 'borrow' && eventName.includes('borrow')) {
      const reserve = getReserveFromTopics(log.topics || []);
      if (!reserve) continue;

      const parsed = parseAmountFromEventData(log.data || '', reserve, 'borrow');
      if (!parsed) continue;

      const token = KNOWN_TOKENS[reserve];
      const tokenPrice = await getTokenPriceUsd(reserve, ethPrice);
      const amount = Number(parsed.amount) / Math.pow(10, parsed.decimals);
      const amountUsd = amount * tokenPrice;
      const amountEth = token?.ethPegged ? amount : 0;

      return { action, amountUsd, amountEth, reserve };
    }

    if (action === 'repay' && eventName.includes('repay')) {
      const reserve = getReserveFromTopics(log.topics || []);
      if (!reserve) continue;

      const parsed = parseAmountFromEventData(log.data || '', reserve, 'repay');
      if (!parsed) continue;

      const token = KNOWN_TOKENS[reserve];
      const tokenPrice = await getTokenPriceUsd(reserve, ethPrice);
      const amount = Number(parsed.amount) / Math.pow(10, parsed.decimals);
      const amountUsd = amount * tokenPrice;
      const amountEth = token?.ethPegged ? amount : 0;

      return { action, amountUsd, amountEth, reserve };
    }
  }

  return null;
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
    const allMethods = [...SUPPLY_METHODS, ...WITHDRAW_METHODS, ...BORROW_METHODS, ...REPAY_METHODS];

    // Query from transaction_enrichment table (case-insensitive address matching)
    const txs = await query<EnrichedTx>(`
      SELECT 
        tx_hash,
        method_id,
        value,
        logs
      FROM transaction_enrichment
      WHERE LOWER(wallet_address) = LOWER($1)
        AND LOWER(contract_address) = ANY($2)
        AND method_id = ANY($3)
      ORDER BY created_at ASC
    `, [wallet, TYDRO_CONTRACTS, allMethods]);

    console.log(`[Tydro] Found ${txs.length} transactions for wallet ${wallet}`);

    // Track per-reserve balances for current position calculation
    const supplyBalances: Map<string, number> = new Map();
    const borrowBalances: Map<string, number> = new Map();

    // Aggregate metrics
    let totalDepositedUsd = 0, totalDepositedEth = 0;
    let totalWithdrawnUsd = 0, totalWithdrawnEth = 0;
    let totalBorrowedUsd = 0, totalBorrowedEth = 0;
    let totalRepaidUsd = 0, totalRepaidEth = 0;
    let depositCount = 0, withdrawCount = 0, borrowCount = 0, repayCount = 0;

    for (const tx of txs) {
      const parsed = await parseTydroTransaction(tx, ethPrice);
      if (!parsed) {
        console.log(`[Tydro] Failed to parse tx ${tx.tx_hash}, method: ${tx.method_id}, value: ${tx.value}, logs: ${tx.logs ? 'present' : 'null'}`);
        continue;
      }

      console.log(`[Tydro] Parsed tx ${tx.tx_hash}: action=${parsed.action}, usd=${parsed.amountUsd}, eth=${parsed.amountEth}`);

      const { action, amountUsd, amountEth, reserve } = parsed;

      switch (action) {
        case 'supply':
          depositCount++;
          totalDepositedUsd += amountUsd;
          totalDepositedEth += amountEth;
          supplyBalances.set(reserve, (supplyBalances.get(reserve) || 0) + amountUsd);
          break;
        case 'withdraw':
          withdrawCount++;
          totalWithdrawnUsd += amountUsd;
          totalWithdrawnEth += amountEth;
          supplyBalances.set(reserve, Math.max(0, (supplyBalances.get(reserve) || 0) - amountUsd));
          break;
        case 'borrow':
          borrowCount++;
          totalBorrowedUsd += amountUsd;
          totalBorrowedEth += amountEth;
          borrowBalances.set(reserve, (borrowBalances.get(reserve) || 0) + amountUsd);
          break;
        case 'repay':
          repayCount++;
          totalRepaidUsd += amountUsd;
          totalRepaidEth += amountEth;
          borrowBalances.set(reserve, Math.max(0, (borrowBalances.get(reserve) || 0) - amountUsd));
          break;
      }
    }

    // Calculate current positions
    let currentSupplyUsd = 0, currentSupplyEth = 0;
    let currentBorrowUsd = 0, currentBorrowEth = 0;

    for (const [reserve, balance] of supplyBalances) {
      if (balance > 0) {
        currentSupplyUsd += balance;
        if (KNOWN_TOKENS[reserve]?.ethPegged) {
          currentSupplyEth += balance / ethPrice;
        }
      }
    }

    for (const [reserve, balance] of borrowBalances) {
      if (balance > 0) {
        currentBorrowUsd += balance;
        if (KNOWN_TOKENS[reserve]?.ethPegged) {
          currentBorrowEth += balance / ethPrice;
        }
      }
    }

    const response: TydroResponse = {
      currentSupplyUsd,
      currentSupplyEth,
      totalDepositedUsd,
      totalDepositedEth,
      totalWithdrawnUsd,
      totalWithdrawnEth,
      depositCount,
      withdrawCount,
      currentBorrowUsd,
      currentBorrowEth,
      totalBorrowedUsd,
      totalBorrowedEth,
      totalRepaidUsd,
      totalRepaidEth,
      borrowCount,
      repayCount,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching Tydro data:', error);
    return NextResponse.json({ error: 'Failed to fetch Tydro data' }, { status: 500 });
  }
}
