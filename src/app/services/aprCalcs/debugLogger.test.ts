import { describe, expect, it, vi } from 'vitest'

interface DebugConfigOverrides {
  aprDebugEnabled?: boolean
  aprDebugVaultAddress?: string
  aprDebugSampleLimit?: number
}

const loadDebugLogger = async (overrides: DebugConfigOverrides = {}) => {
  vi.resetModules()
  vi.doMock('../../config', () => ({
    config: {
      aprDebugEnabled: false,
      aprDebugVaultAddress: undefined,
      aprDebugSampleLimit: undefined,
      ...overrides,
    },
  }))

  return await import('./debugLogger')
}

describe('debugLogger', () => {
  it('does not emit logs when debug is disabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { logVaultAprDebug } = await loadDebugLogger({
      aprDebugEnabled: false,
    })

    logVaultAprDebug({
      stage: 'result_summary',
      vaultAddress: '0x0000000000000000000000000000000000000001',
      reason: 'test',
    })

    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('emits logs when debug is enabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { logVaultAprDebug } = await loadDebugLogger({
      aprDebugEnabled: true,
    })

    logVaultAprDebug({
      stage: 'result_summary',
      vaultAddress: '0x0000000000000000000000000000000000000001',
      reason: 'test',
    })

    expect(logSpy).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  it('applies a vault-address filter', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const targetAddress = '0x0000000000000000000000000000000000000001'
    const { logVaultAprDebug } = await loadDebugLogger({
      aprDebugEnabled: true,
      aprDebugVaultAddress: targetAddress.toLowerCase(),
    })

    logVaultAprDebug({
      stage: 'result_summary',
      vaultAddress: targetAddress.toUpperCase(),
      reason: 'match',
    })
    logVaultAprDebug({
      stage: 'result_summary',
      vaultAddress: '0x0000000000000000000000000000000000000002',
      reason: 'miss',
    })

    expect(logSpy).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  it('enforces unique-vault sampling limits', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { logVaultAprDebug, resetVaultAprDebugStateForTests } =
      await loadDebugLogger({
        aprDebugEnabled: true,
        aprDebugSampleLimit: 1,
      })

    resetVaultAprDebugStateForTests()

    logVaultAprDebug({
      stage: 'result_summary',
      vaultAddress: '0x0000000000000000000000000000000000000001',
      reason: 'first-address',
    })
    logVaultAprDebug({
      stage: 'result_summary',
      vaultAddress: '0x0000000000000000000000000000000000000002',
      reason: 'second-address-blocked',
    })
    logVaultAprDebug({
      stage: 'result_summary',
      vaultAddress: '0x0000000000000000000000000000000000000001',
      reason: 'first-address-repeat',
    })

    expect(logSpy).toHaveBeenCalledTimes(2)
    logSpy.mockRestore()
  })
})
