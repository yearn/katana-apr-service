import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

import { DataCacheService } from '../../services/dataCache'
import type { YearnVaultExtra } from '../../types/yearn'

export const dynamic = 'force-dynamic'

const COMPONENTS: (keyof YearnVaultExtra)[] = [
  'katanaAppRewardsAPR',
  'fixedRateKatanaRewards',
  'katanaBonusAPY',
  'katanaNativeYield',
  'steerPointsPerDollar',
]

interface KongOutput {
  chainId: number
  address: string
  label: string
  component: string
  value: number
  blockNumber: bigint
  blockTime: bigint
}

interface ParsedWebhookBody {
  addresses: string[]
  chainId: number
  blockNumber: bigint
  blockTime: bigint
  label: string
}

function verifyWebhookSignature(
  signatureHeader: string,
  body: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  try {
    const elements = signatureHeader.split(',')
    const timestampElement = elements.find((el) => el.startsWith('t='))
    const signatureElement = elements.find((el) => el.startsWith('v1='))

    if (!timestampElement || !signatureElement) return false

    const timestamp = parseInt(timestampElement.split('=')[1])
    const receivedSignature = signatureElement.split('=')[1]

    const currentTime = Math.floor(Date.now() / 1000)
    if (Math.abs(currentTime - timestamp) > toleranceSeconds) return false

    const expectedSignature = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex')

    return timingSafeEqual(
      new Uint8Array(Buffer.from(receivedSignature, 'hex')),
      new Uint8Array(Buffer.from(expectedSignature, 'hex')),
    )
  } catch {
    return false
  }
}

function parseWebhookBody(rawBody: string): ParsedWebhookBody {
  const body = JSON.parse(rawBody)
  const { vaults, chainId, blockNumber, blockTime, subscription } = body
  return {
    addresses: vaults as string[],
    chainId: Number(chainId),
    blockNumber: BigInt(blockNumber),
    blockTime: BigInt(blockTime),
    label: subscription?.labels?.[0] ?? '',
  }
}

function jsonResponseWithBigInt(data: unknown): Response {
  const replacer = (_: string, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v
  return new Response(JSON.stringify(data, replacer), {
    headers: { 'Content-Type': 'application/json' },
  })
}


const dataCacheService = new DataCacheService()

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.KONG_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 500 })
  }

  const signature = req.headers.get('kong-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  const rawBody = await req.text()

  if (!verifyWebhookSignature(signature, rawBody, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
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

      const netAPR = vault.apr?.netAPR ?? 0
      const profitUnlockPeriods = 365 / 7
      const netAPY = (1 + netAPR / profitUnlockPeriods) ** profitUnlockPeriods - 1

      outputs.push({ ...base, component: 'netAPR', value: netAPR })
      outputs.push({ ...base, component: 'netAPY', value: netAPY })
    }

    return jsonResponseWithBigInt(outputs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Webhook error: ${message}`, { error })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
