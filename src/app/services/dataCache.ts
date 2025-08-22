import _ from 'lodash'
import { isAddressEqual } from 'viem'
import { config } from '../config/index'
import type { YearnVault } from '../types/index'
import { YearnApiService } from './externalApis/yearnApi'
import { YearnAprCalculator } from './aprCalcs/yearnAprCalculator'
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
  yvvbETH: 0.02,
  yvvbUSDC: 0.08,
  yvvbUSDT: 0.08,
  AUSD: 0.08,
  yvvbWBTC: 0.02,
  yvvbUSDS: 0.0,
}

/**
 * This is a guaranteed rate on the underlying APYs by the katana team for the vaults.
 * The mainnet or tbill yields are extrinsic yields that are earned elsewhere.
 * the katana yield is the netAPR value earned by the vault and if it does not hit the below
 * thresholds, then the diference will be made up with KAT tokens valued at 1B FDV.
 *
 * The aggregateVaultResults() function will automatically calculate and display the larger
 * or the katana yield or the netAPR value.
 */
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

// Default FDV value
const FDV = 1_000_000_000

export class DataCacheService {
  private yearnApi: YearnApiService
  private yearnAprCalculator: YearnAprCalculator

  constructor() {
    this.yearnApi = new YearnApiService()
    this.yearnAprCalculator = new YearnAprCalculator()
  }

  async generateVaultAPRData(): Promise<APRDataCache> {
    try {
      console.log('\nGenerating vault APR data...\n----------------------')
      // get all vaults
      const vaults: YearnVault[] = await this.yearnApi.getVaults(
        config.katanaChainId
      )

      // Get APR data from each calculator
      const [yearnAPRs, fixedRateAPRs] = await Promise.all([
        this.yearnAprCalculator.calculateVaultAPRs(vaults),
        this.yearnAprCalculator.calculateFixedRateVaultAPRs(vaults),
      ])

      // Aggregate results for each vault
      const aprDataCache: APRDataCache = _.chain(vaults)
        .map((vault) => {
          try {
            const allResults = _.chain([
              yearnAPRs[vault.address],
              fixedRateAPRs[vault.address],
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

  async getVaultAPRData(vaultAddress: string): Promise<YearnVault | null> {
    const cache = await this.generateVaultAPRData()
    return cache[vaultAddress] || null
  }

  async getAllVaultAPRData(): Promise<APRDataCache> {
    return await this.generateVaultAPRData()
  }

  private aggregateVaultResults(
    vault: YearnVault,
    results: RewardCalculatorResult[]
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
          strat.address as `0x${string}`
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
      (r) => 'vaultAddress' in r && r.vaultAddress === vault.address
    )

    // Separate results by pool type
    const yearnResults = vaultLevelResults.filter((r) => r.poolType === 'yearn')
    const fixedRateResults = vaultLevelResults.filter(
      (r) => r.poolType === 'fixed rate'
    )

    // Calculate APRs for each type
    const yearnVaultRewards = yearnResults.reduce(
      (sum, result) =>
        sum + (result.breakdown?.apr ? result.breakdown.apr / 100 : 0),
      0
    )

    const fixedRateVaultAPR = fixedRateResults.reduce(
      (sum, result) =>
        sum + (result.breakdown?.apr ? result.breakdown.apr / 100 : 0),
      0
    )

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
        katanaRewardsAPR: yearnVaultRewards || 0, // legacy field
        katanaAppRewardsAPR: yearnVaultRewards || 0, // new field
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
      chainID: vault.chainID,
      token: vault.token,
      tvl: vault.tvl,
      apr,
      strategies: strategiesWithRewards.map(({ strategy }) => strategy),
    }

    return newVault
  }
}
