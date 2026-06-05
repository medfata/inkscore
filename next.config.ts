import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server bundle for self-hosted Docker (Hetzner)
  output: 'standalone',
  // Single next/image usage; skip server-side optimization (no sharp dependency)
  images: { unoptimized: true },
  // Empty turbopack config to silence the warning (webpack config kept for Vercel builds)
  turbopack: {},
  // Exclude server-only packages from client bundle
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        worker_threads: false,
      };
    }
    
    // Handle optional wagmi connector dependencies
    config.resolve.alias = {
      ...config.resolve.alias,
      '@base-org/account': false,
      '@coinbase/wallet-sdk': false,
      '@gemini-wallet/core': false,
      '@metamask/sdk': false,
      '@safe-global/safe-apps-sdk': false,
      '@safe-global/safe-apps-provider': false,
      'porto': false,
    };
    
    return config;
  },
};

export default nextConfig;
