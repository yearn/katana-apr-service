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

export interface MorphoUnderlyingAPR {
  morphoVaultAddress: string | null
  usedMorphoApi: boolean
  morphoBaseAPR: number
  morphoBaseAPY: number
  morphoRewardsAPR: number
  estimatedAPR: number | null
  estimatedAPY: number | null
}

export interface VaultMorphoUnderlyingAPR {
  baseAPR: number
  baseAPY: number
  rewardsAPR: number
  estimatedAPR: number
  estimatedAPY: number
  coveredDebtRatio: number
}

export interface YearnStrategy {
  address: string
  name: string
  status?: string
  netAPR?: number | null
  strategyRewardsAPR?: number | null
  morphoUnderlyingAPR?: MorphoUnderlyingAPR
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
  maxFee?: number
}

export interface YearnVaultAPY {
  type?: string
  netAPR?: number
  fees?: YearnVaultFees
  points?: YearnVaultPoints
  pricePerShare?: YearnVaultPricePerShare
  extra?: YearnVaultExtra
  forwardAPR?: {
    type: string
    netAPR: number | null
    composite: {
      boost: number | null
      poolAPY: number | null
      boostedAPR: number | null
      baseAPR: number | null
      cvxAPR: number | null
      rewardsAPR: number | null
    }
    morphoUnderlying?: VaultMorphoUnderlyingAPR
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
