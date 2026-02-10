import axios from 'axios'
import { config } from '../../config'
import type { MerklOpportunity } from '../../types'
import { isAddress } from 'viem'
import { logVaultAprDebug } from '../aprCalcs/debugLogger'

const EXCLUDED_CAMPAIGN_IDS = new Set([
  '0x487022e5f413f60e3e6aa251712f9c2d6601f01d14b565e779a61b68c173bd6c',
  '0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d',
])

const extractAddressFromIdentifier = (
  identifier?: string
): string | undefined => {
  if (!identifier) {
    return undefined
  }

  const candidate = identifier.slice(0, 42)
  return isAddress(candidate) ? candidate : undefined
}

export class MerklApiService {
  private apiUrl: string

  constructor() {
    this.apiUrl = config.merklApiUrl
  }

  private filterCampaigns(
    opportunities: MerklOpportunity[],
  ): MerklOpportunity[] {
    return opportunities.map((opportunity) => {
      if (!opportunity.campaigns?.length) {
        return opportunity
      }

      const removedCampaignIds: string[] = []
      const filteredCampaigns = opportunity.campaigns.filter((campaign) => {
        const campaignId = campaign.campaignId?.toLowerCase()
        const isExcluded = !!campaignId && EXCLUDED_CAMPAIGN_IDS.has(campaignId)
        if (isExcluded) {
          removedCampaignIds.push(campaignId)
        }
        return !isExcluded
      })

      if (filteredCampaigns.length === opportunity.campaigns.length) {
        return opportunity
      }

      const vaultAddress = extractAddressFromIdentifier(opportunity.identifier)
      if (vaultAddress) {
        const aprBreakdownIds = Array.isArray(opportunity.aprRecord?.breakdowns)
          ? opportunity.aprRecord.breakdowns
              .map((breakdown) => breakdown.identifier?.toLowerCase())
              .filter((id): id is string => !!id)
          : []

        const breakdownIdSet = new Set(aprBreakdownIds)
        const blacklistedAprBreakdownCampaignIds = removedCampaignIds.filter(
          (id) => breakdownIdSet.has(id),
        )

        logVaultAprDebug({
          stage: 'blacklist_filter',
          vaultAddress,
          opportunityIdentifier: opportunity.identifier,
          campaignsTotal: opportunity.campaigns.length,
          aprBreakdownsTotal: aprBreakdownIds.length,
          blacklistedCampaigns: removedCampaignIds.length,
          blacklistedCampaignIds: removedCampaignIds,
          blacklistedAprBreakdownCampaignIds,
          reason:
            blacklistedAprBreakdownCampaignIds.length > 0
              ? 'apr_breakdown_campaign_blacklisted'
              : 'campaigns_blacklisted',
        })
      }

      return {
        ...opportunity,
        campaigns: filteredCampaigns,
      }
    })
  }

  async getSushiOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const url: string = `${this.apiUrl}/v4/opportunities`
      const params = {
        name: 'sushi',
        chainId: config.katanaChainId,
        campaigns: true,
      }

      const response = await axios.get<
        MerklOpportunity[] | { opportunities: MerklOpportunity[] }
      >(url, { params })

      // The response is an array directly
      const opportunities: MerklOpportunity[] = Array.isArray(response.data)
        ? response.data
        : response.data.opportunities || []

      return this.filterCampaigns(opportunities)
    } catch (error) {
      console.error('Error fetching Sushi opportunities:', error)
      return []
    }
  }

  async getMorphoOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const url: string = `${this.apiUrl}/v4/opportunities`
      const params = {
        name: 'morpho',
        chainId: config.katanaChainId,
        campaigns: true,
      }

      const response = await axios.get<
        MerklOpportunity[] | { opportunities: MerklOpportunity[] }
      >(url, { params })

      // The response is an array directly
      const opportunities: MerklOpportunity[] = Array.isArray(response.data)
        ? response.data
        : response.data.opportunities || []

      return this.filterCampaigns(opportunities)
    } catch (error) {
      console.error('Error fetching Morpho opportunities:', error)
      return []
    }
  }

  /**
   * Fetches Yearn opportunities from the Merkl API.
   *
   * Sends a GET request to the `/v4/opportunities` endpoint with parameters for Yearn,
   * the configured chain ID, and campaign information. Handles responses that may be
   * either an array of opportunities or an object containing an `opportunities` array.
   *
   * @returns {Promise<MerklOpportunity[]>} A promise that resolves to an array of Yearn opportunities.
   * If an error occurs during the fetch, an empty array is returned.
   */
  async getYearnOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const url: string = `${this.apiUrl}/v4/opportunities`
      const params = {
        name: 'yearn',
        chainId: config.katanaChainId,
        campaigns: true,
      }

      const response = await axios.get<
        MerklOpportunity[] | { opportunities: MerklOpportunity[] }
      >(url, { params })

      // The response is an array directly
      const opportunities: MerklOpportunity[] = Array.isArray(response.data)
        ? response.data
        : response.data.opportunities || []

      return this.filterCampaigns(opportunities)
    } catch (error) {
      console.error('Error fetching Yearn opportunities:', error)
      return []
    }
  }

  /**
   * Fetches ERC20 Log Processor opportunities from the Merkl API.
   *
   * Sends a GET request to the `/v4/opportunities` endpoint with the specified parameters:
   * - `status`: 'LIVE'
   * - `chainId`: from configuration
   * - `type`: 'ERC20LOGPROCESSOR'
   * - `campaigns`: true
   *
   * Handles responses that may either be a direct array of `MerklOpportunity` objects or an object containing an `opportunities` array.
   * In case of an error, logs the error and returns an empty array.
   *
   * @returns {Promise<MerklOpportunity[]>} A promise that resolves to an array of `MerklOpportunity` objects.
   */
  async getErc20LogProcessorOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const url: string = `${this.apiUrl}/v4/opportunities`
      const params = {
        status: 'LIVE',
        chainId: config.katanaChainId,
        type: 'ERC20LOGPROCESSOR',
        campaigns: true,
      }

      const response = await axios.get<
        MerklOpportunity[] | { opportunities: MerklOpportunity[] }
      >(url, { params })

      // The response is an array directly
      const opportunities: MerklOpportunity[] = Array.isArray(response.data)
        ? response.data
        : response.data.opportunities || []

      const filteredOpportunities = this.filterCampaigns(opportunities)
      for (const opportunity of filteredOpportunities) {
        const vaultAddress = extractAddressFromIdentifier(
          opportunity.identifier
        )
        if (!vaultAddress) {
          continue
        }

        logVaultAprDebug({
          stage: 'opportunity_fetch',
          vaultAddress,
          poolType: 'yearn',
          opportunityType: 'ERC20LOGPROCESSOR',
          opportunityIdentifier: opportunity.identifier,
          opportunitiesTotal: filteredOpportunities.length,
          campaignsTotal: opportunity.campaigns?.length || 0,
          reason: 'merkl_opportunity_loaded',
        })
      }

      return filteredOpportunities
    } catch (error) {
      console.error('Error fetching ERC20 Log Processor opportunities:', error)
      return []
    }
  }

  /**
   * Fetches ERC20 fixed APR opportunities from the Merkl API.
   *
   * This method sends a GET request to the `/v4/opportunities` endpoint,
   * filtering for opportunities with status 'LIVE', the configured chain ID, and type 'ERC20_FIX_APR'.
   * It also requests campaigns with `campaigns: true`.
   * The response may be either an array of `MerklOpportunity` objects or an object containing an `opportunities` array.
   * In case of an error, an empty array is returned and the error is logged to the console.
   *
   * @returns {Promise<MerklOpportunity[]>} A promise that resolves to an array of `MerklOpportunity` objects.
   */
  async getErc20FixAprOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const url: string = `${this.apiUrl}/v4/opportunities`
      const params = {
        status: 'LIVE',
        chainId: config.katanaChainId,
        type: 'ERC20_FIX_APR',
        campaigns: true,
      }

      const response = await axios.get<
        MerklOpportunity[] | { opportunities: MerklOpportunity[] }
      >(url, { params })

      // The response is an array directly
      const opportunities: MerklOpportunity[] = Array.isArray(response.data)
        ? response.data
        : response.data.opportunities || []

      const filteredOpportunities = this.filterCampaigns(opportunities)
      for (const opportunity of filteredOpportunities) {
        const vaultAddress = extractAddressFromIdentifier(
          opportunity.identifier
        )
        if (!vaultAddress) {
          continue
        }

        logVaultAprDebug({
          stage: 'opportunity_fetch',
          vaultAddress,
          poolType: 'fixed rate',
          opportunityType: 'ERC20_FIX_APR',
          opportunityIdentifier: opportunity.identifier,
          opportunitiesTotal: filteredOpportunities.length,
          campaignsTotal: opportunity.campaigns?.length || 0,
          reason: 'merkl_opportunity_loaded',
        })
      }

      return filteredOpportunities
    } catch (error) {
      console.error('Error fetching ERC20 Log Processor opportunities:', error)
      return []
    }
  }
}
