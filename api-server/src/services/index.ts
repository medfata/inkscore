export { assetsService, setWalletStatsCacheClearer } from './assets-service';
export { analyticsService } from './analytics-service';
export { metricsService } from './metrics-service';
export { priceService } from './price-service';
export { pointsServiceV2 } from './points-service-v2';
export { walletStatsService, clearWalletStatsCache } from './wallet-stats-service';
export { sweepService } from './sweep-service';
export { inkDcaService } from './inkdca-service';

// Re-export types from wallet-stats-service
export type {
  WalletStatsData,
  TokenHolding,
  NftCollectionHolding,
  TokenType,
} from './wallet-stats-service';
