import { describe, expect, it } from 'vitest'
import {
  EXCLUDED_CAMPAIGN_IDS,
  isExcludedCampaignId,
} from './merklBlacklist'

describe('merklBlacklist', () => {
  it('matches excluded campaign IDs case-insensitively', () => {
    const [firstCampaignId] = Array.from(EXCLUDED_CAMPAIGN_IDS)
    expect(firstCampaignId).toBeDefined()

    if (!firstCampaignId) {
      throw new Error('Expected at least one excluded campaign ID')
    }

    expect(isExcludedCampaignId(firstCampaignId)).toBe(true)
    expect(isExcludedCampaignId(firstCampaignId.toUpperCase())).toBe(true)
  })

  it('returns false for unknown or missing campaign IDs', () => {
    expect(
      isExcludedCampaignId(
        '0x1111111111111111111111111111111111111111111111111111111111111111'
      )
    ).toBe(false)
    expect(isExcludedCampaignId(undefined)).toBe(false)
  })
})
