import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'
import { CANONICAL_KAT_ADDRESS } from '../katanaRewardTokens'

const LEGACY_KAT_ADDRESS = '0x0161A31702d6CF715aaa912d64c6A190FD0093aa'
const WRAPPED_KAT_ADDRESS = '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461'

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet,
  },
}))

import {
  KatanaPriceService,
  parseYDaemonPriceUsd,
  resetKatanaPriceServiceCache,
} from './katanaPriceService'

describe('KatanaPriceService', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.axiosGet.mockReset()
    resetKatanaPriceServiceCache()
  })

  it('returns yDaemon price when available for the canonical address', async () => {
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
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      `${config.yearnApiUrl}/prices/all`,
    )
  })

  it('falls back to CoinGecko when yDaemon cannot serve a price', async () => {
    mocks.axiosGet.mockResolvedValueOnce({ data: {} })
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [config.coingeckoKatanaCoinId]: {
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
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(
      2,
      `${config.coingeckoApiUrl}/simple/price`,
      expect.objectContaining({
        params: {
          ids: config.coingeckoKatanaCoinId,
          vs_currencies: 'usd',
        },
      }),
    )
  })

  it('aliases the legacy KAT address to the canonical KAT yDaemon price', async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '2500000',
        },
      },
    })

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      LEGACY_KAT_ADDRESS,
    )

    expect(price).toBe(2.5)
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      `${config.yearnApiUrl}/prices/all`,
    )
  })

  it('aliases wrapped KAT addresses to the canonical KAT yDaemon price', async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '2500000',
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
      `${config.yearnApiUrl}/prices/all`,
    )
  })

  it('returns 0 when both yDaemon and CoinGecko fail to provide a price', async () => {
    mocks.axiosGet.mockResolvedValueOnce({ data: {} })
    mocks.axiosGet.mockResolvedValueOnce({
      data: {},
    })

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(0)
  })

  it('reuses a cached price within the TTL window', async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '1250000',
        },
      },
    })

    const service = new KatanaPriceService()
    const firstPrice = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )
    const secondPrice = await service.getTokenPriceUsd(
      config.katanaChainId,
      WRAPPED_KAT_ADDRESS,
    )

    expect(firstPrice).toBe(1.25)
    expect(secondPrice).toBe(1.25)
    expect(mocks.axiosGet).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent refreshes for the same KAT price', async () => {
    let resolveRequest: ((value: {
      data: Record<string, Record<string, string>>
    }) => void) | undefined

    mocks.axiosGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
    )

    const service = new KatanaPriceService()
    const firstRequest = service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )
    const secondRequest = service.getTokenPriceUsd(
      config.katanaChainId,
      WRAPPED_KAT_ADDRESS,
    )

    expect(mocks.axiosGet).toHaveBeenCalledTimes(1)

    resolveRequest?.({
      data: {
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '1250000',
        },
      },
    })

    const [firstPrice, secondPrice] = await Promise.all([
      firstRequest,
      secondRequest,
    ])

    expect(firstPrice).toBe(1.25)
    expect(secondPrice).toBe(1.25)
    expect(mocks.axiosGet).toHaveBeenCalledTimes(1)
  })

  it('serves a stale cached price when refresh fails within the stale window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-18T09:00:00.000Z'))
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '1250000',
        },
      },
    })

    const service = new KatanaPriceService()
    const freshPrice = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    vi.setSystemTime(new Date('2026-03-18T09:01:30.000Z'))
    mocks.axiosGet.mockRejectedValueOnce(new Error('yDaemon unavailable'))
    mocks.axiosGet.mockResolvedValueOnce({
      data: {},
    })

    const stalePrice = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(freshPrice).toBe(1.25)
    expect(stalePrice).toBe(1.25)
    expect(mocks.axiosGet).toHaveBeenCalledTimes(3)

    consoleErrorSpy.mockRestore()
  })
})

describe('parseYDaemonPriceUsd', () => {
  it('parses yDaemon 6-decimal integer strings', () => {
    expect(parseYDaemonPriceUsd('1234567')).toBe(1.234567)
  })
})
