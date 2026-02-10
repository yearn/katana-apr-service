import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
