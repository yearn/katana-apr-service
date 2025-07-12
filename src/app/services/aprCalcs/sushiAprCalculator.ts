import _ from 'lodash'
import type { YearnVault } from '../../types'
import { MerklApiService } from '../externalApis/merklApi'
import { YearnApiService } from '../externalApis/yearnApi'
import { ContractReaderService } from '../contractReader'
import type { APRCalculator, RewardCalculatorResult } from './types'
import { calculateStrategyAPR } from './utils'

export class SushiAprCalculator implements APRCalculator {
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
    const sushiOpportunities = await this.merklApi.getSushiOpportunities()

    const vaultStrategyPairs = _.chain(vaults)
      .map((vault) => ({
        vault,
        strategies: this.yearnApi.getActiveSushiStrategies(vault),
      }))
      .filter(({ strategies }) => strategies.length > 0)
      .value()

    const vaultToStrategies: Record<string, string[]> = _.chain(
      vaultStrategyPairs
    )
      .map(({ vault, strategies }) => [vault.address.toLowerCase(), strategies])
      .fromPairs()
      .value()

    const allSushiStrategies = _.chain(vaultToStrategies)
      .values()
      .flatten()
      .map((addr) => addr.toLowerCase())
      .value()

    // Get pool mappings for all strategies and normalize
    const strategyToPool = await this.contractReader
      .getSushiPoolsFromStrategies(allSushiStrategies)
      .then((v) =>
        _.chain(v)
          .toPairs()
          .map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])
          .fromPairs()
          .value()
      )

    // Calculate APRs for each vault
    const resultEntries = _.chain(vaultStrategyPairs)
      .map(({ vault, strategies }) => {
        const vaultResults = _.chain(strategies)
          .map((strategy) => {
            const poolAddress = strategyToPool[strategy.toLowerCase()]
            return calculateStrategyAPR(
              strategy,
              poolAddress,
              sushiOpportunities,
              'sushi'
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
