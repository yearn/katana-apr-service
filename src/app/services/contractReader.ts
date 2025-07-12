import { multicall } from '@wagmi/core'
import _ from 'lodash'
import { getAddress } from 'viem'
import { wagmiConfig } from '../config'
import { MORPHO_LP_ABI, STEER_LP_ABI, STRATEGY_ABI } from '../types/contracts'

export class ContractReaderService {
  async getSushiPoolsFromStrategies(
    strategyAddresses: string[]
  ): Promise<Record<string, string>> {
    if (strategyAddresses.length === 0) {
      return {}
    }

    try {
      const steerLpCalls = strategyAddresses.map((address: string) => ({
        address: getAddress(address) as `0x${string}`,
        abi: STRATEGY_ABI,
        functionName: 'STEER_LP',
      }))

      const steerLpResults = await multicall(wagmiConfig, {
        contracts: steerLpCalls,
      })

      const validSteerLps: { strategy: string; steerLp: string }[] = _.chain(
        steerLpResults
      )
        .map((result, index) =>
          result.status
            ? {
                strategy: strategyAddresses[index],
                steerLp: getAddress(result.result as string),
              }
            : null
        )
        .compact()
        .value()

      if (validSteerLps.length === 0) {
        return {}
      }

      const poolCalls = validSteerLps.map((item) => ({
        address: item.steerLp as `0x${string}`,
        abi: STEER_LP_ABI,
        functionName: 'pool',
      }))

      const poolResults = await multicall(wagmiConfig, {
        contracts: poolCalls,
      })

      const mappings: { strategy: string; pool: string }[] = _.chain(
        poolResults
      )
        .map((poolResult, index) => {
          if (poolResult.status === 'success' && poolResult.result) {
            return {
              strategy: validSteerLps[index].strategy.toLowerCase(),
              pool: getAddress(poolResult.result as string),
            }
          }
          return null
        })
        .compact()
        .value()

      return _.chain(mappings)
        .map(({ strategy, pool }) => [strategy, pool])
        .fromPairs()
        .value()
    } catch (error) {
      console.error('Error getting steer pools from strategies:', error)
      return {}
    }
  }

  async getMorphoVaultsFromStrategies(
    strategyAddresses: string[]
  ): Promise<Record<string, string>> {
    try {
      const morphoVaultCalls = strategyAddresses.map((address: string) => ({
        address: getAddress(address) as `0x${string}`,
        abi: MORPHO_LP_ABI,
        functionName: 'vault',
      }))

      const morphoVaultResults = await multicall(wagmiConfig, {
        contracts: morphoVaultCalls,
      })

      const validMorphoVaults: Record<string, string> = _.chain(
        morphoVaultResults
      )
        .map((result, index) =>
          result.status
            ? [strategyAddresses[index], getAddress(result.result as string)]
            : null
        )
        .compact()
        .fromPairs()
        .value()

      return validMorphoVaults
    } catch (error) {
      console.error('Error getting morpho vaults from strategies:', error)
      return {}
    }
  }
}
