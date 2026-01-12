import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ZNS tracking config
const ZNS_CONFIG = {
  deploy: { contract: '0x63c489d31a2c3de0638360931f47ff066282473f', functions: ['Deploy', 'deploy'] },
  sayGm: { contract: '0x3033d7ded400547d6442c55159da5c61f2721633', functions: ['SayGM', 'sayGM'] },
  register: { contract: '0xfb2cd41a8aec89efbb19575c6c48d872ce97a0a5', functions: ['RegisterDomains', 'registerDomains'] },
};

// GET /api/analytics/[wallet]/zns - Get ZNS metrics for a wallet
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    const walletLower = wallet.toLowerCase();

    // Single query with CASE statements to count all metrics at once
    const rows = await query<{
      deploy_count: string;
      say_gm_count: string;
      register_count: string;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE contract_address = $1 AND function_name = ANY($2)) as deploy_count,
        COUNT(*) FILTER (WHERE contract_address = $3 AND function_name = ANY($4)) as say_gm_count,
        COUNT(*) FILTER (WHERE contract_address = $5 AND function_name = ANY($6)) as register_count
      FROM transaction_details
      WHERE wallet_address = $7
        AND status = 1
        AND (
          (contract_address = $1 AND function_name = ANY($2)) OR
          (contract_address = $3 AND function_name = ANY($4)) OR
          (contract_address = $5 AND function_name = ANY($6))
        )
    `, [
      ZNS_CONFIG.deploy.contract, ZNS_CONFIG.deploy.functions,
      ZNS_CONFIG.sayGm.contract, ZNS_CONFIG.sayGm.functions,
      ZNS_CONFIG.register.contract, ZNS_CONFIG.register.functions,
      walletLower
    ]);

    const deployCount = parseInt(rows[0]?.deploy_count || '0', 10);
    const sayGmCount = parseInt(rows[0]?.say_gm_count || '0', 10);
    const registerCount = parseInt(rows[0]?.register_count || '0', 10);

    return NextResponse.json({
      slug: 'zns',
      name: 'ZNS Connect',
      currency: 'COUNT',
      total_count: deployCount + sayGmCount + registerCount,
      deploy_count: deployCount,
      say_gm_count: sayGmCount,
      register_domain_count: registerCount,
      last_updated: new Date(),
    });
  } catch (error) {
    console.error('Error fetching ZNS metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch ZNS metrics' }, { status: 500 });
  }
}
