import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  logVaultAprDebug: vi.fn(),
}))

vi.stubGlobal('fetch', mocks.fetchGet)

vi.mock('../aprCalcs/debugLogger', () => ({
  logVaultAprDebug: mocks.logVaultAprDebug,
}))

import { MerklApiService } from './merklApi'

const makeOkResponse = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  })

const makeErrorResponse = (status: number) =>
  Promise.resolve({
    ok: false,
    status,
    json: () => Promise.reject(new Error('error body')),
  })

describe('MerklApiService', () => {
  beforeEach(() => {
    mocks.fetchGet.mockReset()
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
    const fallbackOpportunity = {
      chainId: 747474,
      name: 'Yearn Opportunity',
      tvl: 1_000_000,
      status: 'LIVE',
      identifier: '0x93Fec6639717b6215A48E5a72a162C50DCC40d68',
      campaigns: [],
    }

    mocks.fetchGet
      .mockRejectedValueOnce(primaryError)
      .mockImplementationOnce(() =>
        makeOkResponse({ opportunities: [fallbackOpportunity] }),
      )

    const service = new MerklApiService()
    const opportunities = await service.getYearnOpportunities()

    expect(opportunities).toEqual([fallbackOpportunity])
    expect(mocks.fetchGet).toHaveBeenCalledTimes(2)
    expect(mocks.fetchGet).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`${config.merklApiUrl}/v4/opportunities`),
    )
    expect(mocks.fetchGet).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('https://api.merkl.fr/v4/opportunities'),
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

    mocks.fetchGet.mockImplementationOnce(() => makeErrorResponse(502))

    const service = new MerklApiService(customApiUrl)
    const opportunities = await service.getYearnOpportunities()

    expect(opportunities).toEqual([])
    expect(mocks.fetchGet).toHaveBeenCalledTimes(1)
    expect(mocks.fetchGet).toHaveBeenCalledWith(
      expect.stringContaining(`${customApiUrl}/v4/opportunities`),
    )
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'Error fetching Yearn opportunities:',
      expect.any(Error),
    )

    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })

  it('queries sushiswap opportunities using the live Merkl name filter', async () => {
    mocks.fetchGet.mockImplementation(() => makeOkResponse([]))

    const service = new MerklApiService()
    await service.getSushiOpportunities()

    expect(mocks.fetchGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/v4\/opportunities\?.*name=sushiswap/),
    )
    expect(mocks.fetchGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/v4\/opportunities\?.*campaigns=true/),
    )
  })

  it('logs when a blacklist removes the active APR-breakdown campaign', async () => {
    const vaultAddress = '0x93Fec6639717b6215A48E5a72a162C50DCC40d68'
    const blacklistedCampaignId =
      '0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d'

    mocks.fetchGet.mockImplementation(() =>
      makeOkResponse([
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
      ]),
    )

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

    mocks.fetchGet
      .mockRejectedValueOnce(firstError)
      .mockImplementationOnce(() => makeErrorResponse(404))
      .mockImplementationOnce(() => makeErrorResponse(504))

    const service = new MerklApiService()
    const opportunities = await service.getErc20FixAprOpportunities()

    expect(opportunities).toEqual([])
    expect(mocks.fetchGet).toHaveBeenCalledTimes(3)
    expect(mocks.fetchGet).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`${config.merklApiUrl}/v4/opportunities`),
    )
    expect(mocks.fetchGet).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('https://api.merkl.fr/v4/opportunities'),
    )
    expect(mocks.fetchGet).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('https://api-merkl.angle.money/v4/opportunities'),
    )
    expect(consoleWarn).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(
      'Error fetching ERC20 Fixed APR opportunities:',
      expect.any(Error),
    )

    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })
})
