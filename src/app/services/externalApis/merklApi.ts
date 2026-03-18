import axios from 'axios'
import { config } from '../../config'
import type { MerklOpportunity } from '../../types'
import { isAddress } from 'viem'
import { logVaultAprDebug } from '../aprCalcs/debugLogger'
import { isExcludedCampaignId } from './merklBlacklist'

const DEFAULT_MERKL_API_URL = 'https://api.merkl.xyz'
const MERKL_FALLBACK_URLS = [
  'https://api.merkl.fr',
  'https://api-merkl.angle.money',
] as const

type MerklOpportunitiesResponse =
  | MerklOpportunity[]
  | { opportunities: MerklOpportunity[] }

const extractAddressFromIdentifier = (
  identifier?: string
): string | undefined => {
  if (!identifier) {
    return undefined
  }

  const candidate = identifier.slice(0, 42)
  return isAddress(candidate) ? candidate : undefined
}

const normalizeApiUrl = (apiUrl: string): string => apiUrl.replace(/\/+$/, '')

export class MerklApiService {
  private apiUrls: string[]

  constructor(apiUrl: string = config.merklApiUrl) {
    const primaryApiUrl = normalizeApiUrl(apiUrl)
    this.apiUrls =
      primaryApiUrl === DEFAULT_MERKL_API_URL
        ? Array.from(new Set([primaryApiUrl, ...MERKL_FALLBACK_URLS]))
        : [primaryApiUrl]
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
        const isExcluded = isExcludedCampaignId(campaign.campaignId)
        if (isExcluded) {
          if (campaignId) {
            removedCampaignIds.push(campaignId)
          }
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

  private normalizeOpportunities(
    responseData: MerklOpportunitiesResponse,
  ): MerklOpportunity[] {
    return Array.isArray(responseData)
      ? responseData
      : responseData.opportunities || []
  }

  private describeRequestError(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error)
    }

    const axiosLikeError = error as Error & {
      code?: string
      response?: { status?: number }
    }

    const details = [
      axiosLikeError.code,
      axiosLikeError.response?.status
        ? `status ${axiosLikeError.response.status}`
        : undefined,
    ].filter((value): value is string => !!value)

    return details.length > 0
      ? `${error.message} (${details.join(', ')})`
      : error.message
  }

  private async fetchOpportunities(
    params: Record<string, boolean | number | string>,
  ): Promise<MerklOpportunity[]> {
    let lastError: unknown

    for (let index = 0; index < this.apiUrls.length; index += 1) {
      const apiUrl = this.apiUrls[index]

      try {
        const response = await axios.get<MerklOpportunitiesResponse>(
          `${apiUrl}/v4/opportunities`,
          { params },
        )

        return this.normalizeOpportunities(response.data)
      } catch (error) {
        lastError = error

        if (index < this.apiUrls.length - 1) {
          console.warn(
            `Merkl request failed for ${apiUrl}; trying fallback host: ${this.describeRequestError(error)}`
          )
        }
      }
    }

    throw lastError
  }

  async getSushiOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const params = {
        name: 'sushiswap',
        chainId: config.katanaChainId,
        campaigns: true,
      }

      const opportunities = await this.fetchOpportunities(params)
      return this.filterCampaigns(opportunities)
    } catch (error) {
      console.error('Error fetching Sushi opportunities:', error)
      return []
    }
  }

  async getMorphoOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const params = {
        name: 'morpho',
        chainId: config.katanaChainId,
        campaigns: true,
      }

      const opportunities = await this.fetchOpportunities(params)
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
      const params = {
        name: 'yearn',
        chainId: config.katanaChainId,
        campaigns: true,
      }

      const opportunities = await this.fetchOpportunities(params)
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
      const params = {
        status: 'LIVE',
        chainId: config.katanaChainId,
        type: 'ERC20LOGPROCESSOR',
        campaigns: true,
      }

      const opportunities = await this.fetchOpportunities(params)
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
      const params = {
        status: 'LIVE',
        chainId: config.katanaChainId,
        type: 'ERC20_FIX_APR',
        campaigns: true,
      }

      const opportunities = await this.fetchOpportunities(params)
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
      console.error('Error fetching ERC20 Fixed APR opportunities:', error)
      return []
    }
  }
}
