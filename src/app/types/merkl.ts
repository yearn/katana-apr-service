export interface MerklRewardToken {
  address: string
  symbol: string
  decimals: number
  price: number
}

export interface MerklCampaign {
  campaignId?: string
  amount: string
  rewardToken: MerklRewardToken
  startTimestamp: number
  endTimestamp: number
}

export interface MerklOpportunity {
  chainId: number
  name: string
  apr?: number
  aprRecord?: {
    breakdowns?: Array<{
      identifier?: string
      value?: number
    }>
  }
  tags?: string[]
  tvl: number
  address?: string
  identifier: string
  status: string
  type?: string
  dailyRewards?: number
  campaigns?: MerklCampaign[]
  tokens?: Array<{
    address: string
    symbol: string
    decimals: number
    price: number
  }>
}

export interface MerklApiResponse {
  opportunities: MerklOpportunity[]
  total: number
}
