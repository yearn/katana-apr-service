export interface YearnStrategyDetails {
  totalDebt: string;
  totalGain: string;
  totalLoss: string;
  lastReport: number;
  performanceFee?: number;
  debtRatio?: number;
}

export interface YearnRewardToken {
  address: string;
  symbol: string;
  decimals: number;
  assumedFDV?: number;
}

export interface YearnStrategy {
  address: string;
  name: string;
  status?: string;
  netAPR?: number;
  strategyRewardsAPR?: number;
  rewardToken?: YearnRewardToken;
  underlyingContract?: string;
  details?: YearnStrategyDetails;
}

export interface YearnVaultExtra {
  katanaRewardsAPR?: number;
}

export interface YearnVaultPricePerShare {
  today: number;
  weekAgo: number;
  monthAgo: number;
}

export interface YearnVaultPoints {
  weekAgo: number;
  monthAgo: number;
  inception: number;
}

export interface YearnVaultFees {
  performance: number;
  management: number;
}

export interface YearnVaultAPY {
  type: string;
  netAPR: number;
  fees?: YearnVaultFees;
  points?: YearnVaultPoints;
  pricePerShare?: YearnVaultPricePerShare;
  extra?: YearnVaultExtra;
}

export interface YearnVaultTVL {
  totalAssets: string;
  tvl: number;
  price: number;
}

export interface YearnVaultToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  description?: string;
}

export interface YearnVault {
  address: string;
  symbol: string;
  name: string;
  chainId: number;
  strategies: YearnStrategy[];
  apr?: YearnVaultAPY;
  tvl?: YearnVaultTVL;
  token?: YearnVaultToken;
}
