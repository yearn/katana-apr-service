import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'
import { CANONICAL_KAT_ADDRESS } from '../katanaRewardTokens'

const LEGACY_KAT_ADDRESS = '0x0161A31702d6CF715aaa912d64c6A190FD0093aa'
const WRAPPED_KAT_ADDRESS = '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461'

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
}))

vi.stubGlobal('fetch', mocks.fetchGet)

import { KatanaPriceService, resetKatanaPriceServiceCache } from './katanaPriceService'

const makeOkResponse = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  })

const makePriceServiceResponse = (prices: Record<string, number>) =>
  makeOkResponse({
    coins: Object.fromEntries(
      Object.entries(prices).map(([address, price]) => [
        `katana:${address.toLowerCase()}`,
        { prices: [{ price }] },
      ]),
    ),
  })

const makePriceServiceErrorResponse = (status: number) =>
  Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'upstream error' }),
  })

describe('KatanaPriceService', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.fetchGet.mockReset()
    resetKatanaPriceServiceCache()
    config.yearnPricesApiKey = 'test-price-service-key'
    config.yearnPricesBaseUrl = 'https://prices.yearn.dev'
  })

  it('reads the human-readable spot quote for the canonical address', async () => {
    mocks.fetchGet.mockImplementationOnce(() =>
      makePriceServiceResponse({ [CANONICAL_KAT_ADDRESS]: 1.25 }),
    )

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(1.25)
    const [request, options] = mocks.fetchGet.mock.calls[0]
    const requestUrl = new URL(request as URL)
    expect(requestUrl.pathname).toBe('/api/prices/spot')
    expect(JSON.parse(requestUrl.searchParams.get('coins') ?? '[]')).toEqual([
      `katana:${CANONICAL_KAT_ADDRESS.toLowerCase()}`,
    ])
    expect(options.headers).toEqual({
      Authorization: 'Bearer test-price-service-key',
      Accept: 'application/json',
    })
  })

  it('falls back to CoinGecko when the Price Service has no quote', async () => {
    mocks.fetchGet.mockImplementationOnce(() => makeOkResponse({ coins: {} }))
    mocks.fetchGet.mockImplementationOnce(() =>
      makeOkResponse({
        [config.coingeckoKatanaCoinId]: { usd: 1.25 },
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
      expect.objectContaining({
        headers: config.coingeckoApiKey
          ? { 'x-cg-demo-api-key': config.coingeckoApiKey }
          : undefined,
      }),
    )
    expect(mocks.fetchGet).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/ids=katana-network-token/),
      expect.anything(),
    )
  })

  it('falls back from a legacy KAT address to its canonical quote', async () => {
    mocks.fetchGet.mockImplementationOnce(() =>
      makePriceServiceResponse({ [CANONICAL_KAT_ADDRESS]: 2.5 }),
    )

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      LEGACY_KAT_ADDRESS,
    )

    expect(price).toBe(2.5)
  })

  it('falls back from a wrapped KAT address to its canonical quote', async () => {
    mocks.fetchGet.mockImplementationOnce(() =>
      makePriceServiceResponse({ [CANONICAL_KAT_ADDRESS]: 2.5 }),
    )

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      WRAPPED_KAT_ADDRESS,
    )

    expect(price).toBe(2.5)
  })

  it('returns 0 when neither Price Service nor CoinGecko has a quote', async () => {
    mocks.fetchGet.mockImplementationOnce(() => makeOkResponse({ coins: {} }))
    mocks.fetchGet.mockImplementationOnce(() => makeOkResponse({}))

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(0)
  })

  it('logs Price Service authorization errors before using the CoinGecko fallback', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.fetchGet.mockImplementationOnce(() => makePriceServiceErrorResponse(401))
    mocks.fetchGet.mockImplementationOnce(() =>
      makeOkResponse({
        [config.coingeckoKatanaCoinId]: { usd: 1.25 },
      }),
    )

    const service = new KatanaPriceService()
    const price = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    expect(price).toBe(1.25)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error fetching Yearn Price Service token prices:',
      expect.any(Error),
    )
    consoleErrorSpy.mockRestore()
  })

  it('reuses a cached price within the TTL window', async () => {
    mocks.fetchGet.mockImplementationOnce(() =>
      makePriceServiceResponse({ [CANONICAL_KAT_ADDRESS]: 1.25 }),
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
    resolveRequest?.({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          coins: {
            [`katana:${CANONICAL_KAT_ADDRESS.toLowerCase()}`]: {
              prices: [{ price: 1.25 }],
            },
          },
        }),
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
      makePriceServiceResponse({ [CANONICAL_KAT_ADDRESS]: 1.25 }),
    )

    const service = new KatanaPriceService()
    const freshPrice = await service.getTokenPriceUsd(
      config.katanaChainId,
      CANONICAL_KAT_ADDRESS,
    )

    vi.setSystemTime(new Date('2026-03-18T09:01:30.000Z'))
    mocks.fetchGet.mockRejectedValueOnce(new Error('Price Service unavailable'))
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
