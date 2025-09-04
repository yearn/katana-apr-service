import type { YearnVault } from '../../types'

// Mirrors Yearn X app configuration
// Key match is case-insensitive against strategy.name
export const STEER_REWARD_RATES: Record<string, number> = {
  'weETH-vbETH': 2,
  'AUSD-vbUSDC': 1,
  'vbUSDC-vbUSDT': 1,
  'vbWBTC-LBTC': 0,
  'vbWBTC-BTCK': 0,
}

export class SteerPointsCalculator {
  /**
   * Calculate STEER reward points per dollar invested for a given vault.
   * Sums rate * (debtRatio/10000) for strategies whose names include a
   * configured positive-rate key and have totalDebt > 0.
   */
  calculateForVault(vault: YearnVault): number {
    const strategies = vault.strategies ?? []

    // Precompute lowercased keys with positive rates and a mapping
    const positiveRateKeys = Object.entries(STEER_REWARD_RATES)
      .filter(([_, rate]) => rate > 0)
      .map(([key, _]) => key.toLowerCase())
    const positiveRateMap: Record<string, number> = Object.entries(STEER_REWARD_RATES)
      .filter(([_, rate]) => rate > 0)
      .reduce((acc, [key, rate]) => {
        acc[key.toLowerCase()] = rate
        return acc
      }, {} as Record<string, number>)

    const eligible = strategies.filter((s) => {
      const name = (s?.name ?? '').toLowerCase()
      const hasMatch = positiveRateKeys.some((key) => name.includes(key))
      const totalDebt = Number(s?.details?.totalDebt ?? 0)
      return hasMatch && totalDebt > 0
    })

    const total = eligible.reduce((sum, s) => {
      const name = (s?.name ?? '').toLowerCase()
      // Find the first matching key
      const matchKey = positiveRateKeys.find((key) => name.includes(key))
      const rate = matchKey ? Number(positiveRateMap[matchKey]) : 0
      const raw = Number(s?.details?.debtRatio ?? 0) // 10000 = 100%
      const debtRatio = Math.min(Math.max(raw / 10000, 0), 1)
      return sum + rate * debtRatio
    }, 0)

    return total
  }
}

