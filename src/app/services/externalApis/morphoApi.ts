import { config } from '../../config'
import { isKatanaRewardTokenAddress } from '../katanaRewardTokens'

export interface MorphoVaultAprEstimate {
  baseAPY: number
  rewardsAPR: number
}

type MorphoReward = {
  supplyApr?: number | string | null
  asset?: {
    address?: string | null
    symbol?: string | null
  } | null
}

type MorphoVaultV1 = {
  address?: string | null
  state?: {
    apy?: number | string | null
    allRewards?: MorphoReward[] | null
  } | null
}

type MorphoVaultV2 = {
  address?: string | null
  avgNetApyExcludingRewards?: number | string | null
  rewards?: MorphoReward[] | null
}

type MorphoGraphQlResponse = {
  data?: {
    vaults?: {
      items?: MorphoVaultV1[] | null
    } | null
    vaultV2s?: {
      items?: MorphoVaultV2[] | null
    } | null
  } | null
  errors?: unknown[]
}

const MORPHO_VAULT_APR_QUERY = `
  query KatanaMorphoVaultAprs($chainIds: [Int!], $addresses: [String!], $first: Int!) {
    vaults(first: $first, where: { chainId_in: $chainIds, address_in: $addresses }) {
      items {
        address
        state {
          apy
          allRewards {
            supplyApr
            asset {
              address
              symbol
            }
          }
        }
      }
    }
    vaultV2s(first: $first, where: { chainId_in: $chainIds, address_in: $addresses }) {
      items {
        address
        avgNetApyExcludingRewards
        rewards {
          supplyApr
          asset {
            address
            symbol
          }
        }
      }
    }
  }
`

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const sumNonKatRewardsAPR = (rewards?: MorphoReward[] | null): number =>
  (rewards || []).reduce((sum, reward) => {
    if (isKatanaRewardTokenAddress(reward.asset?.address || undefined)) {
      return sum
    }

    return sum + toFiniteNumber(reward.supplyApr)
  }, 0)

export class MorphoApiService {
  private apiUri: string

  constructor(apiUri: string = config.morphoApiUri) {
    this.apiUri = apiUri
  }

  async getVaultAprEstimates(
    addresses: string[],
    chainId: number = config.katanaChainId,
  ): Promise<Record<string, MorphoVaultAprEstimate>> {
    const normalizedAddresses = Array.from(
      new Set(
        addresses
          .map((address) => address.toLowerCase())
          .filter((address) => address.length > 0),
      ),
    )

    if (normalizedAddresses.length === 0) {
      return {}
    }

    try {
      const response = await fetch(this.apiUri, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: MORPHO_VAULT_APR_QUERY,
          variables: {
            chainIds: [chainId],
            addresses: normalizedAddresses,
            first: normalizedAddresses.length,
          },
        }),
      })

      if (!response.ok) {
        throw Object.assign(new Error('HTTP error fetching Morpho vault APRs'), {
          status: response.status,
        })
      }

      const payload = (await response.json()) as MorphoGraphQlResponse
      if (payload.errors?.length && !payload.data) {
        console.error('Morpho API returned errors:', payload.errors)
        return {}
      }

      return this.normalizeVaultAprEstimates(payload)
    } catch (error) {
      console.error('Error fetching Morpho vault APRs:', error)
      return {}
    }
  }

  private normalizeVaultAprEstimates(
    payload: MorphoGraphQlResponse,
  ): Record<string, MorphoVaultAprEstimate> {
    const estimates: Record<string, MorphoVaultAprEstimate> = {}

    for (const vault of payload.data?.vaults?.items || []) {
      if (!vault.address) {
        continue
      }

      estimates[vault.address.toLowerCase()] = {
        baseAPY: toFiniteNumber(vault.state?.apy),
        rewardsAPR: sumNonKatRewardsAPR(vault.state?.allRewards),
      }
    }

    for (const vault of payload.data?.vaultV2s?.items || []) {
      if (!vault.address) {
        continue
      }

      estimates[vault.address.toLowerCase()] = {
        baseAPY: toFiniteNumber(vault.avgNetApyExcludingRewards),
        rewardsAPR: sumNonKatRewardsAPR(vault.rewards),
      }
    }

    return estimates
  }
}
