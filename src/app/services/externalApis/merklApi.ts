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
}
