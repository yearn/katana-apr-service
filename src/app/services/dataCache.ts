import _ from 'lodash'
import { isAddressEqual } from 'viem'
import { config } from '../config/index'
import type { YearnVault } from '../types/index'
import { YearnApiService } from './externalApis/yearnApi'
import { MorphoAprCalculator } from './aprCalcs/morphoAprCalculator'
import { YearnAprCalculator } from './aprCalcs/yearnAprCalculator'
import { type RewardCalculatorResult, TokenBreakdown } from './aprCalcs/types'

export interface VaultAPRData {
  name: string
  apr: number
  pools?: string[]
  breakdown: TokenBreakdown[]
}

export interface APRDataCache {
  [vaultAddress: string]: VaultAPRData
}

export type { TokenBreakdown }

export class DataCacheService {
  private yearnApi: YearnApiService
  // private sushiCalculator: SushiAprCalculator
  private yearnAprCalculator: YearnAprCalculator
  private morphoCalculator: MorphoAprCalculator

  constructor() {
    this.yearnApi = new YearnApiService()
    // this.sushiCalculator = new SushiAprCalculator()
    this.yearnAprCalculator = new YearnAprCalculator()
    this.morphoCalculator = new MorphoAprCalculator()
  }

  async generateVaultAPRData(): Promise<APRDataCache> {
    try {
      // get all vaults
      const vaults: YearnVault[] = await this.yearnApi.getVaults(
        config.katanaChainId
      )

      // Get APR data from each calculator
      const [yearnAPRs, morphoAPRs] = await Promise.all([
        // this.sushiCalculator.calculateVaultAPRs(vaults),
        this.yearnAprCalculator.calculateVaultAPRs(vaults),
        this.morphoCalculator.calculateVaultAPRs(vaults),
      ])

      // Aggregate results for each vault
      const aprDataCache: APRDataCache = _.chain(vaults)
        .map((vault) => {
          try {
            const allResults = _.chain([
              yearnAPRs[vault.address],
              morphoAPRs[vault.address],
            ])
              .flattenDeep()
              .compact()
              .value()

            if (allResults.length === 0) {
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

            return [
              vault.address,
              this.aggregateVaultResults(vault, allResults),
            ]
          } catch (error) {
            console.error(`Error processing vault ${vault.address}:`, error)
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
        `Generated APR data for ${Object.keys(aprDataCache).length} vaults`
      )
      return aprDataCache
    } catch (error) {
      console.error('Error generating vault APR data:', error)
      return {}
    }
  }

  async getVaultAPRData(vaultAddress: string): Promise<VaultAPRData | null> {
    const cache = await this.generateVaultAPRData()
    return cache[vaultAddress] || null
  }

  async getAllVaultAPRData(): Promise<APRDataCache> {
    return await this.generateVaultAPRData()
  }

  private aggregateVaultResults(
    vault: YearnVault,
    results: RewardCalculatorResult[]
  ): any {
    // Default FDV value
    const FDV = 1_000_000_000

    // Build new strategies array with appended data from results
    const strategiesWithRewards = (vault.strategies || []).map((strat) => {
      if (!strat.address || strat.status?.toLowerCase() !== 'active') {
        return { strategy: strat, debtRatio: 0, strategyRewardsAPR: 0 }
      }

      const result = results.find((r) => {
        const addressToCheck =
          'strategyAddress' in r && r.strategyAddress
            ? r.strategyAddress
            : 'vaultAddress' in r
            ? (r as any).vaultAddress
            : undefined
        return isAddressEqual(
          addressToCheck as `0x${string}`,
          strat.address as `0x${string}`
        )
      })

      const strategyData = result?.breakdown
        ? {
            strategyRewardsAPR: result.breakdown.apr / 100,
            rewardToken: { ...result.breakdown.token, assumedFDV: FDV },
            underlyingContract: result.poolAddress,
            assumedFDV: FDV,
          }
        : {
            strategyRewardsAPR: 0,
            rewardToken: undefined,
            underlyingContract: undefined,
            assumedFDV: FDV,
          }

      return {
        strategy: {
          ...strat,
          ...strategyData,
        },
        debtRatio: strat.details?.debtRatio ?? strat.details?.debtRatio ?? 0,
        strategyRewardsAPR: strategyData.strategyRewardsAPR,
      }
    })

    // Calculate totals using reduce
    const { totalApr } = strategiesWithRewards.reduce(
      (acc, { debtRatio, strategyRewardsAPR }) => ({
        totalApr: acc.totalApr + strategyRewardsAPR * (debtRatio / 10000),
        totalDebtRatio: acc.totalDebtRatio + debtRatio,
      }),
      { totalApr: 0, totalDebtRatio: 0 }
    )

    // Find vault-level APR result (where vaultAddress matches vault.address)
    const vaultLevelResult = results.find(
      (r) => 'vaultAddress' in r && r.vaultAddress === vault.address
    )
    const vaultLevelAPR = vaultLevelResult?.breakdown?.apr
      ? vaultLevelResult.breakdown.apr / 100
      : 0

    // Add vault-level APR to totalApr
    const combinedApr = totalApr + vaultLevelAPR

    const apr = vault.apr
      ? {
          ...vault.apr,
          extra: {
            ...(vault.apr.extra || {}),
            katanaRewardsAPR: combinedApr,
          },
        }
      : undefined

    const newVault: YearnVault = {
      address: vault.address,
      symbol: vault.symbol,
      name: vault.name,
      chainId: vault.chainId,
      token: vault.token,
      tvl: vault.tvl,
      apr,
      strategies: strategiesWithRewards.map(({ strategy }) => strategy),
    }

    return newVault
  }
}
