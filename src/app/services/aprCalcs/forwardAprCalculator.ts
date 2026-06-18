import { isAddress, isAddressEqual } from 'viem'
import type { MerklOpportunity, YearnStrategy, YearnVault } from '../../types'
import { KATANA_REWARD_TOKEN_ADDRESSES } from '../katanaRewardTokens'
import { MerklApiService } from '../externalApis/merklApi'
import {
  aprToApy,
  apyToApr,
  MORPHO_REWARD_TOKEN_ADDRESS,
  MorphoApiService,
  type MorphoVaultEstimate,
} from '../externalApis/morphoApi'

const ESTIMATED_APR_TYPE = 'katana-estimated-apr' as const

type FeeConfig = {
  management?: number | null
  performance?: number | null
}

const MORPHO_STRATEGY_TO_VAULT: Record<string, string> = {
  // USDC
  '0xd46dfdaa7caa8739b0e3274e2c085dffc8d4776a':
    '0xE4248e2105508FcBad3fe95691551d1AF14015f7',
  '0x78ec25fba1baf6b7dc097ebb8115a390a2a4ee12':
    '0xCE2b8e464Fc7b5E58710C24b7e5EBFB6027f29D7',
  '0x58b369aec52dd904f70122cf72ed311f7aae3bac':
    '0x61D4F9D3797BA4dA152238c53a6f93Fb665C3c1d',
  '0xb542f002f4fc811effe6465205872cc0fb5ae24c':
    '0x1445A01a57D7B7663CfD7B4EE0a8Ec03B379aabD',

  // USDT
  '0x156c729c78076b7cd815d01ca6967c00c5ac8d9c':
    '0x8ED68f91AfbE5871dCE31ae007a936ebE8511d47',
  '0x543cc24962b540430dd1121e83e8564770da6810':
    '0x1ecDC3F2B5E90bfB55fF45a7476FF98A8957388E',

  // ETH
  '0x37a79bfb9f645f8ed0a9ead9c722710d8f47c431':
    '0xFaDe0C546f44e33C134c4036207B314AC643dc2E',
  '0xea79c91540c7e884e6e0069ce036e52f7bbb1194':
    '0xC5e7AB07030305fc925175b25B93b285d40dCdFf',

  // AUSD
  '0xc1ec6d26902949bf6cbb0c9859dbead1e87fb243':
    '0x82c4C641CCc38719ae1f0FBd16A64808d838fDfD',
  '0xf7ede5332c6b4a235be4aa3c019222cfe72e984f':
    '0x9540441C503D763094921dbE4f13268E6d1d3B56',

  // WBTC
  '0x0a1937f0d7f15b9adee5d96616f269a0c6749c6d':
    '0xf243523996ADbb273F0B237B53f30017C4364bBC',
  '0xc1b365011dd4a8db71eb7c5aa016ee4e456d15c5':
    '0xe107cCdeb8e20E499545C813f98Cc90619b29859',
}

export interface StrategyForwardAprEstimate {
  strategyAddress: string
  apr: number | null
  apy: number | null
  components: Record<string, number | null>
  underlyingContract?: string
  covered: boolean
}

export interface VaultForwardAprEstimate {
  forwardAPR: {
    type: typeof ESTIMATED_APR_TYPE
    apr?: number | null
    apy?: number | null
    netAPR?: number | null
    netAPY?: number | null
    components: Record<string, number | null>
  }
  strategies: Record<string, StrategyForwardAprEstimate>
}

const toFiniteNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toPositiveDebt = (strategy: YearnStrategy): number => {
  const parsed = Number(strategy.details?.totalDebt ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const toPositiveTotalAssets = (vault: YearnVault): number => {
  const parsed = Number(vault.tvl?.totalAssets ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export const computeNetApr = (grossApr: number, fees: FeeConfig): number => {
  if (grossApr <= 0) {
    return 0
  }

  const management = toFiniteNumber(fees.management)
  const performance = toFiniteNumber(fees.performance)
  const net = (grossApr - management) * (1 - performance)

  return Math.max(net, grossApr / 2)
}

const normalizeAddress = (address?: string | null): string | undefined => {
  if (!address || !isAddress(address)) {
    return undefined
  }
  return address.toLowerCase()
}

const isTokenAddress = (left?: string, right?: string): boolean => {
  if (!left || !right || !isAddress(left) || !isAddress(right)) {
    return false
  }
  return isAddressEqual(left as `0x${string}`, right as `0x${string}`)
}

const isMorphoStrategy = (strategy: YearnStrategy): boolean =>
  strategy.name.toLowerCase().includes('morpho')

const isLenderBorrowerStrategy = (strategy: YearnStrategy): boolean =>
  strategy.name.toLowerCase().includes('lender borrower')

const isSteerStrategy = (strategy: YearnStrategy): boolean =>
  strategy.name.toLowerCase().includes('steer')

const identifierMatchesAddress = (
  identifier?: string,
  address?: string,
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

const isOpportunityType = (
  opportunity: MerklOpportunity,
  type: string,
): boolean => opportunity.type?.toUpperCase() === type

const isLiveOpportunity = (opportunity: MerklOpportunity): boolean =>
  opportunity.status.toUpperCase() === 'LIVE'

const dedupeOpportunities = (
  opportunities: MerklOpportunity[],
): MerklOpportunity[] => {
  const seen = new Set<string>()

  return opportunities.filter((opportunity) => {
    const key = [
      opportunity.id ?? '',
      opportunity.type ?? '',
      opportunity.identifier.toLowerCase(),
    ].join('|')

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

const findMorphoFallbackOpportunities = (
  opportunities: MerklOpportunity[],
  strategyAddress: string,
  morphoVaultAddress: string,
): MerklOpportunity[] => {
  const liveOpportunities = opportunities.filter(isLiveOpportunity)
  const underlyingMatches = liveOpportunities.filter((opportunity) =>
    identifierMatchesAddress(opportunity.identifier, morphoVaultAddress),
  )
  const strategyMatches = liveOpportunities.filter((opportunity) =>
    identifierMatchesAddress(opportunity.identifier, strategyAddress),
  )

  return dedupeOpportunities([
    ...underlyingMatches.filter((opportunity) =>
      isOpportunityType(opportunity, 'MORPHOVAULT'),
    ),
    ...underlyingMatches.filter(
      (opportunity) => !isOpportunityType(opportunity, 'MORPHOVAULT'),
    ),
    ...strategyMatches,
  ])
}

const sumMerklCampaignApr = (
  opportunity: MerklOpportunity,
  rewardTokenAddresses: string[],
): number => {
  const campaigns = opportunity.campaigns || []
  const breakdowns = opportunity.aprRecord?.breakdowns || []

  return campaigns.reduce((sum, campaign) => {
    if (
      !rewardTokenAddresses.some((address) =>
        isTokenAddress(campaign.rewardToken.address, address),
      )
    ) {
      return sum
    }

    const breakdown = breakdowns.find(
      (item) =>
        item.identifier?.toLowerCase() ===
        String(campaign.campaignId).toLowerCase(),
    )

    return sum + toFiniteNumber(breakdown?.value) / 100
  }, 0)
}

export class ForwardAprCalculator {
  constructor(
    private morphoApi = new MorphoApiService(),
    private merklApi = new MerklApiService(),
  ) {}

  async calculateVaultForwardAPRs(
    vaults: YearnVault[],
  ): Promise<Record<string, VaultForwardAprEstimate>> {
    const morphoStrategies = vaults.flatMap((vault) =>
      vault.strategies.filter(
        (strategy) => isMorphoStrategy(strategy) && !isLenderBorrowerStrategy(strategy),
      ),
    )
    const resolvedMorphoVaults = Object.fromEntries(
      morphoStrategies
        .map((strategy) => {
          const strategyAddress = normalizeAddress(strategy.address)
          const morphoVaultAddress = this.resolveMorphoVaultAddress(strategy)

          return strategyAddress && morphoVaultAddress
            ? [strategyAddress, morphoVaultAddress]
            : null
        })
        .filter((entry): entry is [string, string] => entry !== null),
    )

    const morphoVaultEstimates = await this.morphoApi.getVaultEstimates(
      Object.values(resolvedMorphoVaults),
    )

    let merklMorphoOpportunities: MerklOpportunity[] | undefined

    const getMerklMorphoOpportunities = async () => {
      if (merklMorphoOpportunities === undefined) {
        merklMorphoOpportunities = await this.merklApi.getMorphoOpportunities()
      }
      return merklMorphoOpportunities
    }

    const results: Record<string, VaultForwardAprEstimate> = {}

    for (const vault of vaults) {
      results[vault.address] = await this.calculateVaultForwardAPR(
        vault,
        resolvedMorphoVaults,
        morphoVaultEstimates,
        getMerklMorphoOpportunities,
      )
    }

    return results
  }

  private async calculateVaultForwardAPR(
    vault: YearnVault,
    resolvedMorphoVaults: Record<string, string>,
    morphoVaultEstimates: Record<string, MorphoVaultEstimate>,
    getMerklMorphoOpportunities: () => Promise<MerklOpportunity[]>,
  ): Promise<VaultForwardAprEstimate> {
    const activeStrategies = vault.strategies.filter(
      (strategy) => strategy.status === 'active' && toPositiveDebt(strategy) > 0,
    )
    const totalActiveDebt = activeStrategies.reduce(
      (sum, strategy) => sum + toPositiveDebt(strategy),
      0,
    )
    const totalAssets = toPositiveTotalAssets(vault)

    if (totalActiveDebt === 0) {
      const grossApr = 0
      const netApr = computeNetApr(grossApr, vault.apr?.fees ?? {})

      return {
        forwardAPR: {
          type: ESTIMATED_APR_TYPE,
          apr: grossApr,
          apy: 0,
          netAPR: netApr,
          netAPY: aprToApy(netApr),
          components: {
            baseNetAPY: 0,
            morphoBaseAPY: 0,
            morphoRewardsAPR: 0,
            morphoRewardsAPY: 0,
            steerAPY: 0,
            estimatedDebtCoverage: totalAssets > 0 ? 0 : 1,
          },
        },
        strategies: {},
      }
    }

    const strategyEstimates: Record<string, StrategyForwardAprEstimate> = {}
    const totals: Record<string, number> = {
      baseNetAPY: 0,
      morphoBaseAPY: 0,
      morphoRewardsAPR: 0,
      morphoRewardsAPY: 0,
      morphoKatRewardsAPR: 0,
      steerAPY: 0,
      oracleAPY: 0,
    }
    let coveredDebt = 0
    let totalApy = 0

    for (const strategy of activeStrategies) {
      const strategyAddress = normalizeAddress(strategy.address)
      if (!strategyAddress) {
        continue
      }

      const debt = toPositiveDebt(strategy)
      const weight = totalAssets > 0 ? debt / totalAssets : 0
      const estimate = await this.calculateStrategyForwardAPR(
        strategy,
        resolvedMorphoVaults[strategyAddress],
        morphoVaultEstimates,
        getMerklMorphoOpportunities,
      )
      strategyEstimates[strategyAddress] = estimate

      if (!estimate.covered || estimate.apy == null) {
        continue
      }

      coveredDebt += debt
      totalApy += estimate.apy * weight

      for (const [component, value] of Object.entries(estimate.components)) {
        totals[component] = (totals[component] || 0) + toFiniteNumber(value) * weight
      }
    }

    const estimatedDebtCoverage =
      totalAssets > 0 ? coveredDebt / totalAssets : 0
    const activeDebtCoverage = coveredDebt / totalActiveDebt
    const components: Record<string, number | null> = {
      baseNetAPY: totals.baseNetAPY,
      morphoBaseAPY: totals.morphoBaseAPY,
      morphoRewardsAPR: totals.morphoRewardsAPR,
      morphoRewardsAPY: totals.morphoRewardsAPY,
      morphoKatRewardsAPR: totals.morphoKatRewardsAPR,
      steerAPY: totals.steerAPY,
      oracleAPY: totals.oracleAPY,
      estimatedDebtCoverage,
    }
    const shouldEmitTopLevel = totalAssets > 0 && activeDebtCoverage >= 0.999999
    const grossApr = shouldEmitTopLevel ? apyToApr(totalApy) : undefined
    const netApr = grossApr != null
      ? computeNetApr(grossApr, vault.apr?.fees ?? {})
      : undefined

    return {
      forwardAPR: {
        type: ESTIMATED_APR_TYPE,
        ...(shouldEmitTopLevel && grossApr != null && netApr != null
          ? {
              apr: grossApr,
              apy: totalApy,
              netAPR: netApr,
              netAPY: aprToApy(netApr),
            }
          : {}),
        components,
      },
      strategies: strategyEstimates,
    }
  }

  private async calculateStrategyForwardAPR(
    strategy: YearnStrategy,
    morphoVaultAddress: string | undefined,
    morphoVaultEstimates: Record<string, MorphoVaultEstimate>,
    getMerklMorphoOpportunities: () => Promise<MerklOpportunity[]>,
  ): Promise<StrategyForwardAprEstimate> {
    if (isMorphoStrategy(strategy) && !isLenderBorrowerStrategy(strategy)) {
      return this.calculateMorphoStrategyForwardAPR(
        strategy,
        morphoVaultAddress,
        morphoVaultEstimates,
        getMerklMorphoOpportunities,
      )
    }

    return this.calculateOracleStrategyForwardAPR(strategy)
  }

  private async calculateMorphoStrategyForwardAPR(
    strategy: YearnStrategy,
    morphoVaultAddress: string | undefined,
    morphoVaultEstimates: Record<string, MorphoVaultEstimate>,
    getMerklMorphoOpportunities: () => Promise<MerklOpportunity[]>,
  ): Promise<StrategyForwardAprEstimate> {
    if (!morphoVaultAddress) {
      return this.uncoveredStrategyEstimate(strategy, morphoVaultAddress)
    }

    const estimate =
      morphoVaultEstimates[morphoVaultAddress.toLowerCase()] ||
      this.estimateMorphoFromMerkl(
        strategy,
        morphoVaultAddress,
        await getMerklMorphoOpportunities(),
      )

    if (!estimate) {
      return this.uncoveredStrategyEstimate(strategy, morphoVaultAddress)
    }

    const morphoRewardsAPY = aprToApy(estimate.morphoRewardsApr)
    const apy = estimate.baseApy + morphoRewardsAPY

    return {
      strategyAddress: strategy.address,
      apr: apyToApr(apy),
      apy,
      underlyingContract: morphoVaultAddress,
      covered: true,
      components: {
        baseNetAPY: estimate.baseApy,
        morphoBaseAPY: estimate.baseApy,
        morphoRewardsAPR: estimate.morphoRewardsApr,
        morphoRewardsAPY,
        morphoKatRewardsAPR: estimate.katRewardsApr,
      },
    }
  }

  private calculateOracleStrategyForwardAPR(
    strategy: YearnStrategy,
  ): StrategyForwardAprEstimate {
    const oracleAPY =
      this.toFiniteNumberOrNull(strategy.oracleAPY) ??
      (strategy.oracleAPR != null ? aprToApy(strategy.oracleAPR) : null) ??
      (strategy.netAPR != null ? aprToApy(strategy.netAPR) : null)

    if (oracleAPY == null) {
      return this.uncoveredStrategyEstimate(strategy)
    }

    const components: Record<string, number | null> = isSteerStrategy(strategy)
      ? {
          baseNetAPY: oracleAPY,
          steerAPY: oracleAPY,
        }
      : {
          baseNetAPY: oracleAPY,
          oracleAPY,
        }

    return {
      strategyAddress: strategy.address,
      apr: apyToApr(oracleAPY),
      apy: oracleAPY,
      covered: true,
      components,
    }
  }

  private estimateMorphoFromMerkl(
    strategy: YearnStrategy,
    morphoVaultAddress: string,
    opportunities: MerklOpportunity[],
  ): MorphoVaultEstimate | undefined {
    const fallbackOpportunities = findMorphoFallbackOpportunities(
      opportunities,
      strategy.address,
      morphoVaultAddress,
    )

    for (const opportunity of fallbackOpportunities) {
      const estimate = this.normalizeMerklMorphoEstimate(
        opportunity,
        morphoVaultAddress,
      )

      if (estimate) {
        return estimate
      }
    }

    return undefined
  }

  private normalizeMerklMorphoEstimate(
    opportunity: MerklOpportunity,
    morphoVaultAddress: string,
  ): MorphoVaultEstimate | undefined {
    const baseApy = toFiniteNumber(opportunity.nativeAprRecord?.value) / 100
    const morphoRewardsApr = sumMerklCampaignApr(opportunity, [
      MORPHO_REWARD_TOKEN_ADDRESS,
    ])
    const katRewardsApr = sumMerklCampaignApr(opportunity, [
      ...KATANA_REWARD_TOKEN_ADDRESSES,
    ])

    if (baseApy === 0 && morphoRewardsApr === 0) {
      return undefined
    }

    return {
      address: morphoVaultAddress.toLowerCase(),
      name: opportunity.name,
      symbol: '',
      baseApy,
      totalApy: baseApy + aprToApy(morphoRewardsApr),
      morphoRewardsApr,
      katRewardsApr,
    }
  }

  private resolveMorphoVaultAddress(strategy: YearnStrategy): string | undefined {
    const strategyAddress = normalizeAddress(strategy.address)
    const staticAddress = strategyAddress
      ? MORPHO_STRATEGY_TO_VAULT[strategyAddress]
      : undefined

    return (
      normalizeAddress(strategy.underlyingContract) ||
      normalizeAddress(staticAddress)
    )
  }

  private uncoveredStrategyEstimate(
    strategy: YearnStrategy,
    underlyingContract?: string,
  ): StrategyForwardAprEstimate {
    return {
      strategyAddress: strategy.address,
      apr: null,
      apy: null,
      underlyingContract,
      covered: false,
      components: {},
    }
  }

  private toFiniteNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
}
