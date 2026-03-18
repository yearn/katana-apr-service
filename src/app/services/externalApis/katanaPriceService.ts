import axios from 'axios'
import { formatUnits } from 'viem'
import { config } from '../../config'
import {
  CANONICAL_KAT_ADDRESS,
  getKatanaPriceLookupAddresses,
  isKatanaRewardTokenAddress,
} from '../katanaRewardTokens'

type CoinGeckoTokenPriceResponse = Record<
  string,
  {
    usd?: number
  }
>

type YDaemonPricesChain = Record<string, Record<string, string>>

const YDAEMON_PRICE_DECIMALS = 6
const PRICE_CACHE_TTL_MS = 60_000
const PRICE_CACHE_STALE_TTL_MS = 5 * 60_000

type CachedKatanaPrice = {
  priceUsd: number
  freshUntil: number
  staleUntil: number
}

const katanaPriceCache = new Map<string, CachedKatanaPrice>()
const inFlightPriceRequests = new Map<string, Promise<number>>()

const isPositiveFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const getCacheKeyAddress = (tokenAddress: string): string => {
  if (isKatanaRewardTokenAddress(tokenAddress)) {
    return CANONICAL_KAT_ADDRESS.toLowerCase()
  }

  return tokenAddress.toLowerCase()
}

const getCacheKey = (chainId: number, tokenAddress: string): string =>
  `${chainId}:${getCacheKeyAddress(tokenAddress)}`

const parseYDaemonPriceUsd = (rawPrice: unknown): number => {
  if (typeof rawPrice !== 'string' || rawPrice.length === 0) {
    return 0
  }

  try {
    const normalizedPrice = Number(
      formatUnits(BigInt(rawPrice), YDAEMON_PRICE_DECIMALS),
    )
    return isPositiveFiniteNumber(normalizedPrice) ? normalizedPrice : 0
  } catch {
    const parsedPrice = Number(rawPrice)
    return isPositiveFiniteNumber(parsedPrice) ? parsedPrice : 0
  }
}

export class KatanaPriceService {
  private readonly coingeckoApiUrl: string
  private readonly coingeckoKatanaCoinId: string
  private readonly yearnApiUrl: string
  private readonly coinGeckoHeaders?: Record<string, string>

  constructor() {
    this.coingeckoApiUrl = config.coingeckoApiUrl
    this.coingeckoKatanaCoinId = config.coingeckoKatanaCoinId
    this.yearnApiUrl = config.yearnApiUrl
    this.coinGeckoHeaders = config.coingeckoApiKey
      ? { 'x-cg-demo-api-key': config.coingeckoApiKey }
      : undefined
  }

  async getTokenPriceUsd(
    chainId: number,
    tokenAddress: string,
  ): Promise<number> {
    const cacheKey = getCacheKey(chainId, tokenAddress)
    const now = Date.now()
    const cachedPrice = katanaPriceCache.get(cacheKey)

    if (cachedPrice && cachedPrice.freshUntil > now) {
      return cachedPrice.priceUsd
    }

    const inFlightRequest = inFlightPriceRequests.get(cacheKey)
    if (inFlightRequest) {
      return await inFlightRequest
    }

    const refreshPromise = this.fetchTokenPriceUsd(chainId, tokenAddress)
      .then((priceUsd) => {
        const refreshedAt = Date.now()

        if (priceUsd > 0) {
          katanaPriceCache.set(cacheKey, {
            priceUsd,
            freshUntil: refreshedAt + PRICE_CACHE_TTL_MS,
            staleUntil: refreshedAt + PRICE_CACHE_STALE_TTL_MS,
          })
          return priceUsd
        }

        const staleCachedPrice = katanaPriceCache.get(cacheKey)
        if (staleCachedPrice && staleCachedPrice.staleUntil > refreshedAt) {
          return staleCachedPrice.priceUsd
        }

        return 0
      })
      .finally(() => {
        inFlightPriceRequests.delete(cacheKey)
      })

    inFlightPriceRequests.set(cacheKey, refreshPromise)
    return await refreshPromise
  }

  private async fetchTokenPriceUsd(
    chainId: number,
    tokenAddress: string,
  ): Promise<number> {
    const lookupAddresses = getKatanaPriceLookupAddresses(tokenAddress)

    const yDaemonPrice = await this.getYDaemonPriceUsd(chainId, lookupAddresses)
    if (yDaemonPrice > 0) {
      return yDaemonPrice
    }

    const coinGeckoPrice = await this.getCoinGeckoPriceUsd()
    if (coinGeckoPrice > 0) {
      return coinGeckoPrice
    }

    return 0
  }

  private async getCoinGeckoPriceUsd(): Promise<number> {
    try {
      const response = await axios.get<CoinGeckoTokenPriceResponse>(
        `${this.coingeckoApiUrl}/simple/price`,
        {
          params: {
            ids: this.coingeckoKatanaCoinId,
            vs_currencies: 'usd',
          },
          headers: this.coinGeckoHeaders,
        },
      )

      const price = response.data?.[this.coingeckoKatanaCoinId]?.usd
      if (isPositiveFiniteNumber(price)) {
        return price
      }
    } catch (error) {
      console.error('Error fetching CoinGecko token price:', error)
    }

    return 0
  }

  private async getYDaemonPriceUsd(
    chainId: number,
    addresses: string[],
  ): Promise<number> {
    try {
      const response = await axios.get<YDaemonPricesChain>(
        `${this.yearnApiUrl}/prices/all`,
      )
      const chainPrices = response.data?.[String(chainId)]

      if (!chainPrices) {
        return 0
      }

      const normalizedChainPrices = new Map(
        Object.entries(chainPrices).map(([address, price]) => [
          address.toLowerCase(),
          price,
        ]),
      )

      for (const address of addresses) {
        const price = parseYDaemonPriceUsd(
          normalizedChainPrices.get(address.toLowerCase()),
        )
        if (price > 0) {
          return price
        }
      }
    } catch (error) {
      console.error('Error fetching yDaemon token prices:', error)
    }

    return 0
  }
}

export const resetKatanaPriceServiceCache = (): void => {
  katanaPriceCache.clear()
  inFlightPriceRequests.clear()
}

export { parseYDaemonPriceUsd }
