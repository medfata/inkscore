"use client";

import React, { useState, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { NFT_CONTRACT_ADDRESS, NFT_CONTRACT_ABI } from '@/lib/nft-contract';
import { Sparkles, Loader2, CheckCircle, AlertCircle, ExternalLink } from './Icons';

interface MintScoreNFTProps {
  walletAddress: string;
  currentScore: number;
  currentRank: string;
  rankColor: string;
}

type MintState = 'idle' | 'authorizing' | 'confirming' | 'minting' | 'success' | 'error';

interface AuthorizationResponse {
  signature: string;
  score: number;
  rank: string;
  expiry: number;
  walletAddress: string;
}

export const MintScoreNFT: React.FC<MintScoreNFTProps> = ({
  walletAddress,
  currentScore,
  currentRank,
  rankColor,
}) => {
  const [mintState, setMintState] = useState<MintState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [showTooltip, setShowTooltip] = useState(false);

  // Check if wallet already has an NFT
  const { data: hasNFTData } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: NFT_CONTRACT_ABI,
    functionName: 'hasNFT',
    args: [walletAddress as `0x${string}`],
  });

  const hasExistingNFT = hasNFTData?.[0] ?? false;
  const existingTokenId = hasNFTData?.[1] ?? BigInt(0);

  // Contract write hook
  const { writeContract, data: writeData, error: writeError, isPending: isWritePending } = useWriteContract();

  // Wait for transaction receipt
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: writeData,
  });

  // Handle transaction state changes
  useEffect(() => {
    if (writeData) {
      setTxHash(writeData);
      setMintState('minting');
    }
  }, [writeData]);

  useEffect(() => {
    if (isConfirmed) {
      setMintState('success');
    }
  }, [isConfirmed]);

  useEffect(() => {
    if (writeError) {
      setMintState('error');
      setErrorMessage(writeError.message.includes('User rejected')
        ? 'Transaction cancelled'
        : 'Transaction failed. Please try again.');
    }
  }, [writeError]);

  const handleMint = async () => {
    try {
      setMintState('authorizing');
      setErrorMessage('');

      // Get authorization from backend
      const response = await fetch('/api/nft/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get authorization');
      }

      const auth: AuthorizationResponse = await response.json();

      setMintState('confirming');

      // Call contract mint function
      writeContract({
        address: NFT_CONTRACT_ADDRESS,
        abi: NFT_CONTRACT_ABI,
        functionName: 'mint',
        args: [
          BigInt(auth.score),
          auth.rank,
          BigInt(auth.expiry),
          auth.signature as `0x${string}`,
        ],
      });
    } catch (error) {
      setMintState('error');
      setErrorMessage(error instanceof Error ? error.message : 'An error occurred');
    }
  };

  const handleRetry = () => {
    setMintState('idle');
    setErrorMessage('');
    setTxHash('');
  };

  const getButtonContent = () => {
    switch (mintState) {
      case 'authorizing':
        return (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span>Authorizing...</span>
          </>
        );
      case 'confirming':
        return (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span>Confirm in Wallet</span>
          </>
        );
      case 'minting':
        return (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span>Minting...</span>
          </>
        );
      case 'success':
        return (
          <>
            <CheckCircle size={16} />
            <span>Minted!</span>
          </>
        );
      case 'error':
        return (
          <>
            <AlertCircle size={16} />
            <span>Retry</span>
          </>
        );
      default:
        return (
          <>
            <Sparkles size={16} />
            <span>{hasExistingNFT ? 'Update NFT' : 'Mint Score NFT'}</span>
          </>
        );
    }
  };

  const isDisabled = mintState === 'authorizing' || mintState === 'confirming' || mintState === 'minting';

  return (
    <div className="relative mt-4">
      {/* Main Button */}
      <button
        onClick={mintState === 'error' ? handleRetry : handleMint}
        disabled={isDisabled}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`
          w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
          font-medium text-sm transition-all duration-200
          ${mintState === 'success'
            ? 'bg-green-500/20 border border-green-500/40 text-green-400'
            : mintState === 'error'
              ? 'bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30'
              : isDisabled
                ? 'bg-slate-700/50 border border-slate-600/50 text-slate-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-ink-purple/80 to-ink-blue/80 border border-purple-500/30 text-white hover:from-ink-purple hover:to-ink-blue hover:shadow-lg hover:shadow-purple-500/20'
          }
        `}
      >
        {getButtonContent()}
      </button>

      {/* Tooltip */}
      {showTooltip && mintState === 'idle' && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 whitespace-nowrap z-50 shadow-xl">
          {hasExistingNFT
            ? 'Update your NFT with your current score'
            : 'Mint an NFT that displays your score'}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
        </div>
      )}

      {/* Error Message */}
      {mintState === 'error' && errorMessage && (
        <p className="mt-2 text-xs text-red-400 text-center">{errorMessage}</p>
      )}

      {/* Success Message with Link */}
      {mintState === 'success' && txHash && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <a
            href={`https://explorer.inkonchain.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
          >
            View Transaction
            <ExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  );
};
