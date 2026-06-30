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

const MERKL_PAGE_SIZE = 100
const YEARN_VAULT_REWARD_OPPORTUNITY_TYPES = [
  'ERC20LOGPROCESSOR',
  'ERC20_MAPPING',
] as const

const normalizeApiUrl = (apiUrl: string): string => apiUrl.replace(/\/+$/, '')

type MerklCampaign = NonNullable<MerklOpportunity['campaigns']>[number]
type MerklAprBreakdown = NonNullable<
  NonNullable<MerklOpportunity['aprRecord']>['breakdowns']
>[number]

const getCampaignKey = (campaign: MerklCampaign): string =>
  campaign.campaignId?.toLowerCase() ||
  [
    campaign.rewardToken.address.toLowerCase(),
    campaign.amount,
    campaign.startTimestamp,
    campaign.endTimestamp,
  ].join('|')

const getAprBreakdownKey = (breakdown: MerklAprBreakdown): string =>
  breakdown.identifier?.toLowerCase() || String(breakdown.value)

export class MerklApiService {
  private apiUrls: string[]
  private requestInit?: RequestInit

  constructor(
    apiUrl: string = config.merklApiUrl,
    apiKey: string | undefined = config.merklApiKey,
  ) {
    const primaryApiUrl = normalizeApiUrl(apiUrl)
    const merklApiKey = apiKey?.trim()
    this.apiUrls =
      primaryApiUrl === DEFAULT_MERKL_API_URL
        ? Array.from(new Set([primaryApiUrl, ...MERKL_FALLBACK_URLS]))
        : [primaryApiUrl]
    this.requestInit = merklApiKey
      ? {
          headers: {
            'X-API-Key': merklApiKey,
          },
        }
      : undefined
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

  private mergeOpportunities(
    opportunities: MerklOpportunity[],
  ): MerklOpportunity[] {
    const mergedOpportunities = new Map<string, MerklOpportunity>()

    for (const opportunity of opportunities) {
      const key = opportunity.identifier.toLowerCase()
      const existingOpportunity = mergedOpportunities.get(key)

      if (!existingOpportunity) {
        const copiedOpportunity: MerklOpportunity = {
          ...opportunity,
          campaigns: opportunity.campaigns ? [...opportunity.campaigns] : [],
        }

        if (opportunity.aprRecord) {
          copiedOpportunity.aprRecord = {
            ...opportunity.aprRecord,
            breakdowns: opportunity.aprRecord?.breakdowns
              ? [...opportunity.aprRecord.breakdowns]
              : [],
          }
        }

        mergedOpportunities.set(key, copiedOpportunity)
        continue
      }

      const campaignKeys = new Set(
        existingOpportunity.campaigns?.map(getCampaignKey) || [],
      )
      const additionalCampaigns = opportunity.campaigns?.filter((campaign) => {
        const campaignKey = getCampaignKey(campaign)
        if (campaignKeys.has(campaignKey)) {
          return false
        }
        campaignKeys.add(campaignKey)
        return true
      }) || []

      const existingBreakdowns = existingOpportunity.aprRecord?.breakdowns || []
      const breakdownKeys = new Set(existingBreakdowns.map(getAprBreakdownKey))
      const additionalBreakdowns =
        opportunity.aprRecord?.breakdowns?.filter((breakdown) => {
          const breakdownKey = getAprBreakdownKey(breakdown)
          if (breakdownKeys.has(breakdownKey)) {
            return false
          }
          breakdownKeys.add(breakdownKey)
          return true
        }) || []

      existingOpportunity.campaigns = [
        ...(existingOpportunity.campaigns || []),
        ...additionalCampaigns,
      ]
      existingOpportunity.aprRecord = {
        ...existingOpportunity.aprRecord,
        breakdowns: [...existingBreakdowns, ...additionalBreakdowns],
      }
    }

    return [...mergedOpportunities.values()]
  }

  private describeRequestError(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error)
    }

    const fetchLikeError = error as Error & {
      status?: number
    }

    const details = [
      fetchLikeError.status
        ? `status ${fetchLikeError.status}`
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
        const aggregatedOpportunities: MerklOpportunity[] = []

        for (let page = 0; ; page += 1) {
          const searchParams = new URLSearchParams(
            Object.entries({
              ...params,
              items: MERKL_PAGE_SIZE,
              page,
            }).map(([k, v]) => [k, String(v)]),
          )
          const requestUrl = `${apiUrl}/v4/opportunities?${searchParams}`
          const response = this.requestInit
            ? await fetch(requestUrl, this.requestInit)
            : await fetch(requestUrl)

          if (!response.ok) {
            const httpError = Object.assign(
              new Error(`HTTP error fetching Merkl opportunities`),
              { status: response.status },
            )
            throw httpError
          }

          const data = (await response.json()) as MerklOpportunitiesResponse
          const pageOpportunities = this.normalizeOpportunities(data)
          aggregatedOpportunities.push(...pageOpportunities)

          if (pageOpportunities.length < MERKL_PAGE_SIZE) {
            return aggregatedOpportunities
          }
        }
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

  async getYearnVaultRewardOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const opportunityResults = await Promise.all(
        YEARN_VAULT_REWARD_OPPORTUNITY_TYPES.map(async (type) => {
          try {
            const params = {
              status: 'LIVE',
              chainId: config.katanaChainId,
              type,
              campaigns: true,
            }

            return await this.fetchOpportunities(params)
          } catch (error) {
            console.error(`Error fetching ${type} opportunities:`, error)
            return []
          }
        }),
      )

      const filteredOpportunities = this.filterCampaigns(
        opportunityResults.flat(),
      )
      const mergedOpportunities = this.mergeOpportunities(filteredOpportunities)

      for (const opportunity of mergedOpportunities) {
        const vaultAddress = extractAddressFromIdentifier(
          opportunity.identifier,
        )
        if (!vaultAddress) {
          continue
        }

        logVaultAprDebug({
          stage: 'opportunity_fetch',
          vaultAddress,
          poolType: 'yearn',
          opportunityType: YEARN_VAULT_REWARD_OPPORTUNITY_TYPES.join(','),
          opportunityIdentifier: opportunity.identifier,
          opportunitiesTotal: mergedOpportunities.length,
          campaignsTotal: opportunity.campaigns?.length || 0,
          reason: 'merkl_opportunity_loaded',
        })
      }

      return mergedOpportunities
    } catch (error) {
      console.error('Error fetching Yearn vault reward opportunities:', error)
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
