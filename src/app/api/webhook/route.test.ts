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

  it('returns vault-level components plus strategy-addressed KAT APR rows', async () => {
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
})
