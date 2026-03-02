// Sweep.haus NFT Collection Deployment Service
// Tracks NFT collections deployed by wallet addresses on Sweep platform

import { createPublicClient, http, defineChain } from 'viem';

const SWEEP_API_BASE = 'https://api.sweep.haus/api';
const SWEEP_BASE_URL = 'https://sweep.haus';

const SWEEP_BADGE_CONTRACT = '0xb6f046A449f3112ccaC7Ed0dd69bC65D12c4509c';
const SWEEP_BADGE_TOKEN_ID = 0n;

const RPC_URL = 'https://rpc-qnd.inkonchain.com';

const inkChain = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'Routescan', url: 'https://explorer.inkonchain.com' },
  },
});

const publicClient = createPublicClient({
  chain: inkChain,
  transport: http(RPC_URL),
});

const ERC1155_BALANCE_OF_ABI = [
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' }
    ],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Initial token (will be updated if it expires)
let SWEEP_BEARER_TOKEN = '06842b8891417d34590ee613b9750b2db4197e092b419ef066aea97734ca62c1fcd6173f94cc7e47d5d306b379f680024158e8cebfe4783ed848b66c663ec07e74dd9c7973969bd0cefb462c7b93bc56b5902dba7c5c8c5beb0fd461746fb0c6016ca0f8ed4dff41ab8adb7e0ac5050470a7be49daaf2aed19ba1d3e2644c732';

interface SweepCollection {
  id: number;
  documentId: string;
  name: string;
  CollectionURL: string;
  NFTCollectionContractAddress: string;
  contractDeployer: string | null;
  deploymentDate: string | null;
  deploymentTxHash: string | null;
  createdAt: string;
  isDeployedByPlatform: boolean | null;
}

interface SweepApiResponse {
  data: SweepCollection[];
  meta: {
    pagination: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

export interface SweepMetrics {
  totalCollections: number;
  sweepBadgeBalance: number;
}

// Simple in-memory cache (5 minute TTL)
const cache = new Map<string, { data: SweepMetrics; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class SweepService {
  // Extract all chunk file URLs from Sweep's main page
  private async getChunkUrls(): Promise<string[]> {
    try {
      const response = await fetch(SWEEP_BASE_URL);
      if (!response.ok) {
        console.error(`Failed to fetch Sweep homepage: ${response.status}`);
        return [];
      }

      const html = await response.text();
      
      // Extract all chunk URLs from the HTML
      // Pattern: /_next/static/chunks/[hash].js
      const chunkMatches = html.matchAll(/\/_next\/static\/chunks\/([a-f0-9]+)\.js/g);
      const chunkUrls = Array.from(chunkMatches, match => `${SWEEP_BASE_URL}${match[0]}`);
      
      // Remove duplicates
      return [...new Set(chunkUrls)];
    } catch (error) {
      console.error('Error fetching chunk URLs:', error);
      return [];
    }
  }

  // Search through chunks to find the Bearer token
  private async searchChunksForToken(chunkUrls: string[]): Promise<string | null> {
    console.log(`Searching through ${chunkUrls.length} chunk files for Bearer token...`);
    
    // Search chunks in parallel (batches of 10 to avoid overwhelming the server)
    const batchSize = 10;
    for (let i = 0; i < chunkUrls.length; i += batchSize) {
      const batch = chunkUrls.slice(i, i + batchSize);
      
      const results = await Promise.all(
        batch.map(async (url) => {
          try {
            const response = await fetch(url);
            if (!response.ok) return null;
            
            const content = await response.text();
            
            // Look for: Authorization: "Bearer <token>"
            const bearerMatch = content.match(/Authorization:\s*["']Bearer\s+([a-f0-9]{256})["']/i);
            
            if (bearerMatch && bearerMatch[1]) {
              console.log(`✅ Found Bearer token in chunk: ${url.split('/').pop()}`);
              return bearerMatch[1];
            }
            
            return null;
          } catch (error) {
            return null;
          }
        })
      );
      
      // Return the first token found
      const token = results.find(t => t !== null);
      if (token) {
        return token;
      }
    }
    
    console.error('Could not find Bearer token in any chunk file');
    return null;
  }

  // Fetch fresh Bearer token from Sweep's JavaScript chunks
  private async fetchFreshToken(): Promise<string | null> {
    try {
      console.log('Fetching fresh Sweep Bearer token from JS chunks...');
      
      // Step 1: Get all chunk URLs from the main page
      const chunkUrls = await this.getChunkUrls();
      
      if (chunkUrls.length === 0) {
        console.error('No chunk URLs found');
        return null;
      }
      
      console.log(`Found ${chunkUrls.length} chunk files to search`);
      
      // Step 2: Search through chunks for the Bearer token
      const newToken = await this.searchChunksForToken(chunkUrls);
      
      if (newToken) {
        console.log('Successfully extracted fresh Sweep Bearer token');
        SWEEP_BEARER_TOKEN = newToken; // Update global token
        return newToken;
      }

      return null;
    } catch (error) {
      console.error('Error fetching fresh Sweep token:', error);
      return null;
    }
  }

  // Get NFT collections deployed by a wallet address
  async getDeployedCollections(walletAddress: string): Promise<SweepMetrics> {
    const wallet = walletAddress.toLowerCase();

    // Check cache
    const cached = cache.get(wallet);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    try {
      // Query Sweep API for collections deployed by this wallet
      // We only need the total count, so use pageSize=1 to minimize data transfer
      const url = `${SWEEP_API_BASE}/nft-collections?filters[contractDeployer][$containsi]=${wallet}&pagination[pageSize]=1`;
      
      let response = await fetch(url, {
        headers: {
          'accept': '*/*',
          'authorization': `Bearer ${SWEEP_BEARER_TOKEN}`,
          'content-type': 'application/json',
        },
      });

      // If we get 401 or 403, try to fetch a fresh token and retry
      if (response.status === 401 || response.status === 403) {
        console.warn(`Sweep API returned ${response.status}, attempting to fetch fresh token...`);
        
        const freshToken = await this.fetchFreshToken();
        
        if (freshToken) {
          console.log('Retrying Sweep API with fresh token...');
          response = await fetch(url, {
            headers: {
              'accept': '*/*',
              'authorization': `Bearer ${freshToken}`,
              'content-type': 'application/json',
            },
          });
        }
      }

      if (!response.ok) {
        console.error(`Sweep API error: ${response.status} ${response.statusText}`);
        return { totalCollections: 0, sweepBadgeBalance: 0 };
      }

      const data = await response.json() as SweepApiResponse;

      const sweepBadgeBalance = await this.getSweepBadgeBalance(wallet);

      const metrics: SweepMetrics = {
        totalCollections: data.meta.pagination.total,
        sweepBadgeBalance,
      };

      // Cache the result
      cache.set(wallet, { data: metrics, timestamp: Date.now() });

      return metrics;
    } catch (error) {
      console.error('Failed to fetch Sweep collections:', error);
      return { totalCollections: 0, sweepBadgeBalance: 0 };
    }
  }

  private async getSweepBadgeBalance(walletAddress: string): Promise<number> {
    try {
      const balance = await publicClient.readContract({
        address: SWEEP_BADGE_CONTRACT as `0x${string}`,
        abi: ERC1155_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`, SWEEP_BADGE_TOKEN_ID],
      });
      return Number(balance);
    } catch (error) {
      console.error('Failed to fetch Sweep badge balance:', error);
      return 0;
    }
  }
}

export const sweepService = new SweepService();
