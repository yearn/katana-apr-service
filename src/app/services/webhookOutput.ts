import type { KongBatchWebhook, Output } from '../types/webhook'
import type { YearnVaultExtra } from '../types/yearn'
import { DataCacheService } from './dataCache'

const LABEL = 'katana-apr'

const COMPONENTS: (keyof YearnVaultExtra)[] = [
  'katanaAppRewardsAPR',
  'FixedRateKatanaRewards',
  'katanaBonusAPY',
  'katanaNativeYield',
  'steerPointsPerDollar',
]

const dataCacheService = new DataCacheService()

export async function computeKatanaAPR(
  hook: KongBatchWebhook,
): Promise<Output[]> {
  const { chainId, vaults: addresses, blockNumber, blockTime } = hook
  if (addresses.length === 0) return []

  const cache = await dataCacheService.generateVaultAPRData()

  const results = await Promise.allSettled(
    addresses.map(async (address) => {
      const vault = cache[address] || cache[address.toLowerCase()]
      if (!vault) return []

      const extra = vault.apr?.extra || {}
      return COMPONENTS.map((component) => ({
        chainId,
        address,
        label: LABEL,
        component,
        value: extra[component] ?? 0,
        blockNumber,
        blockTime,
      }))
    }),
  )

  const outputs: Output[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      outputs.push(...result.value)
    } else {
      console.error('Error processing vault in batch:', result.reason)
    }
  }

  return outputs
}
