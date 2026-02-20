import _ from 'lodash'
import { isAddressEqual } from 'viem'
import { config } from '../config/index'
import type { YearnVault } from '../types/index'
import { YearnApiService } from './externalApis/yearnApi'
import { YearnAprCalculator } from './aprCalcs/yearnAprCalculator'
import { SteerPointsCalculator } from './pointsCalcs/steerPointsCalculator'
import { logVaultAprDebug } from './aprCalcs/debugLogger'
import {
  type RewardCalculatorResult,
  TokenBreakdown,
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

/**
 * This is a bonus for users who do not withdraw from the vaults over a certain period of time.
 * It is provided by the Katana team.
 */
const katanaBonusAPY: Record<
  'yvvbETH' | 'yvvbUSDC' | 'yvvbUSDT' | 'AUSD' | 'yvvbWBTC' | 'yvvbUSDS',
  number
> = {
  yvvbETH: 0.016,
  yvvbUSDC: 0.068,
  yvvbUSDT: 0.068,
  AUSD: 0.068,
  yvvbWBTC: 0.016,
  yvvbUSDS: 0.0,
}

const HARDCODED_FIXED_RATE_APR: Record<
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

// Default FDV value
const FDV = 1_000_000_000

export class DataCacheService {
  private yearnApi: YearnApiService
  private yearnAprCalculator: YearnAprCalculator
  private steerPointsCalculator: SteerPointsCalculator

  constructor() {
    this.yearnApi = new YearnApiService()
    this.yearnAprCalculator = new YearnAprCalculator()
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
      // fixedRateAPRs
    ] = await Promise.all([
      this.yearnAprCalculator.calculateVaultAPRs(vaults),
      // this.yearnAprCalculator.calculateFixedRateVaultAPRs(vaults),
    ])

    // Aggregate results for each vault
    const aprDataCache: APRDataCache = _.chain(vaults)
      .map((vault) => {
        try {
          const allResults = _.chain([
            yearnAPRs[vault.address],
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

          return [vault.address, this.aggregateVaultResults(vault, allResults)]
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
    results: RewardCalculatorResult[],
  ): YearnVault {
    // Build new strategies array with appended data from results
    const strategiesWithRewards = (vault.strategies || []).map((strat) => {
      if (!strat.address || strat.status?.toLowerCase() !== 'active') {
        return { strategy: strat, debtRatio: 0 }
      }

      const result = results.find((r) => {
        const addressToCheck =
          'strategyAddress' in r && r.strategyAddress
            ? r.strategyAddress
            : 'vaultAddress' in r
              ? (r as unknown as YearnRewardCalculatorResult).vaultAddress
              : undefined
        return isAddressEqual(
          addressToCheck as `0x${string}`,
          strat.address as `0x${string}`,
        )
      })

      const strategyData = result?.breakdown
        ? {
            rewardToken: { ...result.breakdown.token, assumedFDV: FDV },
            underlyingContract: result.poolAddress,
          }
        : {
            rewardToken: undefined,
            underlyingContract: undefined,
          }

      return {
        strategy: {
          ...strat,
          ...strategyData,
        },
        debtRatio: strat.details?.debtRatio ?? strat.details?.debtRatio ?? 0,
      }
    })

    // Find vault-level APR results (where vaultAddress matches vault.address)
    const vaultLevelResults = results.filter(
      (r) => 'vaultAddress' in r && r.vaultAddress === vault.address,
    )

    // Separate results by pool type
    const yearnResults = vaultLevelResults.filter((r) => r.poolType === 'yearn')

    // Calculate APRs for each type
    const yearnVaultRewards = yearnResults.reduce(
      (sum, result) =>
        sum + (result.breakdown?.apr ? result.breakdown.apr / 100 : 0),
      0,
    )

    // use this when fixed rate pools are live
    // const fixedRateResults = vaultLevelResults.filter(
    //   (r) => r.poolType === 'fixed rate'
    // )
    // const fixedRateVaultAPR = fixedRateResults.reduce(
    //   (sum, result) =>
    //     sum + (result.breakdown?.apr ? result.breakdown.apr / 100 : 0),
    //   0
    // )

    // override with hardcoded values until new campaigns are live
    const fixedRateFromHardcoded =
      HARDCODED_FIXED_RATE_APR[
        vault.symbol as keyof typeof HARDCODED_FIXED_RATE_APR
      ] || 0

    // Get the katana bonus APY for this vault based on its symbol
    const vaultKatanaBonusAPY =
      katanaBonusAPY[vault.symbol as keyof typeof katanaBonusAPY] || 0

    // katanaNativeYield is the greater of the second field or netAPR
    const katanaNativeYield = vault.apr?.netAPR || 0

    const apr = {
      ...vault.apr,
      extra: {
        ...(vault.apr?.extra || {}),
        katanaRewardsAPR: yearnVaultRewards || 0, // legacy field
        katanaAppRewardsAPR: yearnVaultRewards || 0, // new field
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
      strategies: strategiesWithRewards.map(({ strategy }) => strategy),
    }

    return newVault
  }
}
