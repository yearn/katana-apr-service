import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'
import { CANONICAL_KAT_ADDRESS } from '../katanaRewardTokens'

const LEGACY_KAT_ADDRESS = '0x0161A31702d6CF715aaa912d64c6A190FD0093aa'
const WRAPPED_KAT_ADDRESS = '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461'

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
}))

vi.stubGlobal('fetch', mocks.fetchGet)

import {
  KatanaPriceService,
  parseYDaemonPriceUsd,
  resetKatanaPriceServiceCache,
} from './katanaPriceService'

const makeOkResponse = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  })

const makeErrorResponse = (status: number) =>
  Promise.resolve({
    ok: false,
    status,
    json: () => Promise.reject(new Error('error body')),
  })

describe('KatanaPriceService', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.fetchGet.mockReset()
    resetKatanaPriceServiceCache()
  })

  it('returns yDaemon price when available for the canonical address', async () => {
    mocks.fetchGet.mockImplementationOnce(() =>
      makeOkResponse({
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '1250000',
        },
      }),
    )

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(1.25)
    expect(mocks.fetchGet).toHaveBeenCalledWith(
      `${config.yearnApiUrl}/prices/all`,
    )
  })

  it('falls back to CoinGecko when yDaemon cannot serve a price', async () => {
    mocks.fetchGet.mockImplementationOnce(() => makeOkResponse({}))
    mocks.fetchGet.mockImplementationOnce(() =>
      makeOkResponse({
        [config.coingeckoKatanaCoinId]: {
          usd: 1.25,
        },
      }),
    )

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(1.25)
    expect(mocks.fetchGet).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`${config.coingeckoApiUrl}/simple/price`),
      expect.objectContaining({ headers: undefined }),
    )
    expect(mocks.fetchGet).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/ids=katana-network-token/),
      expect.anything(),
    )
  })

  it('aliases the legacy KAT address to the canonical KAT yDaemon price', async () => {
    mocks.fetchGet.mockImplementationOnce(() =>
      makeOkResponse({
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '2500000',
        },
      }),
    )

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      LEGACY_KAT_ADDRESS,
    )

    expect(price).toBe(2.5)
    expect(mocks.fetchGet).toHaveBeenCalledWith(
      `${config.yearnApiUrl}/prices/all`,
    )
  })

  it('aliases wrapped KAT addresses to the canonical KAT yDaemon price', async () => {
    mocks.fetchGet.mockImplementationOnce(() =>
      makeOkResponse({
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '2500000',
        },
      }),
    )

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      WRAPPED_KAT_ADDRESS,
    )

    expect(price).toBe(2.5)
    expect(mocks.fetchGet).toHaveBeenCalledWith(
      `${config.yearnApiUrl}/prices/all`,
    )
  })

  it('returns 0 when both yDaemon and CoinGecko fail to provide a price', async () => {
    mocks.fetchGet.mockImplementationOnce(() => makeOkResponse({}))
    mocks.fetchGet.mockImplementationOnce(() => makeOkResponse({}))

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(0)
  })

  it('reuses a cached price within the TTL window', async () => {
    mocks.fetchGet.mockImplementationOnce(() =>
      makeOkResponse({
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '1250000',
        },
      }),
    )

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
    expect(mocks.fetchGet).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent refreshes for the same KAT price', async () => {
    let resolveRequest:
      | ((value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void)
      | undefined

    mocks.fetchGet.mockImplementationOnce(
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

    expect(mocks.fetchGet).toHaveBeenCalledTimes(1)

    const responseData = {
      [config.katanaChainId]: {
        [CANONICAL_KAT_ADDRESS.toLowerCase()]: '1250000',
      },
    }
    resolveRequest?.({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
    })

    const [firstPrice, secondPrice] = await Promise.all([
      firstRequest,
      secondRequest,
    ])

    expect(firstPrice).toBe(1.25)
    expect(secondPrice).toBe(1.25)
    expect(mocks.fetchGet).toHaveBeenCalledTimes(1)
  })

  it('serves a stale cached price when refresh fails within the stale window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-18T09:00:00.000Z'))
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.fetchGet.mockImplementationOnce(() =>
      makeOkResponse({
        [config.katanaChainId]: {
          [CANONICAL_KAT_ADDRESS.toLowerCase()]: '1250000',
        },
      }),
    )

    const service = new KatanaPriceService()
    const freshPrice = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    vi.setSystemTime(new Date('2026-03-18T09:01:30.000Z'))
    mocks.fetchGet.mockRejectedValueOnce(new Error('yDaemon unavailable'))
    mocks.fetchGet.mockImplementationOnce(() => makeOkResponse({}))

    const stalePrice = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(freshPrice).toBe(1.25)
    expect(stalePrice).toBe(1.25)
    expect(mocks.fetchGet).toHaveBeenCalledTimes(3)

    consoleErrorSpy.mockRestore()
  })
})

describe('parseYDaemonPriceUsd', () => {
  it('parses yDaemon 6-decimal integer strings', () => {
    expect(parseYDaemonPriceUsd('1234567')).toBe(1.234567)
  })
})
