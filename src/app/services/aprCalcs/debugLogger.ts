import { config } from '../../config'
import type { VaultAprDebugEvent } from './types'

const sampledVaultAddresses = new Set<string>()

const normalizeAddress = (address: string): string => address.toLowerCase()

const matchesVaultFilter = (vaultAddress?: string): boolean => {
  if (!config.aprDebugVaultAddress) {
    return true
  }

  if (!vaultAddress) {
    return false
  }

  return normalizeAddress(vaultAddress) === config.aprDebugVaultAddress
}

const isWithinSampleLimit = (vaultAddress?: string): boolean => {
  if (!config.aprDebugSampleLimit) {
    return true
  }

  if (!vaultAddress) {
    return false
  }

  const normalizedVaultAddress = normalizeAddress(vaultAddress)
  if (sampledVaultAddresses.has(normalizedVaultAddress)) {
    return true
  }

  if (sampledVaultAddresses.size >= config.aprDebugSampleLimit) {
    return false
  }

  sampledVaultAddresses.add(normalizedVaultAddress)
  return true
}

export const shouldLogVaultAprDebug = (vaultAddress?: string): boolean => {
  if (!config.aprDebugEnabled) {
    return false
  }

  return matchesVaultFilter(vaultAddress) && isWithinSampleLimit(vaultAddress)
}

export const logVaultAprDebug = (event: VaultAprDebugEvent): void => {
  if (!shouldLogVaultAprDebug(event.vaultAddress)) {
    return
  }

  const payload = {
    ts: new Date().toISOString(),
    ...event,
  }

  console.log(`[apr-debug] ${JSON.stringify(payload)}`)
}

export const resetVaultAprDebugStateForTests = (): void => {
  sampledVaultAddresses.clear()
}
