export interface YearnStrategyDetails {
  totalDebt: string
  totalGain: string
  totalLoss: string
  lastReport: number
  performanceFee?: number
  debtRatio?: number
}

export interface YearnRewardToken {
  address: string
  symbol: string
  decimals: number
  assumedFDV?: number
}

export interface YearnStrategy {
  address: string
  name: string
  status?: string
  netAPR?: number | null
  oracleAPR?: number | null
  oracleAPY?: number | null
  oracleSource?: string | null
  estimatedAPR?: number | null
  estimatedAPY?: number | null
  estimatedComponents?: Record<string, number | null>
  strategyRewardsAPR?: number | null
  rewardToken?: YearnRewardToken | null
  underlyingContract?: string | null
  details?: YearnStrategyDetails
}

export interface YearnVaultExtra {
  stakingRewardsAPR?: number | null
  gammaRewardAPR?: number | null
  katanaRewardsAPR?: number // legacy field
  katanaAppRewardsAPR?: number
  fixedRateKatanaRewards?: number
  katanaBonusAPY?: number
  katanaNativeYield?: number
  // Points per dollar invested from STEER allocations
  steerPointsPerDollar?: number
}

export interface YearnVaultPricePerShare {
  today: number
  weekAgo: number
  monthAgo: number
}

export interface YearnVaultPoints {
  weekAgo: number
  monthAgo: number
  inception: number
}

export interface YearnVaultFees {
  performance: number
  management: number
}

export interface YearnVaultAPY {
  type?: string
  netAPR?: number
  fees?: YearnVaultFees
  points?: YearnVaultPoints
  pricePerShare?: YearnVaultPricePerShare
  extra?: YearnVaultExtra
  forwardAPR?: {
    type: 'katana-estimated-apr'
    apr?: number | null
    apy?: number | null
    netAPR?: number | null
    netAPY?: number | null
    components: Record<string, number | null>
  }
}

export interface YearnVaultTVL {
  totalAssets: string
  tvl: number
  price: number
}

export interface YearnVaultToken {
  address: string
  name: string
  symbol: string
  decimals: number
  description?: string
}

export interface YearnVault {
  address: string
  symbol: string
  name: string
  chainID: number
  strategies: YearnStrategy[]
  apr?: YearnVaultAPY
  tvl?: YearnVaultTVL
  token?: YearnVaultToken
}
