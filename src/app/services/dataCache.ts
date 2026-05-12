import _ from 'lodash'
import { config } from '../config/index'
import type { YearnVault } from '../types/index'
import { YearnApiService } from './externalApis/yearnApi'
import { KatanaPriceService } from './externalApis/katanaPriceService'
import { MorphoAprCalculator } from './aprCalcs/morphoAprCalculator'
import { SushiAprCalculator } from './aprCalcs/sushiAprCalculator'
import { YearnAprCalculator } from './aprCalcs/yearnAprCalculator'
import { SteerPointsCalculator } from './pointsCalcs/steerPointsCalculator'
import { logVaultAprDebug } from './aprCalcs/debugLogger'
import { CANONICAL_KAT_ADDRESS } from './katanaRewardTokens'
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

const ASSUMED_KAT_PRICE_USD = 0.1

const FIXED_RATE_APR_AT_ASSUMED_KAT_PRICE: Record<
  | 'yvvbETH'
  | 'yvvbUSDC'
  | 'yvvbUSDT'
  | 'AUSD'
  | 'yvvbWBTC'
  | 'yvvbUSDS'
  | 'yvwstETH',
  number
> = {
  yvvbETH: 0.14,
  yvvbUSDC: 0.35,
  yvvbUSDT: 0.35,
  AUSD: 0.35,
  yvvbWBTC: 0.07,
  yvvbUSDS: 0.0,
  yvwstETH: 0.0,
}

export class DataCacheService {
  private yearnApi: YearnApiService
  private katanaPriceService: KatanaPriceService
  private yearnAprCalculator: YearnAprCalculator
  private morphoAprCalculator: MorphoAprCalculator
  private sushiAprCalculator: SushiAprCalculator
  private steerPointsCalculator: SteerPointsCalculator

  constructor() {
    this.yearnApi = new YearnApiService()
    this.katanaPriceService = new KatanaPriceService()
    this.yearnAprCalculator = new YearnAprCalculator()
    this.morphoAprCalculator = new MorphoAprCalculator()
    this.sushiAprCalculator = new SushiAprCalculator()
    this.steerPointsCalculator = new SteerPointsCalculator()
  }

  async generateVaultAPRData(): Promise<APRDataCache> {
    console.log('\nGenerating vault APR data...\n----------------------')
    // get all vaults
    const vaults: YearnVault[] = await this.yearnApi.getVaults(
      config.katanaChainId,
    )

    if (vaults.length === 0) {
      throw new Error(
        `No vaults returned from yDaemon (chainId=${config.katanaChainId})`,
      )
    }

    // Get APR data from each calculator
    const [
      yearnAPRs,
      morphoAPRs,
      sushiAPRs,
      katanaTokenPriceUsd,
      // fixedRateAPRs
    ] = await Promise.all([
      this.yearnAprCalculator.calculateVaultAPRs(vaults),
      this.morphoAprCalculator.calculateVaultAPRs(vaults),
      this.sushiAprCalculator.calculateVaultAPRs(vaults),
      this.katanaPriceService.getTokenPriceUsd(
        config.katanaChainId,
        CANONICAL_KAT_ADDRESS,
      ),
      // this.yearnAprCalculator.calculateFixedRateVaultAPRs(vaults),
    ])

    // Aggregate results for each vault
    const aprDataCache: APRDataCache = _.chain(vaults)
      .map((vault) => {
        try {
          const allResults = _.chain([
            yearnAPRs[vault.address],
            morphoAPRs[vault.address],
            sushiAPRs[vault.address],
            // fixedRateAPRs[vault.address],
          ])
            .flattenDeep()
            .compact()
            .value()

          if (allResults.length === 0) {
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
            this.aggregateVaultResults(vault, allResults, katanaTokenPriceUsd),
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
    katanaTokenPriceUsd: number,
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

      return {
        ...strategy,
        ...(strategyRewards
          ? {
              strategyRewardsAPR: strategyRewards.rawApr,
              rewardToken: strategyRewards.rewardToken
                ? { ...strategyRewards.rewardToken }
                : undefined,
              underlyingContract: strategyRewards.underlyingContract,
            }
          : {}),
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

    const fixedRateBaseApr =
      FIXED_RATE_APR_AT_ASSUMED_KAT_PRICE[
        vault.symbol as keyof typeof FIXED_RATE_APR_AT_ASSUMED_KAT_PRICE
      ] || 0

    const fixedRateFromHardcoded =
      fixedRateBaseApr * (katanaTokenPriceUsd / ASSUMED_KAT_PRICE_USD)

    const vaultKatanaBonusAPY = 0

    const katanaNativeYield = vault.apr?.netAPR || 0

    const apr = {
      ...vault.apr,
      extra: {
        ...(vault.apr?.extra || {}),
        katanaRewardsAPR: yearnVaultRewards || 0, // legacy field
        katanaAppRewardsAPR: yearnVaultRewards || 0,
        fixedRateKatanaRewards: fixedRateFromHardcoded || 0,
        katanaBonusAPY: vaultKatanaBonusAPY,
        katanaNativeYield,
        steerPointsPerDollar:
          this.steerPointsCalculator.calculateForVault(vault),
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
