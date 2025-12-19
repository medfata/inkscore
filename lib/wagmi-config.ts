import { http, createConfig, createStorage, cookieStorage } from 'wagmi';
import { injected } from 'wagmi/connectors';

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
