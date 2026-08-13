import _ from 'lodash'
import { config } from '../config/index'
import type { YearnStrategy, YearnVault, YearnVaultAPY } from '../types/index'
import { YearnApiService } from './externalApis/yearnApi'
import { MorphoAprCalculator } from './aprCalcs/morphoAprCalculator'
import {
  MorphoUnderlyingAprCalculator,
  type MorphoUnderlyingAprResult,
} from './aprCalcs/morphoUnderlyingAprCalculator'
import { SushiAprCalculator } from './aprCalcs/sushiAprCalculator'
import { YearnAprCalculator } from './aprCalcs/yearnAprCalculator'
import { logVaultAprDebug } from './aprCalcs/debugLogger'
import {
  type RewardCalculatorResult,
  TokenBreakdown,
  type VaultRewardCalculatorResult,
  YearnRewardCalculatorResult,
} from './aprCalcs/types'

export interface VaultAPRData {
  name: string
  apr: number
  pools?: string[]
  breakdown: TokenBreakdown[]
}

export interface APRDataCache {
  [vaultAddress: string]: YearnVault
}

export type { TokenBreakdown }

interface StrategyRewardSummary {
  rawApr: number
  rewardToken?: TokenBreakdown['token']
  underlyingContract?: string
}

const KATANA_ACCOUNTANT_DEFAULT_MAX_FEE = 0.5

export class DataCacheService {
  private yearnApi: YearnApiService
  private yearnAprCalculator: YearnAprCalculator
  private morphoAprCalculator: MorphoAprCalculator
  private morphoUnderlyingAprCalculator: MorphoUnderlyingAprCalculator
  private sushiAprCalculator: SushiAprCalculator

  constructor() {
    this.yearnApi = new YearnApiService()
    this.yearnAprCalculator = new YearnAprCalculator()
    this.morphoAprCalculator = new MorphoAprCalculator()
    this.morphoUnderlyingAprCalculator = new MorphoUnderlyingAprCalculator()
    this.sushiAprCalculator = new SushiAprCalculator()
  }

  async generateVaultAPRData(): Promise<APRDataCache> {
    console.log('\nGenerating vault APR data...\n----------------------')
    // get all vaults
    const vaults: YearnVault[] = await this.yearnApi.getVaults(
      config.katanaChainId,
    )

    if (vaults.length === 0) {
      throw new Error(
        `No vaults returned from Kong (chainId=${config.katanaChainId})`,
      )
    }

    // Get APR data from each calculator
    const [
      yearnAPRs,
      morphoAPRs,
      morphoUnderlyingAPRs,
      sushiAPRs,
    ] = await Promise.all([
      this.yearnAprCalculator.calculateVaultAPRs(vaults),
      this.morphoAprCalculator.calculateVaultAPRs(vaults),
      this.morphoUnderlyingAprCalculator.calculateVaultAPRs(vaults),
      this.sushiAprCalculator.calculateVaultAPRs(vaults),
    ])

    // Aggregate results for each vault
    const aprDataCache: APRDataCache = _.chain(vaults)
      .map((vault) => {
        try {
          const allResults = _.chain([
            yearnAPRs[vault.address],
            morphoAPRs[vault.address],
            sushiAPRs[vault.address],
          ])
            .flattenDeep()
            .compact()
            .value()
          const morphoUnderlyingResults =
            morphoUnderlyingAPRs[vault.address] || []

          if (
            allResults.length === 0 &&
            morphoUnderlyingResults.length === 0
          ) {
            logVaultAprDebug({
              stage: 'fallback',
              vaultAddress: vault.address,
              vaultName: vault.name,
              vaultSymbol: vault.symbol,
              reason: 'empty_results_after_calculation',
            })
            return [
              vault.address,
              {
                name: vault.name,
                apr: 0,
                pools: undefined,
                breakdown: [],
              },
            ]
          }

          logVaultAprDebug({
            stage: 'result_summary',
            vaultAddress: vault.address,
            vaultName: vault.name,
            vaultSymbol: vault.symbol,
            acceptedCampaigns: allResults.length,
            reason: 'vault_results_aggregated',
          })

          return [
            vault.address,
            this.aggregateVaultResults(
              vault,
              allResults,
              morphoUnderlyingResults,
            ),
          ]
        } catch (error) {
          console.error(`Error processing vault ${vault.address}:`, error)
          logVaultAprDebug({
            stage: 'fallback',
            vaultAddress: vault.address,
            vaultName: vault.name,
            vaultSymbol: vault.symbol,
            reason: 'exception_while_processing_vault',
          })
          return [
            vault.address,
            {
              name: vault.name,
              apr: 0,
              pools: undefined,
              breakdown: [],
            },
          ]
        }
      })
      .fromPairs()
      .value()

    console.log(
      `Generated APR data for ${Object.keys(aprDataCache).length} vaults`,
    )
    return aprDataCache
  }

  async getVaultAPRData(vaultAddress: string): Promise<YearnVault | null> {
    const cache = await this.generateVaultAPRData()
    return cache[vaultAddress] || null
  }

  async getAllVaultAPRData(): Promise<APRDataCache> {
    return await this.generateVaultAPRData()
  }

  private aggregateVaultResults(
    vault: YearnVault,
    results: VaultRewardCalculatorResult[],
    morphoUnderlyingResults: MorphoUnderlyingAprResult[] = [],
  ): YearnVault {
    const strategyResults = results.filter(
      (result): result is RewardCalculatorResult => 'strategyAddress' in result,
    )
    const strategyRewardsByAddress = this.buildStrategyRewardsByAddress(
      strategyResults,
    )
    const morphoUnderlyingByAddress = this.buildMorphoUnderlyingByAddress(
      morphoUnderlyingResults,
    )

    const strategiesWithRewards = (vault.strategies || []).map((strategy) => {
      const strategyAddress = this.normalizeAddress(strategy.address)
      const strategyRewards = strategyAddress
        ? strategyRewardsByAddress[strategyAddress]
        : undefined
      const morphoUnderlying = strategyAddress
        ? morphoUnderlyingByAddress[strategyAddress]
        : undefined
      const strategyRewardsAPR = strategyRewards
        ? strategyRewards.rawApr > 0
          ? strategyRewards.rawApr
          : strategy.strategyRewardsAPR ?? strategyRewards.rawApr
        : strategy.strategyRewardsAPR ?? null
      const liveStrategyNetAPR =
        morphoUnderlying && this.hasLiveMorphoReplacement(morphoUnderlying)
          ? morphoUnderlying.replacementAPR
          : this.getKongOracleAPR(strategy)

      return {
        ...strategy,
        netAPR: liveStrategyNetAPR,
        ...(morphoUnderlying
          ? {
              morphoUnderlyingAPR: {
                morphoVaultAddress: morphoUnderlying.morphoVaultAddress,
                usedMorphoApi: morphoUnderlying.usedMorphoApi,
                morphoBaseAPR: morphoUnderlying.morphoBaseAPR,
                morphoBaseAPY: morphoUnderlying.morphoBaseAPY,
                morphoRewardsAPR: morphoUnderlying.morphoRewardsAPR,
                estimatedAPR: morphoUnderlying.replacementAPR,
                estimatedAPY: morphoUnderlying.estimatedAPY,
              },
            }
          : {}),
        ...(strategyRewards
          ? {
              strategyRewardsAPR,
              rewardToken: strategyRewards.rewardToken
                ? { ...strategyRewards.rewardToken }
                : strategy.rewardToken ?? null,
              underlyingContract:
                strategyRewards.underlyingContract ??
                strategy.underlyingContract ??
                null,
            }
          : {
              strategyRewardsAPR: strategy.strategyRewardsAPR ?? null,
              rewardToken: strategy.rewardToken ?? null,
              underlyingContract: strategy.underlyingContract ?? null,
            }),
      }
    })

    // Find vault-level APR results (where vaultAddress matches vault.address)
    const vaultLevelResults = results.filter(
      (result): result is YearnRewardCalculatorResult =>
        'vaultAddress' in result && result.vaultAddress === vault.address,
    )

    // Separate results by pool type
    const yearnResults = vaultLevelResults.filter((r) => r.poolType === 'yearn')

    // Calculate APRs for each type
    const yearnVaultRewards = yearnResults.reduce(
      (sum, result) =>
        sum + (result.breakdown?.apr ? result.breakdown.apr / 100 : 0),
      0,
    )

    const vaultKatanaBonusAPY = 0

    const katanaNativeYield = vault.apr?.netAPR || 0
    const forwardAPR = this.buildForwardAPR(
      vault,
      morphoUnderlyingResults,
    )

    const apr = {
      ...vault.apr,
      ...(forwardAPR ? { forwardAPR } : {}),
      extra: {
        ...(vault.apr?.extra || {}),
        stakingRewardsAPR: null,
        gammaRewardAPR: null,
        katanaRewardsAPR: yearnVaultRewards || 0, // legacy field
        katanaAppRewardsAPR: yearnVaultRewards || 0,
        fixedRateKatanaRewards: 0,
        katanaBonusAPY: vaultKatanaBonusAPY,
        katanaNativeYield,
        steerPointsPerDollar: 0,
      },
    }

    const newVault: YearnVault = {
      address: vault.address,
      symbol: vault.symbol,
      name: vault.name,
      chainID: vault.chainID,
      token: vault.token,
      tvl: vault.tvl,
      apr,
      strategies: strategiesWithRewards,
    }

    return newVault
  }

  private buildForwardAPR(
    vault: YearnVault,
    morphoUnderlyingResults: MorphoUnderlyingAprResult[],
  ): YearnVaultAPY['forwardAPR'] | undefined {
    if (morphoUnderlyingResults.length === 0) {
      return vault.apr?.forwardAPR
    }

    const liveMorphoResults = morphoUnderlyingResults.filter(
      this.hasLiveMorphoReplacement,
    )
    const morphoReplacementByStrategy = new Map(
      liveMorphoResults.map((result) => [
        result.strategyAddress.toLowerCase(),
        result.replacementAPR,
      ]),
    )
    const allocatedStrategies = (vault.strategies || [])
      .map((strategy) => ({
        strategy,
        debtShare: this.getStrategyDebtShare(strategy, vault),
      }))
      .filter(({ debtShare }) => debtShare > 0)

    const strategiesWithForwardAPR = allocatedStrategies.map((allocation) => ({
      ...allocation,
      forwardAPR:
        morphoReplacementByStrategy.get(
          allocation.strategy.address.toLowerCase(),
        ) ?? this.getKongOracleAPR(allocation.strategy),
    }))
    const hasCompleteForwardCoverage = strategiesWithForwardAPR.every(
      ({ forwardAPR }) => forwardAPR !== null,
    )
    if (!hasCompleteForwardCoverage) {
      return vault.apr?.forwardAPR
    }

    const netAPR = strategiesWithForwardAPR.reduce((sum, allocation) => {
      return (
        sum +
        this.computeNetStrategyForwardAPR(
          allocation.forwardAPR!,
          allocation.debtShare,
          vault,
        )
      )
    }, 0)

    return {
      type: vault.apr?.forwardAPR?.type || '',
      netAPR,
      composite: vault.apr?.forwardAPR?.composite || {
        boost: null,
        poolAPY: null,
        boostedAPR: null,
        baseAPR: null,
        cvxAPR: null,
        rewardsAPR: null,
      },
      morphoUnderlying: this.buildVaultMorphoUnderlyingAPR(
        vault,
        liveMorphoResults,
      ),
    }
  }

  private buildVaultMorphoUnderlyingAPR(
    vault: YearnVault,
    morphoUnderlyingResults: Array<
      MorphoUnderlyingAprResult & { replacementAPR: number }
    >,
  ): NonNullable<YearnVaultAPY['forwardAPR']>['morphoUnderlying'] {
    const weighted = morphoUnderlyingResults.reduce(
      (accumulator, result) => {
        const strategy = vault.strategies.find(
          (candidate) =>
            candidate.address.toLowerCase() ===
            result.strategyAddress.toLowerCase(),
        )
        if (!strategy) {
          return accumulator
        }

        const debtShare = this.getStrategyDebtShare(strategy, vault)
        if (debtShare <= 0) {
          return accumulator
        }

        accumulator.baseAPR += result.morphoBaseAPR * debtShare
        accumulator.rewardsAPR += result.morphoRewardsAPR * debtShare
        accumulator.estimatedAPR += result.replacementAPR * debtShare
        accumulator.coveredDebtRatio += debtShare
        return accumulator
      },
      {
        baseAPR: 0,
        rewardsAPR: 0,
        estimatedAPR: 0,
        coveredDebtRatio: 0,
      },
    )

    return {
      ...weighted,
      estimatedAPY: this.convertAprToWeeklyApy(weighted.estimatedAPR),
    }
  }

  private computeNetStrategyForwardAPR(
    strategyAPR: number,
    debtShare: number,
    vault: YearnVault,
  ): number {
    const grossContribution = strategyAPR * debtShare
    if (grossContribution <= 0) {
      return 0
    }

    const managementFee = this.getFiniteFee(vault.apr?.fees?.management)
    const performanceFee = this.getFiniteFee(vault.apr?.fees?.performance)
    const maxFee = this.getFiniteFee(
      vault.apr?.fees?.maxFee,
      KATANA_ACCOUNTANT_DEFAULT_MAX_FEE,
    )
    const managementFeeContribution = managementFee * debtShare
    const uncappedFees =
      managementFeeContribution + grossContribution * performanceFee
    const totalFees =
      maxFee > 0
        ? Math.min(uncappedFees, grossContribution * maxFee)
        : uncappedFees
    const netAPR = grossContribution - totalFees

    return Math.max(netAPR, 0)
  }

  private getFiniteFee(value: number | undefined, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback
  }

  private getStrategyDebtShare(
    strategy: YearnStrategy,
    vault: YearnVault,
  ): number {
    const debtRatio = this.toFiniteNumber(strategy.details?.debtRatio)
    if (debtRatio > 0) {
      return debtRatio / 10_000
    }

    try {
      const strategyDebt = BigInt(String(strategy.details?.totalDebt ?? '0'))
      const vaultTotalAssets = BigInt(String(vault.tvl?.totalAssets ?? '0'))
      if (strategyDebt <= BigInt(0) || vaultTotalAssets <= BigInt(0)) {
        return 0
      }

      return Number(strategyDebt) / Number(vaultTotalAssets)
    } catch {
      return 0
    }
  }

  private hasLiveMorphoReplacement(
    result: MorphoUnderlyingAprResult,
  ): result is MorphoUnderlyingAprResult & {
    replacementAPR: number
  } {
    return (
      result.usedMorphoApi &&
      typeof result.replacementAPR === 'number' &&
      Number.isFinite(result.replacementAPR)
    )
  }

  private getKongOracleAPR(strategy: YearnStrategy): number | null {
    return typeof strategy.netAPR === 'number' && Number.isFinite(strategy.netAPR)
      ? strategy.netAPR
      : null
  }

  private buildStrategyRewardsByAddress(
    results: RewardCalculatorResult[],
  ): Record<string, StrategyRewardSummary> {
    return results.reduce<Record<string, StrategyRewardSummary>>(
      (accumulator, result) => {
        const strategyAddress = this.normalizeAddress(result.strategyAddress)
        if (!strategyAddress) {
          return accumulator
        }

        const existing = accumulator[strategyAddress] || { rawApr: 0 }
        const nextRewardToken = this.hasResolvedRewardToken(result)
          ? { ...result.breakdown.token }
          : existing.rewardToken

        accumulator[strategyAddress] = {
          rawApr: existing.rawApr + this.toAprDecimal(result.breakdown?.apr),
          rewardToken: nextRewardToken,
          underlyingContract:
            existing.underlyingContract || result.poolAddress || undefined,
        }

        return accumulator
      },
      {},
    )
  }

  private buildMorphoUnderlyingByAddress(
    results: MorphoUnderlyingAprResult[],
  ): Record<string, MorphoUnderlyingAprResult> {
    return Object.fromEntries(
      results.map((result) => [
        result.strategyAddress.toLowerCase(),
        result,
      ]),
    )
  }

  private hasResolvedRewardToken(result: RewardCalculatorResult): boolean {
    return Boolean(result.breakdown?.token?.address)
  }

  private normalizeAddress(address?: string): string | undefined {
    if (!address) {
      return undefined
    }

    return address.toLowerCase()
  }

  private toAprDecimal(aprPercent?: number): number {
    const apr = this.toFiniteNumber(aprPercent)
    return apr > 0 ? apr / 100 : 0
  }

  private toFiniteNumber(value?: number | string): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  private convertAprToWeeklyApy(apr: number): number {
    return (1 + apr / 52) ** 52 - 1
  }
}
