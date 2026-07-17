import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockGenerateVaultAPRData: vi.fn(),
}))

vi.mock('../../services/dataCache', () => ({
  DataCacheService: vi.fn().mockImplementation(() => ({
    generateVaultAPRData: mocks.mockGenerateVaultAPRData,
  })),
}))

import { POST } from './route'

const WEBHOOK_SECRET = 'test-secret'
const VAULT_ADDRESS = '0x00000000000000000000000000000000000000aa'
const REQUEST_VAULT_ADDRESS = '0x00000000000000000000000000000000000000Aa'
const STRATEGY_ADDRESS = '0x00000000000000000000000000000000000000bb'
const SECOND_STRATEGY_ADDRESS = '0x00000000000000000000000000000000000000cc'

const buildSignedRequest = (body: Record<string, unknown>): NextRequest => {
  const rawBody = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex')

  return new NextRequest('http://localhost/api/webhook', {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      'kong-signature': `t=${timestamp},v1=${signature}`,
    },
  })
}

describe('/api/webhook route', () => {
  beforeEach(() => {
    process.env.KONG_WEBHOOK_SECRET = WEBHOOK_SECRET
    mocks.mockGenerateVaultAPRData.mockReset()
  })

  it('returns vault-level components plus strategy-addressed estimated and KAT APR rows', async () => {
    const forwardNetAPR = 0.0789
    const forwardNetAPY = (1 + forwardNetAPR / 52) ** 52 - 1

    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [VAULT_ADDRESS.toLowerCase()]: {
        address: VAULT_ADDRESS,
        symbol: 'yvKAT',
        name: 'KAT Vault',
        chainID: 747474,
        strategies: [
          {
            address: STRATEGY_ADDRESS,
            name: 'Morpho Strategy',
            strategyRewardsAPR: 0.123,
            morphoUnderlyingAPR: {
              morphoVaultAddress:
                '0x00000000000000000000000000000000000000ee',
              usedMorphoApi: true,
              morphoBaseAPR: 0.04,
              morphoBaseAPY: 0.0408,
              morphoRewardsAPR: 0.02,
              estimatedAPR: 0.06,
              estimatedAPY: 0.0618,
            },
          },
          {
            address: SECOND_STRATEGY_ADDRESS,
            name: 'Steer Strategy',
            strategyRewardsAPR: 0,
          },
          {
            address: '',
            name: 'Invalid Strategy',
            strategyRewardsAPR: 0.5,
          },
          {
            address: '0x00000000000000000000000000000000000000dd',
            name: 'Missing APR Strategy',
          },
        ],
        apr: {
          forwardAPR: {
            type: '',
            netAPR: forwardNetAPR,
            composite: {
              boost: null,
              poolAPY: null,
              boostedAPR: null,
              baseAPR: null,
              cvxAPR: null,
              rewardsAPR: null,
            },
            morphoUnderlying: {
              baseAPR: 0.02,
              rewardsAPR: 0.01,
              estimatedAPR: 0.03,
              estimatedAPY: 0.0305,
              coveredDebtRatio: 0.5,
            },
          },
          extra: {
            katanaAppRewardsAPR: 0.1234,
            fixedRateKatanaRewards: 0,
            katanaBonusAPY: 0,
            katanaNativeYield: 0.0456,
            steerPointsPerDollar: 0.5,
          },
        },
      },
    })

    const response = await POST(
      buildSignedRequest({
        vaults: [REQUEST_VAULT_ADDRESS],
        chainId: 747474,
        blockNumber: '123',
        blockTime: '456',
        subscription: {
          labels: ['katana'],
        },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).not.toContainEqual(
      expect.objectContaining({ component: 'morphoRewardsAPR' }),
    )
    expect(body).not.toContainEqual(
      expect.objectContaining({ component: 'estimatedAPR' }),
    )
    expect(body).toEqual([
      {
        chainId: 747474,
        address: REQUEST_VAULT_ADDRESS,
        label: 'katana',
        component: 'katanaAppRewardsAPR',
        value: 0.1234,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: REQUEST_VAULT_ADDRESS,
        label: 'katana',
        component: 'fixedRateKatanaRewards',
        value: 0,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: REQUEST_VAULT_ADDRESS,
        label: 'katana',
        component: 'katanaBonusAPY',
        value: 0,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: REQUEST_VAULT_ADDRESS,
        label: 'katana',
        component: 'katanaNativeYield',
        value: 0.0456,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: REQUEST_VAULT_ADDRESS,
        label: 'katana',
        component: 'steerPointsPerDollar',
        value: 0.5,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: REQUEST_VAULT_ADDRESS,
        label: 'katana',
        component: 'netAPR',
        value: forwardNetAPR,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: REQUEST_VAULT_ADDRESS,
        label: 'katana',
        component: 'netAPY',
        value: forwardNetAPY,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: STRATEGY_ADDRESS,
        label: 'katana',
        component: 'netAPR',
        value: 0.06,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: STRATEGY_ADDRESS,
        label: 'katana',
        component: 'netAPY',
        value: 0.0618,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: STRATEGY_ADDRESS,
        label: 'katana',
        component: 'katRewardsAPR',
        value: 0.123,
        blockNumber: '123',
        blockTime: '456',
      },
      {
        chainId: 747474,
        address: SECOND_STRATEGY_ADDRESS,
        label: 'katana',
        component: 'katRewardsAPR',
        value: 0,
        blockNumber: '123',
        blockTime: '456',
      },
    ])
  })

  it('emits strategy estimated APR and APY independently of KAT rewards', async () => {
    const zeroEstimateAddress =
      '0x00000000000000000000000000000000000000d1'
    const invalidEstimateAddress =
      '0x00000000000000000000000000000000000000d2'

    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [VAULT_ADDRESS.toLowerCase()]: {
        address: VAULT_ADDRESS,
        symbol: 'yvKAT',
        name: 'KAT Vault',
        chainID: 747474,
        strategies: [
          {
            address: zeroEstimateAddress,
            name: 'Morpho Strategy Without KAT',
            status: 'unallocated',
            morphoUnderlyingAPR: {
              morphoVaultAddress:
                '0x00000000000000000000000000000000000000e1',
              usedMorphoApi: true,
              morphoBaseAPR: 0,
              morphoBaseAPY: 0,
              morphoRewardsAPR: 0,
              estimatedAPR: 0,
              estimatedAPY: 0,
            },
          },
          {
            address: invalidEstimateAddress,
            name: 'Invalid Morpho Estimate',
            strategyRewardsAPR: 0.01,
            morphoUnderlyingAPR: {
              morphoVaultAddress:
                '0x00000000000000000000000000000000000000e2',
              usedMorphoApi: true,
              morphoBaseAPR: 0,
              morphoBaseAPY: 0,
              morphoRewardsAPR: 0,
              estimatedAPR: Number.POSITIVE_INFINITY,
              estimatedAPY: Number.NaN,
            },
          },
        ],
        apr: {
          extra: {},
        },
      },
    })

    const response = await POST(
      buildSignedRequest({
        vaults: [REQUEST_VAULT_ADDRESS],
        chainId: 747474,
        blockNumber: '123',
        blockTime: '456',
        subscription: {
          labels: ['katana-estimated-apr'],
        },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toContainEqual({
      chainId: 747474,
      address: zeroEstimateAddress,
      label: 'katana-estimated-apr',
      component: 'netAPR',
      value: 0,
      blockNumber: '123',
      blockTime: '456',
    })
    expect(body).toContainEqual({
      chainId: 747474,
      address: zeroEstimateAddress,
      label: 'katana-estimated-apr',
      component: 'netAPY',
      value: 0,
      blockNumber: '123',
      blockTime: '456',
    })
    expect(body).not.toContainEqual(
      expect.objectContaining({
        address: zeroEstimateAddress,
        component: 'katRewardsAPR',
      }),
    )
    expect(body).not.toContainEqual(
      expect.objectContaining({
        address: invalidEstimateAddress,
        component: 'netAPR',
      }),
    )
    expect(body).not.toContainEqual(
      expect.objectContaining({
        address: invalidEstimateAddress,
        component: 'netAPY',
      }),
    )
    expect(body).toContainEqual({
      chainId: 747474,
      address: invalidEstimateAddress,
      label: 'katana-estimated-apr',
      component: 'katRewardsAPR',
      value: 0.01,
      blockNumber: '123',
      blockTime: '456',
    })
  })

  it('emits zero forward net APR and APY rows', async () => {
    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [VAULT_ADDRESS.toLowerCase()]: {
        address: VAULT_ADDRESS,
        symbol: 'yvKAT',
        name: 'KAT Vault',
        chainID: 747474,
        strategies: [],
        apr: {
          forwardAPR: {
            type: '',
            netAPR: 0,
            composite: {
              boost: null,
              poolAPY: null,
              boostedAPR: null,
              baseAPR: null,
              cvxAPR: null,
              rewardsAPR: null,
            },
          },
          extra: {},
        },
      },
    })

    const response = await POST(
      buildSignedRequest({
        vaults: [REQUEST_VAULT_ADDRESS],
        chainId: 747474,
        blockNumber: '123',
        blockTime: '456',
        subscription: {
          labels: ['katana-estimated-apr'],
        },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toContainEqual({
      chainId: 747474,
      address: REQUEST_VAULT_ADDRESS,
      label: 'katana-estimated-apr',
      component: 'netAPR',
      value: 0,
      blockNumber: '123',
      blockTime: '456',
    })
    expect(body).toContainEqual({
      chainId: 747474,
      address: REQUEST_VAULT_ADDRESS,
      label: 'katana-estimated-apr',
      component: 'netAPY',
      value: 0,
      blockNumber: '123',
      blockTime: '456',
    })
  })

  it('does not emit forward APR or APY rows for null, missing, or non-finite values', async () => {
    const nullForwardAddress = '0x00000000000000000000000000000000000000a1'
    const missingForwardAddress = '0x00000000000000000000000000000000000000a2'
    const nonFiniteForwardAddress = '0x00000000000000000000000000000000000000a3'

    mocks.mockGenerateVaultAPRData.mockResolvedValue({
      [nullForwardAddress]: {
        address: nullForwardAddress,
        symbol: 'yvNULL',
        name: 'Null Forward Vault',
        chainID: 747474,
        strategies: [],
        apr: {
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
          extra: {},
        },
      },
      [missingForwardAddress]: {
        address: missingForwardAddress,
        symbol: 'yvMISS',
        name: 'Missing Forward Vault',
        chainID: 747474,
        strategies: [],
        apr: {
          extra: {},
        },
      },
      [nonFiniteForwardAddress]: {
        address: nonFiniteForwardAddress,
        symbol: 'yvINF',
        name: 'Non-finite Forward Vault',
        chainID: 747474,
        strategies: [],
        apr: {
          forwardAPR: {
            type: '',
            netAPR: Number.POSITIVE_INFINITY,
            composite: {
              boost: null,
              poolAPY: null,
              boostedAPR: null,
              baseAPR: null,
              cvxAPR: null,
              rewardsAPR: null,
            },
          },
          extra: {},
        },
      },
    })

    const response = await POST(
      buildSignedRequest({
        vaults: [
          nullForwardAddress,
          missingForwardAddress,
          nonFiniteForwardAddress,
        ],
        chainId: 747474,
        blockNumber: '123',
        blockTime: '456',
        subscription: {
          labels: ['katana-estimated-apr'],
        },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).not.toContainEqual(
      expect.objectContaining({
        component: 'netAPR',
      }),
    )
    expect(body).not.toContainEqual(
      expect.objectContaining({
        component: 'netAPY',
      }),
    )
  })
})
