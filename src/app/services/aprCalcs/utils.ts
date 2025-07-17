import { isAddressEqual } from 'viem'
import type { Campaign, Opportunity, RewardCalculatorResult } from './types'

/**
 * Calculates the APR breakdown for a given strategy and pool, based on available opportunities and campaigns.
 *
 * This function searches for the matching opportunity by pool address, then filters campaigns by the target reward token.
 * For each matching campaign, it finds the corresponding APR breakdown and constructs a result object.
 * If no opportunity or campaigns are found, returns a default result with zero APR.
 *
 * @param strategyAddress - The address of the strategy for which APR is being calculated.
 * @param poolAddress - The address of the pool associated with the strategy.
 * @param opportunities - An array of available opportunities, each containing campaigns and APR records.
 * @param poolType - The type of the pool (e.g., 'morpho').
 * @param targetRewardTokenAddress - The address of the reward token to filter campaigns by.
 * @returns An array of `RewardCalculatorResult` objects containing APR breakdowns for each matching campaign, or `null` if no pool address is provided.
 */
export const calculateStrategyAPR = (
  strategyAddress: string,
  poolAddress: string,
  opportunities: Opportunity[],
  poolType: string,
  targetRewardTokenAddress: string
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
  // if (poolType === 'morpho') {
  //   console.log(`Found opportunity for pool ${poolAddress}:`, opportunity)
  // }

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

  const targetCampaigns = opportunity.campaigns.filter((campaign: Campaign) => {
    // if (poolType === 'morpho') {
    //   console.log('Comparing:', {
    //     campaignRewardToken: campaign.rewardToken.address,
    //     targetRewardToken: targetRewardTokenAddress,
    //   })
    // }
    return isAddressEqual(
      campaign.rewardToken.address as `0x${string}`,
      targetRewardTokenAddress as `0x${string}`
    )
  })
  if (poolType === 'morpho') {
    console.log(
      `Found ${targetCampaigns.length} campaigns for pool ${poolAddress}`
    )
  }

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
  if (poolType === 'morpho') {
    // console.dir(_.fromPairs(resultEntries), { depth: null })
    console.dir(tokenBreakdowns, { depth: null })
  }

  return combineTokenBreakdowns(tokenBreakdowns)
}

/**
 * Combines an array of `RewardCalculatorResult` objects by merging entries with identical
 * strategy, pool, token, and weight properties. The APR values of matching entries are summed.
 *
 * @param tokenBreakdowns - Array of `RewardCalculatorResult` objects to be combined.
 * @returns An array of combined `RewardCalculatorResult` objects with summed APRs for duplicates.
 */
function combineTokenBreakdowns(
  tokenBreakdowns: RewardCalculatorResult[]
): RewardCalculatorResult[] {
  const combined: Record<string, RewardCalculatorResult> = {}
  for (const item of tokenBreakdowns) {
    // Create a key from all fields except apr
    const key = [
      item.strategyAddress,
      item.poolAddress,
      item.poolType,
      item.breakdown.token.address,
      item.breakdown.token.symbol,
      item.breakdown.token.decimals,
      item.breakdown.weight,
    ].join('|')
    if (combined[key]) {
      combined[key].breakdown.apr += item.breakdown.apr
    } else {
      combined[key] = { ...item }
    }
  }
  console.log('returning combined token breakdowns')
  console.dir(Object.values(combined), { depth: null })
  return Object.values(combined)
}
