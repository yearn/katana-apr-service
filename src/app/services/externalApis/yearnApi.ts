import { config } from '../../config'
import type {
  YearnStrategy,
  YearnStrategyDetails,
  YearnVault,
  YearnVaultAPY,
  YearnVaultToken,
  YearnVaultTVL,
} from '../../types'
import { logVaultAprDebug } from '../aprCalcs/debugLogger'

type KongVaultListItem = {
  address: string
  chainId: number
  origin?: string | null
  inclusion?: Record<string, boolean>
}

type KongVaultCompositionItem = {
  address?: string
  name?: string
  status?: string
  currentDebt?: string
  totalDebt?: string
  totalGain?: string
  totalLoss?: string
  lastReport?: string | number
  performanceFee?: string | number
}

type KongVaultAsset = {
  address?: string
  name?: string
  symbol?: string
  decimals?: string | number
}

type KongVaultSnapshot = {
  address?: string
  symbol?: string
  name?: string
  chainId?: number
  totalAssets?: string
  tvl?: { close?: number } | number
  asset?: KongVaultAsset | null
  meta?: {
    displayName?: string
    token?: KongVaultAsset
  }
  apy?: {
    net?: number
    weeklyNet?: number
    monthlyNet?: number
    inceptionNet?: number
    pricePerShare?: string | number
    weeklyPricePerShare?: string | number
    monthlyPricePerShare?: string | number
  }
  performance?: {
    oracle?: {
      netAPR?: number
    }
    historical?: {
      net?: number
      weeklyNet?: number
      monthlyNet?: number | null
      inceptionNet?: number | null
    }
  }
  fees?: {
    managementFee?: number
    performanceFee?: number
  } | null
  composition?: KongVaultCompositionItem[]
}

const isKongVaultListItem = (value: unknown): value is KongVaultListItem =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as KongVaultListItem).address === 'string' &&
  typeof (value as KongVaultListItem).chainId === 'number'

const isKongVaultSnapshot = (value: unknown): value is KongVaultSnapshot =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as KongVaultSnapshot).address === 'string'

const toTrimmedBaseUrl = (url: string): string => url.replace(/\/+$/, '')

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toStringValue = (value: unknown, fallback = '0'): string =>
  value === null || value === undefined ? fallback : String(value)

const isKatanaYearnVault = (vault: KongVaultListItem): boolean =>
  vault.origin === 'yearn' && vault.inclusion?.isKatana === true

const mapKongAssetToYearnToken = (
  asset?: KongVaultAsset | null,
): YearnVaultToken | undefined => {
  if (!asset?.address || !asset.name || !asset.symbol) {
    return undefined
  }

  return {
    address: asset.address,
    name: asset.name,
    symbol: asset.symbol,
    decimals: toNumber(asset.decimals),
  }
}

const mapKongCompositionToYearnStrategy = (
  strategy: KongVaultCompositionItem,
): YearnStrategy | null => {
  if (!strategy.address) {
    return null
  }

  const details: YearnStrategyDetails = {
    totalDebt: toStringValue(strategy.currentDebt ?? strategy.totalDebt),
    totalGain: toStringValue(strategy.totalGain),
    totalLoss: toStringValue(strategy.totalLoss),
    lastReport: toNumber(strategy.lastReport),
    performanceFee: toNumber(strategy.performanceFee),
  }

  return {
    address: strategy.address,
    name: strategy.name || 'Unknown',
    status: strategy.status,
    details,
  }
}

const mapKongAprToYearnApr = (snapshot: KongVaultSnapshot): YearnVaultAPY => {
  const historical = snapshot.performance?.historical
  const apy = snapshot.apy

  return {
    netAPR:
      apy?.net ??
      historical?.net ??
      snapshot.performance?.oracle?.netAPR ??
      0,
    fees: snapshot.fees
      ? {
          management: toNumber(snapshot.fees.managementFee),
          performance: toNumber(snapshot.fees.performanceFee),
        }
      : undefined,
    points: {
      weekAgo: toNumber(apy?.weeklyNet ?? historical?.weeklyNet),
      monthAgo: toNumber(apy?.monthlyNet ?? historical?.monthlyNet),
      inception: toNumber(apy?.inceptionNet ?? historical?.inceptionNet),
    },
    pricePerShare: {
      today: toNumber(apy?.pricePerShare),
      weekAgo: toNumber(apy?.weeklyPricePerShare),
      monthAgo: toNumber(apy?.monthlyPricePerShare),
    },
  }
}

const mapKongTvlToYearnTvl = (snapshot: KongVaultSnapshot): YearnVaultTVL => ({
  totalAssets: toStringValue(snapshot.totalAssets),
  tvl: typeof snapshot.tvl === 'number'
    ? snapshot.tvl
    : toNumber(snapshot.tvl?.close),
  price: 0,
})

const mapKongSnapshotToYearnVault = (
  snapshot: KongVaultSnapshot,
  chainId: number,
): YearnVault | null => {
  if (!snapshot.address || !snapshot.name || !snapshot.symbol) {
    return null
  }

  const token = mapKongAssetToYearnToken(snapshot.asset ?? snapshot.meta?.token)
  const strategies = (snapshot.composition || [])
    .map(mapKongCompositionToYearnStrategy)
    .filter((strategy): strategy is YearnStrategy => strategy !== null)

  return {
    address: snapshot.address,
    symbol: snapshot.symbol,
    name: snapshot.meta?.displayName || snapshot.name,
    chainID: snapshot.chainId ?? chainId,
    strategies,
    apr: mapKongAprToYearnApr(snapshot),
    tvl: mapKongTvlToYearnTvl(snapshot),
    ...(token ? { token } : {}),
  }
}

export class YearnApiService {
  private apiUrl: string

  constructor() {
    this.apiUrl = toTrimmedBaseUrl(config.kongApiUrl)
  }

  async getVaults(
    chainId: number = config.katanaChainId,
  ): Promise<YearnVault[]> {
    try {
      const listResponse = await fetch(
        `${this.apiUrl}/list/vaults/${chainId}?origin=yearn`,
      )

      if (!listResponse.ok) {
        throw new Error(`HTTP error fetching vault list from Kong: ${listResponse.status}`)
      }

      const vaultList = ((await listResponse.json()) as unknown[] || [])
        .filter(isKongVaultListItem)
        .filter(isKatanaYearnVault)

      const snapshots = await Promise.all(
        vaultList.map((vault) => this.getVaultSnapshot(chainId, vault.address)),
      )

      const vaults = snapshots
        .map((snapshot) =>
          snapshot ? mapKongSnapshotToYearnVault(snapshot, chainId) : null
        )
        .filter((vault): vault is YearnVault => vault !== null)

      for (const vault of vaults) {
        logVaultAprDebug({
          stage: 'vault_fetch',
          vaultAddress: vault.address,
          vaultName: vault.name,
          vaultSymbol: vault.symbol,
          chainId,
          totalVaults: vaults.length,
          reason: 'fetched_from_kong',
        })
      }

      return vaults
    } catch (error) {
      console.error('Error fetching vaults from Kong:', error)
      return []
    }
  }

  async getVaultByAddress(
    vaultAddress: string,
    chainId: number = config.katanaChainId,
  ): Promise<YearnVault | null> {
    try {
      const snapshot = await this.getVaultSnapshot(chainId, vaultAddress)
      return snapshot ? mapKongSnapshotToYearnVault(snapshot, chainId) : null
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

  private async getVaultSnapshot(
    chainId: number,
    vaultAddress: string,
  ): Promise<KongVaultSnapshot | null> {
    const response = await fetch(
      `${this.apiUrl}/snapshot/${chainId}/${vaultAddress.toLowerCase()}`,
    )

    if (!response.ok) {
      throw new Error(
        `HTTP error fetching vault snapshot from Kong: ${response.status}`,
      )
    }

    const snapshot = await response.json()
    return isKongVaultSnapshot(snapshot) ? snapshot : null
  }
}
