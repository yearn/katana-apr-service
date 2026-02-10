import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockGenerateVaultAPRData: vi.fn(),
}))

vi.mock('../../services/dataCache', () => ({
  DataCacheService: vi.fn().mockImplementation(() => ({
    generateVaultAPRData: mocks.mockGenerateVaultAPRData,
  })),
}))

import { GET, OPTIONS } from './route'

describe('/api/vaults route', () => {
  beforeEach(() => {
    mocks.mockGenerateVaultAPRData.mockReset()
  })

  it('returns APR data with cache and CORS headers on success', async () => {
    const payload = {
      '0x00000000000000000000000000000000000000aa': {
        name: 'Vault',
        apr: 0,
        breakdown: [],
      },
    }

    mocks.mockGenerateVaultAPRData.mockResolvedValue(payload)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(payload)
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=900')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns 502 with error payload when data generation fails', async () => {
    mocks.mockGenerateVaultAPRData.mockRejectedValue(new Error('upstream failed'))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body).toEqual({
      message: 'An error occurred while fetching data.',
      error: 'upstream failed',
    })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('handles OPTIONS requests for CORS preflight', async () => {
    const response = OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })
})
