import _ from 'lodash'
import type { YearnVault, YearnStrategy } from '../../types'
import { ContractReaderService } from '../contractReader'
import { MorphoApiService, type MorphoVaultAprEstimate } from '../externalApis/morphoApi'
import { YearnApiService } from '../externalApis/yearnApi'

export interface MorphoUnderlyingAprResult {
  strategyAddress: string
  morphoVaultAddress: string | null
  morphoBaseAPR: number
  morphoBaseAPY: number
  morphoRewardsAPR: number
  replacementAPR: number
  estimatedAPY: number
  usedMorphoApi: boolean
}

export class MorphoUnderlyingAprCalculator {
  private yearnApi: YearnApiService
  private contractReader: ContractReaderService
  private morphoApi: MorphoApiService

  constructor() {
    this.yearnApi = new YearnApiService()
    this.contractReader = new ContractReaderService()
    this.morphoApi = new MorphoApiService()
  }

  async calculateVaultAPRs(
    vaults: YearnVault[],
  ): Promise<Record<string, MorphoUnderlyingAprResult[]>> {
    const vaultStrategyPairs = vaults
      .map((vault) => ({
        vault,
        strategyAddresses:
          this.yearnApi.getMorphoCompounderStrategies(vault),
      }))
      .filter(({ strategyAddresses }) => strategyAddresses.length > 0)

    const allStrategyAddresses = vaultStrategyPairs.flatMap(
      ({ strategyAddresses }) => strategyAddresses,
    )

    if (allStrategyAddresses.length === 0) {
      return {}
    }

    const strategyToMorphoVault = await this.getStrategyToMorphoVault(
      allStrategyAddresses,
    )
    const morphoVaultAddresses = _.uniq(
      Object.values(strategyToMorphoVault).filter(Boolean),
    )
    const morphoVaultEstimates = await this.getMorphoVaultEstimates(
      morphoVaultAddresses,
    )

    const resultEntries = vaultStrategyPairs
      .map(({ vault, strategyAddresses }) => {
        const strategiesByAddress = new Map(
          vault.strategies.map((strategy) => [
            strategy.address.toLowerCase(),
            strategy,
          ]),
        )

        const results = strategyAddresses
          .map((strategyAddress) => {
            const strategy = strategiesByAddress.get(
              strategyAddress.toLowerCase(),
            )

            if (!strategy) {
              return null
            }

            const morphoVaultAddress =
              strategyToMorphoVault[strategyAddress.toLowerCase()] || null
            const estimate = morphoVaultAddress
              ? morphoVaultEstimates[morphoVaultAddress.toLowerCase()]
              : undefined

            const aprEstimate = estimate
              ? this.buildMorphoAprEstimate(estimate)
              : this.buildFallbackAprEstimate(strategy)

            return {
              strategyAddress,
              morphoVaultAddress,
              ...aprEstimate,
              usedMorphoApi: Boolean(estimate),
            }
          })
          .filter(
            (result): result is MorphoUnderlyingAprResult => result !== null,
          )

        return results.length > 0 ? [vault.address, results] : null
      })
      .filter(
        (entry): entry is [string, MorphoUnderlyingAprResult[]] =>
          entry !== null,
      )

    return _.fromPairs(resultEntries)
  }

  private async getStrategyToMorphoVault(
    strategyAddresses: string[],
  ): Promise<Record<string, string>> {
    const strategyToMorphoVault =
      await this.contractReader.getMorphoVaultsFromStrategies(strategyAddresses)

    return _.chain(strategyToMorphoVault)
      .toPairs()
      .map(([strategyAddress, morphoVaultAddress]) => [
        strategyAddress.toLowerCase(),
        morphoVaultAddress,
      ])
      .fromPairs()
      .value()
  }

  private async getMorphoVaultEstimates(
    morphoVaultAddresses: string[],
  ): Promise<Record<string, MorphoVaultAprEstimate>> {
    if (morphoVaultAddresses.length === 0) {
      return {}
    }

    return this.morphoApi.getVaultAprEstimates(morphoVaultAddresses)
  }

  private buildMorphoAprEstimate(estimate: MorphoVaultAprEstimate): Omit<
    MorphoUnderlyingAprResult,
    'strategyAddress' | 'morphoVaultAddress' | 'usedMorphoApi'
  > {
    const morphoBaseAPR = this.convertApyToWeeklyApr(estimate.baseAPY)
    const morphoRewardsAPR = estimate.rewardsAPR
    const replacementAPR = morphoBaseAPR + morphoRewardsAPR

    return {
      morphoBaseAPR,
      morphoBaseAPY: estimate.baseAPY,
      morphoRewardsAPR,
      replacementAPR,
      estimatedAPY: this.convertAprToWeeklyApy(replacementAPR),
    }
  }

  private buildFallbackAprEstimate(strategy: YearnStrategy): Omit<
    MorphoUnderlyingAprResult,
    'strategyAddress' | 'morphoVaultAddress' | 'usedMorphoApi'
  > {
    const replacementAPR = this.getFallbackStrategyAPR(strategy)

    return {
      morphoBaseAPR: 0,
      morphoBaseAPY: 0,
      morphoRewardsAPR: 0,
      replacementAPR,
      estimatedAPY: this.convertAprToWeeklyApy(replacementAPR),
    }
  }

  private convertApyToWeeklyApr(apy: number): number {
    return 52 * ((1 + apy) ** (1 / 52) - 1)
  }

  private convertAprToWeeklyApy(apr: number): number {
    return (1 + apr / 52) ** 52 - 1
  }

  private getFallbackStrategyAPR(strategy: YearnStrategy): number {
    const parsed = Number(strategy.netAPR)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
}
