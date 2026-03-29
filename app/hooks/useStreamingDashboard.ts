import { useState, useEffect, useRef } from 'react';
import { isEventSourceSupported, logBrowserInfo } from '../utils/browserCompat';

interface MetricEvent {
  type: 'metric' | 'error' | 'done';
  id?: string;
  data?: any;
  error?: string;
  duration?: number;
  totalDuration?: number;
  timedOut?: boolean;
  timestamp: number;
}

interface StreamingDashboardState {
  metrics: Record<string, any>;
  loadingMetrics: Set<string>;
  errors: Record<string, string>;
  isComplete: boolean;
  isConnected: boolean;
  totalDuration: number | null;
  timedOut: boolean;
}

/**
 * Hook for streaming dashboard metrics progressively via Server-Sent Events (SSE)
 * 
 * @param walletAddress - The wallet address to fetch metrics for
 * @param enabled - Whether streaming is enabled (default: true)
 * @returns State object with metrics, loading states, errors, and connection status
 */
export function useStreamingDashboard(
  walletAddress: string,
  enabled: boolean = true
): StreamingDashboardState {
  const [state, setState] = useState<StreamingDashboardState>({
    metrics: {},
    loadingMetrics: new Set([
      'stats',
      'bridge',
      'swap',
      'volume',
      'score',
      'analytics',
      'cards',
      'marvk',
      'nado',
      'copink',
      'nft2me',
      'tydro',
      'gmCount',
      'inkypumpCreatedTokens',
      'inkypumpBuyVolume',
      'inkypumpSellVolume',
      'nftTraded',
      'zns',
      'shelliesJoinedRaffles',
      'shelliesPayToPlay',
      'shelliesStaking',
      'openseaBuyCount',
      'mintCount',
      'openseaSaleCount',
      'inkdcaRunDca',
      'templarsNftBalance',
      'cowswapSwaps',
    ]),
    errors: {},
    isComplete: false,
    isConnected: false,
    totalDuration: null,
    timedOut: false,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!walletAddress || !enabled) return;

    // Log browser compatibility info (only in development)
    if (process.env.NODE_ENV === 'development') {
      logBrowserInfo();
    }

    // Check for EventSource support
    if (!isEventSourceSupported()) {
      console.warn('[STREAM] EventSource not supported, falling back to polling');
      // Fall back to regular fetch
      fetchDashboardFallback(walletAddress);
      return;
    }

    console.log('[STREAM] Opening connection for wallet:', walletAddress);

    // Open SSE connection
    const eventSource = new EventSource(
      `/api/${walletAddress}/dashboard?stream=true`
    );
    eventSourceRef.current = eventSource;

    // Set timeout (60 seconds)
    timeoutRef.current = setTimeout(() => {
      console.warn('[STREAM] Client timeout reached, closing connection');
      eventSource.close();
      setState((prev) => ({
        ...prev,
        isComplete: true,
        timedOut: true,
      }));
    }, 60000);

    eventSource.onopen = () => {
      console.log('[STREAM] Connection opened');
      setState((prev) => ({ ...prev, isConnected: true }));
    };

    eventSource.onmessage = (event) => {
      const message: MetricEvent = JSON.parse(event.data);

      if (message.type === 'metric') {
        console.log(
          `[STREAM] Received metric: ${message.id} (${message.duration}ms)`
        );

        setState((prev) => {
          const newLoadingMetrics = new Set(prev.loadingMetrics);
          newLoadingMetrics.delete(message.id!);

          return {
            ...prev,
            metrics: {
              ...prev.metrics,
              [message.id!]: message.data,
            },
            loadingMetrics: newLoadingMetrics,
            errors: message.error
              ? {
                  ...prev.errors,
                  [message.id!]: message.error,
                }
              : prev.errors,
          };
        });
      } else if (message.type === 'error') {
        console.error(
          `[STREAM] Error for metric: ${message.id}`,
          message.error
        );

        setState((prev) => {
          const newLoadingMetrics = new Set(prev.loadingMetrics);
          newLoadingMetrics.delete(message.id!);

          return {
            ...prev,
            loadingMetrics: newLoadingMetrics,
            errors: {
              ...prev.errors,
              [message.id!]: message.error!,
            },
          };
        });
      } else if (message.type === 'done') {
        console.log(
          `[STREAM] All metrics completed (${message.totalDuration}ms)${
            message.timedOut ? ' - TIMED OUT' : ''
          }`
        );

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        setState((prev) => ({
          ...prev,
          isComplete: true,
          totalDuration: message.totalDuration || null,
          timedOut: message.timedOut || false,
        }));

        eventSource.close();
      }
    };

    eventSource.onerror = (error) => {
      console.error('[STREAM] Connection error:', error);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setState((prev) => ({
        ...prev,
        isConnected: false,
        isComplete: true,
      }));

      eventSource.close();
      
      // Fall back to regular fetch on error
      console.log('[STREAM] Falling back to non-streaming endpoint');
      fetchDashboardFallback(walletAddress);
    };

    // Cleanup
    return () => {
      console.log('[STREAM] Cleaning up connection');

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [walletAddress, enabled]);

  /**
   * Fallback function for browsers without EventSource support
   * or when streaming connection fails
   */
  const fetchDashboardFallback = async (wallet: string) => {
    try {
      console.log('[STREAM] Fetching dashboard data via fallback');
      
      const response = await fetch(`/api/${wallet}/dashboard`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Process the consolidated response
      const metrics: Record<string, any> = {};
      
      if (data.stats) metrics.stats = data.stats;
      if (data.bridge) metrics.bridge = data.bridge;
      if (data.swap) metrics.swap = data.swap;
      if (data.volume) metrics.volume = data.volume;
      if (data.score) metrics.score = data.score;
      if (data.analytics) metrics.analytics = data.analytics;
      if (data.cards) metrics.cards = data.cards;
      if (data.marvk) metrics.marvk = data.marvk;
      if (data.nado) metrics.nado = data.nado;
      if (data.copink) metrics.copink = data.copink;
      if (data.nft2me) metrics.nft2me = data.nft2me;
      if (data.tydro) metrics.tydro = data.tydro;
      if (data.gmCount) metrics.gmCount = data.gmCount;
      if (data.inkypumpCreatedTokens) metrics.inkypumpCreatedTokens = data.inkypumpCreatedTokens;
      if (data.inkypumpBuyVolume) metrics.inkypumpBuyVolume = data.inkypumpBuyVolume;
      if (data.inkypumpSellVolume) metrics.inkypumpSellVolume = data.inkypumpSellVolume;
      if (data.nftTraded) metrics.nftTraded = data.nftTraded;
      if (data.zns) metrics.zns = data.zns;
      if (data.shelliesJoinedRaffles) metrics.shelliesJoinedRaffles = data.shelliesJoinedRaffles;
      if (data.shelliesPayToPlay) metrics.shelliesPayToPlay = data.shelliesPayToPlay;
      if (data.shelliesStaking) metrics.shelliesStaking = data.shelliesStaking;
      if (data.openseaBuyCount) metrics.openseaBuyCount = data.openseaBuyCount;
      if (data.mintCount) metrics.mintCount = data.mintCount;
      if (data.openseaSaleCount) metrics.openseaSaleCount = data.openseaSaleCount;
      if (data.inkdcaRunDca) metrics.inkdcaRunDca = data.inkdcaRunDca;
      if (data.templarsNftBalance) metrics.templarsNftBalance = data.templarsNftBalance;
      if (data.cowswapSwaps) metrics.cowswapSwaps = data.cowswapSwaps;
      
      setState({
        metrics,
        loadingMetrics: new Set(),
        errors: {},
        isComplete: true,
        isConnected: false,
        totalDuration: null,
        timedOut: false,
      });
      
      console.log('[STREAM] Fallback fetch completed successfully');
    } catch (error) {
      console.error('[STREAM] Fallback fetch failed:', error);
      
      setState((prev) => ({
        ...prev,
        loadingMetrics: new Set(),
        isComplete: true,
        errors: {
          fallback: error instanceof Error ? error.message : 'Failed to fetch dashboard data',
        },
      }));
    }
  };

  return state;
}
