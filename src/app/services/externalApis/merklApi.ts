import axios from 'axios'
import { config } from '../../config'
import type { MerklOpportunity } from '../../types'

export class MerklApiService {
  private apiUrl: string

  constructor() {
    this.apiUrl = config.merklApiUrl
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

      return opportunities
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

      return opportunities
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

      return opportunities
    } catch (error) {
      console.error('Error fetching Yearn opportunities:', error)
      return []
    }
  }

  /**
   * Fetches ERC20 Log Processor opportunities from the Merkl API.
   *
   * Sends a GET request to the `/v4/opportunities/campaigns` endpoint with the specified parameters:
   * - `status`: 'LIVE'
   * - `chainId`: from configuration
   * - `type`: 'ERC20LOGPROCESSOR'
   *
   * Handles responses that may either be a direct array of `MerklOpportunity` objects or an object containing an `opportunities` array.
   * In case of an error, logs the error and returns an empty array.
   *
   * @returns {Promise<MerklOpportunity[]>} A promise that resolves to an array of `MerklOpportunity` objects.
   */
  async getErc20LogProcessorOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const url: string = `${this.apiUrl}/v4/opportunities/campaigns`
      const params = {
        status: 'LIVE',
        chainId: config.katanaChainId,
        type: 'ERC20LOGPROCESSOR',
      }

      const response = await axios.get<
        MerklOpportunity[] | { opportunities: MerklOpportunity[] }
      >(url, { params })

      // The response is an array directly
      const opportunities: MerklOpportunity[] = Array.isArray(response.data)
        ? response.data
        : response.data.opportunities || []

      return opportunities
    } catch (error) {
      console.error('Error fetching ERC20 Log Processor opportunities:', error)
      return []
    }
  }

  /**
   * Fetches ERC20 fixed APR opportunities from the Merkl API.
   *
   * This method sends a GET request to the `/v4/opportunities/campaigns` endpoint,
   * filtering for opportunities with status 'LIVE', the configured chain ID, and type 'ERC20_FIX_APR'.
   * The response may be either an array of `MerklOpportunity` objects or an object containing an `opportunities` array.
   * In case of an error, an empty array is returned and the error is logged to the console.
   *
   * @returns {Promise<MerklOpportunity[]>} A promise that resolves to an array of `MerklOpportunity` objects.
   */
  async getErc20FixAprOpportunities(): Promise<MerklOpportunity[]> {
    try {
      const url: string = `${this.apiUrl}/v4/opportunities/campaigns`
      const params = {
        status: 'LIVE',
        chainId: config.katanaChainId,
        type: 'ERC20_FIX_APR',
      }

      const response = await axios.get<
        MerklOpportunity[] | { opportunities: MerklOpportunity[] }
      >(url, { params })

      // The response is an array directly
      const opportunities: MerklOpportunity[] = Array.isArray(response.data)
        ? response.data
        : response.data.opportunities || []

      return opportunities
    } catch (error) {
      console.error('Error fetching ERC20 Log Processor opportunities:', error)
      return []
    }
  }
}
