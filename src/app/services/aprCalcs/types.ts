export interface APRCalculator {
  calculateVaultAPRs(vaults: any[]): Promise<Record<string, RewardCalculatorResult[]>>;
}

export interface TokenBreakdown {
  apr: number;
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  weight: number;
}

export interface RewardCalculatorResult {
  strategyAddress: string;
  poolAddress: string;
  poolType: string; // e.g., 'morpho', 'steer'
  breakdown: TokenBreakdown;
}

export interface Campaign {
  campaignId?: string;
  amount?: string;
  rewardToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  startTimestamp?: number;
  endTimestamp?: number;
}

export interface Opportunity {
  identifier: string;
  campaigns?: Campaign[];
  apr?: number;
  aprRecord?: {
    breakdowns?: Array<{
      identifier: string;
      value: number;
    }>;
  };
}
