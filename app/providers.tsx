'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, type Config } from 'wagmi';
import { createAppKit } from '@reown/appkit/react';
import { wagmiAdapter, projectId, networks, inkChain } from '@/lib/wagmi-config';
import { useState, type ReactNode } from 'react';

// Set up metadata for AppKit
const metadata = {
  name: 'INKSCORE',
  description: 'On-Chain Reputation Score for InkChain',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://inkscore.app',
  icons: ['https://inkscore.app/icon.png'],
};

// Create the AppKit modal
createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [inkChain],
  defaultNetwork: inkChain,
  metadata,
  features: {
    analytics: true,
    email: false,
    socials: false,
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#7c3aed',
    '--w3m-border-radius-master': '12px',
  },
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
