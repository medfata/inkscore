"use client";

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink } from './Icons';

interface MintSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  nftImageUrl: string;
  txHash: string;
  walletAddress: string;
  score: number;
  rank: string;
  isLoadingImage?: boolean;
}

export const MintSuccessModal: React.FC<MintSuccessModalProps> = ({
  isOpen,
  onClose,
  nftImageUrl,
  txHash,
  walletAddress,
  score,
  rank,
  isLoadingImage = false,
}) => {
  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'copying' | 'success' | 'error'>('idle');

  // Log modal props for debugging
  useEffect(() => {
    if (isOpen) {
      console.log('[MintSuccessModal] Modal opened with props:', {
        isOpen,
        hasNftImageUrl: !!nftImageUrl,
        nftImageUrlLength: nftImageUrl?.length,
        nftImageUrlPreview: nftImageUrl?.substring(0, 100),
        txHash,
        walletAddress,
        score,
        rank
      });
    }
  }, [isOpen, nftImageUrl, txHash, walletAddress, score, rank]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Create a better Twitter share message with the NFT metadata URL
  // Twitter will automatically fetch and display the image from Open Graph tags
  const twitterText = `🎉 Just minted my InkScore NFT on @Inkscore!\n\n📊 Score: ${score.toLocaleString()}\n🏆 Rank: ${rank}\n\nMint yours at inkscore.xyz`;

  const twitterShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}`;

  const explorerUrl = `https://explorer.inkonchain.com/tx/${txHash}`;

  // Function to download the NFT image
  const handleDownloadImage = () => {
    if (!nftImageUrl) return;

    const link = document.createElement('a');
    link.href = nftImageUrl;
    link.download = `inkscore-nft-${score}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Function to copy image to clipboard
  const handleCopyImage = async () => {
    if (!nftImageUrl) return;

    setCopyStatus('copying');

    try {
      // Convert SVG data URL to PNG blob for better clipboard compatibility
      const img = new Image();
      img.src = nftImageUrl;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // Create canvas and draw image
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 400;
      canvas.height = img.height || 400;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      ctx.drawImage(img, 0, 0);

      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });

      // Copy to clipboard
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);

      console.log('[MintSuccessModal] Image copied to clipboard');
      setCopyStatus('success');

      // Reset status after 2 seconds
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('[MintSuccessModal] Failed to copy image:', err);
      setCopyStatus('error');

      // Reset status after 2 seconds
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-fade-in-up">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg bg-slate-800/50 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors z-10"
        >
          <X size={20} />
        </button>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Success Header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 border-2 border-green-500/40 mb-4">
              <svg
                className="w-8 h-8 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-display font-bold text-white mb-2">
              NFT Minted Successfully!
            </h2>
            <p className="text-slate-400 text-sm">
              Your InkScore NFT has been minted on the Ink Chain
            </p>
          </div>

          {/* NFT Image */}
          <div className="relative rounded-xl overflow-hidden border-2 border-purple-500/30 shadow-lg shadow-purple-500/20 group">
            {isLoadingImage ? (
              <div className="w-full aspect-square bg-slate-800/50 flex flex-col items-center justify-center">
                <div className="relative w-16 h-16 mb-4">
                  <div className="w-16 h-16 border-4 border-purple-500/20 rounded-full animate-pulse-slow"></div>
                  <div className="absolute inset-0 border-4 border-t-purple-500 rounded-full animate-spin"></div>
                </div>
                <p className="text-slate-400 text-sm">Generating your NFT...</p>
                <p className="text-slate-500 text-xs mt-1">This may take a few moments</p>
              </div>
            ) : (
              <>
                <img
                  src={nftImageUrl}
                  alt="Minted NFT"
                  className="w-full h-auto"
                  onLoad={() => {
                    console.log('[MintSuccessModal] Image loaded successfully');
                  }}
                  onError={(e) => {
                    console.error('[MintSuccessModal] Image failed to load:', {
                      src: nftImageUrl,
                      error: e
                    });
                    (e.target as HTMLImageElement).src = 'https://via.placeholder.com/400x400?text=NFT';
                  }}
                />

                {/* Hover Action Buttons */}
                <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {/* Copy Image Button */}
                  <button
                    onClick={handleCopyImage}
                    disabled={copyStatus === 'copying'}
                    className={`p-2 rounded-lg backdrop-blur-sm transition-all shadow-lg ${copyStatus === 'success'
                        ? 'bg-green-600/90 hover:bg-green-700'
                        : copyStatus === 'error'
                          ? 'bg-red-600/90 hover:bg-red-700'
                          : 'bg-slate-900/90 hover:bg-slate-800'
                      } text-white`}
                    title={copyStatus === 'success' ? 'Copied!' : copyStatus === 'error' ? 'Failed to copy' : 'Copy image'}
                  >
                    {copyStatus === 'copying' ? (
                      <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    ) : copyStatus === 'success' ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : copyStatus === 'error' ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>

                  {/* Download Image Button */}
                  <button
                    onClick={handleDownloadImage}
                    className="p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-white backdrop-blur-sm transition-colors shadow-lg"
                    title="Download image"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* Post on X */}
            <a
              href={twitterShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>Post on X</span>
            </a>

            {!isLoadingImage && (
              <p className="text-xs text-center text-slate-500">
                💡 Tip: Hover over the image to copy or download it!
              </p>
            )}

            {/* View on Explorer */}
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors"
            >
              <ExternalLink size={18} />
              <span>View on Ink Explorer</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );

  // Use portal to render modal at document body level
  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
};
