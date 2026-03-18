import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'
import { CANONICAL_KAT_ADDRESS } from '../katanaRewardTokens'

const WRAPPED_KAT_ADDRESS = '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461'

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet,
  },
}))

import { KatanaPriceService, parseYDaemonPriceUsd } from './katanaPriceService'

describe('KatanaPriceService', () => {
  beforeEach(() => {
    mocks.axiosGet.mockReset()
  })

  it('returns CoinGecko price when available for the requested address', async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [CANONICAL_KAT_ADDRESS.toLowerCase()]: {
          usd: 1.25,
        },
      },
    })

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(1.25)
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      `${config.coingeckoApiUrl}/simple/token_price/${config.coingeckoKatanaPlatformId}`,
      expect.objectContaining({
        params: {
          contract_addresses: CANONICAL_KAT_ADDRESS.toLowerCase(),
          vs_currencies: 'usd',
        },
      }),
    )
  })

  it('falls back to yDaemon prices and parses 6-decimal strings', async () => {
    mocks.axiosGet.mockResolvedValueOnce({ data: {} })
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '1250000',
        },
      },
    })

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(1.25)
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(
      2,
      `${config.yearnApiUrl}/prices/all`,
    )
  })

  it('aliases wrapped KAT addresses to the canonical KAT price', async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [CANONICAL_KAT_ADDRESS.toLowerCase()]: {
          usd: 2.5,
        },
      },
    })

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      WRAPPED_KAT_ADDRESS,
    )

    expect(price).toBe(2.5)
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      `${config.coingeckoApiUrl}/simple/token_price/${config.coingeckoKatanaPlatformId}`,
      expect.objectContaining({
        params: {
          contract_addresses: [
            WRAPPED_KAT_ADDRESS.toLowerCase(),
            CANONICAL_KAT_ADDRESS.toLowerCase(),
          ].join(','),
          vs_currencies: 'usd',
        },
      }),
    )
  })

  it('returns 0 when both CoinGecko and yDaemon fail to provide a price', async () => {
    mocks.axiosGet.mockResolvedValueOnce({ data: {} })
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [config.katanaChainId]: {},
      },
    })

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(0)
  })
})

describe('parseYDaemonPriceUsd', () => {
  it('parses yDaemon 6-decimal integer strings', () => {
    expect(parseYDaemonPriceUsd('1234567')).toBe(1.234567)
  })
})
