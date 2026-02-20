import { NextRequest, NextResponse } from 'next/server'
import { DataCacheService } from '../../services/dataCache'
import {
  verifyWebhookSignature,
  parseWebhookBody,
  jsonResponseWithBigInt,
  type KongOutput,
} from '../../lib/webhookAuth'
import type { YearnVaultExtra } from '../../types/yearn'

export const dynamic = 'force-dynamic'

const COMPONENTS: (keyof YearnVaultExtra)[] = [
  'katanaAppRewardsAPR',
  'FixedRateKatanaRewards',
  'katanaBonusAPY',
  'katanaNativeYield',
  'steerPointsPerDollar',
]

const dataCacheService = new DataCacheService()

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.KONG_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 500 })
  }

  const signature = req.headers.get('kong-signature')
  if (!signature) {
    return new Response('Missing signature', { status: 401 })
  }

  const rawBody = await req.text()

  if (!verifyWebhookSignature(signature, rawBody, secret)) {
    return new Response('Invalid signature', { status: 401 })
  }

  try {
    const { addresses, chainId, blockNumber, blockTime, label } = parseWebhookBody(rawBody)
    if (addresses.length === 0) {
      return jsonResponseWithBigInt([])
    }

    const vaultsMap = await dataCacheService.generateVaultAPRData()
    const outputs: KongOutput[] = []

    for (const address of addresses) {
      const vault = vaultsMap[address] || vaultsMap[address.toLowerCase()]
      if (!vault) continue

      const extra = vault.apr?.extra || {}
      const base = { chainId, address, label, blockNumber, blockTime }

      for (const component of COMPONENTS) {
        outputs.push({ ...base, component, value: extra[component] ?? 0 })
      }

      const netAPR =
        (extra.katanaAppRewardsAPR ?? 0) +
        (extra.FixedRateKatanaRewards ?? 0) +
        (extra.katanaNativeYield ?? 0)

      outputs.push({ ...base, component: 'netAPR', value: netAPR })
      outputs.push({ ...base, component: 'netAPY', value: extra.katanaBonusAPY ?? 0 })
    }

    return jsonResponseWithBigInt(outputs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Webhook error: ${message}`, { error })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
