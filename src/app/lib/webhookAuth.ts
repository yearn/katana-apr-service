import { createHmac, timingSafeEqual } from 'node:crypto'

export interface KongOutput {
  chainId: number
  address: string
  label: string
  component: string
  value: number
  blockNumber: bigint
  blockTime: bigint
}

export interface ParsedWebhookBody {
  addresses: string[]
  chainId: number
  blockNumber: bigint
  blockTime: bigint
  label: string
}

export function verifyWebhookSignature(
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

export function parseWebhookBody(rawBody: string): ParsedWebhookBody {
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

export function jsonResponseWithBigInt(data: unknown): Response {
  const replacer = (_: string, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v
  return new Response(JSON.stringify(data, replacer), {
    headers: { 'Content-Type': 'application/json' },
  })
}
