import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearnVault } from '../../types'

const mocks = vi.hoisted(() => ({
  getYearnVaultRewardOpportunities: vi.fn(),
}))

vi.mock('../externalApis/merklApi', () => ({
  MerklApiService: vi.fn().mockImplementation(() => ({
    getYearnVaultRewardOpportunities: mocks.getYearnVaultRewardOpportunities,
  })),
}))

vi.mock('../externalApis/yearnApi', () => ({
  YearnApiService: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('../contractReader', () => ({
  ContractReaderService: vi.fn().mockImplementation(() => ({})),
}))

import { YearnAprCalculator } from './yearnAprCalculator'

const VAULT_ADDRESS = '0x00000000000000000000000000000000000000aa'
const CANONICAL_KAT_ADDRESS = '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d'

const vault: YearnVault = {
  address: VAULT_ADDRESS,
  symbol: 'yvvbUSDC',
  name: 'USDC yVault',
  chainID: 747474,
  token: {
    address: '0x00000000000000000000000000000000000000bb',
    name: 'Vault Bridge USDC',
    symbol: 'vbUSDC',
    description: '',
    decimals: 6,
  },
  tvl: {
    totalAssets: '100',
    tvl: 100,
    price: 1,
  },
  strategies: [],
  apr: {
    netAPR: 0,
  },
}

describe('YearnAprCalculator', () => {
  beforeEach(() => {
    mocks.getYearnVaultRewardOpportunities.mockReset()
  })

  it('includes ERC20_MAPPING opportunities for vault-level Yearn rewards', async () => {
    mocks.getYearnVaultRewardOpportunities.mockResolvedValue([
      {
        id: '166629803376662999264',
        identifier: VAULT_ADDRESS,
        name: 'Yearn ERC20 mapping reward',
        type: 'ERC20_MAPPING',
        campaigns: [
          {
            campaignId: 'mapping-campaign',
            rewardToken: {
              address: CANONICAL_KAT_ADDRESS,
              symbol: 'KAT',
              decimals: 18,
            },
          },
        ],
        aprRecord: {
          breakdowns: [{ identifier: 'mapping-campaign', value: 7.5 }],
        },
      },
    ])

    const calculator = new YearnAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])

    expect(mocks.getYearnVaultRewardOpportunities).toHaveBeenCalledOnce()
    expect(results[VAULT_ADDRESS]).toEqual([
      {
        vaultName: 'USDC yVault',
        vaultAddress: VAULT_ADDRESS,
        poolType: 'yearn',
        breakdown: {
          apr: 7.5,
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
