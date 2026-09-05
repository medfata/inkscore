import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolCount } from './blockscout-service';

// NFT2Me contract addresses
const NFT2ME_CONTRACTS = {
    FACTORY: '0x00000000001594c61dd8a6804da9ab58ed2483ce',
    MINTER: '0x00000000009a1e02f00e280dcfa4c81c55724212',
};

const TRACKED_FUNCTIONS = {
    CREATE_COLLECTION: 'createCollectionN2M_000oEFvt',
    MINT: 'mint',
};

// NFT2Me counts are append-only (same rationale as Tydro long cache).
const NFT2ME_LONG_CACHE_TTL = 5 * 60 * 1000;

export interface Nft2MeResponse {
    collectionsCreated: number;
    nftsMinted: number;
    totalTransactions: number;
}

export async function getNft2meData(walletAddress: string): Promise<Nft2MeResponse> {
    const lcKey = 'long:wallet:nft2me:' + walletAddress;

    const nft2meLc = getLongCache<Nft2MeResponse>(lcKey, NFT2ME_LONG_CACHE_TTL);
    if (nft2meLc) {
        return nft2meLc;
    }

    return withInflight<Nft2MeResponse>(lcKey, async () => {
        const factoryLower = NFT2ME_CONTRACTS.FACTORY.toLowerCase();
        const minterLower = NFT2ME_CONTRACTS.MINTER.toLowerCase();

        // Counts via Blockscout (method names resolved per tx; sets are tiny).
        const [createdRes, mintedRes] = await Promise.all([
            getProtocolCount(
                walletAddress, 'nft2me-created', factoryLower, null,
                [TRACKED_FUNCTIONS.CREATE_COLLECTION]
            ),
            getProtocolCount(
                walletAddress, 'nft2me-minted', minterLower, null,
                [TRACKED_FUNCTIONS.MINT]
            ),
        ]);
        const collectionsCreated = createdRes.count;
        const nftsMinted = mintedRes.count;

        const response: Nft2MeResponse = {
            collectionsCreated,
            nftsMinted,
            totalTransactions: collectionsCreated + nftsMinted,
        };

        setLongCache(lcKey, response);

        return response;
    });
}
