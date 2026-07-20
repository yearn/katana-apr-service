import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearnVault } from '../types'

const mocks = vi.hoisted(() => ({
  mockGetVaults: vi.fn(),
  mockCalculateYearnVaultAPRs: vi.fn(),
  mockCalculateMorphoVaultAPRs: vi.fn(),
  mockCalculateMorphoUnderlyingVaultAPRs: vi.fn(),
  mockCalculateSushiVaultAPRs: vi.fn(),
  logVaultAprDebug: vi.fn(),
}))

vi.mock('./externalApis/yearnApi', () => ({
  YearnApiService: vi.fn().mockImplementation(() => ({
    getVaults: mocks.mockGetVaults,
  })),
}))

vi.mock('./aprCalcs/yearnAprCalculator', () => ({
  YearnAprCalculator: vi.fn().mockImplementation(() => ({
    calculateVaultAPRs: mocks.mockCalculateYearnVaultAPRs,
  })),
}))

vi.mock('./aprCalcs/morphoAprCalculator', () => ({
  MorphoAprCalculator: vi.fn().mockImplementation(() => ({
    calculateVaultAPRs: mocks.mockCalculateMorphoVaultAPRs,
  })),
}))

vi.mock('./aprCalcs/morphoUnderlyingAprCalculator', () => ({
  MorphoUnderlyingAprCalculator: vi.fn().mockImplementation(() => ({
    calculateVaultAPRs: mocks.mockCalculateMorphoUnderlyingVaultAPRs,
  })),
}))

vi.mock('./aprCalcs/sushiAprCalculator', () => ({
  SushiAprCalculator: vi.fn().mockImplementation(() => ({
    calculateVaultAPRs: mocks.mockCalculateSushiVaultAPRs,
  })),
}))

vi.mock('./aprCalcs/debugLogger', () => ({
  logVaultAprDebug: mocks.logVaultAprDebug,
}))

import { DataCacheService } from './dataCache'

const STRATEGY_ADDRESS = '0x00000000000000000000000000000000000000cc'

const makeVault = (overrides: Partial<YearnVault> = {}): YearnVault => ({
  address: '0x00000000000000000000000000000000000000aa',
  symbol: 'TST',
  name: 'Test Vault',
  chainID: 747474,
  strategies: [],
  apr: {
    netAPR: 0.02,
  },
  ...overrides,
})

describe('DataCacheService.generateVaultAPRData', () => {
  beforeEach(() => {
    mocks.mockGetVaults.mockReset()
    mocks.mockCalculateYearnVaultAPRs.mockReset()
    mocks.mockCalculateMorphoVaultAPRs.mockReset()
    mocks.mockCalculateMorphoUnderlyingVaultAPRs.mockReset()
    mocks.mockCalculateSushiVaultAPRs.mockReset()
    mocks.logVaultAprDebug.mockReset()
    mocks.mockCalculateYearnVaultAPRs.mockResolvedValue({})
    mocks.mockCalculateMorphoVaultAPRs.mockResolvedValue({})
    mocks.mockCalculateMorphoUnderlyingVaultAPRs.mockResolvedValue({})
    mocks.mockCalculateSushiVaultAPRs.mockResolvedValue({})
  })

  it('returns fallback payload when all calculator results are empty', async () => {
    const vault = makeVault()
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateYearnVaultAPRs.mockResolvedValue({
      [vault.address]: [],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address]).toEqual({
      name: vault.name,
      apr: 0,
      pools: undefined,
      breakdown: [],
    })
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'fallback',
        vaultAddress: vault.address,
        reason: 'empty_results_after_calculation',
      }),
    )
  })

  it('aggregates vault APR when rewards data exists', async () => {
    const vault = makeVault({
      tvl: {
        totalAssets: '100',
        tvl: 100,
        price: 1,
      },
      strategies: [
        {
          address: STRATEGY_ADDRESS,
          name: 'Morpho Strategy',
          status: 'active',
          details: {
            totalDebt: '25',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 5000,
          },
        },
        {
          address: '0x00000000000000000000000000000000000000ee',
          name: 'Steer Strategy',
          status: 'active',
          details: {
            totalDebt: '10',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 1500,
          },
        },
      ],
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateYearnVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          vaultName: vault.name,
          vaultAddress: vault.address,
          poolType: 'yearn',
          breakdown: {
            apr: 10,
            token: {
              address: '0x00000000000000000000000000000000000000bb',
              symbol: 'KAT',
              decimals: 18,
            },
            weight: 0,
          },
        },
      ],
    })
    mocks.mockCalculateMorphoVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: STRATEGY_ADDRESS,
          poolAddress: '0x00000000000000000000000000000000000000dd',
          poolType: 'morpho',
          breakdown: {
            apr: 4,
            token: {
              address: '0x00000000000000000000000000000000000000bb',
              symbol: 'KAT',
              decimals: 18,
            },
            weight: 0,
          },
        },
      ],
    })
    mocks.mockCalculateSushiVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: '0x00000000000000000000000000000000000000ee',
          poolAddress: '0x00000000000000000000000000000000000000ff',
          poolType: 'sushi',
          breakdown: {
            apr: 8,
            token: {
              address: '0x00000000000000000000000000000000000000bb',
              symbol: 'KAT',
              decimals: 18,
            },
            weight: 0,
          },
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()
    const aggregatedVault = data[vault.address]

    expect(aggregatedVault.address).toBe(vault.address)
    expect(aggregatedVault.apr?.extra?.katanaAppRewardsAPR).toBeCloseTo(0.1)
    expect(aggregatedVault.apr?.extra?.katanaRewardsAPR).toBeCloseTo(0.1)
    expect(aggregatedVault.apr?.extra?.fixedRateKatanaRewards).toBe(0)
    expect(aggregatedVault.apr?.extra?.katanaBonusAPY).toBe(0)
    expect(aggregatedVault.apr?.extra?.steerPointsPerDollar).toBe(0)
    expect(aggregatedVault.strategies[0].strategyRewardsAPR).toBe(0.04)
    expect(aggregatedVault.strategies[0].rewardToken).toEqual({
      address: '0x00000000000000000000000000000000000000bb',
      symbol: 'KAT',
      decimals: 18,
    })
    expect(aggregatedVault.strategies[0].underlyingContract).toBe(
      '0x00000000000000000000000000000000000000dd',
    )
    expect(aggregatedVault.strategies[0].rewardToken).not.toHaveProperty(
      'assumedFDV',
    )
    expect(aggregatedVault.strategies[1].strategyRewardsAPR).toBe(0.08)
    expect(aggregatedVault.strategies[1].underlyingContract).toBe(
      '0x00000000000000000000000000000000000000ff',
    )
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'result_summary',
        vaultAddress: vault.address,
        reason: 'vault_results_aggregated',
      }),
    )
  })

  it('does not apply ended fixed-rate KAT rewards', async () => {
    const vault = makeVault({
      symbol: 'yvvbUSDC',
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateYearnVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          vaultName: vault.name,
          vaultAddress: vault.address,
          poolType: 'yearn',
          breakdown: {
            apr: 10,
            token: {
              address: '0x00000000000000000000000000000000000000bb',
              symbol: 'KAT',
              decimals: 18,
            },
            weight: 0,
          },
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address].apr?.extra?.fixedRateKatanaRewards).toBe(0)
  })

  it('keeps zero-result strategy entries when a strategy mapping or opportunity is missing', async () => {
    const vault = makeVault({
      tvl: {
        totalAssets: '0',
        tvl: 0,
        price: 1,
      },
      strategies: [
        {
          address: STRATEGY_ADDRESS,
          name: 'Morpho Strategy',
          status: 'active',
          details: {
            totalDebt: '0',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 2500,
          },
        },
      ],
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateMorphoVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: STRATEGY_ADDRESS,
          poolAddress: '',
          poolType: 'morpho',
          breakdown: {
            apr: 0,
            token: {
              address: '',
              symbol: '',
              decimals: 0,
            },
            weight: 0,
          },
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address].strategies[0]).toMatchObject({
      address: STRATEGY_ADDRESS,
      strategyRewardsAPR: 0,
    })
    expect(data[vault.address].strategies[0].rewardToken).toBeNull()
    expect(data[vault.address].strategies[0].underlyingContract).toBeNull()
    expect(data[vault.address].apr?.extra?.katanaAppRewardsAPR).toBe(0)
    expect(data[vault.address].apr?.extra?.katanaRewardsAPR).toBe(0)
  })

  it('preserves the existing forward APR when an allocated strategy lacks a live replacement', async () => {
    const morphoStrategyAddress =
      '0x00000000000000000000000000000000000000f1'
    const steerStrategyAddress =
      '0x00000000000000000000000000000000000000f2'
    const idleStrategyAddress =
      '0x00000000000000000000000000000000000000f3'
    const vault = makeVault({
      apr: {
        netAPR: 0.0123,
        fees: {
          management: 0.02,
          performance: 0.1,
        },
        forwardAPR: {
          type: '',
          netAPR: 0.025,
          composite: {
            boost: null,
            poolAPY: null,
            boostedAPR: null,
            baseAPR: null,
            cvxAPR: null,
            rewardsAPR: null,
          },
        },
      },
      tvl: {
        totalAssets: '100',
        tvl: 100,
        price: 1,
      },
      strategies: [
        {
          address: morphoStrategyAddress,
          name: 'Morpho Yearn USDC Compounder',
          status: 'active',
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
          address: steerStrategyAddress,
          name: 'Steer USDC Strategy',
          status: 'active',
          netAPR: 0.04,
          details: {
            totalDebt: '25',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 2500,
          },
        },
        {
          address: idleStrategyAddress,
          name: 'Morpho Idle USDC Compounder',
          status: 'unallocated',
          netAPR: 0.50,
          details: {
            totalDebt: '0',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
          },
        },
      ],
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateMorphoUnderlyingVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: morphoStrategyAddress,
          morphoVaultAddress:
            '0x00000000000000000000000000000000000000a1',
          morphoBaseAPR: 0.08,
          morphoBaseAPY: 0.0832,
          morphoRewardsAPR: 0.02,
          replacementAPR: 0.10,
          estimatedAPY: (1 + 0.10 / 52) ** 52 - 1,
          usedMorphoApi: true,
        },
        {
          strategyAddress: idleStrategyAddress,
          morphoVaultAddress:
            '0x00000000000000000000000000000000000000a2',
          morphoBaseAPR: 0.20,
          morphoBaseAPY: 0.22,
          morphoRewardsAPR: 0.30,
          replacementAPR: 0.50,
          estimatedAPY: (1 + 0.50 / 52) ** 52 - 1,
          usedMorphoApi: true,
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()
    expect(data[vault.address].apr?.netAPR).toBe(0.0123)
    expect(data[vault.address].apr?.forwardAPR?.netAPR).toBe(0.025)
    expect(data[vault.address].apr?.forwardAPR?.morphoUnderlying).toBeUndefined()
    expect(data[vault.address].strategies[0].netAPR).toBe(0.10)
    expect(data[vault.address].strategies[1].netAPR).toBeNull()
    expect(data[vault.address].strategies[2].netAPR).toBe(0.50)
    expect(data[vault.address].strategies[0].morphoUnderlyingAPR).toEqual({
      morphoVaultAddress: '0x00000000000000000000000000000000000000a1',
      usedMorphoApi: true,
      morphoBaseAPR: 0.08,
      morphoBaseAPY: 0.0832,
      morphoRewardsAPR: 0.02,
      estimatedAPR: 0.10,
      estimatedAPY: (1 + 0.10 / 52) ** 52 - 1,
    })
    expect(data[vault.address].strategies[1].morphoUnderlyingAPR).toBeUndefined()
    expect(data[vault.address].strategies[2].morphoUnderlyingAPR).toEqual({
      morphoVaultAddress: '0x00000000000000000000000000000000000000a2',
      usedMorphoApi: true,
      morphoBaseAPR: 0.20,
      morphoBaseAPY: 0.22,
      morphoRewardsAPR: 0.30,
      estimatedAPR: 0.50,
      estimatedAPY: (1 + 0.50 / 52) ** 52 - 1,
    })
  })

  it('does not use historical strategy APR when a Morpho estimate fails', async () => {
    const morphoStrategyAddress =
      '0x00000000000000000000000000000000000000f4'
    const vault = makeVault({
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
          address: morphoStrategyAddress,
          name: 'Morpho Yearn USDC Compounder',
          status: 'active',
          netAPR: 0.03,
          details: {
            totalDebt: '50',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 5000,
          },
        },
      ],
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateMorphoUnderlyingVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: morphoStrategyAddress,
          morphoVaultAddress:
            '0x00000000000000000000000000000000000000a2',
          morphoBaseAPR: 0,
          morphoBaseAPY: 0,
          morphoRewardsAPR: 0,
          replacementAPR: null,
          estimatedAPY: null,
          usedMorphoApi: false,
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address].apr?.netAPR).toBe(0.02)
    expect(data[vault.address].apr?.forwardAPR).toBeUndefined()
    expect(data[vault.address].strategies[0].netAPR).toBeNull()
    expect(data[vault.address].strategies[0].morphoUnderlyingAPR).toMatchObject({
      usedMorphoApi: false,
      estimatedAPR: null,
      estimatedAPY: null,
    })
  })

  it('keeps forward APR unchanged when there are no Morpho replacement results', async () => {
    const vault = makeVault({
      apr: {
        netAPR: 0.02,
        forwardAPR: {
          type: '',
          netAPR: null,
          composite: {
            boost: null,
            poolAPY: null,
            boostedAPR: null,
            baseAPR: null,
            cvxAPR: null,
            rewardsAPR: null,
          },
        },
      },
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateYearnVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          vaultName: vault.name,
          vaultAddress: vault.address,
          poolType: 'yearn',
          breakdown: {
            apr: 10,
            token: {
              address: '0x00000000000000000000000000000000000000bb',
              symbol: 'KAT',
              decimals: 18,
            },
            weight: 0,
          },
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address].apr?.forwardAPR?.netAPR).toBeNull()
  })

  it('caps total accountant fees at max fee percent of gross APR', async () => {
    const morphoStrategyAddress =
      '0x00000000000000000000000000000000000000f5'
    const vault = makeVault({
      apr: {
        netAPR: 0.02,
        fees: {
          management: 0.009,
          performance: 0,
        },
      },
      tvl: {
        totalAssets: '100',
        tvl: 100,
        price: 1,
      },
      strategies: [
        {
          address: morphoStrategyAddress,
          name: 'Morpho Yearn USDC Compounder',
          status: 'active',
          netAPR: 0,
          details: {
            totalDebt: '100',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 10000,
          },
        },
      ],
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateMorphoUnderlyingVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: morphoStrategyAddress,
          morphoVaultAddress:
            '0x00000000000000000000000000000000000000a3',
          replacementAPR: 0.01,
          usedMorphoApi: true,
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address].apr?.forwardAPR?.netAPR).toBeCloseTo(0.005)
  })

  it('applies performance fee to gross APR without reducing management fee', async () => {
    const morphoStrategyAddress =
      '0x00000000000000000000000000000000000000f8'
    const vault = makeVault({
      apr: {
        netAPR: 0.02,
        fees: {
          management: 0.02,
          performance: 0.1,
          maxFee: 0.5,
        },
      },
      tvl: {
        totalAssets: '100',
        tvl: 100,
        price: 1,
      },
      strategies: [
        {
          address: morphoStrategyAddress,
          name: 'Morpho Yearn USDC Compounder',
          status: 'active',
          details: {
            totalDebt: '100',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 10000,
          },
        },
      ],
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateMorphoUnderlyingVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: morphoStrategyAddress,
          morphoVaultAddress:
            '0x00000000000000000000000000000000000000a6',
          replacementAPR: 0.08,
          usedMorphoApi: true,
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address].apr?.forwardAPR?.netAPR).toBeCloseTo(0.052)
  })

  it('returns zero forward APR for zero or negative gross APR before fees', async () => {
    const morphoStrategyAddress =
      '0x00000000000000000000000000000000000000f6'
    const vault = makeVault({
      apr: {
        netAPR: 0.02,
        fees: {
          management: 0.01,
          performance: 0.2,
        },
      },
      tvl: {
        totalAssets: '100',
        tvl: 100,
        price: 1,
      },
      strategies: [
        {
          address: morphoStrategyAddress,
          name: 'Morpho Yearn USDC Compounder',
          status: 'active',
          details: {
            totalDebt: '100',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 10000,
          },
        },
      ],
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateMorphoUnderlyingVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: morphoStrategyAddress,
          morphoVaultAddress:
            '0x00000000000000000000000000000000000000a4',
          replacementAPR: -0.01,
          usedMorphoApi: true,
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address].apr?.forwardAPR?.netAPR).toBe(0)
  })

  it('treats missing or non-finite fee values as zero fees', async () => {
    const morphoStrategyAddress =
      '0x00000000000000000000000000000000000000f7'
    const vault = makeVault({
      apr: {
        netAPR: 0.02,
        fees: {
          management: Number.NaN,
          performance: Number.POSITIVE_INFINITY,
        },
      },
      tvl: {
        totalAssets: '100',
        tvl: 100,
        price: 1,
      },
      strategies: [
        {
          address: morphoStrategyAddress,
          name: 'Morpho Yearn USDC Compounder',
          status: 'active',
          details: {
            totalDebt: '100',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
            debtRatio: 10000,
          },
        },
      ],
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateMorphoUnderlyingVaultAPRs.mockResolvedValue({
      [vault.address]: [
        {
          strategyAddress: morphoStrategyAddress,
          morphoVaultAddress:
            '0x00000000000000000000000000000000000000a5',
          replacementAPR: 0.07,
          usedMorphoApi: true,
        },
      ],
    })

    const service = new DataCacheService()
    const data = await service.generateVaultAPRData()

    expect(data[vault.address].apr?.forwardAPR?.netAPR).toBeCloseTo(0.07)
  })
})
