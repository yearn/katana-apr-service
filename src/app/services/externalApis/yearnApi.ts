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
import { CANONICAL_KAT_ADDRESS } from '../katanaRewardTokens'

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
  maxDebt?: string
  totalDebt?: string
  totalGain?: string
  totalLoss?: string
  lastReport?: string | number
  performanceFee?: string | number
  latestReportApr?: number | null
  performance?: {
    estimated?: {
      components?: Record<string, number | string | null>
    }
  }
}

type KongVaultAsset = {
  address?: string
  name?: string
  symbol?: string
  description?: string
  decimals?: string | number
}

type KongVaultSnapshot = {
  address?: string
  symbol?: string
  name?: string
  chainId?: number
  decimals?: string | number
  totalAssets?: string
  totalDebt?: string
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

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toStringValue = (value: unknown, fallback = '0'): string =>
  value === null || value === undefined ? fallback : String(value)

const normalizeBasisPoints = (value: unknown): number => toNumber(value) / 10_000

const normalizeShareValue = (
  value: unknown,
  decimals: number,
): number => {
  if (value === null || value === undefined) {
    return 0
  }

  try {
    return Number(BigInt(String(value))) / 10 ** decimals
  } catch {
    return toNumber(value)
  }
}

const calculateDebtRatio = (
  strategyDebt: unknown,
  vaultTotalAssets: unknown,
): number | undefined => {
  try {
    const debt = BigInt(String(strategyDebt ?? '0'))
    const totalAssets = BigInt(String(vaultTotalAssets ?? '0'))
    if (debt <= BigInt(0) || totalAssets <= BigInt(0)) {
      return undefined
    }

    return Number(
      (debt * BigInt(10_000) + totalAssets / BigInt(2)) / totalAssets,
    )
  } catch {
    return undefined
  }
}

const calculateTokenPrice = (
  totalAssets: unknown,
  tvl: number,
  decimals: number,
): number => {
  const normalizedAssets = normalizeShareValue(totalAssets, decimals)
  return normalizedAssets > 0 ? tvl / normalizedAssets : 0
}

const toPositiveFiniteNumberOrNull = (value: unknown): number | null => {
  const parsed = toFiniteNumberOrNull(value)
  return parsed && parsed > 0 ? parsed : null
}

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
    description: asset.description || '',
  }
}

const mapKongCompositionToYearnStrategy = (
  strategy: KongVaultCompositionItem,
  snapshot: KongVaultSnapshot,
): YearnStrategy | null => {
  if (!strategy.address) {
    return null
  }

  const totalDebt = toStringValue(strategy.currentDebt ?? strategy.totalDebt)
  const estimatedKatRewardsAPR = toFiniteNumberOrNull(
    strategy.performance?.estimated?.components?.katRewardsAPR,
  )
  const details: YearnStrategyDetails = {
    totalDebt,
    totalGain: toStringValue(strategy.totalGain),
    totalLoss: toStringValue(strategy.totalLoss),
    lastReport: toNumber(strategy.lastReport),
    performanceFee: toNumber(strategy.performanceFee),
  }
  const debtRatio = calculateDebtRatio(totalDebt, snapshot.totalAssets)
  if (debtRatio !== undefined) {
    details.debtRatio = debtRatio
  }

  return {
    address: strategy.address,
    name: strategy.name || 'Unknown',
    status: totalDebt === '0' ? 'unallocated' : strategy.status,
    netAPR: toPositiveFiniteNumberOrNull(strategy.latestReportApr),
    strategyRewardsAPR: estimatedKatRewardsAPR,
    rewardToken:
      estimatedKatRewardsAPR !== null && estimatedKatRewardsAPR > 0
        ? {
            address: CANONICAL_KAT_ADDRESS,
            symbol: 'KAT',
            decimals: 18,
          }
        : null,
    underlyingContract: null,
    details,
  }
}

const mapKongAprToYearnApr = (snapshot: KongVaultSnapshot): YearnVaultAPY => {
  const historical = snapshot.performance?.historical
  const apy = snapshot.apy
  const shareDecimals = toNumber(snapshot.decimals ?? snapshot.asset?.decimals)

  return {
    type: 'v3:averaged',
    netAPR:
      apy?.monthlyNet ??
      historical?.monthlyNet ??
      apy?.net ??
      historical?.net ??
      snapshot.performance?.oracle?.netAPR ??
      0,
    fees: snapshot.fees
      ? {
          management: normalizeBasisPoints(snapshot.fees.managementFee),
          performance: normalizeBasisPoints(snapshot.fees.performanceFee),
        }
      : undefined,
    points: {
      weekAgo: toNumber(apy?.weeklyNet ?? historical?.weeklyNet),
      monthAgo: toNumber(apy?.monthlyNet ?? historical?.monthlyNet),
      inception: toNumber(apy?.inceptionNet ?? historical?.inceptionNet),
    },
    pricePerShare: {
      today: normalizeShareValue(apy?.pricePerShare, shareDecimals),
      weekAgo: normalizeShareValue(
        apy?.weeklyPricePerShare,
        shareDecimals,
      ),
      monthAgo: normalizeShareValue(
        apy?.monthlyPricePerShare,
        shareDecimals,
      ),
    },
    forwardAPR: {
      type: '',
      netAPR: null,
      composite: {
        boost: null,
        poolAPY: null,
        boostedAPR: null,
        baseAPR: null,
        cvxAPR: null,
        rewardsAPR: null,
      },
    },
  }
}

const mapKongTvlToYearnTvl = (snapshot: KongVaultSnapshot): YearnVaultTVL => {
  const tvl = typeof snapshot.tvl === 'number'
    ? snapshot.tvl
    : toNumber(snapshot.tvl?.close)

  return {
    totalAssets: toStringValue(snapshot.totalAssets),
    tvl,
    price: calculateTokenPrice(
      snapshot.totalAssets,
      tvl,
      toNumber(snapshot.asset?.decimals ?? snapshot.decimals),
    ),
  }
}

const mapKongSnapshotToYearnVault = (
  snapshot: KongVaultSnapshot,
  chainId: number,
): YearnVault | null => {
  if (!snapshot.address || !snapshot.name || !snapshot.symbol) {
    return null
  }

  const token = mapKongAssetToYearnToken(snapshot.asset ?? snapshot.meta?.token)
  const strategies = (snapshot.composition || [])
    .map((strategy) => mapKongCompositionToYearnStrategy(strategy, snapshot))
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
