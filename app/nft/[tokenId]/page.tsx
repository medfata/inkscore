"use client";

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { Logo } from '../../components/Logo';
import { NFT_CONTRACT_ADDRESS } from '@/lib/nft-contract';

interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
  }>;
}

export default function NFTViewPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = use(params);
  const [metadata, setMetadata] = useState<NFTMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetadata() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/nft/metadata/${tokenId}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('NFT not found');
          }
          throw new Error('Failed to fetch NFT metadata');
        }
        
        const data = await response.json();
        setMetadata(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchMetadata();
  }, [tokenId]);

  return (
    <div className="bg-ink-950 min-h-screen text-slate-200 font-sans">
      {/* Header */}
      <nav className="border-b border-white/5 bg-ink-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="hover:opacity-90 transition-opacity">
            <Logo size="sm" />
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-ink-purple/30 border-t-ink-purple rounded-full animate-spin mb-4"></div>
            <p className="text-slate-400">Loading NFT...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-8 text-center max-w-md">
              <p className="text-red-400 text-lg mb-4">{error}</p>
              <Link 
                href="/"
                className="inline-block px-6 py-2 bg-ink-purple/20 hover:bg-ink-purple/30 border border-ink-purple/30 rounded-lg text-ink-purple transition-colors"
              >
                Go Home
              </Link>
            </div>
          </div>
        )}

        {metadata && (
          <div className="animate-fade-in-up">
            {/* NFT Card */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
              {/* Image */}
              <div className="aspect-square max-w-lg mx-auto p-8">
                <img 
                  src={metadata.image} 
                  alt={metadata.name}
                  className="w-full h-full object-contain rounded-xl"
                />
              </div>

              {/* Details */}
              <div className="p-8 border-t border-slate-800">
                <h1 className="text-3xl font-bold text-white mb-2">{metadata.name}</h1>
                <p className="text-slate-400 mb-6">{metadata.description}</p>

                {/* Attributes */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {metadata.attributes.map((attr, index) => (
                    <div 
                      key={index}
                      className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center"
                    >
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                        {attr.trait_type}
                      </p>
                      <p className="text-lg font-semibold text-white">
                        {attr.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Links */}
                <div className="flex gap-4">
                  <a
                    href={metadata.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center px-6 py-3 bg-ink-purple/20 hover:bg-ink-purple/30 border border-ink-purple/30 rounded-lg text-ink-purple transition-colors"
                  >
                    View Wallet Profile
                  </a>
                  <Link
                    href="/"
                    className="flex-1 text-center px-6 py-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 rounded-lg text-slate-300 transition-colors"
                  >
                    Back to Home
                  </Link>
                </div>
              </div>
            </div>

            {/* Contract Info */}
            <div className="mt-8 p-6 bg-slate-900/30 border border-slate-800 rounded-xl">
              <h3 className="text-sm font-medium text-slate-400 mb-3">Contract Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Token ID</span>
                  <span className="text-white font-mono">{tokenId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Contract</span>
                  <span className="text-white font-mono text-xs">{NFT_CONTRACT_ADDRESS}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Network</span>
                  <span className="text-white">Ink Chain</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
