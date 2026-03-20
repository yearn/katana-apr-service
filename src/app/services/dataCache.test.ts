import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearnVault } from '../types'

const mocks = vi.hoisted(() => ({
  mockGetVaults: vi.fn(),
  mockGetTokenPriceUsd: vi.fn(),
  mockCalculateYearnVaultAPRs: vi.fn(),
  mockCalculateMorphoVaultAPRs: vi.fn(),
  mockCalculateSushiVaultAPRs: vi.fn(),
  mockCalculateSteerPoints: vi.fn(),
  logVaultAprDebug: vi.fn(),
}))

vi.mock('./externalApis/yearnApi', () => ({
  YearnApiService: vi.fn().mockImplementation(() => ({
    getVaults: mocks.mockGetVaults,
  })),
}))

vi.mock('./externalApis/katanaPriceService', () => ({
  KatanaPriceService: vi.fn().mockImplementation(() => ({
    getTokenPriceUsd: mocks.mockGetTokenPriceUsd,
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

vi.mock('./aprCalcs/sushiAprCalculator', () => ({
  SushiAprCalculator: vi.fn().mockImplementation(() => ({
    calculateVaultAPRs: mocks.mockCalculateSushiVaultAPRs,
  })),
}))

vi.mock('./pointsCalcs/steerPointsCalculator', () => ({
  SteerPointsCalculator: vi.fn().mockImplementation(() => ({
    calculateForVault: mocks.mockCalculateSteerPoints,
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
    mocks.mockGetTokenPriceUsd.mockReset()
    mocks.mockCalculateYearnVaultAPRs.mockReset()
    mocks.mockCalculateMorphoVaultAPRs.mockReset()
    mocks.mockCalculateSushiVaultAPRs.mockReset()
    mocks.mockCalculateSteerPoints.mockReset()
    mocks.logVaultAprDebug.mockReset()
    mocks.mockGetTokenPriceUsd.mockResolvedValue(1)
    mocks.mockCalculateYearnVaultAPRs.mockResolvedValue({})
    mocks.mockCalculateMorphoVaultAPRs.mockResolvedValue({})
    mocks.mockCalculateSushiVaultAPRs.mockResolvedValue({})
    mocks.mockCalculateSteerPoints.mockReturnValue(0)
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

  it('scales fixed rate rewards by the live-to-assumed KAT price ratio', async () => {
    const vault = makeVault({
      symbol: 'yvvbUSDC',
    })
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockGetTokenPriceUsd.mockResolvedValue(0.5)
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

    expect(data[vault.address].apr?.extra?.fixedRateKatanaRewards).toBe(1.75)
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
    expect(data[vault.address].strategies[0].rewardToken).toBeUndefined()
    expect(data[vault.address].strategies[0].underlyingContract).toBeUndefined()
    expect(data[vault.address].apr?.extra?.katanaAppRewardsAPR).toBe(0)
    expect(data[vault.address].apr?.extra?.katanaRewardsAPR).toBe(0)
  })
})
