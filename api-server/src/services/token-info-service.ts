// DeFi Llama token info (price / decimals / symbol) with a 2h cache per token.
//
// Extracted verbatim from backup_wallet.ts so bridge, swap, and analytics
// share ONE cache instead of two diverging copies (dedup item from Sprint 1).
// analytics.ts still has its own copy — switch it to this service next.

export interface TokenInfo {
    decimals: number;
    symbol: string;
    price: number;
    timestamp: number;
    confidence: number;
}

// Cache for token info (price, decimals, symbol, etc.)
const tokenInfoCache: Record<string, { data: TokenInfo; cachedAt: number }> = {};
const TOKEN_INFO_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

// Fallback token info when API doesn't have the token
const FALLBACK_TOKEN_INFO: TokenInfo = {
    decimals: 18,
    symbol: 'UNKNOWN',
    price: 0.00001,
    timestamp: 0,
    confidence: 0
};

/**
 * Get token info (price, decimals, symbol) from DeFi Llama API
 * Uses 2-hour cache per token
 * Fallback: 18 decimals, $0.0015 price
 */
export async function getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const cacheKey = tokenAddress.toLowerCase();

    // Check cache first
    const cached = tokenInfoCache[cacheKey];
    if (cached && Date.now() - cached.cachedAt < TOKEN_INFO_CACHE_TTL) {
        return cached.data;
    }

    try {
        // Use DeFi Llama API for Ink Chain
        const llamaUrl = `https://coins.llama.fi/prices/current/ink:${tokenAddress}`;
        const response = await fetch(llamaUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(3000) });

        if (response.ok) {
            const data: any = await response.json();
            const coinKey = `ink:${tokenAddress}`;
            if (data && data.coins && data.coins[coinKey]) {
                const coin = data.coins[coinKey];
                const tokenInfo: TokenInfo = {
                    decimals: coin.decimals ?? 18,
                    symbol: coin.symbol ?? 'UNKNOWN',
                    price: coin.price ?? 0.0015,
                    timestamp: coin.timestamp ?? 0,
                    confidence: coin.confidence ?? 0
                };
                tokenInfoCache[cacheKey] = { data: tokenInfo, cachedAt: Date.now() };
                return tokenInfo;
            }
        }

        // Token not found in API - use fallback
        tokenInfoCache[cacheKey] = { data: FALLBACK_TOKEN_INFO, cachedAt: Date.now() };
        return FALLBACK_TOKEN_INFO;
    } catch (error) {
        console.error(`[Token Info] Error fetching info for ${tokenAddress}:`, error);
    }

    // Fallback on error
    return FALLBACK_TOKEN_INFO;
}
