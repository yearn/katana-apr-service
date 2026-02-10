import { config } from '../../config'
import type { VaultAprDebugEvent } from './types'

const sampledVaultAddresses = new Set<string>()

const normalizeAddress = (address: string): string => address.toLowerCase()

const matchesVaultFilter = (vaultAddress?: string): boolean => {
  if (!config.aprDebugVaultAddress) {
    return true
  }

  if (!vaultAddress) {
    return false
  }

  return normalizeAddress(vaultAddress) === config.aprDebugVaultAddress
}

const isWithinSampleLimit = (vaultAddress?: string): boolean => {
  if (!config.aprDebugSampleLimit) {
    return true
  }

  if (!vaultAddress) {
    return false
  }

  const normalizedVaultAddress = normalizeAddress(vaultAddress)
  if (sampledVaultAddresses.has(normalizedVaultAddress)) {
    return true
  }

  if (sampledVaultAddresses.size >= config.aprDebugSampleLimit) {
    return false
  }

  sampledVaultAddresses.add(normalizedVaultAddress)
  return true
}

export const shouldLogVaultAprDebug = (vaultAddress?: string): boolean => {
  if (!config.aprDebugEnabled) {
    return false
  }

  return matchesVaultFilter(vaultAddress) && isWithinSampleLimit(vaultAddress)
}

const shortenAddress = (address?: string): string => {
  if (!address) {
    return 'unknown'
  }

  if (address.length <= 12) {
    return address
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

const formatCampaignId = (campaignId?: string): string =>
  campaignId ? campaignId : 'unknown-campaign'

const formatVaultLabel = (event: VaultAprDebugEvent): string => {
  const shortAddress = shortenAddress(event.vaultAddress)
  return event.vaultName
    ? `${event.vaultName} (${shortAddress})`
    : shortAddress
}

const formatDebugEvent = (event: VaultAprDebugEvent): string | null => {
  const vaultLabel = formatVaultLabel(event)

  switch (event.stage) {
    case 'vault_fetch':
      return `👀 Vault fetched: ${vaultLabel}${
        event.vaultSymbol ? ` [${event.vaultSymbol}]` : ''
      } (total vaults: ${event.totalVaults ?? '?'})`
    case 'blacklist_filter':
      return `⛔ Blacklist removed ${event.blacklistedCampaigns ?? 0} campaign(s) for ${vaultLabel}. APR-linked removals: ${
        event.blacklistedAprBreakdownCampaignIds?.length ?? 0
      }`
    case 'opportunity_fetch':
      return `📦 Opportunity loaded for ${vaultLabel}: ${
        event.opportunityType ?? event.poolType ?? 'unknown'
      } with ${event.campaignsTotal ?? 0} campaign(s)`
    case 'opportunity_lookup':
      if (event.reason === 'opportunity_found') {
        return `🎯 Opportunity found for ${vaultLabel} (${event.poolType ?? 'unknown'}): ${shortenAddress(
          event.opportunityIdentifier
        )}`
      }
      return `🔍 No opportunity found for ${vaultLabel} (${event.poolType ?? 'unknown'})`
    case 'campaign_scan':
      return `🧮 Scanning ${event.campaignsTotal ?? 0} campaign(s) and ${
        event.aprBreakdownsTotal ?? 0
      } APR breakdown(s) for ${vaultLabel}`
    case 'campaign_apr_match':
      if (!event.aprBreakdownMatched) {
        return null
      }
      return `📊 Campaign ${formatCampaignId(
        event.campaignId
      )} has APR breakdown${typeof event.aprValue === 'number' ? ` (${event.aprValue.toFixed(4)}%)` : ''}`
    case 'token_filter':
      return `   ${
        event.tokenMatched ? '✅' : '❌'
      } Token ${event.rewardTokenSymbol ?? 'unknown'} (${shortenAddress(
        event.rewardTokenAddress
      )}) ${event.tokenMatched ? 'accepted' : 'filtered'}`
    case 'result_summary':
      if (event.reason === 'apr_calculated') {
        return `📋 Summary for ${vaultLabel}: ${
          event.acceptedCampaigns ?? 0
        } campaign(s) contributed APR`
      }
      if (event.reason === 'no_matching_campaigns_after_filters') {
        return `📋 Summary for ${vaultLabel}: campaigns exist but none matched APR + token filters`
      }
      if (event.reason === 'vault_results_aggregated') {
        return `✅ Vault aggregated for ${vaultLabel} with ${
          event.acceptedCampaigns ?? 0
        } result entry(ies)`
      }
      if (event.reason === 'opportunity_missing') {
        return `📋 Summary for ${vaultLabel}: no matching opportunity`
      }
      if (event.reason === 'opportunity_has_no_campaigns') {
        return `📋 Summary for ${vaultLabel}: opportunity has no campaigns`
      }
      return `📋 Summary for ${vaultLabel}: ${event.reason ?? 'completed'}`
    case 'fallback':
      return `⚠️ Fallback used for ${vaultLabel}: ${event.reason ?? 'unknown_reason'}`
    default:
      return `${event.stage}: ${event.reason ?? 'event'}`
  }
}

export const logVaultAprDebug = (event: VaultAprDebugEvent): void => {
  if (!shouldLogVaultAprDebug(event.vaultAddress)) {
    return
  }

  const message = formatDebugEvent(event)
  if (!message) {
    return
  }

  console.log(`[apr-debug] ${message}`)
}

export const resetVaultAprDebugStateForTests = (): void => {
  sampledVaultAddresses.clear()
}
