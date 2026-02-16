import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

const mocks = vi.hoisted(() => ({
  mockComputeKatanaAPR: vi.fn(),
}))

vi.mock('../../services/webhookOutput', () => ({
  computeKatanaAPR: mocks.mockComputeKatanaAPR,
}))

import { POST } from './route'

const TEST_SECRET = 'test-webhook-secret'
const VAULT_A = '0x000000000000000000000000000000000000aaaa'

const subscription = {
  id: 'S_TEST',
  url: 'https://example.com/webhook',
  abiPath: 'yearn/3/vault',
  type: 'timeseries',
  labels: ['katana-apr'],
}

function makeBody(overrides = {}) {
  return {
    abiPath: 'yearn/3/vault',
    chainId: 747474,
    blockNumber: '100',
    blockTime: '1700000000',
    subscription,
    vaults: [VAULT_A],
    ...overrides,
  }
}

function makeSignature(bodyStr: string, secret = TEST_SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', secret)
    .update(`${timestamp}.${bodyStr}`, 'utf8')
    .digest('hex')
  return `t=${timestamp},v1=${sig}`
}

function makeRequest(body: unknown, signature?: string): Request {
  const bodyStr = JSON.stringify(body)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (signature) {
    headers['kong-signature'] = signature
  }
  return new Request('http://localhost/api/webhook', {
    method: 'POST',
    headers,
    body: bodyStr,
  })
}

describe('/api/webhook route', () => {
  beforeEach(() => {
    mocks.mockComputeKatanaAPR.mockReset()
    vi.stubEnv('KONG_WEBHOOK_SECRET', TEST_SECRET)
  })

  it('returns 500 when KONG_WEBHOOK_SECRET is not set', async () => {
    vi.stubEnv('KONG_WEBHOOK_SECRET', '')
    const req = makeRequest(makeBody(), 'some-sig')
    const res = await POST(req as any)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('webhook secret not configured')
  })

  it('returns 401 when Kong-Signature header is missing', async () => {
    const req = makeRequest(makeBody())
    const res = await POST(req as any)

    expect(res.status).toBe(401)
  })

  it('returns 401 when signature is invalid', async () => {
    const bodyObj = makeBody()
    const bodyStr = JSON.stringify(bodyObj)
    const badSig = makeSignature(bodyStr, 'wrong-secret')
    const req = makeRequest(bodyObj, badSig)
    const res = await POST(req as any)

    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid payload schema', async () => {
    const bodyObj = { invalid: true, subscription: { id: 'S_TEST' } }
    const bodyStr = JSON.stringify(bodyObj)
    const sig = makeSignature(bodyStr)
    const req = makeRequest(bodyObj, sig)
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid payload')
  })

  it('returns 200 with outputs on success', async () => {
    const mockOutputs = [
      {
        chainId: 747474,
        address: VAULT_A,
        label: 'katana-apr',
        component: 'katanaAppRewardsAPR',
        value: 0.12,
        blockNumber: 100n,
        blockTime: 1700000000n,
      },
    ]
    mocks.mockComputeKatanaAPR.mockResolvedValue(mockOutputs)

    const bodyObj = makeBody()
    const bodyStr = JSON.stringify(bodyObj)
    const sig = makeSignature(bodyStr)
    const req = makeRequest(bodyObj, sig)
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].address).toBe(VAULT_A)
    expect(body[0].component).toBe('katanaAppRewardsAPR')
    expect(body[0].value).toBe(0.12)
    // bigints serialized as strings
    expect(body[0].blockNumber).toBe('100')
  })

  it('returns 500 on internal error', async () => {
    mocks.mockComputeKatanaAPR.mockRejectedValue(new Error('boom'))

    const bodyObj = makeBody()
    const bodyStr = JSON.stringify(bodyObj)
    const sig = makeSignature(bodyStr)
    const req = makeRequest(bodyObj, sig)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req as any)
    consoleSpy.mockRestore()

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('boom')
  })
})
