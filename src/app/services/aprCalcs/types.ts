export interface APRCalculator {
  calculateVaultAPRs(
    vaults: any[]
  ): Promise<Record<string, RewardCalculatorResult[]>>
}

export interface TokenBreakdown {
  apr: number
  token: {
    address: string
    symbol: string
    decimals: number
  }
  weight: number
}

export interface RewardCalculatorResult {
  strategyAddress: string
  poolAddress: string
  poolType: string // e.g., 'morpho', 'steer'
  breakdown: TokenBreakdown
}

export interface YearnRewardCalculatorResult {
  vaultName: string
  vaultAddress: string
  poolType: string // e.g., 'morpho', 'steer'
  breakdown: TokenBreakdown
}

export interface Campaign {
  campaignId?: string
  amount?: string
  rewardToken: {
    address: string
    symbol: string
    decimals: number
  }
  startTimestamp?: number
  endTimestamp?: number
}

export interface Opportunity {
  name: string
  identifier: string
  campaigns?: Campaign[]
  apr?: number
  aprRecord?: {
    breakdowns?: Array<{
      identifier?: string
      value?: number
    }>
  }
}

export type VaultAprDebugStage =
  | 'vault_fetch'
  | 'blacklist_filter'
  | 'opportunity_fetch'
  | 'opportunity_lookup'
  | 'campaign_scan'
  | 'campaign_apr_match'
  | 'token_filter'
  | 'result_summary'
  | 'fallback'

export interface VaultAprDebugEvent {
  stage: VaultAprDebugStage
  vaultAddress?: string
  vaultName?: string
  vaultSymbol?: string
  chainId?: number
  poolType?: string
  opportunityType?: string
  opportunityIdentifier?: string
  opportunitiesTotal?: number
  campaignId?: string
  campaignsTotal?: number
  aprBreakdownsTotal?: number
  rewardTokenAddress?: string
  rewardTokenSymbol?: string
  aprBreakdownMatched?: boolean
  tokenMatched?: boolean
  aprValue?: number
  acceptedCampaigns?: number
  blacklistedCampaigns?: number
  blacklistedCampaignIds?: string[]
  blacklistedAprBreakdownCampaignIds?: string[]
  totalVaults?: number
  withResults?: number
  fallbackCount?: number
  reason?: string
}
