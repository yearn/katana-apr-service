import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchPost: vi.fn(),
}))

vi.stubGlobal('fetch', mocks.fetchPost)

import { MorphoApiService } from './morphoApi'

const KAT_ADDRESS = '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d'
const WRAPPED_KAT_ADDRESS = '0x3ba1fbC4c3aEA775d335b31fb53778f46FD3a330'
const MORPHO_ADDRESS = '0x9994e35db50125e0df82e4c2dde62496ce330999'

const makeOkResponse = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  })

describe('MorphoApiService', () => {
  beforeEach(() => {
    mocks.fetchPost.mockReset()
  })

  it('normalizes V1 vault base APY and non-KAT rewards', async () => {
    const address = '0xE4248e2105508FcBad3fe95691551d1AF14015f7'
    mocks.fetchPost.mockImplementationOnce(() =>
      makeOkResponse({
        data: {
          vaults: {
            items: [
              {
                address,
                state: {
                  apy: '0.05',
                  allRewards: [
                    {
                      supplyApr: '0.01',
                      asset: {
                        address: MORPHO_ADDRESS,
                        symbol: 'MORPHO',
                      },
                    },
                  ],
                },
              },
            ],
          },
          vaultV2s: {
            items: [],
          },
        },
      }),
    )

    const service = new MorphoApiService('https://morpho.test/graphql')
    const estimates = await service.getVaultAprEstimates([address])

    expect(estimates[address.toLowerCase()]).toEqual({
      baseAPY: 0.05,
      rewardsAPR: 0.01,
    })
  })

  it('normalizes V2 vault base APY and rewards', async () => {
    const address = '0x8ED68f91AfbE5871dCE31ae007a936ebE8511d47'
    mocks.fetchPost.mockImplementationOnce(() =>
      makeOkResponse({
        data: {
          vaults: {
            items: [],
          },
          vaultV2s: {
            items: [
              {
                address,
                avgNetApyExcludingRewards: 0.04,
                rewards: [
                  {
                    supplyApr: 0.006,
                    asset: {
                      address: MORPHO_ADDRESS,
                      symbol: 'MORPHO',
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
    )

    const service = new MorphoApiService('https://morpho.test/graphql')
    const estimates = await service.getVaultAprEstimates([address])

    expect(estimates[address.toLowerCase()]).toEqual({
      baseAPY: 0.04,
      rewardsAPR: 0.006,
    })
  })

  it('excludes KAT rewards and includes MORPHO rewards', async () => {
    const address = '0xCE2b8e464Fc7b5E58710C24b7e5EBFB6027f29D7'
    mocks.fetchPost.mockImplementationOnce(() =>
      makeOkResponse({
        data: {
          vaults: {
            items: [
              {
                address,
                state: {
                  apy: 0.03,
                  allRewards: [
                    {
                      supplyApr: 0.02,
                      asset: {
                        address: MORPHO_ADDRESS,
                        symbol: 'MORPHO',
                      },
                    },
                    {
                      supplyApr: 0.50,
                      asset: {
                        address: KAT_ADDRESS,
                        symbol: 'KAT',
                      },
                    },
                    {
                      supplyApr: 0.25,
                      asset: {
                        address: WRAPPED_KAT_ADDRESS,
                        symbol: 'KAT',
                      },
                    },
                  ],
                },
              },
            ],
          },
          vaultV2s: {
            items: [],
          },
        },
      }),
    )

    const service = new MorphoApiService('https://morpho.test/graphql')
    const estimates = await service.getVaultAprEstimates([address])

    expect(estimates[address.toLowerCase()]).toEqual({
      baseAPY: 0.03,
      rewardsAPR: 0.02,
    })
  })

  it('returns partial data when GraphQL errors include data', async () => {
    const address = '0xA2d38c8A3D810EBcF4C2075821c5eC8F976bb692'
    mocks.fetchPost.mockImplementationOnce(() =>
      makeOkResponse({
        errors: [{ message: 'partial failure' }],
        data: {
          vaults: {
            items: [
              {
                address,
                state: {
                  apy: 0.01,
                  allRewards: [],
                },
              },
            ],
          },
          vaultV2s: {
            items: [],
          },
        },
      }),
    )

    const service = new MorphoApiService('https://morpho.test/graphql')
    const estimates = await service.getVaultAprEstimates([address])

    expect(estimates[address.toLowerCase()]).toEqual({
      baseAPY: 0.01,
      rewardsAPR: 0,
    })
  })

  it('returns an empty map on API errors', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mocks.fetchPost.mockRejectedValueOnce(new Error('network failed'))

    const service = new MorphoApiService('https://morpho.test/graphql')
    const estimates = await service.getVaultAprEstimates([
      '0xbeeff2d5d126d4809195EeA02b605423917bb6c6',
    ])

    expect(estimates).toEqual({})
    expect(consoleError).toHaveBeenCalledWith(
      'Error fetching Morpho vault APRs:',
      expect.any(Error),
    )

    consoleError.mockRestore()
  })
})
