/**
 * NFT Image Generator Service
 * Generates dynamic SVG images for InkScore NFTs
 */

export interface SVGGeneratorParams {
  score: number;
  rank: string;
  rankColor: string;
  walletAddress: string;
  topPercentage?: number; // e.g., 1 for "Top 1%"
}

function abbreviateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatScore(score: number): string {
  return score.toLocaleString();
}

// Convert hex color to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 124, g: 58, b: 237 };
}

// Calculate health bar width based on score (max around 10000)
function getHealthWidth(score: number): number {
  const maxScore = 10000;
  return Math.min(100, Math.round((score / maxScore) * 100));
}

// Get health status based on score
function getHealthStatus(score: number): string {
  if (score >= 5000) return "Excellent";
  if (score >= 2000) return "Great";
  if (score >= 500) return "Good";
  if (score >= 100) return "Fair";
  return "Starting";
}

export function generateScoreNFTSvg(params: SVGGeneratorParams): string {
  const { score, rank, rankColor, walletAddress, topPercentage = 10 } = params;
  const formattedScore = formatScore(score);
  const healthWidth = getHealthWidth(score);
  const healthStatus = getHealthStatus(score);
  const rgb = hexToRgb(rankColor);

  const escapeXml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 380" width="400" height="380">
  <defs>
    <!-- Gradients -->
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    
    <linearGradient id="inkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="50%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
    
    <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </linearGradient>
    
    <linearGradient id="healthGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="50%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
    
    <linearGradient id="rankBadgeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)"/>
      <stop offset="100%" stop-color="rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)"/>
    </linearGradient>
    
    <!-- Filters -->
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    
    <filter id="scoreGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feFlood flood-color="#7c3aed" flood-opacity="0.3"/>
      <feComposite in2="blur" operator="in"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <filter id="healthGlow" x="-5%" y="-100%" width="110%" height="300%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feFlood flood-color="#7c3aed" flood-opacity="0.4"/>
      <feComposite in2="blur" operator="in"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <!-- Card shadow -->
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#7c3aed" flood-opacity="0.2"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="400" height="380" fill="url(#bgGradient)"/>
  
  <!-- Glass card -->
  <rect x="16" y="16" width="368" height="348" rx="24" fill="rgba(15, 23, 42, 0.6)" stroke="rgba(255,255,255,0.1)" stroke-width="1" filter="url(#cardShadow)"/>
  
  <!-- ========== HEADER ROW ========== -->
  <g transform="translate(40, 44)">
    <!-- Left: InkScore Logo -->
    <g filter="url(#glow)">
      <path d="M16 1.6 L29.86 9.6 V25.6 L16 33.6 L2.14 25.6 V9.6 Z" stroke="url(#inkGradient)" stroke-width="1.5" fill="rgba(15, 23, 42, 0.6)"/>
      <path d="M16 8 C16 8 8 16 8 20.8 C8 25.6 11.84 28.8 16 28.8 C20.16 28.8 24 25.6 24 20.8 C24 16 16 8 16 8 Z" fill="url(#inkGradient)"/>
      <path d="M12.8 20.8 L15.36 23.04 L19.2 17.6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    </g>
    <!-- Ping dot -->
    <circle cx="30" cy="2" r="2.5" fill="#60a5fa" opacity="0.9"/>
  </g>
  
  <!-- Right: Rank section -->
  <g transform="translate(360, 44)" text-anchor="end">
    <text x="0" y="6" font-family="system-ui, -apple-system, sans-serif" font-size="9" fill="#64748b" letter-spacing="2">TOTAL INKSCORE</text>
    
    <!-- Rank badge -->
    <g transform="translate(-100, 14)">
      <rect x="0" y="0" width="100" height="24" rx="4" fill="url(#rankBadgeGradient)" stroke="rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)" stroke-width="1"/>
      <!-- Award icon -->
      <g transform="translate(8, 5)" fill="none" stroke="rgb(${rgb.r}, ${rgb.g}, ${rgb.b})" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 8.5 L11 14 A0.4 0.4 0 0 1 10.4 14.4 L8 12.6 A0.8 0.8 0 0 0 7 12.6 L4.6 14.4 A0.4 0.4 0 0 1 4 14 L5 8.5"/>
        <circle cx="7.5" cy="5" r="4"/>
      </g>
      <text x="58" y="16" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700" fill="rgb(${rgb.r}, ${rgb.g}, ${rgb.b})" text-anchor="middle">${escapeXml(rank.toUpperCase())}</text>
    </g>
  </g>
  
  <!-- ========== MAIN SCORE SECTION ========== -->
  <g transform="translate(40, 100)">
    <!-- Large Score Number -->
    <text y="90" font-family="system-ui, -apple-system, sans-serif" font-size="120" font-weight="800" fill="url(#scoreGradient)" filter="url(#scoreGlow)" letter-spacing="-6">${escapeXml(formattedScore)}</text>
  </g>
  
  <!-- ========== REPUTATION HEALTH SECTION ========== -->
  <g transform="translate(40, 250)">
    <!-- Labels row -->
    <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-size="13" fill="#94a3b8">Reputation Health</text>
    <text x="320" y="0" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="white" text-anchor="end">${escapeXml(healthStatus)}</text>
    
    <!-- Health bar background -->
    <rect x="0" y="12" width="320" height="10" rx="5" fill="#1e293b"/>
    
    <!-- Health bar fill -->
    <rect x="0" y="12" width="${(320 * healthWidth) / 100}" height="10" rx="5" fill="url(#healthGradient)" filter="url(#healthGlow)"/>
    
    <!-- Stats row - directly below progress bar -->
    <text x="0" y="42" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#64748b">Top ${topPercentage}% of users</text>
    
    <!-- Live updates indicator -->
    <g transform="translate(320, 42)" text-anchor="end">
      <circle cx="-82" cy="-4" r="3" fill="#22c55e"/>
      <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#64748b">Live Updates</text>
    </g>
  </g>
  
  <!-- Wallet address at bottom -->
  <text x="200" y="340" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" fill="#475569" text-anchor="middle">${escapeXml(abbreviateAddress(walletAddress))}</text>
</svg>`;
}
