import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearnVault } from '../../types'

const mocks = vi.hoisted(() => ({
  getMorphoOpportunities: vi.fn(),
  getActiveMorphoStrategies: vi.fn(),
  getMorphoVaultsFromStrategies: vi.fn(),
}))

vi.mock('../externalApis/merklApi', () => ({
  MerklApiService: vi.fn().mockImplementation(() => ({
    getMorphoOpportunities: mocks.getMorphoOpportunities,
  })),
}))

vi.mock('../externalApis/yearnApi', () => ({
  YearnApiService: vi.fn().mockImplementation(() => ({
    getActiveMorphoStrategies: mocks.getActiveMorphoStrategies,
  })),
}))

vi.mock('../contractReader', () => ({
  ContractReaderService: vi.fn().mockImplementation(() => ({
    getMorphoVaultsFromStrategies: mocks.getMorphoVaultsFromStrategies,
  })),
}))

import { MorphoAprCalculator } from './morphoAprCalculator'

const VAULT_ADDRESS = '0x00000000000000000000000000000000000000aa'
const STRATEGY_ADDRESS = '0x00000000000000000000000000000000000000bb'
const MORPHO_VAULT_ADDRESS = '0x00000000000000000000000000000000000000cc'
const CANONICAL_KAT_ADDRESS = '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d'
const WRAPPED_KAT_ADDRESS = '0x3ba1fbC4c3aEA775d335b31fb53778f46FD3a330'

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
      name: 'Morpho vbWBTC/yvUSDC Lender Borrower',
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

describe('MorphoAprCalculator', () => {
  beforeEach(() => {
    mocks.getMorphoOpportunities.mockReset()
    mocks.getActiveMorphoStrategies.mockReset()
    mocks.getMorphoVaultsFromStrategies.mockReset()
  })

  it('includes canonical and wrapped KAT campaign aliases for lender-borrower strategies', async () => {
    mocks.getActiveMorphoStrategies.mockReturnValue([STRATEGY_ADDRESS])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [STRATEGY_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getMorphoOpportunities.mockResolvedValue([
      {
        identifier: STRATEGY_ADDRESS,
        name: 'Deposit vbWBTC in Morpho vbWBTC/yvUSDC Lender Borrower',
        campaigns: [
          {
            campaignId: 'campaign-canonical',
            rewardToken: {
              address: CANONICAL_KAT_ADDRESS,
              symbol: 'KAT',
              decimals: 18,
            },
          },
          {
            campaignId: 'campaign-wrapped',
            rewardToken: {
              address: WRAPPED_KAT_ADDRESS,
              symbol: 'KAT',
              decimals: 18,
            },
          },
        ],
        aprRecord: {
          breakdowns: [
            { identifier: 'campaign-canonical', value: 1.25 },
            { identifier: 'campaign-wrapped', value: 0.75 },
          ],
        },
      },
    ])

    const calculator = new MorphoAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])

    expect(results[VAULT_ADDRESS]).toEqual([
      {
        strategyAddress: STRATEGY_ADDRESS,
        poolAddress: MORPHO_VAULT_ADDRESS,
        poolType: 'morpho',
        breakdown: {
          apr: 1.25,
          token: {
            address: CANONICAL_KAT_ADDRESS,
            symbol: 'KAT',
            decimals: 18,
          },
          weight: 0,
        },
      },
      {
        strategyAddress: STRATEGY_ADDRESS,
        poolAddress: MORPHO_VAULT_ADDRESS,
        poolType: 'morpho',
        breakdown: {
          apr: 0.75,
          token: {
            address: WRAPPED_KAT_ADDRESS,
            symbol: 'KAT',
            decimals: 18,
          },
          weight: 0,
        },
      },
    ])
  })
})
