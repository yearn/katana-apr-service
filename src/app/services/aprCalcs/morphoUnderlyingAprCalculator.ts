import _ from 'lodash'
import {
  MORPHO_ESTIMATE_SOURCE,
  type MerklOpportunity,
  type MorphoEstimateSource,
  type YearnVault,
} from '../../types'
import { ContractReaderService } from '../contractReader'
import { isKatanaRewardTokenAddress } from '../katanaRewardTokens'
import { isExcludedCampaignId } from '../externalApis/merklBlacklist'
import { MerklApiService } from '../externalApis/merklApi'
import { MorphoApiService, type MorphoVaultAprEstimate } from '../externalApis/morphoApi'
import { YearnApiService } from '../externalApis/yearnApi'

const MERKL_ESTIMATE_OPPORTUNITY_TYPES = [
  'MORPHOVAULT',
  'ERC20LOGPROCESSOR',
] as const

export interface MorphoUnderlyingAprResult {
  strategyAddress: string
  morphoVaultAddress: string | null
  morphoBaseAPR: number
  morphoBaseAPY: number
  morphoRewardsAPR: number
  replacementAPR: number | null
  estimatedAPY: number | null
  usedMorphoApi: boolean
  morphoEstimateSource: MorphoEstimateSource | null
}

export class MorphoUnderlyingAprCalculator {
  private yearnApi: YearnApiService
  private contractReader: ContractReaderService
  private merklApi: MerklApiService
  private morphoApi: MorphoApiService

  constructor() {
    this.yearnApi = new YearnApiService()
    this.contractReader = new ContractReaderService()
    this.merklApi = new MerklApiService()
    this.morphoApi = new MorphoApiService()
  }

  async calculateVaultAPRs(
    vaults: YearnVault[],
    suppliedMorphoOpportunities?: MerklOpportunity[],
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
    const morphoOpportunities =
      suppliedMorphoOpportunities ??
      (await this.merklApi.getMorphoOpportunities())

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
            const oracleAPR = this.toFiniteNumberOrNull(strategy.netAPR)

            const aprEstimate = estimate
              ? this.buildMorphoAprEstimate(estimate)
              : this.buildFallbackAprEstimate(
                  strategyAddress,
                  morphoVaultAddress,
                  oracleAPR,
                  morphoOpportunities,
                )

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

    try {
      return await this.morphoApi.getVaultAprEstimates(morphoVaultAddresses)
    } catch (error) {
      console.error('Error resolving Morpho vault APR estimates:', error)
      return {}
    }
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
      morphoEstimateSource: MORPHO_ESTIMATE_SOURCE.MORPHO_API,
    }
  }

  private buildFallbackAprEstimate(
    strategyAddress: string,
    morphoVaultAddress: string | null,
    oracleAPR: number | null,
    morphoOpportunities: MerklOpportunity[],
  ): Omit<
    MorphoUnderlyingAprResult,
    'strategyAddress' | 'morphoVaultAddress' | 'usedMorphoApi'
  > {
    if (morphoVaultAddress) {
      const underlyingRewardsAPR = this.getMerklRewardsAPR(
        morphoVaultAddress,
        morphoOpportunities,
      )
      if (underlyingRewardsAPR !== null) {
        return this.buildMerklAprEstimate(
          underlyingRewardsAPR,
          oracleAPR,
          MORPHO_ESTIMATE_SOURCE.MERKL_UNDERLYING,
        )
      }
    }

    const strategyRewardsAPR = this.getMerklRewardsAPR(
      strategyAddress,
      morphoOpportunities,
    )
    if (strategyRewardsAPR !== null) {
      return this.buildMerklAprEstimate(
        strategyRewardsAPR,
        oracleAPR,
        MORPHO_ESTIMATE_SOURCE.MERKL_STRATEGY,
      )
    }

    if (oracleAPR !== null) {
      return {
        morphoBaseAPR: oracleAPR,
        morphoBaseAPY: this.convertAprToWeeklyApy(oracleAPR),
        morphoRewardsAPR: 0,
        replacementAPR: oracleAPR,
        estimatedAPY: this.convertAprToWeeklyApy(oracleAPR),
        morphoEstimateSource: MORPHO_ESTIMATE_SOURCE.KONG_ORACLE,
      }
    }

    return {
      morphoBaseAPR: 0,
      morphoBaseAPY: 0,
      morphoRewardsAPR: 0,
      replacementAPR: null,
      estimatedAPY: null,
      morphoEstimateSource: null,
    }
  }

  private buildMerklAprEstimate(
    morphoRewardsAPR: number,
    oracleAPR: number | null,
    morphoEstimateSource: MorphoEstimateSource,
  ): Omit<
    MorphoUnderlyingAprResult,
    'strategyAddress' | 'morphoVaultAddress' | 'usedMorphoApi'
  > {
    const morphoBaseAPR = oracleAPR ?? 0
    const replacementAPR = morphoBaseAPR + morphoRewardsAPR

    return {
      morphoBaseAPR,
      morphoBaseAPY: this.convertAprToWeeklyApy(morphoBaseAPR),
      morphoRewardsAPR,
      replacementAPR,
      estimatedAPY: this.convertAprToWeeklyApy(replacementAPR),
      morphoEstimateSource,
    }
  }

  private getMerklRewardsAPR(
    address: string,
    opportunities: MerklOpportunity[],
  ): number | null {
    const normalizedAddress = address.toLowerCase()
    const matchingOpportunities = opportunities.filter(
      (opportunity) =>
        opportunity.status.toUpperCase() === 'LIVE' &&
        opportunity.identifier.toLowerCase() === normalizedAddress,
    )

    for (const opportunityType of MERKL_ESTIMATE_OPPORTUNITY_TYPES) {
      const campaignAprById = new Map<string, number>()

      for (const opportunity of matchingOpportunities) {
        if (opportunity.type?.toUpperCase() !== opportunityType) {
          continue
        }

        const breakdowns = new Map(
          (opportunity.aprRecord?.breakdowns || []).flatMap((breakdown) => {
            const value = this.toFiniteNumberOrNull(breakdown.value)
            return breakdown.identifier && value !== null
              ? [[breakdown.identifier.toLowerCase(), value] as const]
              : []
          }),
        )

        for (const campaign of opportunity.campaigns || []) {
          if (
            !campaign.campaignId ||
            isExcludedCampaignId(campaign.campaignId) ||
            isKatanaRewardTokenAddress(campaign.rewardToken.address)
          ) {
            continue
          }

          const campaignId = campaign.campaignId.toLowerCase()
          const aprPercent = breakdowns.get(campaignId)
          if (aprPercent !== undefined) {
            campaignAprById.set(campaignId, aprPercent)
          }
        }
      }

      if (campaignAprById.size > 0) {
        const totalAprPercent = Array.from(campaignAprById.values()).reduce(
          (sum, apr) => sum + apr,
          0,
        )
        return totalAprPercent / 100
      }
    }

    return null
  }

  private toFiniteNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  private convertApyToWeeklyApr(apy: number): number {
    return 52 * ((1 + apy) ** (1 / 52) - 1)
  }

  private convertAprToWeeklyApy(apr: number): number {
    return (1 + apr / 52) ** 52 - 1
  }
}
