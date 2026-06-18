import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MerklOpportunity, YearnVault } from '../../types'
import { CANONICAL_KAT_ADDRESS } from '../katanaRewardTokens'
import {
  aprToApy,
  apyToApr,
  MORPHO_REWARD_TOKEN_ADDRESS,
  type MorphoApiService,
} from '../externalApis/morphoApi'
import type { MerklApiService } from '../externalApis/merklApi'
import { computeNetApr, ForwardAprCalculator } from './forwardAprCalculator'

const MORPHO_STRATEGY = '0xD46dFDAA7cAA8739B0e3274e2C085dFFc8d4776A'
const STEER_STRATEGY = '0x00000000000000000000000000000000000000ee'
const MORPHO_VAULT = '0xE4248e2105508FcBad3fe95691551d1AF14015f7'

const makeVault = (overrides: Partial<YearnVault> = {}): YearnVault => ({
  address: '0x00000000000000000000000000000000000000aa',
  symbol: 'TST',
  name: 'Test Vault',
  chainID: 747474,
  tvl: {
    totalAssets: '100',
    tvl: 100,
    price: 1,
  },
  strategies: [
    {
      address: MORPHO_STRATEGY,
      name: 'Morpho Gauntlet USDC Vault Compounder',
      status: 'active',
      details: {
        totalDebt: '60',
        totalGain: '0',
        totalLoss: '0',
        lastReport: 0,
      },
    },
    {
      address: STEER_STRATEGY,
      name: 'Single Sided Steer AUSD-vbUSDC vbUSDC',
      status: 'active',
      oracleAPY: 0.05,
      details: {
        totalDebt: '40',
        totalGain: '0',
        totalLoss: '0',
        lastReport: 0,
      },
    },
  ],
  apr: {
    netAPR: 0.01,
  },
  ...overrides,
})

const buildCalculator = (
  morphoEstimates: Awaited<
    ReturnType<MorphoApiService['getVaultEstimates']>
  >,
  merklOpportunities: MerklOpportunity[] = [],
) => {
  const morphoApi = {
    getVaultEstimates: vi.fn().mockResolvedValue(morphoEstimates),
  } as unknown as MorphoApiService
  const merklApi = {
    getMorphoOpportunities: vi.fn().mockResolvedValue(merklOpportunities),
  } as unknown as MerklApiService

  return {
    calculator: new ForwardAprCalculator(morphoApi, merklApi),
    morphoApi,
    merklApi,
  }
}

const makeMerklOpportunity = ({
  identifier,
  type,
  name,
  status = 'LIVE',
  nativeAprPercent,
  morphoAprPercent,
  katAprPercent,
}: {
  identifier: string
  type: string
  name: string
  status?: string
  nativeAprPercent?: number
  morphoAprPercent?: number
  katAprPercent?: number
}): MerklOpportunity => {
  const campaigns: NonNullable<MerklOpportunity['campaigns']> = []
  const breakdowns: NonNullable<
    NonNullable<MerklOpportunity['aprRecord']>['breakdowns']
  > = []

  const addRewardCampaign = (
    campaignId: string,
    address: string,
    symbol: string,
    aprPercent: number | undefined,
  ) => {
    if (aprPercent === undefined) {
      return
    }

    campaigns.push({
      campaignId,
      amount: '1',
      startTimestamp: 0,
      endTimestamp: 0,
      rewardToken: {
        address,
        symbol,
        decimals: 18,
        price: 1,
      },
    })
    breakdowns.push({
      identifier: campaignId,
      value: aprPercent,
    })
  }

  addRewardCampaign(
    'morpho-campaign',
    MORPHO_REWARD_TOKEN_ADDRESS,
    'MORPHO',
    morphoAprPercent,
  )
  addRewardCampaign(
    'kat-campaign',
    CANONICAL_KAT_ADDRESS,
    'KAT',
    katAprPercent,
  )

  return {
    chainId: 747474,
    identifier,
    name,
    status,
    type,
    tvl: 1,
    ...(nativeAprPercent !== undefined
      ? {
          nativeAprRecord: {
            value: nativeAprPercent,
          },
        }
      : {}),
    campaigns,
    aprRecord: {
      breakdowns,
    },
  }
}

describe('ForwardAprCalculator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('weights Morpho offchain APY and Steer oracle APY by total assets', async () => {
    const morphoRewardsApr = 0.01
    const morphoBaseApy = 0.04
    const morphoApy = morphoBaseApy + aprToApy(morphoRewardsApr)
    const { calculator, morphoApi, merklApi } = buildCalculator({
      [MORPHO_VAULT.toLowerCase()]: {
        address: MORPHO_VAULT.toLowerCase(),
        name: 'Gauntlet USDC',
        symbol: 'gtUSDC',
        baseApy: morphoBaseApy,
        totalApy: morphoApy,
        morphoRewardsApr,
        katRewardsApr: 0.02,
      },
    })

    const result = await calculator.calculateVaultForwardAPRs([
      makeVault({
        tvl: {
          totalAssets: '200',
          tvl: 200,
          price: 1,
        },
      }),
    ])
    const forwardAPR =
      result['0x00000000000000000000000000000000000000aa'].forwardAPR
    const expectedApy = morphoApy * 0.3 + 0.05 * 0.2
    const expectedApr = apyToApr(expectedApy)
    const expectedNetApr = expectedApr

    expect(morphoApi.getVaultEstimates).toHaveBeenCalledWith([
      MORPHO_VAULT.toLowerCase(),
    ])
    expect(merklApi.getMorphoOpportunities).not.toHaveBeenCalled()
    expect(forwardAPR).toEqual({
      type: 'katana-estimated-apr',
      apr: expectedApr,
      apy: expectedApy,
      netAPR: expectedNetApr,
      netAPY: aprToApy(expectedNetApr),
      components: {
        baseNetAPY: morphoBaseApy * 0.3 + 0.05 * 0.2,
        morphoBaseAPY: morphoBaseApy * 0.3,
        morphoRewardsAPR: morphoRewardsApr * 0.3,
        morphoRewardsAPY: aprToApy(morphoRewardsApr) * 0.3,
        morphoKatRewardsAPR: 0.02 * 0.3,
        steerAPY: 0.05 * 0.2,
        oracleAPY: 0,
        estimatedDebtCoverage: 0.5,
      },
    })
  })

  it('omits top-level APY when an active strategy is uncovered', async () => {
    const { calculator } = buildCalculator({})

    const result = await calculator.calculateVaultForwardAPRs([
      makeVault({
        tvl: {
          totalAssets: '200',
          tvl: 200,
          price: 1,
        },
      }),
    ])
    const forwardAPR =
      result['0x00000000000000000000000000000000000000aa'].forwardAPR

    expect(forwardAPR).not.toHaveProperty('apr')
    expect(forwardAPR).not.toHaveProperty('apy')
    expect(forwardAPR).not.toHaveProperty('netAPR')
    expect(forwardAPR).not.toHaveProperty('netAPY')
    expect(forwardAPR.components.estimatedDebtCoverage).toBe(0.2)
    expect(forwardAPR.components.steerAPY).toBe(0.05 * 0.2)
  })

  it('prefers underlying MORPHOVAULT fallback and excludes KAT from estimated APY', async () => {
    const merklOpportunities: MerklOpportunity[] = [
      makeMerklOpportunity({
        identifier: MORPHO_STRATEGY,
        type: 'ERC20LOGPROCESSOR',
        name: 'Hold strategy shares',
        katAprPercent: 99,
      }),
      makeMerklOpportunity({
        identifier: MORPHO_VAULT,
        type: 'MORPHOVAULT',
        name: 'Past Morpho Gauntlet USDC Vault',
        status: 'PAST',
        nativeAprPercent: 50,
        morphoAprPercent: 50,
        katAprPercent: 50,
      }),
      makeMerklOpportunity({
        identifier: MORPHO_VAULT,
        type: 'MORPHOVAULT',
        name: 'Morpho Gauntlet USDC Vault',
        nativeAprPercent: 4,
        morphoAprPercent: 1.2,
        katAprPercent: 2.3,
      }),
    ]
    const { calculator } = buildCalculator({}, merklOpportunities)

    const result = await calculator.calculateVaultForwardAPRs([
      makeVault({
        strategies: [
          {
            address: MORPHO_STRATEGY,
            name: 'Morpho Gauntlet USDC Vault Compounder',
            status: 'active',
            details: {
              totalDebt: '100',
              totalGain: '0',
              totalLoss: '0',
              lastReport: 0,
            },
          },
        ],
      }),
    ])
    const vaultEstimate =
      result['0x00000000000000000000000000000000000000aa']
    const forwardAPR = vaultEstimate.forwardAPR
    const strategyEstimate =
      vaultEstimate.strategies[MORPHO_STRATEGY.toLowerCase()]

    expect(forwardAPR.components.morphoBaseAPY).toBe(0.04)
    expect(forwardAPR.components.morphoRewardsAPR).toBe(0.012)
    expect(forwardAPR.components.morphoKatRewardsAPR).toBe(0.023)
    expect(forwardAPR.apy).toBe(0.04 + aprToApy(0.012))
    expect(forwardAPR.netAPR).toBe(forwardAPR.apr)
    expect(forwardAPR.netAPY).toBeCloseTo(forwardAPR.apy ?? 0)
    expect(strategyEstimate.components.morphoRewardsAPR).toBe(0.012)
    expect(strategyEstimate.components.morphoKatRewardsAPR).toBe(0.023)
    expect(strategyEstimate.apy).toBe(0.04 + aprToApy(0.012))
  })

  it('does not cover Morpho fallback from a strategy KAT-only ERC20LOGPROCESSOR', async () => {
    const merklOpportunities: MerklOpportunity[] = [
      makeMerklOpportunity({
        identifier: MORPHO_STRATEGY,
        type: 'ERC20LOGPROCESSOR',
        name: 'Hold strategy shares',
        katAprPercent: 2.3,
      }),
    ]
    const { calculator, merklApi } = buildCalculator({}, merklOpportunities)

    const result = await calculator.calculateVaultForwardAPRs([
      makeVault({
        strategies: [
          {
            address: MORPHO_STRATEGY,
            name: 'Morpho Gauntlet USDC Vault Compounder',
            status: 'active',
            details: {
              totalDebt: '100',
              totalGain: '0',
              totalLoss: '0',
              lastReport: 0,
            },
          },
        ],
      }),
    ])
    const vaultEstimate =
      result['0x00000000000000000000000000000000000000aa']
    const strategyEstimate =
      vaultEstimate.strategies[MORPHO_STRATEGY.toLowerCase()]

    expect(merklApi.getMorphoOpportunities).toHaveBeenCalledOnce()
    expect(strategyEstimate.covered).toBe(false)
    expect(strategyEstimate.apy).toBeNull()
    expect(vaultEstimate.forwardAPR).not.toHaveProperty('apr')
    expect(vaultEstimate.forwardAPR).not.toHaveProperty('apy')
    expect(vaultEstimate.forwardAPR).not.toHaveProperty('netAPR')
    expect(vaultEstimate.forwardAPR).not.toHaveProperty('netAPY')
    expect(vaultEstimate.forwardAPR.components.morphoRewardsAPR).toBe(0)
    expect(vaultEstimate.forwardAPR.components.morphoKatRewardsAPR).toBe(0)
    expect(vaultEstimate.forwardAPR.components.estimatedDebtCoverage).toBe(0)
  })

  it('fee-adjusts the top-level forward estimate with vault fees', async () => {
    const { calculator } = buildCalculator({})

    const result = await calculator.calculateVaultForwardAPRs([
      makeVault({
        apr: {
          netAPR: 0.99,
          fees: {
            management: 0.01,
            performance: 0.2,
          },
        },
        strategies: [
          {
            address: STEER_STRATEGY,
            name: 'Single Sided Steer AUSD-vbUSDC vbUSDC',
            status: 'active',
            oracleAPY: 0.08,
            details: {
              totalDebt: '100',
              totalGain: '0',
              totalLoss: '0',
              lastReport: 0,
            },
          },
        ],
      }),
    ])
    const forwardAPR =
      result['0x00000000000000000000000000000000000000aa'].forwardAPR
    const grossApr = apyToApr(0.08)
    const expectedNetApr = computeNetApr(grossApr, {
      management: 0.01,
      performance: 0.2,
    })

    expect(forwardAPR.apr).toBe(grossApr)
    expect(forwardAPR.apy).toBe(0.08)
    expect(forwardAPR.netAPR).toBe(expectedNetApr)
    expect(forwardAPR.netAPY).toBe(aprToApy(expectedNetApr))
  })

  it('uses the oracle APR path for Morpho Lender Borrower strategies', async () => {
    const { calculator, merklApi } = buildCalculator({})

    const result = await calculator.calculateVaultForwardAPRs([
      makeVault({
        strategies: [
          {
            address: '0x0432337365d89c0D73f1D0Cb263791F8f1B98D43',
            name: 'Morpho vbWBTC/yvUSDC Lender Borrower',
            status: 'active',
            oracleAPY: 0.03,
            details: {
              totalDebt: '50',
              totalGain: '0',
              totalLoss: '0',
              lastReport: 0,
            },
          },
          {
            address: STEER_STRATEGY,
            name: 'Single Sided Steer AUSD-vbUSDC vbUSDC',
            status: 'active',
            oracleAPY: 0.05,
            details: {
              totalDebt: '50',
              totalGain: '0',
              totalLoss: '0',
              lastReport: 0,
            },
          },
        ],
      }),
    ])
    const forwardAPR =
      result['0x00000000000000000000000000000000000000aa'].forwardAPR
    const expectedApy = 0.03 * 0.5 + 0.05 * 0.5

    expect(merklApi.getMorphoOpportunities).not.toHaveBeenCalled()
    expect(forwardAPR.apr).toBe(apyToApr(expectedApy))
    expect(forwardAPR.apy).toBe(expectedApy)
    expect(forwardAPR.netAPR).toBe(forwardAPR.apr)
    expect(forwardAPR.netAPY).toBeCloseTo(forwardAPR.apy ?? 0)
    expect(forwardAPR.components.estimatedDebtCoverage).toBe(1)
    expect(forwardAPR.components.oracleAPY).toBe(0.015)
    expect(forwardAPR.components.steerAPY).toBe(0.025)
  })

  describe('computeNetApr', () => {
    it('returns gross APR when fees are zero', () => {
      expect(computeNetApr(0.1, { management: 0, performance: 0 })).toBe(0.1)
    })

    it('applies management and performance fees', () => {
      expect(
        computeNetApr(0.1, { management: 0.02, performance: 0.2 }),
      ).toBeCloseTo(0.064)
    })

    it('floors the result at half gross APR', () => {
      expect(computeNetApr(0.1, { management: 0.2, performance: 0.2 })).toBe(
        0.05,
      )
    })

    it('returns zero for non-positive gross APR', () => {
      expect(computeNetApr(0, { management: 0.01, performance: 0.2 })).toBe(0)
      expect(computeNetApr(-0.01, { management: 0, performance: 0 })).toBe(0)
    })
  })
})
