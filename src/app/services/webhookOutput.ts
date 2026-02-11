import type { KongBatchWebhook, Output } from '../types/webhook'
import { OutputSchema } from '../types/webhook'
import { DataCacheService } from './dataCache'

const LABEL = 'katana-apr'

const COMPONENTS = [
  'katanaAppRewardsAPR',
  'FixedRateKatanaRewards',
  'katanaBonusAPY',
  'katanaNativeYield',
  'steerPointsPerDollar',
] as const

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
      const outputs: Output[] = []

      for (const component of COMPONENTS) {
        const value = extra[component] ?? 0
        outputs.push(
          OutputSchema.parse({
            chainId,
            address,
            label: LABEL,
            component,
            value,
            blockNumber,
            blockTime,
          }),
        )
      }

      return outputs
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
