/**
 * NFT Image Generator Service
 * Generates dynamic SVG images for InkScore NFTs
 */

export interface SVGGeneratorParams {
  score: number;
  rank: string;
  rankColor: string;
  walletAddress: string;
}

function abbreviateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatScore(score: number): string {
  return score.toLocaleString();
}

// Convert hex color to RGB for SVG filters
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 124, g: 58, b: 237 }; // Default purple
}

export function generateScoreNFTSvg(params: SVGGeneratorParams): string {
  const { score, rank, rankColor, walletAddress } = params;
  const abbreviatedWallet = abbreviateAddress(walletAddress);
  const formattedScore = formatScore(score);
  const rgb = hexToRgb(rankColor);

  // Escape special characters for XML
  const escapeXml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <!-- Background gradient -->
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a1a;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#111827;stop-opacity:1" />
    </linearGradient>
    
    <!-- Purple glow for score -->
    <filter id="purpleGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feFlood flood-color="#7c3aed" flood-opacity="0.3"/>
      <feComposite in2="blur" operator="in"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <!-- Rank badge gradient -->
    <linearGradient id="rankGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5);stop-opacity:1" />
      <stop offset="100%" style="stop-color:rgb(${rgb.r}, ${rgb.g}, ${rgb.b});stop-opacity:1" />
    </linearGradient>
    
    <!-- Ambient glow -->
    <filter id="ambientGlow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="40" result="blur"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="400" height="400" fill="url(#bgGradient)"/>
  
  <!-- Ambient purple glow (top-left) -->
  <circle cx="80" cy="80" r="80" fill="#7c3aed" opacity="0.15" filter="url(#ambientGlow)"/>
  
  <!-- Card container -->
  <rect x="40" y="80" width="320" height="240" rx="16" ry="16" fill="rgba(15, 23, 42, 0.6)" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
  
  <!-- "Total INKSCORE" label -->
  <text x="200" y="130" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle" letter-spacing="0.5">
    Total INKSCORE
  </text>
  
  <!-- Score value -->
  <text x="200" y="195" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="bold" fill="white" text-anchor="middle" filter="url(#purpleGlow)" letter-spacing="-2">
    ${escapeXml(formattedScore)}
  </text>
  
  <!-- Rank badge -->
  <rect x="125" y="220" width="150" height="32" rx="16" ry="16" fill="url(#rankGradient)"/>
  <text x="200" y="242" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="white" text-anchor="middle">
    ${escapeXml(rank)}
  </text>
  
  <!-- Wallet address -->
  <text x="200" y="290" font-family="ui-monospace, monospace" font-size="12" fill="#64748b" text-anchor="middle">
    ${escapeXml(abbreviatedWallet)}
  </text>
  
  <!-- InkScore branding -->
  <text x="200" y="360" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#475569" text-anchor="middle" letter-spacing="1">
    INKSCORE
  </text>
</svg>`;
}
