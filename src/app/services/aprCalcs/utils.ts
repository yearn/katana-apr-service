import { isAddressEqual } from 'viem'
import type { Campaign, Opportunity, RewardCalculatorResult } from './types'

const WRAPPED_KAT_ADDRESS = '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461'

export const calculateStrategyAPR = (
  strategyAddress: string,
  poolAddress: string,
  opportunities: Opportunity[],
  poolType: string,
  targetRewardTokenAddress: string = WRAPPED_KAT_ADDRESS
): RewardCalculatorResult[] | null => {
  if (!poolAddress) {
    console.log('no pool')
    return null
  }

  const opportunity = opportunities.find((opp) =>
    isAddressEqual(
      opp.identifier as `0x${string}`,
      poolAddress as `0x${string}`
    )
  )

  if (!opportunity?.campaigns?.length) {
    console.log(`No ${poolType} opportunity found for pool ${poolAddress}`)
    // Return a result with 0 APR and null token details
    return [
      {
        strategyAddress,
        poolAddress,
        poolType,
        breakdown: {
          apr: 0,
          token: {
            address: '',
            symbol: '',
            decimals: 0,
          },
          weight: 0,
        },
      },
    ]
  }

  // Find all campaigns with the specified rewardToken address
  const targetCampaigns = opportunity.campaigns.filter((campaign: Campaign) =>
    isAddressEqual(
      campaign.rewardToken.address as `0x${string}`,
      targetRewardTokenAddress as `0x${string}`
    )
  )

  const strategyAprValues: Array<{ apr: number; campaign: Campaign }> = []
  if (
    targetCampaigns.length > 0 &&
    opportunity.aprRecord &&
    Array.isArray(opportunity.aprRecord.breakdowns)
  ) {
    for (const campaign of targetCampaigns) {
      const campaignId = campaign.campaignId
      const aprBreakdown = opportunity.aprRecord.breakdowns.find(
        (b: any) =>
          b.identifier &&
          b.identifier.toLowerCase() === String(campaignId).toLowerCase()
      )
      if (aprBreakdown && typeof aprBreakdown.value === 'number') {
        strategyAprValues.push({ apr: aprBreakdown.value, campaign })
      }
    }
  }

  // Return all APR breakdowns for each matching campaign
  const tokenBreakdowns: RewardCalculatorResult[] = strategyAprValues.map(
    ({ apr, campaign }) => ({
      strategyAddress,
      poolAddress,
      poolType,
      breakdown: {
        apr,
        token: {
          address: campaign.rewardToken.address,
          symbol: campaign.rewardToken.symbol,
          decimals: campaign.rewardToken.decimals,
        },
        weight: 0,
      },
    })
  )

  return tokenBreakdowns
}
