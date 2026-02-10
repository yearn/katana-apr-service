export const EXCLUDED_CAMPAIGN_IDS = new Set([
  '0x487022e5f413f60e3e6aa251712f9c2d6601f01d14b565e779a61b68c173bd6c',
  '0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d',
])

export const isExcludedCampaignId = (campaignId?: string): boolean => {
  if (!campaignId) {
    return false
  }

  return EXCLUDED_CAMPAIGN_IDS.has(campaignId.toLowerCase())
}
