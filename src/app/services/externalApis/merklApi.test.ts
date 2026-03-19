import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  logVaultAprDebug: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet,
  },
}))

vi.mock('../aprCalcs/debugLogger', () => ({
  logVaultAprDebug: mocks.logVaultAprDebug,
}))

import { MerklApiService } from './merklApi'

describe('MerklApiService', () => {
  beforeEach(() => {
    mocks.axiosGet.mockReset()
    mocks.logVaultAprDebug.mockReset()
  })

  it('falls back to api.merkl.fr when the primary Merkl domain fails', async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const primaryError = Object.assign(
      new Error('getaddrinfo ENOTFOUND api.merkl.xyz'),
      { code: 'ENOTFOUND' },
    )
    const params = {
      name: 'yearn',
      chainId: config.katanaChainId,
      campaigns: true,
    }
    const fallbackOpportunity = {
      chainId: 747474,
      name: 'Yearn Opportunity',
      tvl: 1_000_000,
      status: 'LIVE',
      identifier: '0x93Fec6639717b6215A48E5a72a162C50DCC40d68',
      campaigns: [],
    }

    mocks.axiosGet
      .mockRejectedValueOnce(primaryError)
      .mockResolvedValueOnce({
        data: {
          opportunities: [fallbackOpportunity],
        },
      })

    const service = new MerklApiService()
    const opportunities = await service.getYearnOpportunities()

    expect(opportunities).toEqual([fallbackOpportunity])
    expect(mocks.axiosGet).toHaveBeenCalledTimes(2)
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(
      1,
      `${config.merklApiUrl}/v4/opportunities`,
      { params },
    )
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(
      2,
      'https://api.merkl.fr/v4/opportunities',
      { params },
    )
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        `Merkl request failed for ${config.merklApiUrl}; trying fallback host:`,
      ),
    )

    consoleWarn.mockRestore()
  })

  it('does not fall back when a custom Merkl base URI is configured', async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const customApiUrl = 'https://merkl-proxy.internal'
    const customError = Object.assign(new Error('Bad gateway'), {
      response: { status: 502 },
    })
    const params = {
      name: 'yearn',
      chainId: config.katanaChainId,
      campaigns: true,
    }

    mocks.axiosGet.mockRejectedValueOnce(customError)

    const service = new MerklApiService(customApiUrl)
    const opportunities = await service.getYearnOpportunities()

    expect(opportunities).toEqual([])
    expect(mocks.axiosGet).toHaveBeenCalledTimes(1)
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      `${customApiUrl}/v4/opportunities`,
      { params },
    )
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'Error fetching Yearn opportunities:',
      customError,
    )

    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })

  it('logs when a blacklist removes the active APR-breakdown campaign', async () => {
    const vaultAddress = '0x93Fec6639717b6215A48E5a72a162C50DCC40d68'
    const blacklistedCampaignId =
      '0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d'

    mocks.axiosGet.mockResolvedValue({
      data: [
        {
          chainId: 747474,
          name: 'AUSD Opportunity',
          tvl: 1_000_000,
          status: 'LIVE',
          identifier: vaultAddress,
          campaigns: [
            {
              campaignId: blacklistedCampaignId,
              amount: '1',
              rewardToken: {
                address: '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461',
                symbol: 'KAT',
                decimals: 18,
                price: 1,
              },
              startTimestamp: 0,
              endTimestamp: 0,
            },
            {
              campaignId:
                '0x1111111111111111111111111111111111111111111111111111111111111111',
              amount: '1',
              rewardToken: {
                address: '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461',
                symbol: 'KAT',
                decimals: 18,
                price: 1,
              },
              startTimestamp: 0,
              endTimestamp: 0,
            },
          ],
          aprRecord: {
            breakdowns: [
              {
                identifier: blacklistedCampaignId,
                value: 12.3,
              },
            ],
          },
        },
      ],
    })

    const service = new MerklApiService()
    const opportunities = await service.getErc20LogProcessorOpportunities()

    expect(opportunities).toHaveLength(1)
    expect(opportunities[0].campaigns).toHaveLength(1)
    expect(opportunities[0].campaigns?.[0]?.campaignId).not.toBe(
      blacklistedCampaignId,
    )

    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'blacklist_filter',
        vaultAddress,
        reason: 'apr_breakdown_campaign_blacklisted',
        blacklistedCampaigns: 1,
        blacklistedCampaignIds: [blacklistedCampaignId],
        blacklistedAprBreakdownCampaignIds: [blacklistedCampaignId],
      }),
    )
  })

  it('returns an empty array after all Merkl hosts fail', async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const firstError = Object.assign(
      new Error('getaddrinfo ENOTFOUND api.merkl.xyz'),
      { code: 'ENOTFOUND' },
    )
    const secondError = Object.assign(new Error('Route not found'), {
      response: { status: 404 },
    })
    const thirdError = Object.assign(new Error('Gateway timeout'), {
      response: { status: 504 },
    })
    const params = {
      status: 'LIVE',
      chainId: config.katanaChainId,
      type: 'ERC20_FIX_APR',
      campaigns: true,
    }

    mocks.axiosGet
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(secondError)
      .mockRejectedValueOnce(thirdError)

    const service = new MerklApiService()
    const opportunities = await service.getErc20FixAprOpportunities()

    expect(opportunities).toEqual([])
    expect(mocks.axiosGet).toHaveBeenCalledTimes(3)
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(
      1,
      `${config.merklApiUrl}/v4/opportunities`,
      { params },
    )
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(
      2,
      'https://api.merkl.fr/v4/opportunities',
      { params },
    )
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(
      3,
      'https://api-merkl.angle.money/v4/opportunities',
      { params },
    )
    expect(consoleWarn).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(
      'Error fetching ERC20 Fixed APR opportunities:',
      thirdError,
    )

    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })
})
