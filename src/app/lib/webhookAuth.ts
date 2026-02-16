import { createHmac, timingSafeEqual } from 'node:crypto'

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
