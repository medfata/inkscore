/**
 * Wallet Points Debugger
 *
 * Fetches the full points breakdown for one or more wallets from the API server
 * and shows a per-metric comparison table: raw value, expected max, and actual points.
 *
 * Usage:
 *   npx ts-node scripts/test-wallet-points.ts <wallet1> [wallet2] ...
 *
 * Or hard-code wallets in the WALLETS array below.
 *
 * Reads API_SERVER_URL from api-server/.env (falls back to http://localhost:4000)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Read API_SERVER_URL from api-server/.env
// ---------------------------------------------------------------------------
function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = value;
  }
  return env;
}

const envPath = path.resolve(__dirname, '../.env');
const env = loadEnvFile(envPath);
const API_BASE_URL = env['API_BASE_URL'] || env['API_SERVER_URL'] || 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Wallets to test (override via CLI args)
// ---------------------------------------------------------------------------
const CLI_WALLETS = process.argv.slice(2).filter(a => /^0x[a-fA-F0-9]{40}$/.test(a));

const WALLETS: string[] = CLI_WALLETS.length > 0
  ? CLI_WALLETS
  : [
    '0x9D292255ddc87532974EF5b13CB5d8C44BFcab23'
  ];

// ---------------------------------------------------------------------------
// Points caps from the "How it Works" page
// ---------------------------------------------------------------------------
const METRIC_MAX: Record<string, number> = {
  // Native
  nft_collections: 400,
  erc20_tokens: 400,
  meme_coins: 300,
  wallet_age: 600,
  total_tx: 600,
  // Platforms
  bridge_in: 500,
  bridge_out: 500,
  gm: 400,
  swap: 500,
  opensea: 2500,
  inkypump: 400,
  shellies: 400,
  zns: 300,
  nft2me: 300,
  nft_trading: 400,
  marvk: 300,
  nado: 2500,
  copink: 400,
  templars: 2700,
  tydro: 2500,
  cowswap: 2000,
  phase1: 1000,
  sweep: 800,
  nft_staking: 500,
  inkdca: 500,
};

// Human-readable labels
const METRIC_LABEL: Record<string, string> = {
  nft_collections: 'NFT Collections',
  erc20_tokens: 'Token Holdings',
  meme_coins: 'Meme Coins',
  wallet_age: 'Wallet Age',
  total_tx: 'Total Transactions',
  bridge_in: 'Bridge IN',
  bridge_out: 'Bridge OUT',
  gm: 'GM',
  swap: 'Swap Volume',
  opensea: 'OpenSea',
  inkypump: 'InkyPump',
  shellies: 'Shellies',
  zns: 'ZNS Connect',
  nft2me: 'NFT2Me',
  nft_trading: 'NFT Trading',
  marvk: 'Marvk',
  nado: 'Nado Finance',
  copink: 'Copink',
  templars: 'Templars of the Storm',
  tydro: 'Tydro (Lending)',
  cowswap: 'CowSwap',
  phase1: 'Phase 1 Eligibility',
  sweep: 'Sweep',
  nft_staking: 'NFT Staking',
  inkdca: 'INKDCA',
};

// ---------------------------------------------------------------------------
// Types (mirrors WalletScoreResponse from points-service-v2)
// ---------------------------------------------------------------------------
interface MetricEntry {
  value?: number;
  points: number;
  tx_count?: number;
  usd_volume?: number;
}

interface ScoreResponse {
  wallet_address: string;
  total_points: number;
  rank?: { name: string; badge?: string } | null;
  breakdown: {
    native: Record<string, MetricEntry>;
    platforms: Record<string, MetricEntry>;
  };
  last_updated?: string;
}

// ---------------------------------------------------------------------------
// Fetch score for a single wallet
// ---------------------------------------------------------------------------
async function fetchScore(wallet: string): Promise<ScoreResponse> {
  const url = `${API_BASE_URL}/api/wallet/${wallet.toLowerCase()}/score?refresh=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json() as Promise<ScoreResponse>;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------
function pad(str: string, len: number, right = false): string {
  const s = String(str);
  if (right) return s.padStart(len);
  return s.padEnd(len);
}

function formatValue(key: string, entry: MetricEntry): string {
  if (entry.usd_volume !== undefined && entry.usd_volume > 0) {
    return `$${entry.usd_volume.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (entry.tx_count !== undefined && entry.tx_count > 0) {
    return `${entry.tx_count} txs`;
  }
  if (entry.value !== undefined) {
    return String(entry.value);
  }
  return '-';
}

function bar(points: number, max: number, width = 20): string {
  if (max === 0) return ' '.repeat(width);
  const filled = Math.round((points / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Print score report for one wallet
// ---------------------------------------------------------------------------
function printReport(score: ScoreResponse): void {
  const wallet = score.wallet_address;
  const rank = score.rank ? `${score.rank.badge || ''} ${score.rank.name}` : 'N/A';

  console.log('\n' + '═'.repeat(90));
  console.log(`  WALLET: ${wallet}`);
  console.log(`  RANK:   ${rank.trim()}`);
  console.log(`  TOTAL:  ${score.total_points.toLocaleString()} pts`);
  console.log('═'.repeat(90));

  const allMetrics: Array<[string, MetricEntry, 'native' | 'platform']> = [
    ...Object.entries(score.breakdown.native).map(
      ([k, v]) => [k, v, 'native'] as [string, MetricEntry, 'native' | 'platform']
    ),
    ...Object.entries(score.breakdown.platforms).map(
      ([k, v]) => [k, v, 'platform'] as [string, MetricEntry, 'native' | 'platform']
    ),
  ];

  // Separate native and platform sections
  const nativeEntries = allMetrics.filter(([, , t]) => t === 'native');
  const platformEntries = allMetrics.filter(([, , t]) => t === 'platform');

  let sumNative = 0;
  let sumPlatform = 0;

  const printSection = (entries: Array<[string, MetricEntry, 'native' | 'platform']>, title: string) => {
    console.log(`\n  ── ${title} ─────────────────────────────────────────────────────────────`);
    console.log(
      `  ${pad('Metric', 26)} ${pad('Value', 16, true)} ${pad('Points', 8, true)} ${pad('Max', 6, true)}  Progress`
    );
    console.log('  ' + '─'.repeat(86));

    for (const [key, entry] of entries) {
      const label = METRIC_LABEL[key] || key;
      const max = METRIC_MAX[key] ?? 0;
      const pts = entry.points ?? 0;
      const valStr = formatValue(key, entry);
      const maxStr = max > 0 ? String(max) : '?';
      const progress = max > 0 ? bar(pts, max) : '';
      const utilPct = max > 0 ? `${Math.round((pts / max) * 100)}%` : '';

      const flag = pts === 0 ? '  ⚠' : pts === max ? '  ✓' : '   ';

      console.log(
        `  ${pad(label, 26)} ${pad(valStr, 16, true)} ${pad(String(pts), 8, true)} ${pad(maxStr, 6, true)}  ${progress} ${pad(utilPct, 4, true)}${flag}`
      );

      if (title.includes('NATIVE')) sumNative += pts;
      else sumPlatform += pts;
    }
  };

  printSection(nativeEntries, 'NATIVE METRICS');
  printSection(platformEntries, 'PLATFORM METRICS');

  console.log('\n  ' + '─'.repeat(86));
  console.log(`  ${'Native subtotal'.padEnd(26)} ${''.padStart(16)} ${String(sumNative).padStart(8)}`);
  console.log(`  ${'Platform subtotal'.padEnd(26)} ${''.padStart(16)} ${String(sumPlatform).padStart(8)}`);
  console.log(`  ${'TOTAL'.padEnd(26)} ${''.padStart(16)} ${String(score.total_points).padStart(8)}`);

  // Highlight zero-point metrics
  const zeros = allMetrics.filter(([, e]) => (e.points ?? 0) === 0).map(([k]) => METRIC_LABEL[k] || k);
  if (zeros.length > 0) {
    console.log(`\n  ⚠  Zero-point metrics (potential areas to improve):`);
    for (const z of zeros) {
      console.log(`       • ${z}`);
    }
  }

  // Highlight metrics that hit max
  const maxed = allMetrics.filter(([k, e]) => {
    const max = METRIC_MAX[k] ?? 0;
    return max > 0 && (e.points ?? 0) >= max;
  }).map(([k]) => METRIC_LABEL[k] || k);
  if (maxed.length > 0) {
    console.log(`\n  ✓  Maxed-out metrics:`);
    for (const m of maxed) {
      console.log(`       • ${m}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nInkScore Points Debugger`);
  console.log(`API Server: ${API_BASE_URL}`);

  // Quick connectivity check before processing wallets
  try {
    const healthRes = await fetch(`${API_BASE_URL}/api/ranks`);
    if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
  } catch (err) {
    console.error(`\n❌ Cannot reach API server at ${API_BASE_URL}`);
    console.error(`   Make sure the server is running:`);
    console.error(`   cd api-server && npm run dev\n`);
    process.exit(1);
  }

  console.log(`Testing ${WALLETS.length} wallet(s)...`);

  for (const wallet of WALLETS) {
    try {
      console.log(`\nFetching score for ${wallet}...`);
      const score = await fetchScore(wallet);
      printReport(score);
    } catch (err) {
      console.error(`\n❌ Failed for ${wallet}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n' + '═'.repeat(90) + '\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
