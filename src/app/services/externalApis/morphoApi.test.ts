import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aprToApy,
  MORPHO_REWARD_TOKEN_ADDRESS,
  MorphoApiService,
} from './morphoApi'
import { CANONICAL_KAT_ADDRESS } from '../katanaRewardTokens'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.stubGlobal('fetch', mocks.fetch)

const okResponse = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  })

describe('MorphoApiService', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
  })

  it('normalizes V1 and V2 vault APY and reward APR data', async () => {
    mocks.fetch.mockResolvedValue(
      okResponse({
        data: {
          vaults: {
            items: [
              {
                address: '0xE4248e2105508FcBad3fe95691551d1AF14015f7',
                name: 'Gauntlet USDC',
                symbol: 'gtUSDC',
                state: {
                  apy: 0.04,
                  netApy: 0.07,
                  allRewards: [
                    {
                      asset: {
                        address: MORPHO_REWARD_TOKEN_ADDRESS,
                        symbol: 'MORPHO',
                      },
                      supplyApr: 0.01,
                    },
                    {
                      asset: {
                        address: CANONICAL_KAT_ADDRESS,
                        symbol: 'KAT',
                      },
                      supplyApr: 0.02,
                    },
                  ],
                },
              },
            ],
          },
          vaultV2s: {
            items: [
              {
                address: '0xca44cbe1FB03691d43d2d93AA460e2fCB03878fE',
                name: 'Yearn OG USDC',
                symbol: 'ymvOG-vbUSDC',
                avgNetApy: 0.08,
                avgNetApyExcludingRewards: 0.05,
                rewards: [
                  {
                    asset: {
                      address: MORPHO_REWARD_TOKEN_ADDRESS,
                      symbol: 'MORPHO',
                    },
                    supplyApr: 0.015,
                  },
                ],
              },
            ],
          },
        },
      }),
    )

    const service = new MorphoApiService('https://morpho.example/graphql')
    const estimates = await service.getVaultEstimates([
      '0xE4248e2105508FcBad3fe95691551d1AF14015f7',
      '0xca44cbe1FB03691d43d2d93AA460e2fCB03878fE',
    ])

    expect(estimates['0xe4248e2105508fcbad3fe95691551d1af14015f7']).toEqual({
      address: '0xe4248e2105508fcbad3fe95691551d1af14015f7',
      name: 'Gauntlet USDC',
      symbol: 'gtUSDC',
      baseApy: 0.04,
      totalApy: 0.04 + aprToApy(0.01),
      morphoRewardsApr: 0.01,
      katRewardsApr: 0.02,
    })
    expect(estimates['0xca44cbe1fb03691d43d2d93aa460e2fcb03878fe']).toEqual({
      address: '0xca44cbe1fb03691d43d2d93aa460e2fcb03878fe',
      name: 'Yearn OG USDC',
      symbol: 'ymvOG-vbUSDC',
      baseApy: 0.05,
      totalApy: 0.05 + aprToApy(0.015),
      morphoRewardsApr: 0.015,
      katRewardsApr: 0,
    })
  })
})
