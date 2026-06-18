import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearnVault } from '../../types'
import { CANONICAL_KAT_ADDRESS } from '../katanaRewardTokens'

const mocks = vi.hoisted(() => ({
  getYearnVaultRewardOpportunities: vi.fn(),
  getErc20FixAprOpportunities: vi.fn(),
}))

vi.mock('../externalApis/merklApi', () => ({
  MerklApiService: vi.fn().mockImplementation(() => ({
    getYearnVaultRewardOpportunities: mocks.getYearnVaultRewardOpportunities,
    getErc20FixAprOpportunities: mocks.getErc20FixAprOpportunities,
  })),
}))

vi.mock('../externalApis/yearnApi', () => ({
  YearnApiService: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('../contractReader', () => ({
  ContractReaderService: vi.fn().mockImplementation(() => ({})),
}))

import { YearnAprCalculator } from './yearnAprCalculator'

const VB_WBTC_VAULT = '0xAa0362eCC584B985056E47812931270b99C91f9d'

const makeVault = (overrides: Partial<YearnVault> = {}): YearnVault => ({
  address: VB_WBTC_VAULT,
  symbol: 'yvvbWBTC',
  name: 'WBTC yVault',
  chainID: 747474,
  strategies: [],
  ...overrides,
})

describe('YearnAprCalculator', () => {
  beforeEach(() => {
    mocks.getYearnVaultRewardOpportunities.mockReset()
    mocks.getErc20FixAprOpportunities.mockReset()
  })

  it('uses ERC20_MAPPING vault opportunities for Yearn vault-level rewards', async () => {
    const mappingApr = 0.25450353429333744

    mocks.getYearnVaultRewardOpportunities.mockResolvedValue([
      {
        id: '16662980337666299926',
        chainId: 747474,
        identifier: VB_WBTC_VAULT,
        status: 'LIVE',
        type: 'ERC20_MAPPING',
        name: 'Deposit vbWBTC in vbWBTC yVault',
        tvl: 1_660_000,
        campaigns: [
          {
            campaignId: 'kat-campaign',
            amount: '1',
            startTimestamp: 0,
            endTimestamp: 0,
            rewardToken: {
              address: CANONICAL_KAT_ADDRESS,
              symbol: 'KAT',
              decimals: 18,
              price: 1,
            },
          },
        ],
        aprRecord: {
          breakdowns: [
            {
              identifier: 'kat-campaign',
              value: mappingApr,
            },
          ],
        },
      },
    ])

    const calculator = new YearnAprCalculator()
    const result = await calculator.calculateVaultAPRs([makeVault()])

    expect(mocks.getYearnVaultRewardOpportunities).toHaveBeenCalledTimes(1)
    expect(result[VB_WBTC_VAULT]).toEqual([
      {
        vaultName: 'WBTC yVault',
        vaultAddress: VB_WBTC_VAULT,
        poolType: 'yearn',
        breakdown: {
          apr: mappingApr,
          token: {
            address: CANONICAL_KAT_ADDRESS,
            symbol: 'KAT',
            decimals: 18,
          },
          weight: 0,
        },
      },
    ])
  })
})
