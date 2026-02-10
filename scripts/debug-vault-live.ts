import axios from 'axios'
import dotenv from 'dotenv'
import { isAddress } from 'viem'
import { isExcludedCampaignId } from '../src/app/services/externalApis/merklBlacklist'

dotenv.config()

const CHAIN_ID = Number.parseInt(process.env.KATANA_CHAIN_ID ?? '747474', 10)
const YEARN_API_URL = process.env.YDAEMON_BASE_URI || 'https://ydaemon.yearn.fi'
const MERKL_API_URL = process.env.MERKL_BASE_URI || 'https://api.merkl.xyz'

const WRAPPED_KAT_ADDRESSES = [
  '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461',
  '0x3ba1fbC4c3aEA775d335b31fb53778f46FD3a330',
  '0x0161A31702d6CF715aaa912d64c6A190FD0093aa',
].map((address) => address.toLowerCase())

type ClassificationReason =
  | 'NO_OPPORTUNITY'
  | 'NO_CAMPAIGNS'
  | 'NO_APR_BREAKDOWN_MATCH'
  | 'TOKEN_FILTERED_OUT'
  | 'APR_CALCULATED'

interface YearnVault {
  address: string
  symbol: string
  name: string
}

interface MerklCampaign {
  campaignId?: string
  rewardToken: {
    address: string
    symbol: string
  }
}

interface MerklOpportunity {
  identifier: string
  name: string
  campaigns?: MerklCampaign[]
  aprRecord?: {
    breakdowns?: Array<{
      identifier?: string
      value?: number
    }>
  }
}

interface VaultClassification {
  vaultAddress: string
  vaultName: string
  vaultSymbol: string
  reason: ClassificationReason
  opportunityIdentifier?: string
  campaignsTotal?: number
  aprBreakdownsTotal?: number
  matchedCampaigns?: string[]
  filteredCampaigns?: string[]
}

const identifierMatchesAddress = (
  identifier?: string,
  address?: string
): boolean => {
  if (!identifier || !address) {
    return false
  }

  const normalizedIdentifier = identifier.toLowerCase()
  const normalizedAddress = address.toLowerCase()
  return (
    normalizedIdentifier === normalizedAddress ||
    normalizedIdentifier.startsWith(normalizedAddress)
  )
}

const isAllowlistedToken = (address?: string): boolean => {
  if (!address) {
    return false
  }
  return WRAPPED_KAT_ADDRESSES.includes(address.toLowerCase())
}

const classifyVault = (
  vault: YearnVault,
  opportunities: MerklOpportunity[]
): VaultClassification => {
  const opportunity = opportunities.find((opp) =>
    identifierMatchesAddress(opp.identifier, vault.address)
  )

  if (!opportunity) {
    return {
      vaultAddress: vault.address,
      vaultName: vault.name,
      vaultSymbol: vault.symbol,
      reason: 'NO_OPPORTUNITY',
    }
  }

  if (!opportunity.campaigns?.length) {
    return {
      vaultAddress: vault.address,
      vaultName: vault.name,
      vaultSymbol: vault.symbol,
      reason: 'NO_CAMPAIGNS',
      opportunityIdentifier: opportunity.identifier,
      campaignsTotal: 0,
      aprBreakdownsTotal: Array.isArray(opportunity.aprRecord?.breakdowns)
        ? opportunity.aprRecord.breakdowns.length
        : 0,
    }
  }

  const aprBreakdowns = Array.isArray(opportunity.aprRecord?.breakdowns)
    ? opportunity.aprRecord.breakdowns
    : []

  let hasAprBreakdownMatch = false
  let hasAllowlistedCampaign = false
  const matchedCampaigns: string[] = []
  const filteredCampaigns: string[] = []

  for (const campaign of opportunity.campaigns) {
    const campaignId = String(campaign.campaignId || '')
    const aprBreakdown = aprBreakdowns.find(
      (breakdown) =>
        breakdown.identifier &&
        breakdown.identifier.toLowerCase() === campaignId.toLowerCase() &&
        typeof breakdown.value === 'number'
    )

    if (!aprBreakdown) {
      continue
    }

    hasAprBreakdownMatch = true
    if (isAllowlistedToken(campaign.rewardToken.address)) {
      hasAllowlistedCampaign = true
      matchedCampaigns.push(campaignId)
    } else {
      filteredCampaigns.push(campaignId)
    }
  }

  if (!hasAprBreakdownMatch) {
    return {
      vaultAddress: vault.address,
      vaultName: vault.name,
      vaultSymbol: vault.symbol,
      reason: 'NO_APR_BREAKDOWN_MATCH',
      opportunityIdentifier: opportunity.identifier,
      campaignsTotal: opportunity.campaigns.length,
      aprBreakdownsTotal: aprBreakdowns.length,
    }
  }

  if (!hasAllowlistedCampaign) {
    return {
      vaultAddress: vault.address,
      vaultName: vault.name,
      vaultSymbol: vault.symbol,
      reason: 'TOKEN_FILTERED_OUT',
      opportunityIdentifier: opportunity.identifier,
      campaignsTotal: opportunity.campaigns.length,
      aprBreakdownsTotal: aprBreakdowns.length,
      filteredCampaigns,
    }
  }

  return {
    vaultAddress: vault.address,
    vaultName: vault.name,
    vaultSymbol: vault.symbol,
    reason: 'APR_CALCULATED',
    opportunityIdentifier: opportunity.identifier,
    campaignsTotal: opportunity.campaigns.length,
    aprBreakdownsTotal: aprBreakdowns.length,
    matchedCampaigns,
    filteredCampaigns,
  }
}

const printUsage = (): void => {
  console.log(
    [
      'Usage:',
      '  bun scripts/debug-vault-live.ts --vault <0xAddress>',
      '  bun scripts/debug-vault-live.ts --all [--limit 50]',
      '',
      'Examples:',
      '  bun scripts/debug-vault-live.ts --vault 0x93Fec6639717b6215A48E5a72a162C50DCC40d68',
      '  bun scripts/debug-vault-live.ts --all --limit 100',
    ].join('\n')
  )
}

const parseArgs = (): {
  vaultAddress?: string
  inspectAll: boolean
  limit: number
} => {
  const args = process.argv.slice(2)
  let vaultAddress: string | undefined
  let inspectAll = false
  let limit = 25

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--vault') {
      const nextArg = args[i + 1]
      if (!nextArg || nextArg.startsWith('--')) {
        throw new Error('--vault requires a valid 0x address value')
      }
      vaultAddress = nextArg
      i += 1
      continue
    }
    if (arg === '--all') {
      inspectAll = true
      continue
    }
    if (arg === '--limit') {
      const parsedLimit = Number.parseInt(args[i + 1] ?? '', 10)
      if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
        throw new Error('--limit must be a positive integer')
      }
      limit = parsedLimit
      i += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
  }

  if (vaultAddress && !isAddress(vaultAddress)) {
    throw new Error(`Invalid vault address: ${vaultAddress}`)
  }

  if (!vaultAddress && !inspectAll) {
    inspectAll = true
  }

  return { vaultAddress, inspectAll, limit }
}

const fetchYearnVaults = async (): Promise<YearnVault[]> => {
  const params = new URLSearchParams({
    hideAlways: 'true',
    orderBy: 'featuringScore',
    orderDirection: 'desc',
    strategiesDetails: 'withDetails',
    strategiesCondition: 'inQueue',
    chainIDs: CHAIN_ID.toString(),
    limit: '2500',
  })

  const response = await axios.get<YearnVault[]>(
    `${YEARN_API_URL}/vaults/katana?${params}`
  )

  return response.data || []
}

const applyCampaignBlacklist = (
  opportunities: MerklOpportunity[]
): MerklOpportunity[] =>
  opportunities.map((opportunity) => {
    if (!opportunity.campaigns?.length) {
      return opportunity
    }

    const filteredCampaigns = opportunity.campaigns.filter(
      (campaign) => !isExcludedCampaignId(campaign.campaignId)
    )

    if (filteredCampaigns.length === opportunity.campaigns.length) {
      return opportunity
    }

    return {
      ...opportunity,
      campaigns: filteredCampaigns,
    }
  })

const fetchMerklOpportunities = async (): Promise<MerklOpportunity[]> => {
  const response = await axios.get<
    MerklOpportunity[] | { opportunities: MerklOpportunity[] }
  >(`${MERKL_API_URL}/v4/opportunities`, {
    params: {
      status: 'LIVE',
      chainId: CHAIN_ID,
      type: 'ERC20LOGPROCESSOR',
      campaigns: true,
    },
  })

  const opportunities = Array.isArray(response.data)
    ? response.data
    : response.data.opportunities || []

  return applyCampaignBlacklist(opportunities)
}

const buildSummary = (
  classifications: VaultClassification[]
): Record<ClassificationReason, number> => ({
  NO_OPPORTUNITY: classifications.filter((item) => item.reason === 'NO_OPPORTUNITY')
    .length,
  NO_CAMPAIGNS: classifications.filter((item) => item.reason === 'NO_CAMPAIGNS')
    .length,
  NO_APR_BREAKDOWN_MATCH: classifications.filter(
    (item) => item.reason === 'NO_APR_BREAKDOWN_MATCH'
  ).length,
  TOKEN_FILTERED_OUT: classifications.filter(
    (item) => item.reason === 'TOKEN_FILTERED_OUT'
  ).length,
  APR_CALCULATED: classifications.filter((item) => item.reason === 'APR_CALCULATED')
    .length,
})

const main = async (): Promise<void> => {
  const { vaultAddress, inspectAll, limit } = parseArgs()

  const [vaults, opportunities] = await Promise.all([
    fetchYearnVaults(),
    fetchMerklOpportunities(),
  ])

  const selectedVaults = vaultAddress
    ? vaults.filter(
        (vault) => vault.address.toLowerCase() === vaultAddress.toLowerCase()
      )
    : inspectAll
      ? vaults.slice(0, limit)
      : []

  if (selectedVaults.length === 0) {
    console.log(
      JSON.stringify(
        {
          chainId: CHAIN_ID,
          selectedVaults: 0,
          message: vaultAddress
            ? 'No vault matched the provided address in yDaemon response'
            : 'No vaults selected',
        },
        null,
        2
      )
    )
    return
  }

  const classifications = selectedVaults.map((vault) =>
    classifyVault(vault, opportunities)
  )

  console.log(
    JSON.stringify(
      {
        chainId: CHAIN_ID,
        yearnVaultCount: vaults.length,
        merklOpportunityCount: opportunities.length,
        selectedVaults: selectedVaults.length,
        summary: buildSummary(classifications),
        results: classifications,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        message: 'Vault debug run failed',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  )
  process.exit(1)
})
