import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack for builds (use Webpack instead)
  // This fixes issues with pino/thread-stream bundling
  turbopack: false,
  
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
    return config;
  },
};

export default nextConfig;
