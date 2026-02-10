import axios from 'axios'
import { config } from '../../config'
import type { YearnVault } from '../../types'
import { logVaultAprDebug } from '../aprCalcs/debugLogger'

export class YearnApiService {
  private apiUrl: string

  constructor() {
    this.apiUrl = config.yearnApiUrl
  }

  async getVaults(
    chainId: number = config.katanaChainId
  ): Promise<YearnVault[]> {
    try {
      const params = new URLSearchParams({
        hideAlways: 'true',
        orderBy: 'featuringScore',
        orderDirection: 'desc',
        strategiesDetails: 'withDetails',
        strategiesCondition: 'inQueue',
        chainIDs: chainId.toString(),
        limit: '2500',
      })

      const url: string = `${this.apiUrl}/vaults/katana?${params}`

      const response = await axios.get<YearnVault[]>(url)
      const vaults: YearnVault[] = response.data || []

      for (const vault of vaults) {
        logVaultAprDebug({
          stage: 'vault_fetch',
          vaultAddress: vault.address,
          vaultName: vault.name,
          vaultSymbol: vault.symbol,
          chainId,
          totalVaults: vaults.length,
          reason: 'fetched_from_ydaemon',
        })
      }

      return vaults
    } catch (error) {
      console.error('Error fetching vaults from yDaemon:', error)
      return []
    }
  }

  async getVaultByAddress(
    vaultAddress: string,
    chainId: number = config.katanaChainId
  ): Promise<YearnVault | null> {
    try {
      const vaults: YearnVault[] = await this.getVaults(chainId)
      return (
        vaults.find(
          (vault: YearnVault): boolean =>
            vault.address.toLowerCase() === vaultAddress.toLowerCase()
        ) || null
      )
    } catch (error) {
      console.error('Error fetching vault by address:', error)
      return null
    }
  }

  getStrategyAddresses(vault: YearnVault): string[] {
    return vault.strategies.map((strategy): string => strategy.address)
  }

  getActiveStrategyAddresses(vault: YearnVault): string[] {
    return vault.strategies
      .filter((strategy): boolean =>
        Boolean(
          strategy.details?.totalDebt &&
            strategy.details.totalDebt !== '0' &&
            strategy.details.totalDebt !== '0x0'
        )
      )
      .map((strategy): string => strategy.address)
  }

  getActiveSushiStrategies(vault: YearnVault): string[] {
    return vault.strategies
      .filter((strategy): boolean =>
        Boolean(
          strategy.name?.includes('Steer') &&
            strategy.details?.totalDebt &&
            strategy.details.totalDebt !== '0' &&
            strategy.details.totalDebt !== '0x0'
        )
      )
      .map((strategy): string => strategy.address)
  }

  getActiveMorphoStrategies(vault: YearnVault): string[] {
    return vault.strategies
      .filter((strategy): boolean =>
        Boolean(
          strategy.name?.includes('Morpho') &&
            strategy.details?.totalDebt &&
            strategy.details.totalDebt !== '0' &&
            strategy.details.totalDebt !== '0x0'
        )
      )
      .map((strategy): string => strategy.address)
  }

  getAutoCompoundedAPY(vault: YearnVault): number {
    return vault.apr?.netAPR || 0
  }
}
