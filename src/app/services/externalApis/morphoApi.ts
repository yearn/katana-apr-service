import { config } from '../../config'

type MorphoReward = {
  asset?: {
    address?: string | null
    symbol?: string | null
  } | null
  supplyApr?: number | string | null
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

type MorphoVaultsResponse = {
  data?: {
    vaults?: {
      items?: MorphoVaultV1[]
    }
    vaultV2s?: {
      items?: MorphoVaultV2[]
    }
  }
  errors?: Array<{ message?: string }>
}

export interface MorphoVaultRewardAPR {
  tokenAddress?: string
  tokenSymbol?: string
  supplyApr: number
}

export interface MorphoVaultEstimate {
  address: string
  baseAPY: number
  rewards: MorphoVaultRewardAPR[]
  version: 'v1' | 'v2'
}

const MORPHO_VAULT_QUERY = `
  query KatanaMorphoVaultEstimates($chainId: Int!, $addresses: [String!], $first: Int!) {
    vaults(first: $first, where: { chainId_in: [$chainId], address_in: $addresses }) {
      items {
        address
        state {
          apy
          allRewards {
            asset {
              address
              symbol
            }
            supplyApr
          }
        }
      }
    }
    vaultV2s(first: $first, where: { chainId_in: [$chainId], address_in: $addresses }) {
      items {
        address
        avgNetApyExcludingRewards
        rewards {
          asset {
            address
            symbol
          }
          supplyApr
        }
      }
    }
  }
`

const toFiniteNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeAddress = (address?: string | null): string | undefined =>
  address?.toLowerCase()

const normalizeRewards = (
  rewards?: MorphoReward[] | null,
): MorphoVaultRewardAPR[] =>
  (rewards || [])
    .map((reward) => ({
      tokenAddress: reward.asset?.address || undefined,
      tokenSymbol: reward.asset?.symbol || undefined,
      supplyApr: toFiniteNumber(reward.supplyApr),
    }))
    .filter((reward) => reward.supplyApr > 0)

export class MorphoApiService {
  private apiUrl: string

  constructor(apiUrl: string = config.morphoApiUrl) {
    this.apiUrl = apiUrl
  }

  async getVaultEstimates(
    addresses: string[],
    chainId: number = config.katanaChainId,
  ): Promise<Record<string, MorphoVaultEstimate>> {
    const uniqueAddresses = Array.from(
      new Set(addresses.map((address) => address.toLowerCase())),
    )

    if (uniqueAddresses.length === 0) {
      return {}
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: MORPHO_VAULT_QUERY,
          variables: {
            chainId,
            addresses: uniqueAddresses,
            first: Math.max(uniqueAddresses.length, 1),
          },
        }),
      })

      if (!response.ok) {
        const body = await response.text()
        throw new Error(
          `HTTP error fetching Morpho estimates: ${response.status}: ${body.slice(0, 500)}`,
        )
      }

      const data = (await response.json()) as MorphoVaultsResponse
      if (data.errors?.length) {
        throw new Error(
          data.errors.map((error) => error.message || 'unknown').join('; '),
        )
      }

      return this.normalizeVaultEstimates(data)
    } catch (error) {
      console.error('Error fetching Morpho vault estimates:', error)
      return {}
    }
  }

  normalizeVaultEstimates(
    response: MorphoVaultsResponse,
  ): Record<string, MorphoVaultEstimate> {
    const estimates: Record<string, MorphoVaultEstimate> = {}

    for (const vault of response.data?.vaults?.items || []) {
      const address = normalizeAddress(vault.address)
      if (!address) {
        continue
      }

      estimates[address] = {
        address,
        baseAPY: toFiniteNumber(vault.state?.apy),
        rewards: normalizeRewards(vault.state?.allRewards),
        version: 'v1',
      }
    }

    for (const vault of response.data?.vaultV2s?.items || []) {
      const address = normalizeAddress(vault.address)
      if (!address) {
        continue
      }

      estimates[address] = {
        address,
        baseAPY: toFiniteNumber(vault.avgNetApyExcludingRewards),
        rewards: normalizeRewards(vault.rewards),
        version: 'v2',
      }
    }

    return estimates
  }
}
