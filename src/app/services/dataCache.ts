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

const katanaBonusAPY: Record<
  'yvvbETH' | 'yvvbUSDC' | 'yvvbUSDT' | 'AUSD' | 'yvvbWBTC' | 'yvvbUSDS',
  number
> = {
  yvvbETH: 0.02,
  yvvbUSDC: 0.08,
  yvvbUSDT: 0.08,
  AUSD: 0.08,
  yvvbWBTC: 0.02,
  yvvbUSDS: 0.0,
}

const vaultNativeRewards: Record<
  'yvvbETH' | 'yvvbUSDC' | 'yvvbUSDT' | 'AUSD' | 'yvvbWBTC' | 'yvvbUSDS',
  Record<string, number>
> = {
  yvvbETH: { 'Ethereum yield': 0.013, 'Katana yield': 0.027 },
  yvvbUSDC: { 'Ethereum yield': 0.021, 'Katana yield': 0.03 },
  yvvbUSDT: { 'Ethereum yield': 0.017, 'Katana yield': 0.03 },
  AUSD: { 'T-bill yield': 0.035, 'Katana yield': 0.0 },
  yvvbWBTC: { 'Ethereum yield': 0.0001, 'Katana yield': 0.008 },
  yvvbUSDS: { 'Ethereum yield': 0.0, 'Katana yield': 0.0 },
}

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
      console.log('\nGenerating vault APR data...\n----------------------')
      // get all vaults
      const vaults: YearnVault[] = await this.yearnApi.getVaults(
        config.katanaChainId
      )

      // Get APR data from each calculator
      const [yearnAPRs, fixedRateAPRs, morphoAPRs] = await Promise.all([
        // this.sushiCalculator.calculateVaultAPRs(vaults),
        this.yearnAprCalculator.calculateVaultAPRs(vaults),
        this.yearnAprCalculator.calculateFixedRateVaultAPRs(vaults),
        this.morphoCalculator.calculateVaultAPRs(vaults),
      ])

      // Aggregate results for each vault
      const aprDataCache: APRDataCache = _.chain(vaults)
        .map((vault) => {
          try {
            const allResults = _.chain([
              yearnAPRs[vault.address],
              fixedRateAPRs[vault.address],
              morphoAPRs[vault.address],
            ])
              .flattenDeep()
              .compact()
              .value()

            // console.log(`allResults for vault ${vault.address}:`, allResults)

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

    // Find vault-level APR results (where vaultAddress matches vault.address)
    const vaultLevelResults = results.filter(
      (r) => 'vaultAddress' in r && r.vaultAddress === vault.address
    )
    console.dir(vaultLevelResults, { depth: null })

    // Separate results by pool type
    const yearnResults = vaultLevelResults.filter((r) => r.poolType === 'yearn')
    const fixedRateResults = vaultLevelResults.filter(
      (r) => r.poolType === 'fixed rate'
    )

    // Calculate APRs for each type
    const yearnVaultAPR = yearnResults.reduce(
      (sum, result) =>
        sum + (result.breakdown?.apr ? result.breakdown.apr / 100 : 0),
      0
    )

    const fixedRateVaultAPR = fixedRateResults.reduce(
      (sum, result) =>
        sum + (result.breakdown?.apr ? result.breakdown.apr / 100 : 0),
      0
    )

    // Add vault-level APRs to totalApr (only yearn type affects main total)
    const combinedApr = totalApr + yearnVaultAPR

    // Get the katana bonus APY for this vault based on its symbol
    const vaultKatanaBonusAPY =
      katanaBonusAPY[vault.symbol as keyof typeof katanaBonusAPY] || 0

    // Calculate extrinsicYield and katanaNativeYield
    const nativeRewards =
      vaultNativeRewards[vault.symbol as keyof typeof vaultNativeRewards]
    let extrinsicYield = 0
    let katanaNativeYield = 0

    if (nativeRewards) {
      const rewardValues = Object.values(nativeRewards)
      const firstField = rewardValues[0] || 0
      const secondField = rewardValues[1] || 0
      const netAPR = vault.apr?.netAPR || 0

      // extrinsicYield is always the first value
      extrinsicYield = firstField

      // katanaNativeYield is the greater of the second field or netAPR
      katanaNativeYield = Math.max(secondField, netAPR)
    }

    const apr = {
      ...vault.apr,
      extra: {
        ...(vault.apr?.extra || {}),
        katanaAppRewardsAPR: combinedApr || 0,
        FixedRateKatanaRewards: fixedRateVaultAPR || 0,
        katanaBonusAPY: vaultKatanaBonusAPY,
        extrinsicYield,
        katanaNativeYield,
      },
    }

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
