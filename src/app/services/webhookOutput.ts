import type { KongBatchWebhook, Output } from '../types/webhook'
import type { YearnVaultExtra } from '../types/yearn'
import { DataCacheService } from './dataCache'

const LABEL = 'katana-estimated-apr'

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
      const componentOutputs = COMPONENTS.map((component) => ({
        chainId,
        address,
        label: LABEL,
        component,
        value: extra[component] ?? 0,
        blockNumber,
        blockTime,
      }))

      const netAPR =
        (extra.katanaAppRewardsAPR ?? 0) +
        (extra.FixedRateKatanaRewards ?? 0) +
        (extra.katanaNativeYield ?? 0)

      const netAPY = extra.katanaBonusAPY ?? 0

      componentOutputs.push(
        { chainId, address, label: LABEL, component: 'netAPR', value: netAPR, blockNumber, blockTime },
        { chainId, address, label: LABEL, component: 'netAPY', value: netAPY, blockNumber, blockTime },
      )

      return componentOutputs
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
