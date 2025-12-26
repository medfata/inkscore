import { NextRequest, NextResponse } from 'next/server';
import { assetsService } from '@/lib/services/assets-service';

const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = 'https://cdn-canary.routescan.io/api';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

// GET /api/admin/assets/debug?wallet=0x...
// Debug endpoint to check token holdings matching
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json({ error: 'Missing wallet parameter' }, { status: 400 });
    }

    // 1. Get all tokens from DB
    const dbTokens = await assetsService.getAllTokens();
    
    // 2. Fetch holdings from Routescan
    const holdingsUrl = `${ROUTESCAN_BASE_URL}/evm/all/address/${wallet}/erc20-holdings?includedChainIds=${INK_CHAIN_ID}&limit=500`;
    const holdingsRes = await fetch(holdingsUrl);
    const holdingsData = await holdingsRes.json();

    // 3. Build a map of holdings
    const holdingsMap = new Map<string, {
      tokenAddress: string;
      holderBalance: string;
      valueInUsd: number;
      decimals: number;
    }>();

    if (holdingsData.items) {
      for (const item of holdingsData.items) {
        holdingsMap.set(item.tokenAddress.toLowerCase(), {
          tokenAddress: item.tokenAddress,
          holderBalance: item.holderBalance,
          valueInUsd: item.valueInUsd || 0,
          decimals: item.token?.decimals || 18,
        });
      }
    }

    // 4. Fetch DexScreener prices for tokens without USD value
    const tokensNeedingPrices = dbTokens.filter((token) => {
      const holding = holdingsMap.get(token.address.toLowerCase());
      return holding && parseFloat(holding.holderBalance) > 0 && holding.valueInUsd === 0;
    });

    let dexPrices: Record<string, number> = {};
    if (tokensNeedingPrices.length > 0) {
      const addresses = tokensNeedingPrices.map((t) => t.address).join(',');
      try {
        const dexRes = await fetch(`${DEXSCREENER_API}/${addresses}`);
        const dexData = await dexRes.json();
        
        if (dexData.pairs && Array.isArray(dexData.pairs)) {
          for (const pair of dexData.pairs) {
            if (pair.chainId === 'ink') {
              const addr = pair.baseToken?.address?.toLowerCase();
              const price = parseFloat(pair.priceUsd || '0');
              if (addr && price > 0) {
                dexPrices[addr] = price;
              }
            }
          }
        }
      } catch (e) {
        console.error('DexScreener fetch error:', e);
      }
    }

    // 5. Match DB tokens with holdings
    const results = dbTokens.map((token) => {
      const holding = holdingsMap.get(token.address.toLowerCase());
      const rawBalance = holding?.holderBalance || '0';
      const decimals = holding?.decimals || token.decimals;
      const balance = parseFloat(rawBalance) / Math.pow(10, decimals);
      const dexPrice = dexPrices[token.address.toLowerCase()] || null;
      const calculatedUsd = dexPrice ? balance * dexPrice : 0;

      return {
        db_token: {
          name: token.name,
          symbol: token.symbol,
          address: token.address,
          decimals: token.decimals,
          asset_type: token.asset_type,
        },
        routescan_holding: holding ? {
          tokenAddress: holding.tokenAddress,
          holderBalance: holding.holderBalance,
          valueInUsd: holding.valueInUsd,
          decimals: holding.decimals,
        } : null,
        dexscreener_price: dexPrice,
        calculated: {
          rawBalance,
          decimalsUsed: decimals,
          balance,
          routescanUsd: holding?.valueInUsd || 0,
          dexscreenerUsd: calculatedUsd,
          finalUsd: holding?.valueInUsd || calculatedUsd,
        },
        matched: !!holding,
      };
    });

    // 6. Also show unmatched holdings (tokens in wallet but not in DB)
    const dbAddresses = new Set(dbTokens.map(t => t.address.toLowerCase()));
    const unmatchedHoldings = Array.from(holdingsMap.entries())
      .filter(([addr]) => !dbAddresses.has(addr))
      .map(([addr, holding]) => ({
        address: addr,
        ...holding,
      }));

    return NextResponse.json({
      db_tokens_count: dbTokens.length,
      routescan_holdings_count: holdingsMap.size,
      dexscreener_prices: dexPrices,
      matched_tokens: results.filter(r => r.matched),
      unmatched_db_tokens: results.filter(r => !r.matched),
      unmatched_holdings: unmatchedHoldings,
    });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
