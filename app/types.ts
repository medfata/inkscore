export enum ScoreTier {
  NEW_USER = "New User",
  ACTIVE_USER = "Active User",
  POWER_USER = "Power User",
  OG_MEMBER = "OG Ink Member",
  INK_LEGEND = "Ink Legend"
}

export interface NftHolding {
  name: string;
  contractAddress: string;
  count: number;
  pointsPerItem: number;
  totalPoints: number;
  twitterHandle: string;
}

export interface TokenHolding {
  name: string;
  symbol: string;
  contractAddress: string;
  balance: number;
  usdValue: number;
  points: number;
  logoUrl?: string;
}

export interface WalletStats {
  address: string;
  ageDays: number;
  transactionCount: number;
  nftCount: number;
  tokenHoldingsUsd: number;
  defiInteractionCount: number;
  ecosystemParticipationScore: number;
  nftHoldings: NftHolding[];
  nftTotalScore: number;
  tokenHoldings: TokenHolding[];
  tokenTotalScore: number;
  gmInteractionCount: number;
  gmScore: number;
  tydroSupplyCount: number;
  tydroBorrowCount: number;
  tydroScore: number;
}

export interface ScoreData {
  totalScore: number;
  tier: ScoreTier;
  breakdown: {
    nftPower: number;
    tokenWeight: number;
    defiUsage: number;
    txActivity: number;
    longevity: number;
    ecosystemLoyalty: number;
  };
}

export interface AiAnalysisResult {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}
