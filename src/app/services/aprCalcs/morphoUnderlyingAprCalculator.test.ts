import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MORPHO_ESTIMATE_SOURCE,
  type MerklOpportunity,
  type YearnVault,
} from '../../types'

const mocks = vi.hoisted(() => ({
  getMorphoCompounderStrategies: vi.fn(),
  getMorphoVaultsFromStrategies: vi.fn(),
  getVaultAprEstimates: vi.fn(),
  getMorphoOpportunities: vi.fn(),
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

vi.mock('../externalApis/merklApi', () => ({
  MerklApiService: vi.fn().mockImplementation(() => ({
    getMorphoOpportunities: mocks.getMorphoOpportunities,
  })),
}))

import { MorphoUnderlyingAprCalculator } from './morphoUnderlyingAprCalculator'

const VAULT_ADDRESS = '0x00000000000000000000000000000000000000aa'
const COMPOUNDER_ADDRESS = '0x00000000000000000000000000000000000000bb'
const LENDER_BORROWER_ADDRESS = '0x00000000000000000000000000000000000000cc'
const STEER_ADDRESS = '0x00000000000000000000000000000000000000dd'
const MORPHO_VAULT_ADDRESS = '0x00000000000000000000000000000000000000ee'
const MORPHO_REWARD_TOKEN = '0x00000000000000000000000000000000000000f1'
const KAT_REWARD_TOKEN = '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d'
const BLACKLISTED_CAMPAIGN_ID =
  '0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d'

const makeOpportunity = ({
  address,
  aprPercent,
  campaignId,
  rewardTokenAddress = MORPHO_REWARD_TOKEN,
  type = 'ERC20LOGPROCESSOR',
}: {
  address: string
  aprPercent: number
  campaignId: string
  rewardTokenAddress?: string
  type?: string
}): MerklOpportunity => ({
  chainId: 747474,
  name: 'Morpho reward opportunity',
  tvl: 1_000_000,
  identifier: address,
  status: 'LIVE',
  type,
  campaigns: [
    {
      campaignId,
      amount: '1',
      rewardToken: {
        address: rewardTokenAddress,
        symbol: rewardTokenAddress === KAT_REWARD_TOKEN ? 'KAT' : 'MORPHO',
        decimals: 18,
        price: 1,
      },
      startTimestamp: 0,
      endTimestamp: 0,
    },
  ],
  aprRecord: {
    breakdowns: [{ identifier: campaignId, value: aprPercent }],
  },
})

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
    mocks.getMorphoOpportunities.mockReset()
    mocks.getMorphoOpportunities.mockResolvedValue([])
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
        morphoEstimateSource: MORPHO_ESTIMATE_SOURCE.MORPHO_API,
      },
    ])
  })

  it('falls through to the Kong oracle when Morpho and Merkl estimates are missing', async () => {
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
        morphoBaseAPR: 0.01,
        morphoBaseAPY: (1 + 0.01 / 52) ** 52 - 1,
        morphoRewardsAPR: 0,
        replacementAPR: 0.01,
        estimatedAPY: (1 + 0.01 / 52) ** 52 - 1,
        usedMorphoApi: false,
        morphoEstimateSource: MORPHO_ESTIMATE_SOURCE.KONG_ORACLE,
      },
    ])
  })

  it('uses non-KAT Merkl rewards at the resolved underlying address during a Morpho outage', async () => {
    const vault = makeVault()
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mocks.getMorphoCompounderStrategies.mockReturnValue([COMPOUNDER_ADDRESS])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [COMPOUNDER_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getVaultAprEstimates.mockRejectedValue(new Error('Morpho unavailable'))
    mocks.getMorphoOpportunities.mockResolvedValue([
      makeOpportunity({
        address: MORPHO_VAULT_ADDRESS,
        aprPercent: 2,
        campaignId: 'underlying-reward',
      }),
    ])

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])
    const result = results[VAULT_ADDRESS][0]

    expect(result.morphoEstimateSource).toBe(
      MORPHO_ESTIMATE_SOURCE.MERKL_UNDERLYING,
    )
    expect(result.morphoBaseAPR).toBe(0.01)
    expect(result.morphoRewardsAPR).toBe(0.02)
    expect(result.replacementAPR).toBeCloseTo(0.03)
    expect(result.usedMorphoApi).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      'Error resolving Morpho vault APR estimates:',
      expect.any(Error),
    )

    consoleError.mockRestore()
  })

  it('prefers underlying-address rewards over strategy-address rewards', async () => {
    const vault = makeVault()
    mocks.getMorphoCompounderStrategies.mockReturnValue([COMPOUNDER_ADDRESS])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [COMPOUNDER_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getVaultAprEstimates.mockResolvedValue({})
    mocks.getMorphoOpportunities.mockResolvedValue([
      makeOpportunity({
        address: MORPHO_VAULT_ADDRESS,
        aprPercent: 2,
        campaignId: 'underlying-reward',
      }),
      makeOpportunity({
        address: COMPOUNDER_ADDRESS,
        aprPercent: 9,
        campaignId: 'strategy-reward',
      }),
    ])

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])
    const result = results[VAULT_ADDRESS][0]

    expect(result.morphoEstimateSource).toBe(
      MORPHO_ESTIMATE_SOURCE.MERKL_UNDERLYING,
    )
    expect(result.morphoRewardsAPR).toBe(0.02)
    expect(result.replacementAPR).toBeCloseTo(0.03)
  })

  it('uses strategy-address Merkl rewards when the underlying mapping is unavailable', async () => {
    const vault = makeVault()
    mocks.getMorphoCompounderStrategies.mockReturnValue([COMPOUNDER_ADDRESS])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({})
    mocks.getVaultAprEstimates.mockResolvedValue({})
    mocks.getMorphoOpportunities.mockResolvedValue([
      makeOpportunity({
        address: COMPOUNDER_ADDRESS,
        aprPercent: 1.5,
        campaignId: 'strategy-reward',
      }),
    ])

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])
    const result = results[VAULT_ADDRESS][0]

    expect(result.morphoVaultAddress).toBeNull()
    expect(result.morphoEstimateSource).toBe(
      MORPHO_ESTIMATE_SOURCE.MERKL_STRATEGY,
    )
    expect(result.morphoRewardsAPR).toBe(0.015)
    expect(result.replacementAPR).toBeCloseTo(0.025)
  })

  it('does not treat KAT-only strategy opportunities as Morpho estimate coverage', async () => {
    const vault = makeVault()
    mocks.getMorphoCompounderStrategies.mockReturnValue([COMPOUNDER_ADDRESS])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [COMPOUNDER_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getVaultAprEstimates.mockResolvedValue({})
    mocks.getMorphoOpportunities.mockResolvedValue([
      makeOpportunity({
        address: COMPOUNDER_ADDRESS,
        aprPercent: 12,
        campaignId: 'kat-only-reward',
        rewardTokenAddress: KAT_REWARD_TOKEN,
      }),
    ])

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])
    const result = results[VAULT_ADDRESS][0]

    expect(result.morphoEstimateSource).toBe(
      MORPHO_ESTIMATE_SOURCE.KONG_ORACLE,
    )
    expect(result.morphoRewardsAPR).toBe(0)
    expect(result.replacementAPR).toBe(0.01)
  })

  it('excludes blacklisted campaigns from Merkl estimates', async () => {
    const vault = makeVault()
    mocks.getMorphoCompounderStrategies.mockReturnValue([COMPOUNDER_ADDRESS])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [COMPOUNDER_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getVaultAprEstimates.mockResolvedValue({})
    mocks.getMorphoOpportunities.mockResolvedValue([
      makeOpportunity({
        address: MORPHO_VAULT_ADDRESS,
        aprPercent: 99,
        campaignId: BLACKLISTED_CAMPAIGN_ID,
      }),
    ])

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])
    const result = results[VAULT_ADDRESS][0]

    expect(result.morphoEstimateSource).toBe(
      MORPHO_ESTIMATE_SOURCE.KONG_ORACLE,
    )
    expect(result.morphoRewardsAPR).toBe(0)
  })

  it('prefers MORPHOVAULT data over ERC20LOGPROCESSOR data at one address', async () => {
    const vault = makeVault()
    mocks.getMorphoCompounderStrategies.mockReturnValue([COMPOUNDER_ADDRESS])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [COMPOUNDER_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getVaultAprEstimates.mockResolvedValue({})
    mocks.getMorphoOpportunities.mockResolvedValue([
      makeOpportunity({
        address: MORPHO_VAULT_ADDRESS,
        aprPercent: 2,
        campaignId: 'morpho-vault-reward',
        type: 'MORPHOVAULT',
      }),
      makeOpportunity({
        address: MORPHO_VAULT_ADDRESS,
        aprPercent: 7,
        campaignId: 'log-processor-reward',
      }),
    ])

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])
    const result = results[VAULT_ADDRESS][0]

    expect(result.morphoRewardsAPR).toBe(0.02)
    expect(result.replacementAPR).toBeCloseTo(0.03)
  })

  it('returns no estimate only when every rung is unavailable', async () => {
    const vault = makeVault()
    vault.strategies[0].netAPR = null
    mocks.getMorphoCompounderStrategies.mockReturnValue([COMPOUNDER_ADDRESS])
    mocks.getMorphoVaultsFromStrategies.mockResolvedValue({
      [COMPOUNDER_ADDRESS]: MORPHO_VAULT_ADDRESS,
    })
    mocks.getVaultAprEstimates.mockResolvedValue({})

    const calculator = new MorphoUnderlyingAprCalculator()
    const results = await calculator.calculateVaultAPRs([vault])

    expect(results[VAULT_ADDRESS][0]).toMatchObject({
      replacementAPR: null,
      estimatedAPY: null,
      morphoEstimateSource: null,
    })
  })
})
