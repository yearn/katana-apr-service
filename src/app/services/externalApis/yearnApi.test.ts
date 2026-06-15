import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  logVaultAprDebug: vi.fn(),
}))

vi.stubGlobal('fetch', mocks.fetchGet)

vi.mock('../aprCalcs/debugLogger', () => ({
  logVaultAprDebug: mocks.logVaultAprDebug,
}))

import { YearnApiService } from './yearnApi'

const makeOkResponse = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  })

describe('YearnApiService', () => {
  beforeEach(() => {
    mocks.fetchGet.mockReset()
    mocks.logVaultAprDebug.mockReset()
  })

  it('fetches Katana Yearn vaults from Kong snapshots', async () => {
    mocks.fetchGet.mockImplementation((url: string) => {
      if (url.endsWith('/list/vaults/747474?origin=yearn')) {
        return makeOkResponse([
          {
            chainId: 747474,
            address: '0x00000000000000000000000000000000000000aa',
            origin: 'yearn',
            inclusion: { isKatana: true },
          },
          {
            chainId: 747474,
            address: '0x00000000000000000000000000000000000000bb',
            origin: 'yearn',
            inclusion: { isKatana: false },
          },
        ])
      }

      if (
        url.endsWith(
          '/snapshot/747474/0x00000000000000000000000000000000000000aa',
        )
      ) {
        return makeOkResponse({
          chainId: 747474,
          address: '0x00000000000000000000000000000000000000aa',
          name: 'vbUSDC yVault',
          symbol: 'yvvbUSDC',
          totalAssets: '1000000',
          asset: {
            address: '0x00000000000000000000000000000000000000cc',
            name: 'Vault Bridge USDC',
            symbol: 'vbUSDC',
            decimals: '6',
          },
          meta: {
            displayName: 'USDC yVault',
          },
          apy: {
            net: 0.03,
            weeklyNet: 0.02,
            monthlyNet: 0.01,
            inceptionNet: 0.04,
            pricePerShare: '1000000',
            weeklyPricePerShare: '990000',
            monthlyPricePerShare: '980000',
          },
          tvl: {
            close: 100,
          },
          fees: {
            managementFee: 25,
            performanceFee: 1000,
          },
          composition: [
            {
              address: '0x00000000000000000000000000000000000000dd',
              name: 'Morpho Strategy',
              status: 'active',
              currentDebt: '42',
              totalGain: '2',
              totalLoss: '1',
              lastReport: '123',
              performanceFee: '0',
            },
          ],
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const service = new YearnApiService()
    const vaults = await service.getVaults(config.katanaChainId)

    expect(vaults).toHaveLength(1)
    expect(vaults[0]).toMatchObject({
      address: '0x00000000000000000000000000000000000000aa',
      name: 'USDC yVault',
      symbol: 'yvvbUSDC',
      chainID: 747474,
      apr: {
        netAPR: 0.03,
        fees: {
          management: 25,
          performance: 1000,
        },
      },
      tvl: {
        totalAssets: '1000000',
        tvl: 100,
        price: 0,
      },
    })
    expect(vaults[0].strategies).toEqual([
      {
        address: '0x00000000000000000000000000000000000000dd',
        name: 'Morpho Strategy',
        status: 'active',
        details: {
          totalDebt: '42',
          totalGain: '2',
          totalLoss: '1',
          lastReport: 123,
          performanceFee: 0,
        },
      },
    ])
    expect(mocks.fetchGet).toHaveBeenCalledTimes(2)
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'vault_fetch',
        reason: 'fetched_from_kong',
      }),
    )
  })
})
