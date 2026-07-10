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

    const strategiesWithRewards = (vault.strategies || []).map((strategy) => {
      const strategyAddress = this.normalizeAddress(strategy.address)
      const strategyRewards = strategyAddress
        ? strategyRewardsByAddress[strategyAddress]
        : undefined
      const strategyRewardsAPR = strategyRewards
        ? strategyRewards.rawApr > 0
          ? strategyRewards.rawApr
          : strategy.strategyRewardsAPR ?? strategyRewards.rawApr
        : strategy.strategyRewardsAPR ?? null

      return {
        ...strategy,
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

    const replacementAprByStrategy = new Map(
      morphoUnderlyingResults.map((result) => [
        result.strategyAddress.toLowerCase(),
        result.replacementAPR,
      ]),
    )

    const grossForwardAPR = (vault.strategies || []).reduce((sum, strategy) => {
      const debtShare = this.getStrategyDebtShare(strategy, vault)
      if (debtShare <= 0) {
        return sum
      }

      const replacementAPR = replacementAprByStrategy.get(
        strategy.address.toLowerCase(),
      )
      const strategyAPR =
        replacementAPR ?? this.getCurrentStrategyAPR(strategy)

      return sum + debtShare * strategyAPR
    }, 0)
    const netAPR = this.computeNetForwardAPR(grossForwardAPR, vault)

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
    }
  }

  private computeNetForwardAPR(grossAPR: number, vault: YearnVault): number {
    if (grossAPR <= 0) {
      return 0
    }

    const managementFee = this.getFiniteFee(vault.apr?.fees?.management)
    const performanceFee = this.getFiniteFee(vault.apr?.fees?.performance)
    const maxFee = this.getFiniteFee(
      vault.apr?.fees?.maxFee,
      KATANA_ACCOUNTANT_DEFAULT_MAX_FEE,
    )
    const uncappedFees = managementFee + grossAPR * performanceFee
    const totalFees =
      maxFee > 0 ? Math.min(uncappedFees, grossAPR * maxFee) : uncappedFees
    const netAPR = grossAPR - totalFees

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

  private getCurrentStrategyAPR(strategy: YearnStrategy): number {
    const parsed = this.toFiniteNumber(strategy.netAPR ?? undefined)
    return parsed > 0 ? parsed : 0
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
}
