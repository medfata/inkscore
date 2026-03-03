import { readFileSync } from 'fs';
import { join } from 'path';

export interface Phase1Wallet {
  address: string;
  score: number;
}

export class Phase1Service {
  private phase1Wallets: Map<string, number> = new Map();
  private loaded = false;

  // Load Phase 1 wallets from CSV
  private loadPhase1Wallets(): void {
    if (this.loaded) return;

    try {
      const csvPath = join(__dirname, '../data/ink-score-export-2026-02-24.csv');
      const csvContent = readFileSync(csvPath, 'utf-8');
      
      const lines = csvContent.split('\n').slice(1); // Skip header
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        const [address, scoreStr] = trimmedLine.split(',');
        if (address && scoreStr) {
          const normalizedAddress = address.trim().toLowerCase();
          const score = parseInt(scoreStr.trim(), 10);
          this.phase1Wallets.set(normalizedAddress, score);
        }
      }
      
      this.loaded = true;
      console.log(`Loaded ${this.phase1Wallets.size} Phase 1 wallets from CSV`);
    } catch (error) {
      console.error('Failed to load Phase 1 wallets:', error);
      this.loaded = true; // Mark as loaded to prevent retry loops
    }
  }

  // Check if wallet is in Phase 1
  isPhase1Wallet(walletAddress: string): boolean {
    if (!this.loaded) {
      this.loadPhase1Wallets();
    }
    
    const normalized = walletAddress.toLowerCase();
    return this.phase1Wallets.has(normalized);
  }

  // Get wallet score (returns null if not in Phase 1)
  getWalletScore(walletAddress: string): number | null {
    if (!this.loaded) {
      this.loadPhase1Wallets();
    }
    
    const normalized = walletAddress.toLowerCase();
    return this.phase1Wallets.get(normalized) || null;
  }

  // Get Phase 1 status with details
  getPhase1Status(walletAddress: string): {
    isPhase1: boolean;
    score: number | null;
    totalPhase1Wallets: number;
  } {
    if (!this.loaded) {
      this.loadPhase1Wallets();
    }
    
    const normalized = walletAddress.toLowerCase();
    const score = this.phase1Wallets.get(normalized) || null;
    
    return {
      isPhase1: score !== null,
      score,
      totalPhase1Wallets: this.phase1Wallets.size,
    };
  }

  // Get all Phase 1 wallets (for admin purposes)
  getAllPhase1Wallets(): Phase1Wallet[] {
    if (!this.loaded) {
      this.loadPhase1Wallets();
    }
    
    return Array.from(this.phase1Wallets.entries()).map(([address, score]) => ({
      address,
      score,
    }));
  }
}

export const phase1Service = new Phase1Service();
