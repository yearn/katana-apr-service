import { isAddressEqual } from 'viem'
import { config } from '../../config'
import type { YearnStrategy, YearnVault } from '../../types'
import { ContractReaderService } from '../contractReader'
import { MerklApiService } from '../externalApis/merklApi'
import {
  type MorphoVaultEstimate,
  MorphoApiService,
} from '../externalApis/morphoApi'
import { KATANA_REWARD_TOKEN_ADDRESSES } from '../katanaRewardTokens'
import type { Opportunity } from './types'

const WEEKS_PER_YEAR = 52
const STATIC_MORPHO_STRATEGY_TO_VAULT: Record<string, string> = {
  '0x1e35da1b596208ce5059d0b4f4d08410426849b8':
    '0xa2d38c8a3d810ebcf4c2075821c5ec8f976bb692',
}

type ForwardAPR = NonNullable<NonNullable<YearnVault['apr']>['forwardAPR']>

export interface StrategyForwardEstimate {
  address: string
  estimatedAPR: number | null
  estimatedAPY: number | null
  estimatedGrossAPR: number
  estimatedGrossAPY: number
  estimatedNetAPR: number
  estimatedNetAPY: number
  estimatedComponents: Record<string, number | null>
}

export interface VaultForwardEstimate {
  forwardAPR: ForwardAPR
  strategies: Record<string, StrategyForwardEstimate>
}

const normalizeAddress = (address?: string | null): string | undefined =>
  address?.toLowerCase()

const isPositiveDebt = (debt?: string): boolean => {
  try {
    return BigInt(debt || '0') > BigInt(0)
  } catch {
    return false
  }
}

const toFiniteNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const getStrategyDebt = (strategy: YearnStrategy): bigint => {
  try {
    return BigInt(strategy.details?.totalDebt || '0')
  } catch {
    return BigInt(0)
  }
}

const getVaultTotalAssets = (vault: YearnVault): bigint => {
  try {
    return BigInt(vault.tvl?.totalAssets || '0')
  } catch {
    return BigInt(0)
  }
}

export const aprToApy = (apr: number): number =>
  (1 + apr / WEEKS_PER_YEAR) ** WEEKS_PER_YEAR - 1

export const apyToApr = (apy: number): number =>
  ((1 + apy) ** (1 / WEEKS_PER_YEAR) - 1) * WEEKS_PER_YEAR

export const computeNetApr = (
  grossApr: number,
  fees: { management?: number; performance?: number } = {},
): number => {
  if (grossApr <= 0) {
    return 0
  }

  const net =
    (grossApr - toFiniteNumber(fees.management)) *
    (1 - toFiniteNumber(fees.performance))

  return Math.max(net, grossApr / 2)
}

const safeIsAddressEqual = (left?: string, right?: string): boolean => {
  if (!left || !right) {
    return false
  }

  try {
    return isAddressEqual(left as `0x${string}`, right as `0x${string}`)
  } catch {
    return false
  }
}

const isKatRewardToken = (address?: string): boolean =>
  KATANA_REWARD_TOKEN_ADDRESSES.some((katAddress) =>
    safeIsAddressEqual(katAddress, address),
  )

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

const getOpportunityAprs = (
  opportunity?: Opportunity,
): { morphoRewardsAPR: number; morphoKatRewardsAPR: number } => {
  if (!opportunity?.campaigns?.length) {
    return { morphoRewardsAPR: 0, morphoKatRewardsAPR: 0 }
  }

  const breakdowns = opportunity.aprRecord?.breakdowns || []

  return opportunity.campaigns.reduce(
    (accumulator, campaign) => {
      const aprBreakdown = breakdowns.find(
        (breakdown) =>
          breakdown.identifier?.toLowerCase() ===
          campaign.campaignId?.toLowerCase(),
      )
      const apr = toFiniteNumber(aprBreakdown?.value) / 100
      if (apr <= 0) {
        return accumulator
      }

      if (isKatRewardToken(campaign.rewardToken.address)) {
        accumulator.morphoKatRewardsAPR += apr
      } else {
        accumulator.morphoRewardsAPR += apr
      }

      return accumulator
    },
    { morphoRewardsAPR: 0, morphoKatRewardsAPR: 0 },
  )
}

const findMorphoFallbackOpportunity = (
  opportunities: Opportunity[],
  underlyingAddress?: string,
  strategyAddress?: string,
): Opportunity | undefined => {
  const underlyingMorphoVault = opportunities.find(
    (opportunity) =>
      opportunity.type === 'MORPHOVAULT' &&
      identifierMatchesAddress(opportunity.identifier, underlyingAddress),
  )

  if (underlyingMorphoVault) {
    return underlyingMorphoVault
  }

  return opportunities.find(
    (opportunity) =>
      opportunity.type === 'MORPHOVAULT' &&
      identifierMatchesAddress(opportunity.identifier, strategyAddress),
  )
}

const getResolvedMorphoVaultAddress = (
  strategy: YearnStrategy,
  strategyToVault: Record<string, string>,
): string | undefined => {
  const strategyAddress = normalizeAddress(strategy.address)
  if (!strategyAddress) {
    return undefined
  }

  return (
    strategyToVault[strategyAddress] ||
    STATIC_MORPHO_STRATEGY_TO_VAULT[strategyAddress] ||
    normalizeAddress(strategy.underlyingContract)
  )
}

const isMorphoVaultStrategy = (strategy: YearnStrategy): boolean =>
  Boolean(
    strategy.name?.includes('Morpho') &&
      !strategy.name.includes('Lender Borrower'),
  )

const buildStrategyEstimate = (
  strategy: YearnStrategy,
  grossAPY: number,
  components: Record<string, number | null>,
  fees: NonNullable<YearnVault['apr']>['fees'],
): StrategyForwardEstimate => {
  const grossAPR = apyToApr(grossAPY)
  const netAPR = computeNetApr(grossAPR, fees)
  const netAPY = aprToApy(netAPR)

  return {
    address: strategy.address,
    estimatedAPR: netAPR,
    estimatedAPY: netAPY,
    estimatedGrossAPR: grossAPR,
    estimatedGrossAPY: grossAPY,
    estimatedNetAPR: netAPR,
    estimatedNetAPY: netAPY,
    estimatedComponents: components,
  }
}

export class ForwardAprCalculator {
  private contractReader: ContractReaderService
  private merklApi: MerklApiService
  private morphoApi: MorphoApiService

  constructor(
    contractReader = new ContractReaderService(),
    merklApi = new MerklApiService(),
    morphoApi = new MorphoApiService(),
  ) {
    this.contractReader = contractReader
    this.merklApi = merklApi
    this.morphoApi = morphoApi
  }

  async calculateVaultForwardAPRs(
    vaults: YearnVault[],
  ): Promise<Record<string, VaultForwardEstimate>> {
    const morphoStrategies = vaults.flatMap((vault) =>
      vault.strategies.filter(
        (strategy) =>
          isMorphoVaultStrategy(strategy) &&
          isPositiveDebt(strategy.details?.totalDebt),
      ),
    )
    const morphoStrategyAddresses = morphoStrategies.map(
      (strategy) => strategy.address,
    )
    const strategyToVault = await this.resolveMorphoVaults(
      morphoStrategyAddresses,
    )
    const morphoVaultAddresses = morphoStrategies
      .map((strategy) => getResolvedMorphoVaultAddress(strategy, strategyToVault))
      .filter((address): address is string => !!address)
    const [morphoEstimates, morphoOpportunities] = await Promise.all([
      this.morphoApi.getVaultEstimates(morphoVaultAddresses, config.katanaChainId),
      this.merklApi.getMorphoOpportunities(),
    ])

    return Object.fromEntries(
      vaults
        .filter((vault) =>
          vault.strategies.some((strategy) =>
            isPositiveDebt(strategy.details?.totalDebt),
          ),
        )
        .map((vault) => [
          vault.address,
          this.calculateVaultForwardAPR(
            vault,
            strategyToVault,
            morphoEstimates,
            morphoOpportunities,
          ),
        ]),
    )
  }

  private async resolveMorphoVaults(
    strategyAddresses: string[],
  ): Promise<Record<string, string>> {
    const onChainMappings =
      await this.contractReader.getMorphoVaultsFromStrategies(strategyAddresses)

    return Object.fromEntries(
      Object.entries(onChainMappings).map(([strategy, vault]) => [
        strategy.toLowerCase(),
        vault.toLowerCase(),
      ]),
    )
  }

  private calculateVaultForwardAPR(
    vault: YearnVault,
    strategyToVault: Record<string, string>,
    morphoEstimates: Record<string, MorphoVaultEstimate>,
    morphoOpportunities: Opportunity[],
  ): VaultForwardEstimate {
    const totalAssets = getVaultTotalAssets(vault)
    const activeStrategies = vault.strategies.filter((strategy) =>
      isPositiveDebt(strategy.details?.totalDebt),
    )
    const totalActiveDebt = activeStrategies.reduce(
      (sum, strategy) => sum + getStrategyDebt(strategy),
      BigInt(0),
    )
    const strategies: Record<string, StrategyForwardEstimate> = {}
    const weightedComponents: Record<string, number> = {
      baseNetAPY: 0,
      morphoBaseAPY: 0,
      morphoRewardsAPR: 0,
      morphoRewardsAPY: 0,
      morphoKatRewardsAPR: 0,
      steerAPY: 0,
      oracleAPY: 0,
    }
    let coveredDebt = BigInt(0)
    let weightedGrossAPY = 0
    let weightedNetAPY = 0

    for (const strategy of activeStrategies) {
      const estimate = isMorphoVaultStrategy(strategy)
        ? this.calculateMorphoStrategyEstimate(
            strategy,
            strategyToVault,
            morphoEstimates,
            morphoOpportunities,
            vault.apr?.fees,
          )
        : this.calculateOracleStrategyEstimate(strategy, vault.apr?.fees)

      if (!estimate) {
        continue
      }

      const debt = getStrategyDebt(strategy)
      const weight =
        totalAssets > BigInt(0) ? Number(debt) / Number(totalAssets) : 0
      coveredDebt += debt
      strategies[strategy.address.toLowerCase()] = estimate
      weightedGrossAPY += estimate.estimatedGrossAPY * weight
      weightedNetAPY += estimate.estimatedNetAPY * weight

      for (const [component, value] of Object.entries(
        estimate.estimatedComponents,
      )) {
        weightedComponents[component] =
          (weightedComponents[component] || 0) + toFiniteNumber(value) * weight
      }
    }

    const estimatedDebtCoverage =
      totalActiveDebt > BigInt(0)
        ? Number(coveredDebt) / Number(totalActiveDebt)
        : 1
    const components: Record<string, number | null> = {
      ...weightedComponents,
      estimatedDebtCoverage,
    }
    const allActiveDebtCovered = estimatedDebtCoverage >= 0.999999999
    const grossAPR = allActiveDebtCovered ? apyToApr(weightedGrossAPY) : null
    const netAPR = allActiveDebtCovered ? apyToApr(weightedNetAPY) : null

    return {
      forwardAPR: {
        type: 'katana-estimated-apr',
        apr: netAPR,
        apy: allActiveDebtCovered ? weightedNetAPY : null,
        grossAPR,
        grossAPY: allActiveDebtCovered ? weightedGrossAPY : null,
        netAPR,
        netAPY: allActiveDebtCovered ? weightedNetAPY : null,
        components,
      },
      strategies,
    }
  }

  private calculateMorphoStrategyEstimate(
    strategy: YearnStrategy,
    strategyToVault: Record<string, string>,
    morphoEstimates: Record<string, MorphoVaultEstimate>,
    morphoOpportunities: Opportunity[],
    fees: NonNullable<YearnVault['apr']>['fees'],
  ): StrategyForwardEstimate | null {
    const morphoVaultAddress = getResolvedMorphoVaultAddress(
      strategy,
      strategyToVault,
    )
    const morphoEstimate = morphoVaultAddress
      ? morphoEstimates[morphoVaultAddress.toLowerCase()]
      : undefined
    const apiRewards = morphoEstimate?.rewards.reduce(
      (accumulator, reward) => {
        if (isKatRewardToken(reward.tokenAddress)) {
          accumulator.morphoKatRewardsAPR += reward.supplyApr
        } else {
          accumulator.morphoRewardsAPR += reward.supplyApr
        }

        return accumulator
      },
      { morphoRewardsAPR: 0, morphoKatRewardsAPR: 0 },
    ) || { morphoRewardsAPR: 0, morphoKatRewardsAPR: 0 }
    const fallbackRewards = getOpportunityAprs(
      findMorphoFallbackOpportunity(
        morphoOpportunities,
        morphoVaultAddress,
        strategy.address,
      ),
    )
    const morphoBaseAPY = morphoEstimate?.baseAPY || 0
    const morphoRewardsAPR =
      apiRewards.morphoRewardsAPR || fallbackRewards.morphoRewardsAPR
    const morphoKatRewardsAPR =
      apiRewards.morphoKatRewardsAPR || fallbackRewards.morphoKatRewardsAPR
    const morphoRewardsAPY = aprToApy(morphoRewardsAPR)
    const grossAPY = morphoBaseAPY + morphoRewardsAPY

    if (grossAPY <= 0) {
      return null
    }

    return buildStrategyEstimate(
      strategy,
      grossAPY,
      {
        baseNetAPY: morphoBaseAPY,
        morphoBaseAPY,
        morphoRewardsAPR,
        morphoRewardsAPY,
        morphoKatRewardsAPR,
      },
      fees,
    )
  }

  private calculateOracleStrategyEstimate(
    strategy: YearnStrategy,
    fees: NonNullable<YearnVault['apr']>['fees'],
  ): StrategyForwardEstimate | null {
    const oracleAPY = toFiniteNumberOrNull(strategy.oracleAPY)
    const oracleAPR = toFiniteNumberOrNull(strategy.oracleAPR)
    const latestReportAPR = toFiniteNumberOrNull(strategy.netAPR)
    const estimatedAPY =
      oracleAPY ??
      (oracleAPR !== null ? aprToApy(oracleAPR) : null) ??
      (latestReportAPR !== null ? aprToApy(latestReportAPR) : null)

    if (estimatedAPY === null) {
      return null
    }

    return buildStrategyEstimate(
      strategy,
      estimatedAPY,
      {
        baseNetAPY: estimatedAPY,
        steerAPY: strategy.name?.includes('Steer') ? estimatedAPY : 0,
        oracleAPY: estimatedAPY,
      },
      fees,
    )
  }
}
