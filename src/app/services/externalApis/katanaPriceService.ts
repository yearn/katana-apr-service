import { config } from '../../config'
import {
  CANONICAL_KAT_ADDRESS,
  getKatanaPriceLookupAddresses,
  isKatanaRewardTokenAddress,
} from '../katanaRewardTokens'

type CoinGeckoTokenPriceResponse = Record<string, { usd?: number }>

type PriceServiceCoin = {
  prices?: Array<{ price?: unknown }>
  error?: { code?: string; message?: string }
}

type PriceServiceResponse = {
  coins?: Record<string, PriceServiceCoin>
}

const PRICE_CACHE_TTL_MS = 60_000
const PRICE_CACHE_STALE_TTL_MS = 5 * 60_000
const PRICE_SERVICE_CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  100: 'gnosis',
  137: 'polygon',
  146: 'sonic',
  250: 'fantom',
  8453: 'base',
  42161: 'arbitrum',
  80094: 'berachain',
  747474: 'katana',
  4663: 'robinhood',
  999: 'hyperliquid',
}

type CachedKatanaPrice = {
  priceUsd: number
  freshUntil: number
  staleUntil: number
}

const katanaPriceCache = new Map<string, CachedKatanaPrice>()
const inFlightPriceRequests = new Map<string, Promise<number>>()

const isFinitePrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

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

export class KatanaPriceService {
  private readonly coingeckoApiUrl: string
  private readonly coingeckoKatanaCoinId: string
  private readonly yearnPricesApiKey?: string
  private readonly yearnPricesBaseUrl: string
  private readonly coinGeckoHeaders?: Record<string, string>

  constructor() {
    this.coingeckoApiUrl = config.coingeckoApiUrl
    this.coingeckoKatanaCoinId = config.coingeckoKatanaCoinId
    this.yearnPricesApiKey = config.yearnPricesApiKey
    this.yearnPricesBaseUrl = config.yearnPricesBaseUrl
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

        if (isFinitePrice(priceUsd)) {
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
  ): Promise<number | undefined> {
    const lookupAddresses = getKatanaPriceLookupAddresses(tokenAddress)

    const priceServicePrice = await this.getPriceServicePriceUsd(
      chainId,
      lookupAddresses,
    )
    if (priceServicePrice !== undefined) {
      return priceServicePrice
    }

    const coinGeckoPrice = await this.getCoinGeckoPriceUsd()
    if (coinGeckoPrice > 0) {
      return coinGeckoPrice
    }

    return undefined
  }

  private async getCoinGeckoPriceUsd(): Promise<number> {
    try {
      const params = new URLSearchParams({
        ids: this.coingeckoKatanaCoinId,
        vs_currencies: 'usd',
      })
      const response = await fetch(
        `${this.coingeckoApiUrl}/simple/price?${params}`,
        {
          headers: this.coinGeckoHeaders,
        },
      )

      if (!response.ok) {
        throw new Error(`HTTP error fetching CoinGecko price: ${response.status}`)
      }

      const data = (await response.json()) as CoinGeckoTokenPriceResponse
      const price = data?.[this.coingeckoKatanaCoinId]?.usd
      if (isPositiveFiniteNumber(price)) {
        return price
      }
    } catch (error) {
      console.error('Error fetching CoinGecko token price:', error)
    }

    return 0
  }

  private async getPriceServicePriceUsd(
    chainId: number,
    addresses: string[],
  ): Promise<number | undefined> {
    const chainName = PRICE_SERVICE_CHAIN_NAMES[chainId]
    if (!chainName) {
      console.error(`Yearn Price Service does not support chain ${chainId}`)
      return undefined
    }

    if (!this.yearnPricesApiKey) {
      console.error('Yearn Price Service unavailable: YEARN_PRICES_API_KEY is not configured')
      return undefined
    }

    try {
      const url = new URL(`${this.yearnPricesBaseUrl}/api/prices/spot`)
      url.searchParams.set(
        'coins',
        JSON.stringify(addresses.map(address => `${chainName}:${address.toLowerCase()}`)),
      )
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.yearnPricesApiKey}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP error fetching Yearn Price Service prices: ${response.status}`)
      }

      const data = (await response.json()) as PriceServiceResponse
      const normalizedPrices = new Map(
        Object.entries(data?.coins ?? {}).map(([key, coin]) => [
          key.toLowerCase(),
          coin,
        ]),
      )

      for (const address of addresses) {
        const tokenKey = `${chainName}:${address.toLowerCase()}`
        const coin = normalizedPrices.get(tokenKey)
        if (coin?.error) {
          if (coin.error.code !== 'NOT_FOUND') {
            console.error(
              `Yearn Price Service could not price ${tokenKey}: ${coin.error.code ?? 'PRICE_UNAVAILABLE'} ${coin.error.message ?? ''}`,
            )
          }
          continue
        }

        const price = coin?.prices?.[0]?.price
        if (isFinitePrice(price)) {
          return price
        }
      }
    } catch (error) {
      console.error('Error fetching Yearn Price Service token prices:', error)
    }

    return undefined
  }
}

export const resetKatanaPriceServiceCache = (): void => {
  katanaPriceCache.clear()
  inFlightPriceRequests.clear()
}
