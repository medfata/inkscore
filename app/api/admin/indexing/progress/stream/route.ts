import { NextRequest } from 'next/server';
import { query } from '@/lib/db';

interface CursorProgress {
  contract_address: string;
  total_indexed: number;
  api_total_count: number;
  is_complete: boolean;
  updated_at: Date;
  created_at: Date;
}

// Store previous progress for speed calculation - per SSE connection
interface ProgressSnapshot {
  timestamp: number;
  total: number;
}

// GET /api/admin/indexing/progress/stream - SSE endpoint for real-time indexing progress
export async function GET(request: NextRequest) {
  // Create a fresh history map for this SSE connection
  const progressHistory = new Map<string, ProgressSnapshot[]>();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial data
      try {
        const progress = await getIndexingProgress(progressHistory);
        sendEvent(progress);
      } catch (error) {
        console.error('Error fetching initial progress:', error);
      }

      // Poll for updates every 2 seconds
      const interval = setInterval(async () => {
        try {
          const progress = await getIndexingProgress(progressHistory);
          sendEvent(progress);
        } catch (error) {
          console.error('Error fetching progress:', error);
        }
      }, 2000);

      // Clean up on close
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function calculateETA(
  progressHistory: Map<string, ProgressSnapshot[]>,
  address: string,
  totalIndexed: number,
  apiTotalCount: number,
  isComplete: boolean
): { eta_seconds: number | null; speed_per_sec: number } {
  if (isComplete || apiTotalCount === 0) {
    return { eta_seconds: null, speed_per_sec: 0 };
  }

  const now = Date.now();
  const history = progressHistory.get(address) || [];

  // Add current data point
  history.push({ timestamp: now, total: totalIndexed });

  // Keep only last 60 seconds of history (30 data points at 2s intervals)
  const cutoff = now - 60000;
  const recentHistory = history.filter((h) => h.timestamp > cutoff);
  progressHistory.set(address, recentHistory);

  if (recentHistory.length < 2) {
    return { eta_seconds: null, speed_per_sec: 0 };
  }

  // Calculate speed from oldest to newest in window
  const oldest = recentHistory[0];
  const newest = recentHistory[recentHistory.length - 1];
  const timeDiff = (newest.timestamp - oldest.timestamp) / 1000;
  const txDiff = newest.total - oldest.total;

  if (timeDiff <= 0 || txDiff <= 0) {
    return { eta_seconds: null, speed_per_sec: 0 };
  }

  const speedPerSec = txDiff / timeDiff;
  const remaining = apiTotalCount - totalIndexed;
  const etaSeconds = remaining / speedPerSec;

  return {
    eta_seconds: Math.round(etaSeconds),
    speed_per_sec: Math.round(speedPerSec),
  };
}

async function getIndexingProgress(progressHistory: Map<string, ProgressSnapshot[]>) {
  // Get cursor progress for tx-based contracts
  const cursors = await query<CursorProgress>(`
    SELECT 
      contract_address,
      total_indexed,
      COALESCE(api_total_count, 0) as api_total_count,
      is_complete,
      updated_at,
      created_at
    FROM tx_indexer_cursors
    ORDER BY updated_at DESC
  `);

  // Get ALL contract details including pre-computed total_indexed (instant query)
  const contracts = await query<{
    id: number;
    address: string;
    name: string;
    indexing_status: string;
    deploy_block: number;
    fetch_transactions: boolean;
    is_active: boolean;
    total_indexed: string; // BIGINT comes as string from pg
  }>(`
    SELECT id, address, name, indexing_status, deploy_block, fetch_transactions, is_active,
           COALESCE(total_indexed, 0)::text as total_indexed
    FROM contracts
    ORDER BY name ASC
  `);

  // Get platform mappings
  const platformMappings = await query<{
    contract_id: number;
    platform_name: string;
  }>(`
    SELECT pc.contract_id, p.name as platform_name
    FROM platform_contracts pc
    JOIN platforms p ON pc.platform_id = p.id
  `);

  const platformsByContract = new Map<number, string[]>();
  for (const m of platformMappings) {
    const platforms = platformsByContract.get(m.contract_id) || [];
    platforms.push(m.platform_name);
    platformsByContract.set(m.contract_id, platforms);
  }

  const cursorMap = new Map(cursors.map((c) => [c.contract_address.toLowerCase(), c]));

  // Build contract progress with ETA
  const contractProgress = contracts.map((contract) => {
    const cursor = cursorMap.get(contract.address.toLowerCase());

    // Parse contract's total_indexed (BIGINT comes as string from pg)
    const contractTotalIndexed = parseInt(contract.total_indexed, 10) || 0;

    // Use cursor data if available, otherwise fall back to contracts.total_indexed
    const totalIndexed = cursor
      ? (Number(cursor.total_indexed) || 0)
      : contractTotalIndexed;
    const apiTotalCount = cursor
      ? (Number(cursor.api_total_count) || contractTotalIndexed)
      : contractTotalIndexed;

    const isComplete = cursor?.is_complete ||
      (!contract.fetch_transactions && contract.indexing_status === 'complete');

    const progressPercent =
      apiTotalCount > 0
        ? Math.min(100, Math.round((totalIndexed / apiTotalCount) * 100))
        : isComplete
          ? 100
          : 0;

    const { eta_seconds, speed_per_sec } = calculateETA(
      progressHistory,
      contract.address,
      totalIndexed,
      apiTotalCount,
      isComplete
    );

    let status: string;
    if (isComplete || contract.indexing_status === 'complete') {
      status = 'complete';
    } else if (contract.indexing_status === 'indexing' || totalIndexed > 0) {
      status = 'indexing';
    } else if (contract.indexing_status === 'error') {
      status = 'error';
    } else {
      status = 'pending';
    }

    return {
      id: contract.id,
      address: contract.address,
      name: contract.name,
      platforms: platformsByContract.get(contract.id) || [],
      deploy_block: contract.deploy_block,
      fetch_transactions: contract.fetch_transactions,
      is_active: contract.is_active,
      total_indexed: totalIndexed,
      api_total_count: apiTotalCount,
      progress_percent: progressPercent,
      is_complete: isComplete || contract.indexing_status === 'complete',
      status,
      speed_per_sec,
      eta_seconds,
      updated_at: cursor?.updated_at || null,
    };
  });

  // Global stats
  const activeContracts = contractProgress.filter((c) => c.is_active);
  const totalIndexed = activeContracts.reduce((sum, c) => sum + c.total_indexed, 0);
  const totalExpected = activeContracts.reduce((sum, c) => sum + c.api_total_count, 0);
  const completeCount = activeContracts.filter((c) => c.is_complete).length;
  const indexingCount = activeContracts.filter((c) => c.status === 'indexing').length;
  const totalSpeed = activeContracts.reduce((sum, c) => sum + c.speed_per_sec, 0);

  return {
    contracts: contractProgress,
    global_stats: {
      total_contracts: activeContracts.length,
      contracts_complete: completeCount,
      contracts_indexing: indexingCount,
      contracts_pending: activeContracts.length - completeCount - indexingCount,
      total_indexed: totalIndexed,
      total_expected: totalExpected,
      overall_progress: totalExpected > 0 ? Math.round((totalIndexed / totalExpected) * 100) : 0,
      total_speed: totalSpeed,
    },
    timestamp: new Date().toISOString(),
  };
}
