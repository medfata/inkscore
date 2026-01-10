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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 480" width="400" height="480">
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
      <stop offset="0%" stop-color="rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)"/>
      <stop offset="100%" stop-color="rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)"/>
    </linearGradient>
    
    <!-- Filters -->
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    
    <filter id="scoreGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feFlood flood-color="#7c3aed" flood-opacity="0.4"/>
      <feComposite in2="blur" operator="in"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <filter id="healthGlow" x="-10%" y="-50%" width="120%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feFlood flood-color="#7c3aed" flood-opacity="0.5"/>
      <feComposite in2="blur" operator="in"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <!-- Card shadow -->
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="20" flood-color="#7c3aed" flood-opacity="0.15"/>
    </filter>
    
    <!-- Clip path for health bar -->
    <clipPath id="healthClip">
      <rect x="32" y="365" width="336" height="12" rx="6"/>
    </clipPath>
  </defs>
  
  <!-- Background -->
  <rect width="400" height="480" fill="url(#bgGradient)"/>
  
  <!-- Glass card -->
  <rect x="20" y="20" width="360" height="440" rx="24" fill="rgba(15, 23, 42, 0.7)" stroke="rgba(255,255,255,0.1)" stroke-width="1" filter="url(#cardShadow)"/>
  
  <!-- Header row -->
  <g transform="translate(40, 50)">
    <!-- InkScore Logo -->
    <g filter="url(#glow)">
      <path d="M16 1.6 L29.86 9.6 V25.6 L16 33.6 L2.14 25.6 V9.6 Z" stroke="url(#inkGradient)" stroke-width="1.5" fill="rgba(15, 23, 42, 0.6)"/>
      <path d="M16 8 C16 8 8 16 8 20.8 C8 25.6 11.84 28.8 16 28.8 C20.16 28.8 24 25.6 24 20.8 C24 16 16 8 16 8 Z" fill="url(#inkGradient)"/>
      <path d="M12.8 20.8 L15.36 23.04 L19.2 17.6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    </g>
    
    <!-- Ping dot -->
    <circle cx="30" cy="3" r="3" fill="#60a5fa" opacity="0.8"/>
  </g>
  
  <!-- Right side header -->
  <g transform="translate(360, 50)" text-anchor="end">
    <text x="0" y="8" font-family="system-ui, sans-serif" font-size="10" fill="#94a3b8" letter-spacing="1.5">TOTAL INKSCORE</text>
    
    <!-- Rank badge -->
    <g transform="translate(-90, 18)">
      <rect x="0" y="0" width="90" height="22" rx="4" fill="url(#rankBadgeGradient)" stroke="rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)" stroke-width="1"/>
      <!-- Award icon -->
      <g transform="translate(8, 4)" fill="none" stroke="rgb(${rgb.r}, ${rgb.g}, ${rgb.b})" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.3 8.6 L11.3 14.3 A0.33 0.33 0 0 1 10.8 14.6 L8.4 12.8 A0.67 0.67 0 0 0 7.6 12.8 L5.2 14.6 A0.33 0.33 0 0 1 4.7 14.3 L5.7 8.6"/>
        <circle cx="8" cy="5.3" r="4"/>
      </g>
      <text x="28" y="15" font-family="system-ui, sans-serif" font-size="9" font-weight="bold" fill="rgb(${rgb.r}, ${rgb.g}, ${rgb.b})">${escapeXml(rank.toUpperCase())}</text>
    </g>
  </g>
  
  <!-- Score display -->
  <g transform="translate(40, 140)">
    <text font-family="system-ui, sans-serif" font-size="80" font-weight="bold" fill="url(#scoreGradient)" filter="url(#scoreGlow)" letter-spacing="-4">
      ${escapeXml(formattedScore)}
    </text>
    
    <!-- Live indicator -->
    <g transform="translate(${formattedScore.length * 45 + 20}, -30)">
      <rect x="0" y="0" width="60" height="28" rx="6" fill="rgba(34, 197, 94, 0.15)" stroke="rgba(34, 197, 94, 0.3)" stroke-width="1"/>
      <!-- Activity icon -->
      <path d="M12 14 L16 14 A1.3 1.3 0 0 0 17.3 13 L18.8 7.4 A0.17 0.17 0 0 0 18.5 7.4 L13.5 18.6 A0.17 0.17 0 0 1 13.2 18.6 L11.7 13 A1.3 1.3 0 0 0 10.4 12 L8 12" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(6, 2)"/>
      <text x="32" y="18" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#22c55e">LIVE</text>
    </g>
  </g>
  
  <!-- Reputation Health section -->
  <g transform="translate(32, 320)">
    <text x="0" y="0" font-family="system-ui, sans-serif" font-size="13" fill="#94a3b8">Reputation Health</text>
    <text x="336" y="0" font-family="system-ui, sans-serif" font-size="13" font-weight="bold" fill="white" text-anchor="end">${escapeXml(healthStatus)}</text>
  </g>
  
  <!-- Health bar background -->
  <rect x="32" y="340" width="336" height="12" rx="6" fill="#1e293b"/>
  
  <!-- Health bar fill -->
  <rect x="32" y="340" width="${(336 * healthWidth) / 100}" height="12" rx="6" fill="url(#healthGradient)" filter="url(#healthGlow)"/>
  
  <!-- Footer stats -->
  <g transform="translate(32, 390)">
    <!-- Divider line -->
    <line x1="0" y1="0" x2="336" y2="0" stroke="rgba(30, 41, 59, 0.8)" stroke-width="1"/>
    
    <text x="0" y="25" font-family="system-ui, sans-serif" font-size="11" fill="#64748b">Top ${topPercentage}% of users</text>
    
    <!-- Live updates indicator -->
    <g transform="translate(336, 25)" text-anchor="end">
      <circle cx="-70" cy="-4" r="3" fill="#22c55e"/>
      <text x="0" y="0" font-family="system-ui, sans-serif" font-size="11" fill="#64748b">Live Updates</text>
    </g>
  </g>
  
  <!-- Wallet address -->
  <text x="200" y="450" font-family="ui-monospace, monospace" font-size="11" fill="#475569" text-anchor="middle">${escapeXml(abbreviateAddress(walletAddress))}</text>
</svg>`;
}
