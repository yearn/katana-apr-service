import { getAddress, isAddress, isAddressEqual } from 'viem'
import { config } from '../../config'
import { KATANA_REWARD_TOKEN_ADDRESSES } from '../katanaRewardTokens'

export const MORPHO_REWARD_TOKEN_ADDRESS =
  '0x1e5eFCA3D0dB2c6d5C67a4491845c43253eB9e4e'

interface MorphoReward {
  asset?: {
    address?: string | null
    symbol?: string | null
  } | null
  supplyApr?: number | null
}

interface MorphoVaultV1 {
  address?: string | null
  name?: string | null
  symbol?: string | null
  state?: {
    apy?: number | null
    netApy?: number | null
    allRewards?: MorphoReward[] | null
  } | null
}

interface MorphoVaultV2 {
  address?: string | null
  name?: string | null
  symbol?: string | null
  avgNetApy?: number | null
  avgNetApyExcludingRewards?: number | null
  rewards?: MorphoReward[] | null
}

interface MorphoVaultsResponse {
  data?: {
    vaults?: {
      items?: MorphoVaultV1[]
    }
    vaultV2s?: {
      items?: MorphoVaultV2[]
    }
  }
  errors?: Array<{
    message?: string
  }>
}

export interface MorphoVaultEstimate {
  address: string
  name: string
  symbol: string
  baseApy: number
  totalApy: number
  morphoRewardsApr: number
  katRewardsApr: number
}

const VAULT_ESTIMATES_QUERY = `
  query KatanaVaultEstimates($chainIds: [Int!], $addresses: [String!]) {
    vaults(first: 100, where: { chainId_in: $chainIds, address_in: $addresses }) {
      items {
        address
        name
        symbol
        state {
          apy
          netApy
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
    vaultV2s(first: 100, where: { chainId_in: $chainIds, address_in: $addresses }) {
      items {
        address
        name
        symbol
        avgNetApy
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

const toFiniteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const normalizeAddress = (address?: string | null): string | undefined => {
  if (!address || !isAddress(address)) {
    return undefined
  }
  return getAddress(address).toLowerCase()
}

const isRewardToken = (reward: MorphoReward, addresses: string[]): boolean => {
  const rewardAddress = reward.asset?.address
  if (!rewardAddress || !isAddress(rewardAddress)) {
    return false
  }

  return addresses.some((address) =>
    isAddressEqual(rewardAddress as `0x${string}`, address as `0x${string}`),
  )
}

const sumRewardsApr = (
  rewards: MorphoReward[] | null | undefined,
  addresses: string[],
): number => {
  if (!Array.isArray(rewards)) {
    return 0
  }

  return rewards.reduce(
    (sum, reward) =>
      isRewardToken(reward, addresses)
        ? sum + toFiniteNumber(reward.supplyApr)
        : sum,
    0,
  )
}

const normalizeV1Vault = (
  vault: MorphoVaultV1,
): MorphoVaultEstimate | undefined => {
  const address = normalizeAddress(vault.address)
  if (!address) {
    return undefined
  }

  const rewards = vault.state?.allRewards
  const morphoRewardsApr = sumRewardsApr(rewards, [MORPHO_REWARD_TOKEN_ADDRESS])
  const katRewardsApr = sumRewardsApr(rewards, [
    ...KATANA_REWARD_TOKEN_ADDRESSES,
  ])
  const baseApy = toFiniteNumber(vault.state?.apy)

  return {
    address,
    name: vault.name || '',
    symbol: vault.symbol || '',
    baseApy,
    totalApy: baseApy + aprToApy(morphoRewardsApr),
    morphoRewardsApr,
    katRewardsApr,
  }
}

const normalizeV2Vault = (
  vault: MorphoVaultV2,
): MorphoVaultEstimate | undefined => {
  const address = normalizeAddress(vault.address)
  if (!address) {
    return undefined
  }

  const rewards = vault.rewards
  const morphoRewardsApr = sumRewardsApr(rewards, [MORPHO_REWARD_TOKEN_ADDRESS])
  const katRewardsApr = sumRewardsApr(rewards, [
    ...KATANA_REWARD_TOKEN_ADDRESSES,
  ])
  const baseApy = toFiniteNumber(vault.avgNetApyExcludingRewards)

  return {
    address,
    name: vault.name || '',
    symbol: vault.symbol || '',
    baseApy,
    totalApy: baseApy + aprToApy(morphoRewardsApr),
    morphoRewardsApr,
    katRewardsApr,
  }
}

export const aprToApy = (apr: number): number => {
  const result = (1 + apr / 52) ** 52 - 1
  return Number.isFinite(result) ? result : 0
}

export const apyToApr = (apy: number): number => {
  const result = 52 * ((1 + apy) ** (1 / 52) - 1)
  return Number.isFinite(result) ? result : 0
}

export class MorphoApiService {
  constructor(private apiUrl: string = config.morphoApiUrl) {}

  async getVaultEstimates(
    addresses: string[],
  ): Promise<Record<string, MorphoVaultEstimate>> {
    const normalizedAddresses = addresses
      .map((address) => normalizeAddress(address))
      .filter((address): address is string => !!address)

    if (normalizedAddresses.length === 0) {
      return {}
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: VAULT_ESTIMATES_QUERY,
          variables: {
            chainIds: [config.katanaChainId],
            addresses: Array.from(new Set(normalizedAddresses)),
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`Morpho API returned HTTP ${response.status}`)
      }

      const data = (await response.json()) as MorphoVaultsResponse
      if (data.errors?.length) {
        throw new Error(
          data.errors.map((error) => error.message || 'unknown').join('; '),
        )
      }

      const estimates = [
        ...(data.data?.vaults?.items || []).map(normalizeV1Vault),
        ...(data.data?.vaultV2s?.items || []).map(normalizeV2Vault),
      ].filter(
        (estimate): estimate is MorphoVaultEstimate => estimate !== undefined,
      )

      return Object.fromEntries(
        estimates.map((estimate) => [estimate.address, estimate]),
      )
    } catch (error) {
      console.error('Error fetching Morpho vault estimates:', error)
      return {}
    }
  }
}
