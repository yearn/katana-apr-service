import { isAddress, isAddressEqual } from 'viem'
import type {
  Campaign,
  Opportunity,
  RewardCalculatorResult,
  YearnRewardCalculatorResult,
} from './types'

/**
 * Shortens an Ethereum address to display format (0x1234...5678)
 * @param address - The full Ethereum address
 * @param startLength - Number of characters to show at start (default: 4)
 * @param endLength - Number of characters to show at end (default: 4)
 * @returns Shortened address string
 */
const shortenAddress = (
  address: string,
  startLength: number = 4,
  endLength: number = 4
): string => {
  if (!address || address.length <= startLength + endLength + 2) {
    return address
  }
  return `${address.slice(0, 2 + startLength)}...${address.slice(-endLength)}`
}

const safeIsAddressEqual = (left?: string, right?: string): boolean => {
  if (!left || !right) {
    return false
  }
  if (!isAddress(left) || !isAddress(right)) {
    return false
  }
  return isAddressEqual(left as `0x${string}`, right as `0x${string}`)
}

const identifierMatchesAddress = (
  identifier?: string,
  address?: string
): boolean => {
  if (!identifier || !address) {
    return false
  }
  const normalizedIdentifier = identifier.toLowerCase()
  const normalizedAddress = address.toLowerCase()
  return (
    normalizedIdentifier === normalizedAddress ||
    normalizedIdentifier.startsWith(normalizedAddress)
  )
}

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
    console.log(`🚫 No pool address provided`)
    return null
  }

  const opportunity = opportunities.find((opp) =>
    identifierMatchesAddress(opp.identifier, poolAddress)
  )

  if (!opportunity?.campaigns?.length) {
    console.log(
      `🔍 No ${poolType} opportunity found for pool ${shortenAddress(
        poolAddress
      )}`
    )
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
    return safeIsAddressEqual(
      campaign.rewardToken.address,
      targetRewardTokenAddress
    )
  })

  const strategyAprValues: Array<{ apr: number; campaign: Campaign }> = []
  if (
    targetCampaigns.length > 0 &&
    opportunity.aprRecord &&
    Array.isArray(opportunity.aprRecord.breakdowns)
  ) {
    for (const campaign of targetCampaigns) {
      const campaignId = campaign.campaignId
      const aprBreakdown = opportunity.aprRecord.breakdowns.find(
        (b: { identifier?: string; value?: number }) =>
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

  return combineTokenBreakdowns(tokenBreakdowns, 'strategyAddress')
}

/**
 * Calculates the APR breakdowns for Yearn vault rewards based on the provided vault address,
 * opportunities, pool type, and target reward token address.
 *
 * The function searches for the matching opportunity by vault address, then filters campaigns
 * that reward the specified token. For each matching campaign, it finds the corresponding APR
 * breakdown and constructs a result object containing APR and token details.
 *
 * If no opportunity or campaigns are found, returns a default result with 0 APR and null token details.
 * The final result combines token breakdowns by vault address.
 *
 * @param vaultName - The name of the Yearn vault to calculate rewards for.
 * @param vaultAddress - The address of the Yearn vault to calculate rewards for.
 * @param opportunities - Array of available opportunities containing campaigns and APR records.
 * @param poolType - The type of pool (e.g., 'morpho') for which APR is being calculated.
 * @param targetRewardTokenAddress - Array of addresses of the reward tokens to filter campaigns by.
 * @param enableLogging - Whether to enable debug logging for this calculation.
 * @returns An array of YearnRewardCalculatorResult objects containing APR breakdowns for each matching campaign,
 *          or null if no opportunity is found for the vault address.
 */
export const calculateYearnVaultRewardsAPR = (
  vaultName: string,
  vaultAddress: string,
  opportunities: Opportunity[],
  poolType: string,
  targetRewardTokenAddress: string[],
  enableLogging: boolean = false
): YearnRewardCalculatorResult[] | null => {
  // Helper function to conditionally log
  const log = (...args: Parameters<typeof console.log>) => {
    if (enableLogging) {
      console.log(...args)
    }
  }

  if (!vaultAddress) {
    log('🚫 No vault address provided')
    return null
  }

  log(`\n👀 Analyzing vault: ${vaultName} (${shortenAddress(vaultAddress)})`)

  const opportunity = opportunities.find((opp) =>
    identifierMatchesAddress(opp.identifier, vaultAddress)
  )

  if (opportunity) {
    log(`\n🎯 Found Opportunity: ${opportunity.name}`)
    log('═'.repeat(50))
  }

  if (!opportunity?.campaigns?.length) {
    log(
      `🔍 No ${poolType} opportunity found for vault: ${vaultName} (${shortenAddress(
        vaultAddress
      )})`
    )
    log('═'.repeat(50))
    // Return a result with 0 APR and null token details
    return [
      {
        vaultName,
        vaultAddress,
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

  // First check each campaign to see if its campaignId exists in aprRecord.breakdowns,
  // then confirm the token matches
  const vaultAprValues: Array<{ apr: number; campaign: Campaign }> = []
  if (
    opportunity.aprRecord &&
    Array.isArray(opportunity.aprRecord.breakdowns) &&
    opportunity.campaigns.length > 0
  ) {
    for (const campaign of opportunity.campaigns) {
      const campaignId = campaign.campaignId
      const aprBreakdown = opportunity.aprRecord.breakdowns.find(
        (b: { identifier?: string; value?: number }) => {
          const isMatch =
            b.identifier &&
            b.identifier.toLowerCase() === String(campaignId).toLowerCase()
          return isMatch
        }
      )

      // If campaign has APR breakdown and token matches, include it
      if (aprBreakdown && typeof aprBreakdown.value === 'number') {
        log(`📊 Campaign ${campaignId}:`)
        log(
          `   💰 Token: ${shortenAddress(campaign.rewardToken.address)} (${
            campaign.rewardToken.symbol
          })`
        )
        log(
          `   🎯 Target Tokens: [${targetRewardTokenAddress
            .map((addr) => shortenAddress(addr))
            .join(', ')}]`
        )
        log(`   📈 APR: ${aprBreakdown.value.toFixed(4)}%`)

        const tokenMatches = targetRewardTokenAddress.some((addr) =>
          safeIsAddressEqual(campaign.rewardToken.address, addr)
        )

        log(`   ${tokenMatches ? '✅' : '❌'} Token match: ${tokenMatches}`)

        if (tokenMatches) {
          log(`   ➕ Adding campaign ${campaignId} to vault APR values`)
          vaultAprValues.push({ apr: aprBreakdown.value, campaign })
        }
      }
    }

    log('═'.repeat(50))
  }
  log(
    `📋 Summary: Found ${
      vaultAprValues.length
    } campaigns with APR data for vault ${shortenAddress(vaultAddress)}\n`
  )

  // Return all APR breakdowns for each matching campaign
  const tokenBreakdowns: YearnRewardCalculatorResult[] = vaultAprValues.map(
    ({ apr, campaign }) => ({
      vaultName,
      vaultAddress,
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

  return combineTokenBreakdowns(tokenBreakdowns, 'vaultAddress')
}

/**
 * Combines an array of token breakdown objects by aggregating their APR values if they share the same identifying fields.
 * The identifying fields include the specified address key, pool type, token address, symbol, decimals, weight,
 * and (if present) pool address. Objects with matching keys will have their APR values summed.
 *
 * @template T - Type extending RewardCalculatorResult or YearnRewardCalculatorResult.
 * @param tokenBreakdowns - Array of token breakdown objects to combine.
 * @param addressKey - The key used to identify the address field ('strategyAddress' or 'vaultAddress').
 * @returns An array of combined token breakdown objects with aggregated APR values.
 */
function combineTokenBreakdowns<
  T extends RewardCalculatorResult | YearnRewardCalculatorResult
>(tokenBreakdowns: T[], addressKey: 'strategyAddress' | 'vaultAddress'): T[] {
  const combined: Record<string, T> = {}
  for (const item of tokenBreakdowns) {
    // Create a key from all fields except apr
    const key = [
      item[addressKey],
      item.poolType,
      item.breakdown.token.address,
      item.breakdown.token.symbol,
      item.breakdown.token.decimals,
      item.breakdown.weight,
      // If RewardCalculatorResult, add poolAddress
      'poolAddress' in item ? (item as RewardCalculatorResult).poolAddress : '',
    ].join('|')
    if (combined[key]) {
      combined[key].breakdown.apr += item.breakdown.apr
    } else {
      combined[key] = { ...item }
    }
  }
  return Object.values(combined)
}
