import { describe, expect, it } from 'vitest'
import type { YearnVault } from '../../types'
import {
  aprToApy,
  ForwardAprCalculator,
} from './forwardAprCalculator'

const MORPHO_STRATEGY = '0x00000000000000000000000000000000000000aa'
const STEER_STRATEGY = '0x00000000000000000000000000000000000000bb'
const MORPHO_VAULT = '0x00000000000000000000000000000000000000cc'
const NON_KAT_TOKEN = '0x00000000000000000000000000000000000000dd'
const KAT_TOKEN = '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d'

const makeVault = (overrides: Partial<YearnVault> = {}): YearnVault => ({
  address: '0x0000000000000000000000000000000000000011',
  symbol: 'yvTST',
  name: 'Test Vault',
  chainID: 747474,
  tvl: {
    totalAssets: '1000',
    tvl: 1000,
    price: 1,
  },
  apr: {
    netAPR: 0.01,
    fees: {
      management: 0,
      performance: 0,
    },
  },
  strategies: [],
  ...overrides,
})

const makeCalculator = ({
  strategyToVault = {},
  morphoEstimates = {},
  morphoOpportunities = [],
}: {
  strategyToVault?: Record<string, string>
  morphoEstimates?: Record<string, unknown>
  morphoOpportunities?: unknown[]
}) =>
  new ForwardAprCalculator(
    {
      getMorphoVaultsFromStrategies: async () => strategyToVault,
    } as never,
    {
      getMorphoOpportunities: async () => morphoOpportunities,
    } as never,
    {
      getVaultEstimates: async () => morphoEstimates,
    } as never,
  )

describe('ForwardAprCalculator', () => {
  it('aggregates covered active strategy estimates without suppressing idle assets', async () => {
    const vault = makeVault({
      strategies: [
        {
          address: MORPHO_STRATEGY,
          name: 'Morpho Compounder',
          details: {
            totalDebt: '500',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
          },
        },
        {
          address: STEER_STRATEGY,
          name: 'Steer Strategy',
          oracleAPY: 0.03,
          details: {
            totalDebt: '300',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
          },
        },
      ],
    })
    const morphoRewardsAPY = aprToApy(0.01)
    const calculator = makeCalculator({
      strategyToVault: {
        [MORPHO_STRATEGY]: MORPHO_VAULT,
      },
      morphoEstimates: {
        [MORPHO_VAULT]: {
          address: MORPHO_VAULT,
          baseAPY: 0.04,
          version: 'v1',
          rewards: [
            {
              tokenAddress: NON_KAT_TOKEN,
              tokenSymbol: 'MORPHO',
              supplyApr: 0.01,
            },
            {
              tokenAddress: KAT_TOKEN,
              tokenSymbol: 'KAT',
              supplyApr: 0.02,
            },
          ],
        },
      },
    })

    const estimates = await calculator.calculateVaultForwardAPRs([vault])
    const forwardAPR = estimates[vault.address].forwardAPR

    expect(forwardAPR.grossAPY).toBeCloseTo(
      (0.04 + morphoRewardsAPY) * 0.5 + 0.03 * 0.3,
    )
    expect(forwardAPR.netAPY).toBeCloseTo(forwardAPR.grossAPY || 0)
    expect(forwardAPR.components).toMatchObject({
      estimatedDebtCoverage: 1,
      morphoBaseAPY: 0.02,
      morphoRewardsAPR: 0.005,
      morphoRewardsAPY: morphoRewardsAPY * 0.5,
      morphoKatRewardsAPR: 0.01,
      steerAPY: 0.009,
      oracleAPY: 0.009,
    })
    expect(estimates[vault.address].strategies[MORPHO_STRATEGY]).toMatchObject({
      estimatedGrossAPY: 0.04 + morphoRewardsAPY,
      estimatedComponents: {
        morphoKatRewardsAPR: 0.02,
      },
    })
  })

  it('does not cover a Morpho strategy from strategy-address KAT-only Merkl rows', async () => {
    const vault = makeVault({
      strategies: [
        {
          address: MORPHO_STRATEGY,
          name: 'Morpho Compounder',
          details: {
            totalDebt: '500',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
          },
        },
      ],
    })
    const calculator = makeCalculator({
      morphoOpportunities: [
        {
          name: 'KAT only',
          type: 'ERC20LOGPROCESSOR',
          identifier: MORPHO_STRATEGY,
          campaigns: [
            {
              campaignId: 'kat-campaign',
              rewardToken: {
                address: KAT_TOKEN,
                symbol: 'KAT',
                decimals: 18,
              },
            },
          ],
          aprRecord: {
            breakdowns: [{ identifier: 'kat-campaign', value: 10 }],
          },
        },
      ],
    })

    const estimates = await calculator.calculateVaultForwardAPRs([vault])

    expect(estimates[vault.address].forwardAPR.grossAPY).toBeNull()
    expect(estimates[vault.address].forwardAPR.netAPY).toBeNull()
    expect(estimates[vault.address].forwardAPR.components).toMatchObject({
      estimatedDebtCoverage: 0,
    })
  })

  it('uses the reviewed yvvbUSDC static fallback mapping when dynamic resolution misses', async () => {
    const strategyAddress = '0x1e35dA1B596208Ce5059D0B4F4d08410426849B8'
    const morphoVaultAddress = '0xA2d38c8A3D810EBcF4C2075821c5eC8F976bb692'
    const vault = makeVault({
      strategies: [
        {
          address: strategyAddress,
          name: 'Morpho Compounder',
          details: {
            totalDebt: '1000',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
          },
        },
      ],
    })
    const calculator = makeCalculator({
      morphoEstimates: {
        [morphoVaultAddress.toLowerCase()]: {
          address: morphoVaultAddress.toLowerCase(),
          baseAPY: 0.05,
          version: 'v2',
          rewards: [],
        },
      },
    })

    const estimates = await calculator.calculateVaultForwardAPRs([vault])

    expect(estimates[vault.address].forwardAPR.grossAPY).toBeCloseTo(0.05)
    expect(estimates[vault.address].forwardAPR.netAPY).toBeCloseTo(0.05)
  })

  it('treats explicit zero oracle APY as a covered zero-yield estimate', async () => {
    const vault = makeVault({
      strategies: [
        {
          address: STEER_STRATEGY,
          name: 'Steer Strategy',
          oracleAPY: 0,
          details: {
            totalDebt: '1000',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
          },
        },
      ],
    })
    const calculator = makeCalculator({})

    const estimates = await calculator.calculateVaultForwardAPRs([vault])

    expect(estimates[vault.address].forwardAPR).toMatchObject({
      grossAPR: 0,
      grossAPY: 0,
      netAPR: 0,
      netAPY: 0,
      components: {
        estimatedDebtCoverage: 1,
        steerAPY: 0,
        oracleAPY: 0,
      },
    })
    expect(estimates[vault.address].strategies[STEER_STRATEGY]).toMatchObject({
      estimatedGrossAPY: 0,
      estimatedNetAPY: 0,
    })
  })

  it('routes Morpho Lender Borrower strategies through the oracle path', async () => {
    const vault = makeVault({
      strategies: [
        {
          address: MORPHO_STRATEGY,
          name: 'Morpho vbWBTC/yvUSDT Lender Borrower',
          oracleAPY: 0,
          details: {
            totalDebt: '1000',
            totalGain: '0',
            totalLoss: '0',
            lastReport: 0,
          },
        },
      ],
    })
    const calculator = makeCalculator({})

    const estimates = await calculator.calculateVaultForwardAPRs([vault])

    expect(estimates[vault.address].forwardAPR).toMatchObject({
      grossAPY: 0,
      netAPY: 0,
      components: {
        estimatedDebtCoverage: 1,
        oracleAPY: 0,
      },
    })
    expect(estimates[vault.address].strategies[MORPHO_STRATEGY]).toMatchObject({
      estimatedGrossAPY: 0,
      estimatedNetAPY: 0,
    })
  })
})
