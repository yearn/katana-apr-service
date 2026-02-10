import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearnVault } from '../types'

const mocks = vi.hoisted(() => ({
  mockGetVaults: vi.fn(),
  mockCalculateVaultAPRs: vi.fn(),
  mockCalculateSteerPoints: vi.fn(),
  logVaultAprDebug: vi.fn(),
}))

vi.mock('./externalApis/yearnApi', () => ({
  YearnApiService: vi.fn().mockImplementation(() => ({
    getVaults: mocks.mockGetVaults,
  })),
}))

vi.mock('./aprCalcs/yearnAprCalculator', () => ({
  YearnAprCalculator: vi.fn().mockImplementation(() => ({
    calculateVaultAPRs: mocks.mockCalculateVaultAPRs,
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

const makeVault = (): YearnVault => ({
  address: '0x00000000000000000000000000000000000000aa',
  symbol: 'TST',
  name: 'Test Vault',
  chainID: 747474,
  strategies: [],
  apr: {
    netAPR: 0.02,
  },
})

describe('DataCacheService.generateVaultAPRData', () => {
  beforeEach(() => {
    mocks.mockGetVaults.mockReset()
    mocks.mockCalculateVaultAPRs.mockReset()
    mocks.mockCalculateSteerPoints.mockReset()
    mocks.logVaultAprDebug.mockReset()
    mocks.mockCalculateSteerPoints.mockReturnValue(0)
  })

  it('returns fallback payload when all calculator results are empty', async () => {
    const vault = makeVault()
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateVaultAPRs.mockResolvedValue({
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
    const vault = makeVault()
    mocks.mockGetVaults.mockResolvedValue([vault])
    mocks.mockCalculateVaultAPRs.mockResolvedValue({
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
    const aggregatedVault = data[vault.address]

    expect(aggregatedVault.address).toBe(vault.address)
    expect(aggregatedVault.apr?.extra?.katanaAppRewardsAPR).toBe(0.1)
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'result_summary',
        vaultAddress: vault.address,
        reason: 'vault_results_aggregated',
      }),
    )
  })
})
