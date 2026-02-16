import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyWebhookSignature } from '../../lib/webhookAuth'
import { computeKatanaAPR } from '../../services/webhookOutput'
import { KongBatchWebhookSchema, OutputSchema } from '../../types/webhook'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  // ── Auth gate ──────────────────────────────────────────────────────
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
    const body = JSON.parse(rawBody)
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
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Webhook error: ${message}`, { error: err })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
