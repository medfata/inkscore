import { createPublicClient, http } from 'viem';

// Singleton Viem client for Ink chain
let client: ReturnType<typeof createPublicClient> | null = null;

export function getInkPublicClient() {
  if (!client) {
    client = createPublicClient({
      chain: {
        id: 57073,
        name: 'Ink',
        network: 'ink',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: {
          default: { http: ['https://rpc-qnd.inkonchain.com'] },
          public: { http: ['https://rpc-qnd.inkonchain.com'] },
        },
      },
      transport: http('https://rpc-qnd.inkonchain.com'),
    });
  }
  return client;
}
