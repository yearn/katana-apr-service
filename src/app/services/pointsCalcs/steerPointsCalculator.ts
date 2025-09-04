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

    const eligible = strategies.filter((s) => {
      const name = (s?.name ?? '').toLowerCase()
      const hasMatch = Object.entries(STEER_REWARD_RATES).some(([key, rate]) => {
        return rate > 0 && name.includes(key.toLowerCase())
      })
      const totalDebt = Number(s?.details?.totalDebt ?? 0)
      return hasMatch && totalDebt > 0
    })

    const total = eligible.reduce((sum, s) => {
      const name = (s?.name ?? '').toLowerCase()
      const match = Object.entries(STEER_REWARD_RATES).find(
        ([key, rate]) => rate > 0 && name.includes(key.toLowerCase())
      )
      const rate = match ? Number(match[1]) : 0
      const raw = Number(s?.details?.debtRatio ?? 0) // 10000 = 100%
      const debtRatio = Math.min(Math.max(raw / 10000, 0), 1)
      return sum + rate * debtRatio
    }, 0)

    return total
  }
}

