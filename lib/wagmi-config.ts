import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { defineChain } from '@reown/appkit/networks';
import { http } from 'wagmi';

// Get your projectId from https://cloud.reown.com
export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Ink Chain configuration
export const inkChain = defineChain({
  id: 57073,
  caipNetworkId: 'eip155:57073',
  chainNamespace: 'eip155',
  name: 'Ink',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://rpc-gel.inkonchain.com'] },
  },
  blockExplorers: {
    default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' },
  },
});

export const networks = [inkChain] as const;

// Create Wagmi Adapter
export const wagmiAdapter = new WagmiAdapter({
  ssr: true,
  projectId,
  networks: [inkChain],
  // Keyless public RPC — keep the browser's request profile small:
  // - batch: collapse concurrent reads into a single JSON-RPC POST
  //   (viem defaults to one request per call, which rate-limits fast)
  // - retryCount 1: viem's default of 3 retries amplifies 429 storms
  transports: {
    [inkChain.id]: http('https://rpc-gel.inkonchain.com', {
      batch: { wait: 50 },
      retryCount: 1,
      timeout: 10_000,
    }),
  },
});

export const config = wagmiAdapter.wagmiConfig;
