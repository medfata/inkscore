"use client";

import React, { useState, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { NFT_CONTRACT_ADDRESS, NFT_CONTRACT_ABI } from '@/lib/nft-contract';
import { Sparkles, Loader2, CheckCircle, AlertCircle, ExternalLink } from './Icons';
import { MintSuccessModal } from './MintSuccessModal';

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
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [nftImageUrl, setNftImageUrl] = useState<string>('');
  const [isLoadingImage, setIsLoadingImage] = useState(false);

  // Check if wallet already has an NFT
  const { data: hasNFTData } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: NFT_CONTRACT_ABI,
    functionName: 'hasNFT',
    args: [walletAddress as `0x${string}`],
  });

  const hasExistingNFT = hasNFTData?.[0] ?? false;
  const existingTokenId = hasNFTData?.[1] ?? BigInt(0);

  // Read the current mint price from contract
  const { data: mintPrice } = useReadContract({
    address: NFT_CONTRACT_ADDRESS,
    abi: NFT_CONTRACT_ABI,
    functionName: 'mintPrice',
  });

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
    const fetchNFTImage = async () => {
      if (isConfirmed && txHash) {

        setMintState('success');
        setIsLoadingImage(true);
        setShowSuccessModal(true); // Show modal immediately with loading state

        const MAX_RETRIES = 10;
        const RETRY_DELAY = 2000; // 2 seconds between retries

        try {
          // Get the token ID for this wallet
          const tokenId = hasExistingNFT ? existingTokenId.toString() : '1';

          let retryCount = 0;
          let imageFound = false;

          while (retryCount < MAX_RETRIES && !imageFound) {
            const metadataUrl = `/api/nft/metadata/${tokenId}`;

            try {
              const metadataResponse = await fetch(metadataUrl);

              if (metadataResponse.ok) {
                const metadata = await metadataResponse.json();
                if (metadata.image) {
                  setNftImageUrl(metadata.image);
                  setIsLoadingImage(false);
                  imageFound = true;
                  break;
                }
              } else {
                const errorText = await metadataResponse.text();
              }
            } catch (fetchError) {
              console.error(`[MintScoreNFT] Attempt ${retryCount + 1} error:`, fetchError);
            }

            retryCount++;

            if (retryCount < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
          }

          // If we exhausted all retries, use fallback
          if (!imageFound) {
            setNftImageUrl(generateFallbackImage());
            setIsLoadingImage(false);
          }
        } catch (error) {
          console.error('[MintScoreNFT] Error fetching NFT image:', error);
          console.log('[MintScoreNFT] Using fallback image');
          setNftImageUrl(generateFallbackImage());
          setIsLoadingImage(false);
        }
      }
    };

    const generateFallbackImage = () => {
      const svg = `
        <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
          <rect width="400" height="400" fill="#1e293b"/>
          <text x="200" y="180" font-family="Arial" font-size="48" fill="#a855f7" text-anchor="middle" font-weight="bold">${currentScore}</text>
          <text x="200" y="220" font-family="Arial" font-size="20" fill="#94a3b8" text-anchor="middle">${currentRank}</text>
          <text x="200" y="260" font-family="Arial" font-size="16" fill="#64748b" text-anchor="middle">InkScore NFT</text>
        </svg>
      `;
      const base64 = btoa(svg);
      console.log('[MintScoreNFT] Generated fallback image, base64 length:', base64.length);
      return `data:image/svg+xml;base64,${base64}`;
    };

    fetchNFTImage();
  }, [isConfirmed, txHash, walletAddress, currentScore, currentRank, hasExistingNFT, existingTokenId]);

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

      // Call contract mint function with value
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
        value: mintPrice || BigInt(0), // Send the mint price as value
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

  const handleCloseModal = () => {
    setShowSuccessModal(false);
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
    <>
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
        {mintState === 'success' && txHash && !showSuccessModal && (
          <div className="mt-2 flex items-center justify-center gap-2">
            <button
              onClick={() => setShowSuccessModal(true)}
              className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
            >
              View NFT
            </button>
            <span className="text-slate-600">•</span>
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

      {/* Success Modal */}
      <MintSuccessModal
        isOpen={showSuccessModal}
        onClose={handleCloseModal}
        nftImageUrl={nftImageUrl}
        txHash={txHash}
        walletAddress={walletAddress}
        score={currentScore}
        rank={currentRank}
        isLoadingImage={isLoadingImage}
      />
    </>
  );
};
