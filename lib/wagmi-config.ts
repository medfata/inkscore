import { http, createConfig, createStorage, cookieStorage } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';

// Get your projectId from https://cloud.walletconnect.com
export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Ink Chain configuration
export const inkChain = {
  id: 57073,
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
} as const;

export const config = createConfig({
  chains: [inkChain],
  connectors: [
    injected(),
    walletConnect({
      projectId,
      showQrModal: true, // This enables the official WalletConnect modal
      metadata: {
        name: 'INKSCORE',
        description: 'On-Chain Reputation Score for InkChain',
        url: typeof window !== 'undefined' ? window.location.origin : '',
        icons: [],
      },
    }),
  ],
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  transports: {
    [inkChain.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
