import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Opportunity } from './types'

const mocks = vi.hoisted(() => ({
  logVaultAprDebug: vi.fn(),
}))

vi.mock('./debugLogger', () => ({
  logVaultAprDebug: mocks.logVaultAprDebug,
}))

import { calculateYearnVaultRewardsAPR } from './utils'

const VAULT_ADDRESS = '0x00000000000000000000000000000000000000aa'
const WRAPPED_KAT_ADDRESS = '0x00000000000000000000000000000000000000bb'
const NON_ALLOWLIST_TOKEN = '0x00000000000000000000000000000000000000cc'

const makeOpportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  name: 'Test Opportunity',
  identifier: VAULT_ADDRESS,
  campaigns: [
    {
      campaignId: 'campaign-1',
      rewardToken: {
        address: WRAPPED_KAT_ADDRESS,
        symbol: 'KAT',
        decimals: 18,
      },
    },
  ],
  aprRecord: {
    breakdowns: [
      {
        identifier: 'campaign-1',
        value: 12.5,
      },
    ],
  },
  ...overrides,
})

describe('calculateYearnVaultRewardsAPR', () => {
  beforeEach(() => {
    mocks.logVaultAprDebug.mockClear()
  })

  it('returns zero placeholder when no opportunity is found', () => {
    const results = calculateYearnVaultRewardsAPR(
      'Vault',
      VAULT_ADDRESS,
      [],
      'yearn',
      [WRAPPED_KAT_ADDRESS],
    )

    expect(results).toEqual([
      {
        vaultName: 'Vault',
        vaultAddress: VAULT_ADDRESS,
        poolType: 'yearn',
        breakdown: {
          apr: 0,
          token: {
            address: '',
            symbol: '',
            decimals: 0,
          },
          weight: 0,
        },
      },
    ])
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'opportunity_lookup',
        reason: 'opportunity_missing',
      }),
    )
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'result_summary',
        reason: 'opportunity_missing',
      }),
    )
  })

  it('returns zero placeholder when opportunity has no campaigns', () => {
    const results = calculateYearnVaultRewardsAPR(
      'Vault',
      VAULT_ADDRESS,
      [makeOpportunity({ campaigns: [] })],
      'yearn',
      [WRAPPED_KAT_ADDRESS],
    )

    expect(results).toEqual([
      {
        vaultName: 'Vault',
        vaultAddress: VAULT_ADDRESS,
        poolType: 'yearn',
        breakdown: {
          apr: 0,
          token: {
            address: '',
            symbol: '',
            decimals: 0,
          },
          weight: 0,
        },
      },
    ])
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'result_summary',
        reason: 'opportunity_has_no_campaigns',
      }),
    )
  })

  it('returns a zero placeholder when campaigns have no APR breakdown match', () => {
    const results = calculateYearnVaultRewardsAPR(
      'Vault',
      VAULT_ADDRESS,
      [
        makeOpportunity({
          aprRecord: {
            breakdowns: [],
          },
        }),
      ],
      'yearn',
      [WRAPPED_KAT_ADDRESS],
    )

    expect(results).toEqual([
      {
        vaultName: 'Vault',
        vaultAddress: VAULT_ADDRESS,
        poolType: 'yearn',
        breakdown: {
          apr: 0,
          token: {
            address: '',
            symbol: '',
            decimals: 0,
          },
          weight: 0,
        },
      },
    ])
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'campaign_apr_match',
        aprBreakdownMatched: false,
      }),
    )
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'result_summary',
        reason: 'no_matching_campaigns_after_filters',
      }),
    )
  })

  it('returns a zero placeholder when APR exists but reward token is filtered out', () => {
    const results = calculateYearnVaultRewardsAPR(
      'Vault',
      VAULT_ADDRESS,
      [
        makeOpportunity({
          campaigns: [
            {
              campaignId: 'campaign-1',
              rewardToken: {
                address: NON_ALLOWLIST_TOKEN,
                symbol: 'OTHER',
                decimals: 18,
              },
            },
          ],
        }),
      ],
      'yearn',
      [WRAPPED_KAT_ADDRESS],
    )

    expect(results).toEqual([
      {
        vaultName: 'Vault',
        vaultAddress: VAULT_ADDRESS,
        poolType: 'yearn',
        breakdown: {
          apr: 0,
          token: {
            address: '',
            symbol: '',
            decimals: 0,
          },
          weight: 0,
        },
      },
    ])
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'token_filter',
        tokenMatched: false,
        reason: 'reward_token_filtered',
      }),
    )
  })

  it('returns campaign APR breakdown when campaign and token match', () => {
    const results = calculateYearnVaultRewardsAPR(
      'Vault',
      VAULT_ADDRESS,
      [makeOpportunity()],
      'yearn',
      [WRAPPED_KAT_ADDRESS],
    )

    expect(results).toEqual([
      {
        vaultName: 'Vault',
        vaultAddress: VAULT_ADDRESS,
        poolType: 'yearn',
        breakdown: {
          apr: 12.5,
          token: {
            address: WRAPPED_KAT_ADDRESS,
            symbol: 'KAT',
            decimals: 18,
          },
          weight: 0,
        },
      },
    ])
    expect(mocks.logVaultAprDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'result_summary',
        reason: 'apr_calculated',
        acceptedCampaigns: 1,
      }),
    )
  })
})
