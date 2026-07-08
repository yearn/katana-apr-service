import { describe, expect, it } from 'vitest'
import { MorphoApiService } from './morphoApi'

describe('MorphoApiService', () => {
  it('normalizes V1 and V2 vault APY and reward APR fields', () => {
    const service = new MorphoApiService()

    const estimates = service.normalizeVaultEstimates({
      data: {
        vaults: {
          items: [
            {
              address: '0x00000000000000000000000000000000000000AA',
              state: {
                apy: '0.04',
                allRewards: [
                  {
                    asset: {
                      address: '0x00000000000000000000000000000000000000BB',
                      symbol: 'MORPHO',
                    },
                    supplyApr: '0.015',
                  },
                ],
              },
            },
          ],
        },
        vaultV2s: {
          items: [
            {
              address: '0x00000000000000000000000000000000000000CC',
              avgNetApyExcludingRewards: '0.03',
              rewards: [
                {
                  asset: {
                    address: '0x00000000000000000000000000000000000000DD',
                    symbol: 'MORPHO',
                  },
                  supplyApr: '0.012',
                },
              ],
            },
          ],
        },
      },
    })

    expect(estimates).toEqual({
      '0x00000000000000000000000000000000000000aa': {
        address: '0x00000000000000000000000000000000000000aa',
        baseAPY: 0.04,
        version: 'v1',
        rewards: [
          {
            tokenAddress: '0x00000000000000000000000000000000000000BB',
            tokenSymbol: 'MORPHO',
            supplyApr: 0.015,
          },
        ],
      },
      '0x00000000000000000000000000000000000000cc': {
        address: '0x00000000000000000000000000000000000000cc',
        baseAPY: 0.03,
        version: 'v2',
        rewards: [
          {
            tokenAddress: '0x00000000000000000000000000000000000000DD',
            tokenSymbol: 'MORPHO',
            supplyApr: 0.012,
          },
        ],
      },
    })
  })
})
