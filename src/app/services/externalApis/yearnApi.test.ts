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
          totalDebt: '800000',
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
              currentDebt: '640000',
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
        type: 'v3:averaged',
        netAPR: 0.01,
        fees: {
          management: 0.0025,
          performance: 0.1,
        },
        pricePerShare: {
          today: 1,
          weekAgo: 0.99,
          monthAgo: 0.98,
        },
        forwardAPR: {
          type: 'katana-estimated-apr',
          apr: null,
          apy: null,
          grossAPR: null,
          grossAPY: null,
          netAPR: null,
          netAPY: null,
          components: {},
        },
      },
      tvl: {
        totalAssets: '1000000',
        tvl: 100,
        price: 100,
      },
    })
    expect(vaults[0].strategies).toEqual([
      {
        address: '0x00000000000000000000000000000000000000dd',
        name: 'Morpho Strategy',
        status: 'active',
        netAPR: null,
        strategyRewardsAPR: null,
        rewardToken: null,
        underlyingContract: null,
        details: {
          totalDebt: '640000',
          totalGain: '2',
          totalLoss: '1',
          lastReport: 123,
          performanceFee: 0,
          debtRatio: 6400,
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
    expect(vaults[0].apr?.forwardAPR).not.toHaveProperty('composite')
  })

  it('preserves Kong strategy oracle and estimated performance fields', async () => {
    mocks.fetchGet.mockImplementation((url: string) => {
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
          decimals: '6',
          totalAssets: '1000000',
          asset: {
            address: '0x00000000000000000000000000000000000000cc',
            name: 'Vault Bridge USDC',
            symbol: 'vbUSDC',
            decimals: '6',
          },
          apy: {
            net: 0.03,
            monthlyNet: 0.01,
            pricePerShare: '1000000',
          },
          performance: {
            oracle: {
              netAPR: 0.99,
            },
            historical: {
              net: 0.04,
              monthlyNet: 0.02,
            },
          },
          tvl: {
            close: 100,
          },
          composition: [
            {
              address: '0x00000000000000000000000000000000000000dd',
              name: 'Steer Strategy',
              status: 'active',
              currentDebt: '640000',
              performance: {
                oracle: {
                  apr: '0.11',
                  apy: '0.12',
                  source: 'kong-oracle',
                },
                estimated: {
                  apr: '0.01',
                  apy: '0.011',
                  grossAPR: '0.13',
                  grossAPY: '0.14',
                  netAPR: '0.10',
                  netAPY: '0.105',
                  components: {
                    oracleAPY: '0.12',
                    katRewardsAPR: '0.05',
                    empty: null,
                  },
                },
              },
            },
          ],
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const service = new YearnApiService()
    const vault = await service.getVaultByAddress(
      '0x00000000000000000000000000000000000000aa',
      config.katanaChainId,
    )

    expect(vault?.apr?.netAPR).toBe(0.01)
    expect(vault?.apr?.netAPR).not.toBe(0.99)
    expect(vault?.strategies[0]).toMatchObject({
      oracleAPR: 0.11,
      oracleAPY: 0.12,
      oracleSource: 'kong-oracle',
      estimatedAPR: 0.01,
      estimatedAPY: 0.011,
      estimatedGrossAPR: 0.13,
      estimatedGrossAPY: 0.14,
      estimatedNetAPR: 0.1,
      estimatedNetAPY: 0.105,
      estimatedComponents: {
        oracleAPY: 0.12,
        katRewardsAPR: 0.05,
        empty: null,
      },
      strategyRewardsAPR: 0.05,
      rewardToken: {
        address: '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d',
        symbol: 'KAT',
        decimals: 18,
      },
    })
  })
})
