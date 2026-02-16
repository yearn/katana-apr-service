import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWebhookSecret, verifyWebhookSignature } from '../../lib/webhookAuth'
import { computeKatanaAPR } from '../../services/webhookOutput'
import { KongBatchWebhookSchema, OutputSchema } from '../../types/webhook'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth gate ──────────────────────────────────────────────────────
  const signature = req.headers.get('kong-signature')
  if (!signature) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
  }

  const bodyText = await req.text()
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
  }

  const subscriptionId = (body as { subscription?: { id?: string } })
    ?.subscription?.id
  const secret = subscriptionId ? getWebhookSecret(subscriptionId) : ''
  if (!secret || !verifyWebhookSignature(signature, bodyText, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
  }

  // ── Process webhook ────────────────────────────────────────────────
  try {
    const hook = KongBatchWebhookSchema.parse(body)
    const outputs = await computeKatanaAPR(hook)
    const validated = OutputSchema.array().parse(outputs)
    const replacer = (_: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v
    return new NextResponse(JSON.stringify(validated, replacer), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid payload', issues: err.issues },
        { status: 400 },
      )
    }
    console.error('katana webhook error', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
