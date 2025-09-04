import { describe, it, expect } from 'vitest'
import { SteerPointsCalculator, STEER_REWARD_RATES } from './steerPointsCalculator'
import type { YearnVault } from '../../types'

function makeVault(strategies: Array<Partial<YearnVault['strategies'][number]>>): YearnVault {
  // Build a minimal YearnVault with only fields used by the calculator
  return {
    address: '0xvault',
    symbol: 'VAULT',
    name: 'Test Vault',
    chainID: 1,
    strategies: strategies.map((s, i) => ({
      address: (s.address as string) ?? (`0xstrat${i}` as string),
      name: (s.name as string) ?? `Strategy ${i}`,
      details: {
        totalDebt: String(s.details?.totalDebt ?? '0'),
        totalGain: '0',
        totalLoss: '0',
        lastReport: 0,
        debtRatio: s.details?.debtRatio ?? 0,
      },
    })),
  }
}

describe('SteerPointsCalculator', () => {
  const calc = new SteerPointsCalculator()

  it('returns 0 when no strategies match', () => {
    const vault = makeVault([
      { name: 'Unrelated Strategy', details: { totalDebt: '100', debtRatio: 1000 } },
    ])
    expect(calc.calculateForVault(vault)).toBe(0)
  })

  it('awards points for matching strategy with positive rate and debt', () => {
    // Using a key known to have rate 2 in STEER_REWARD_RATES
    const key = Object.keys(STEER_REWARD_RATES).find((k) => STEER_REWARD_RATES[k] === 2)!
    const vault = makeVault([
      { name: `My ${key} Position`, details: { totalDebt: '1000', debtRatio: 5000 } }, // 50%
    ])
    // Expected: 2 * 0.5 = 1.0
    expect(calc.calculateForVault(vault)).toBeCloseTo(1.0, 6)
  })

  it('sums across multiple eligible strategies and clamps debtRatio to [0,1]', () => {
    const vault = makeVault([
      { name: 'weETH-vbETH LP', details: { totalDebt: '1', debtRatio: 12000 } }, // 2 * 1.0 = 2
      { name: 'AUSD-vbUSDC Pool', details: { totalDebt: '500', debtRatio: 2500 } }, // 1 * 0.25 = 0.25
      { name: 'vbWBTC-LBTC', details: { totalDebt: '100', debtRatio: 10000 } }, // rate 0 => 0
      { name: 'vbUSDC-vbUSDT', details: { totalDebt: '0', debtRatio: 10000 } }, // totalDebt 0 => ignored
    ])
    expect(calc.calculateForVault(vault)).toBeCloseTo(2.25, 6)
  })

  it('ignores strategies with zero totalDebt', () => {
    const vault = makeVault([
      { name: 'weETH-vbETH LP', details: { totalDebt: '0', debtRatio: 10000 } },
    ])
    expect(calc.calculateForVault(vault)).toBe(0)
  })
})

