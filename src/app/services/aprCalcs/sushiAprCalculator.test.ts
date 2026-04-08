import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearnVault } from '../../types'

const mocks = vi.hoisted(() => ({
  getSushiOpportunities: vi.fn(),
  getErc20LogProcessorOpportunities: vi.fn(),
  getActiveSushiStrategies: vi.fn(),
  getSushiPoolsFromStrategies: vi.fn(),
}))

vi.mock('../externalApis/merklApi', () => ({
  MerklApiService: vi.fn().mockImplementation(() => ({
    getSushiOpportunities: mocks.getSushiOpportunities,
    getErc20LogProcessorOpportunities: mocks.getErc20LogProcessorOpportunities,
  })),
}))

vi.mock('../externalApis/yearnApi', () => ({
  YearnApiService: vi.fn().mockImplementation(() => ({
    getActiveSushiStrategies: mocks.getActiveSushiStrategies,
  })),
}))

vi.mock('../contractReader', () => ({
  ContractReaderService: vi.fn().mockImplementation(() => ({
    getSushiPoolsFromStrategies: mocks.getSushiPoolsFromStrategies,
  })),
}))

import { SushiAprCalculator } from './sushiAprCalculator'

const VAULT_ADDRESS = '0x00000000000000000000000000000000000000aa'
const STRATEGY_ADDRESS = '0x00000000000000000000000000000000000000bb'
const POOL_ADDRESS = '0x00000000000000000000000000000000000000cc'
const CANONICAL_KAT_ADDRESS = '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d'

const vault: YearnVault = {
  address: VAULT_ADDRESS,
  symbol: 'yvvbWBTC',
  name: 'WBTC yVault',
  chainID: 747474,
  token: {
    address: '0x00000000000000000000000000000000000000dd',
    name: 'Vault Bridge WBTC',
    symbol: 'vbWBTC',
    description: '',
    decimals: 8,
  },
  tvl: {
    totalAssets: '100',
    tvl: 100,
    price: 1,
  },
  strategies: [
    {
      address: STRATEGY_ADDRESS,
      name: 'Single Sided Steer vbWBTC-BTCK vbWBTC',
      status: 'active',
      details: {
        totalDebt: '100',
        totalLoss: '0',
        totalGain: '0',
        performanceFee: 0,
        lastReport: 0,
        debtRatio: 10_000,
      },
    },
  ],
  apr: {
    netAPR: 0,
  },
}

describe('SushiAprCalculator', () => {
  beforeEach(() => {
    mocks.getSushiOpportunities.mockReset()
    mocks.getErc20LogProcessorOpportunities.mockReset()
    mocks.getActiveSushiStrategies.mockReset()
    mocks.getSushiPoolsFromStrategies.mockReset()
  })

  it('falls back to direct ERC20 log processor opportunities for single-sided steer strategies', async () => {
    mocks.getActiveSushiStrategies.mockReturnValue([STRATEGY_ADDRESS])
    mocks.getSushiPoolsFromStrategies.mockResolvedValue({
      [STRATEGY_ADDRESS.toLowerCase()]: POOL_ADDRESS,
    })
    mocks.getSushiOpportunities.mockResolvedValue([
      {
        identifier: POOL_ADDRESS,
        name: 'Provide liquidity to Sushi pool',
        campaigns: [
          {
            campaignId: 'pool-campaign',
            rewardToken: {
              address: CANONICAL_KAT_ADDRESS,
              symbol: 'KAT',
              decimals: 18,
            },
          },
        ],
        aprRecord: {
          breakdowns: [{ identifier: 'pool-campaign', value: 0.4 }],
        },
      },
    ])
    mocks.getErc20LogProcessorOpportunities.mockResolvedValue([
      {
        identifier: STRATEGY_ADDRESS,
        name: 'Deposit vbWBTC in Single Sided Steer vbWBTC-BTCK vbWBTC',
        campaigns: [
          {
            campaignId: 'strategy-campaign',
            rewardToken: {
              address: CANONICAL_KAT_ADDRESS,
              symbol: 'KAT',
              decimals: 18,
            },
          },
        ],
        aprRecord: {
          breakdowns: [{ identifier: 'strategy-campaign', value: 1.5 }],
        },
      },
    ])

    const calculator = new SushiAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])

    expect(results[VAULT_ADDRESS]).toEqual([
      {
        strategyAddress: STRATEGY_ADDRESS,
        poolAddress: POOL_ADDRESS,
        poolType: 'sushi',
        breakdown: {
          apr: 1.5,
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
