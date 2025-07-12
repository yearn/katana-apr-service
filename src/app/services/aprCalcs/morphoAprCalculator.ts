import _ from 'lodash'
import type { YearnVault } from '../../types'
import { MerklApiService } from '../externalApis/merklApi'
import { YearnApiService } from '../externalApis/yearnApi'
import { ContractReaderService } from '../contractReader'
import type { APRCalculator, RewardCalculatorResult } from './types'
import { calculateStrategyAPR } from './utils'

export class MorphoAprCalculator implements APRCalculator {
  private merklApi: MerklApiService
  private yearnApi: YearnApiService
  private contractReader: ContractReaderService

  constructor() {
    this.merklApi = new MerklApiService()
    this.yearnApi = new YearnApiService()
    this.contractReader = new ContractReaderService()
  }

  async calculateVaultAPRs(
    vaults: YearnVault[]
  ): Promise<Record<string, RewardCalculatorResult[]>> {
    const morphoOpportunities = await this.merklApi.getMorphoOpportunities()

    const vaultStrategyPairs = _.chain(vaults)
      .map((vault) => ({
        vault,
        strategies: this.yearnApi.getActiveMorphoStrategies(vault),
      }))
      .filter(({ strategies }) => strategies.length > 0)
      .value()

    const vaultToStrategies: Record<string, string[]> = _.chain(
      vaultStrategyPairs
    )
      .map(({ vault, strategies }) => [vault.address.toLowerCase(), strategies])
      .fromPairs()
      .value()

    const allMorphoStrategies = _.flatten(Object.values(vaultToStrategies))

    // Get vaults for all strategies and normalize
    const strategyToVault = await this.contractReader
      .getMorphoVaultsFromStrategies(allMorphoStrategies)
      .then((v) =>
        _.chain(v)
          .toPairs()
          .map(([k, v]) => [k.toLowerCase(), v])
          .fromPairs()
          .value()
      )

    // Calculate APRs for each vault
    const resultEntries = _.chain(vaultStrategyPairs)
      .map(({ vault, strategies }) => {
        const vaultResults = _.chain(strategies)
          .map((strategy) => {
            const poolAddress = strategyToVault[strategy.toLowerCase()]
            return calculateStrategyAPR(
              strategy,
              poolAddress,
              morphoOpportunities,
              'morpho'
            )
          })
          .compact()
          .value()

        return vaultResults.length > 0 ? [vault.address, vaultResults] : null
      })
      .compact()
      .value() as Array<[string, RewardCalculatorResult[]]>

    return _.fromPairs(resultEntries)
  }
}
