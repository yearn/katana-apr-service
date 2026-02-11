import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KongBatchWebhook } from '../types/webhook'

const mocks = vi.hoisted(() => ({
  mockGenerateVaultAPRData: vi.fn(),
}))

vi.mock('./dataCache', () => ({
  DataCacheService: vi.fn().mockImplementation(() => ({
    generateVaultAPRData: mocks.mockGenerateVaultAPRData,
  })),
}))

import { computeKatanaAPR } from './webhookOutput'

const VAULT_A = '0x000000000000000000000000000000000000aaaa' as const
const VAULT_B = '0x000000000000000000000000000000000000bbbb' as const

const subscription = {
  id: 'S_TEST',
  url: 'https://example.com/webhook',
  abiPath: 'yearn/3/vault',
  type: 'timeseries' as const,
  labels: ['katana-apr'],
}

function makeHook(
  vaults: `0x${string}`[],
  overrides?: Partial<KongBatchWebhook>,
): KongBatchWebhook {
  return {
    abiPath: 'yearn/3/vault',
    chainId: 747474,
    blockNumber: 100n,
    blockTime: 1700000000n,
    subscription,
    vaults,
    ...overrides,
  }
}

describe('computeKatanaAPR', () => {
  beforeEach(() => {
    mocks.mockGenerateVaultAPRData.mockReset()
  })

  it('returns empty array for empty vaults list', async () => {
    const outputs = await computeKatanaAPR(makeHook([]))
    expect(outputs).toEqual([])
    expect(mocks.mockGenerateVaultAPRData).not.toHaveBeenCalled()
  })

  it('produces outputs for a vault with all extra fields', async () => {
    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [VAULT_A]: {
        address: VAULT_A,
        name: 'Test Vault',
        symbol: 'yvvbUSDC',
        chainID: 747474,
        strategies: [],
        apr: {
          extra: {
            katanaAppRewardsAPR: 0.12,
            FixedRateKatanaRewards: 0.35,
            katanaBonusAPY: 0.068,
            katanaNativeYield: 0.05,
            steerPointsPerDollar: 2,
          },
        },
      },
    })

    const outputs = await computeKatanaAPR(makeHook([VAULT_A]))

    expect(outputs).toHaveLength(5)
    expect(outputs.every((o) => o.address === VAULT_A)).toBe(true)
    expect(outputs.every((o) => o.label === 'katana-apr')).toBe(true)
    expect(outputs.every((o) => o.chainId === 747474)).toBe(true)
    expect(outputs.every((o) => o.blockNumber === 100n)).toBe(true)

    const byComponent = Object.fromEntries(
      outputs.map((o) => [o.component, o.value]),
    )
    expect(byComponent.katanaAppRewardsAPR).toBe(0.12)
    expect(byComponent.FixedRateKatanaRewards).toBe(0.35)
    expect(byComponent.katanaBonusAPY).toBe(0.068)
    expect(byComponent.katanaNativeYield).toBe(0.05)
    expect(byComponent.steerPointsPerDollar).toBe(2)
  })

  it('produces outputs for multiple vaults', async () => {
    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [VAULT_A]: {
        address: VAULT_A,
        name: 'Vault A',
        symbol: 'yvvbUSDC',
        chainID: 747474,
        strategies: [],
        apr: {
          extra: {
            katanaAppRewardsAPR: 0.1,
            FixedRateKatanaRewards: 0.2,
            katanaBonusAPY: 0.03,
            katanaNativeYield: 0.04,
            steerPointsPerDollar: 1,
          },
        },
      },
      [VAULT_B]: {
        address: VAULT_B,
        name: 'Vault B',
        symbol: 'yvvbETH',
        chainID: 747474,
        strategies: [],
        apr: {
          extra: {
            katanaAppRewardsAPR: 0.05,
            FixedRateKatanaRewards: 0.14,
            katanaBonusAPY: 0.016,
            katanaNativeYield: 0.02,
            steerPointsPerDollar: 0,
          },
        },
      },
    })

    const outputs = await computeKatanaAPR(makeHook([VAULT_A, VAULT_B]))

    expect(outputs).toHaveLength(10) // 5 components * 2 vaults
    expect(outputs.filter((o) => o.address === VAULT_A)).toHaveLength(5)
    expect(outputs.filter((o) => o.address === VAULT_B)).toHaveLength(5)
  })

  it('skips vaults not found in cache', async () => {
    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [VAULT_A]: {
        address: VAULT_A,
        name: 'Vault A',
        symbol: 'yvvbUSDC',
        chainID: 747474,
        strategies: [],
        apr: { extra: { katanaAppRewardsAPR: 0.1 } },
      },
    })

    const outputs = await computeKatanaAPR(makeHook([VAULT_A, VAULT_B]))

    expect(outputs).toHaveLength(5) // only VAULT_A
    expect(outputs.every((o) => o.address === VAULT_A)).toBe(true)
  })

  it('defaults missing extra fields to 0', async () => {
    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [VAULT_A]: {
        address: VAULT_A,
        name: 'Vault A',
        symbol: 'yvvbUSDC',
        chainID: 747474,
        strategies: [],
        apr: { extra: {} },
      },
    })

    const outputs = await computeKatanaAPR(makeHook([VAULT_A]))

    expect(outputs).toHaveLength(5)
    expect(outputs.every((o) => o.value === 0)).toBe(true)
  })

  it('isolates errors per vault', async () => {
    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [VAULT_A]: null, // will cause an error when accessing .apr
      [VAULT_B]: {
        address: VAULT_B,
        name: 'Vault B',
        symbol: 'yvvbETH',
        chainID: 747474,
        strategies: [],
        apr: { extra: { katanaAppRewardsAPR: 0.05 } },
      },
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const outputs = await computeKatanaAPR(makeHook([VAULT_A, VAULT_B]))
    consoleSpy.mockRestore()

    // VAULT_A returns [] because null is falsy, VAULT_B succeeds
    expect(outputs).toHaveLength(5)
    expect(outputs.every((o) => o.address === VAULT_B)).toBe(true)
  })

  it('calls generateVaultAPRData once per webhook', async () => {
    mocks.mockGenerateVaultAPRData.mockResolvedValue({})

    await computeKatanaAPR(makeHook([VAULT_A, VAULT_B]))

    expect(mocks.mockGenerateVaultAPRData).toHaveBeenCalledTimes(1)
  })
})
