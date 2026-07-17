import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearnVault } from '../../types'

const mocks = vi.hoisted(() => ({
  getMorphoCompounderStrategies: vi.fn(),
  getMorphoVaultsFromStrategies: vi.fn(),
  getVaultAprEstimates: vi.fn(),
}))

vi.mock('../externalApis/yearnApi', () => ({
  YearnApiService: vi.fn().mockImplementation(() => ({
    getMorphoCompounderStrategies: mocks.getMorphoCompounderStrategies,
  })),
}))

vi.mock('../contractReader', () => ({
  ContractReaderService: vi.fn().mockImplementation(() => ({
    getMorphoVaultsFromStrategies: mocks.getMorphoVaultsFromStrategies,
  })),
}))

vi.mock('../externalApis/morphoApi', () => ({
  MorphoApiService: vi.fn().mockImplementation(() => ({
    getVaultAprEstimates: mocks.getVaultAprEstimates,
  })),
}))

import { MorphoUnderlyingAprCalculator } from './morphoUnderlyingAprCalculator'

const VAULT_ADDRESS = '0x00000000000000000000000000000000000000aa'
const COMPOUNDER_ADDRESS = '0x00000000000000000000000000000000000000bb'
const LENDER_BORROWER_ADDRESS = '0x00000000000000000000000000000000000000cc'
const STEER_ADDRESS = '0x00000000000000000000000000000000000000dd'
const MORPHO_VAULT_ADDRESS = '0x00000000000000000000000000000000000000ee'

const makeVault = (): YearnVault => ({
  address: VAULT_ADDRESS,
  symbol: 'yvvbUSDC',
  name: 'USDC yVault',
  chainID: 747474,
  apr: {
    netAPR: 0.02,
  },
  tvl: {
    totalAssets: '100',
    tvl: 100,
    price: 1,
  },
  strategies: [
    {
      address: COMPOUNDER_ADDRESS,
      name: 'Morpho Yearn USDC Compounder',
      netAPR: 0.01,
      details: {
        totalDebt: '50',
        totalGain: '0',
        totalLoss: '0',
        lastReport: 0,
        debtRatio: 5000,
      },
    },
    {
      address: LENDER_BORROWER_ADDRESS,
      name: 'Morpho USDC Lender Borrower',
      netAPR: 0.20,
      details: {
        totalDebt: '25',
        totalGain: '0',
        totalLoss: '0',
        lastReport: 0,
        debtRatio: 2500,
      },
    },
    {
      address: STEER_ADDRESS,
      name: 'Steer USDC Strategy',
      netAPR: 0.30,
      details: {
        totalDebt: '25',
        totalGain: '0',
        totalLoss: '0',
        lastReport: 0,
        debtRatio: 2500,
      },
    },
  ],
})

describe('MorphoUnderlyingAprCalculator', () => {
  beforeEach(() => {
    mocks.getMorphoCompounderStrategies.mockReset()
    mocks.getMorphoVaultsFromStrategies.mockReset()
    mocks.getVaultAprEstimates.mockReset()
  })

  it('uses dynamic vault mapping for selected compounders', async () => {
    const vault = makeVault()
    mocks.getMorphoCompounderStrategies.mockReturnValue([
      COMPOUNDER_ADDRESS,
    ])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [COMPOUNDER_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getVaultAprEstimates.mockResolvedValue({
      [MORPHO_VAULT_ADDRESS.toLowerCase()]: {
        baseAPY: 0.052,
        rewardsAPR: 0.01,
      },
    })

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])

    expect(mocks.getMorphoCompounderStrategies).toHaveBeenCalledWith(vault)
    expect(mocks.getMorphoVaultsFromStrategies).toHaveBeenCalledWith([
      COMPOUNDER_ADDRESS,
    ])
    expect(mocks.getVaultAprEstimates).toHaveBeenCalledWith([
      MORPHO_VAULT_ADDRESS,
    ])
    expect(results[VAULT_ADDRESS]).toEqual([
      {
        strategyAddress: COMPOUNDER_ADDRESS,
        morphoVaultAddress: MORPHO_VAULT_ADDRESS,
        morphoBaseAPR: 52 * ((1 + 0.052) ** (1 / 52) - 1),
        morphoBaseAPY: 0.052,
        morphoRewardsAPR: 0.01,
        replacementAPR: 52 * ((1 + 0.052) ** (1 / 52) - 1) + 0.01,
        estimatedAPY:
          (1 +
            (52 * ((1 + 0.052) ** (1 / 52) - 1) + 0.01) / 52) **
            52 -
          1,
        usedMorphoApi: true,
      },
    ])
  })

  it('falls back to the existing strategy APR when an estimate is missing', async () => {
    const vault = makeVault()
    mocks.getMorphoCompounderStrategies.mockReturnValue([
      COMPOUNDER_ADDRESS,
    ])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [COMPOUNDER_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getVaultAprEstimates.mockResolvedValue({})

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])

    expect(results[VAULT_ADDRESS]).toEqual([
      {
        strategyAddress: COMPOUNDER_ADDRESS,
        morphoVaultAddress: MORPHO_VAULT_ADDRESS,
        morphoBaseAPR: 0,
        morphoBaseAPY: 0,
        morphoRewardsAPR: 0,
        replacementAPR: 0.01,
        estimatedAPY: (1 + 0.01 / 52) ** 52 - 1,
        usedMorphoApi: false,
      },
    ])
  })
})
