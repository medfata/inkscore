import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

const MARVK_CONTRACT = '0x9496ff7a7be0a91f582baa96ac12a0a36300750c';

interface MarvkMetrics {
  lockTokenCount: number;
  vestTokenCount: number;
  totalTransactions: number;
}

// GET /api/marvk/[wallet] - Get Marvk transaction metrics for a wallet
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await params;
    const walletAddress = wallet.toLowerCase();

    // Validate wallet address
    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // Get total transactions for the Marvk contract
    const totalResult = await query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM transaction_details
      WHERE contract_address = LOWER($1)
        AND wallet_address = LOWER($2)
        AND status = 1
    `, [MARVK_CONTRACT, walletAddress]);

    const totalTransactions = parseInt(totalResult[0]?.count || '0');

    // Get transactions by function name to differentiate Lock vs Vest
    const functionResult = await query<{ function_name: string; count: string }>(`
      SELECT 
        COALESCE(function_name, 'unknown') as function_name,
        COUNT(*) as count
      FROM transaction_details
      WHERE contract_address = LOWER($1)
        AND wallet_address = LOWER($2)
        AND status = 1
      GROUP BY function_name
    `, [MARVK_CONTRACT, walletAddress]);

    // Categorize functions into Lock Token and Vest Token
    let lockTokenCount = 0;
    let vestTokenCount = 0;

    functionResult.forEach(row => {
      const count = parseInt(row.count);
      const functionName = row.function_name?.toLowerCase() || '';
      
      // Categorize based on function name patterns
      if (functionName.includes('lock') || functionName.includes('deposit') || functionName.includes('stake')) {
        lockTokenCount += count;
      } else if (functionName.includes('vest') || functionName.includes('claim') || functionName.includes('withdraw')) {
        vestTokenCount += count;
      } else {
        // For unknown functions, split evenly between lock and vest
        const halfCount = Math.floor(count / 2);
        lockTokenCount += halfCount;
        vestTokenCount += (count - halfCount);
      }
    });

    const metrics: MarvkMetrics = {
      lockTokenCount,
      vestTokenCount,
      totalTransactions,
    };

    return NextResponse.json(metrics);
  } catch (error) {
    console.error('Failed to fetch Marvk metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch Marvk metrics' }, { status: 500 });
  }
}