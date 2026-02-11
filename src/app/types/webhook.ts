import { z } from 'zod'

export const AddressSchema = z.custom<`0x${string}`>(
  (val) => typeof val === 'string' && /^0x[0-9a-fA-F]{40}$/.test(val),
  'invalid evm address',
)

export const WebhookSubscriptionSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  abiPath: z.string(),
  type: z.enum(['timeseries']),
  labels: z.array(z.string()),
})
export type WebhookSubscription = z.infer<typeof WebhookSubscriptionSchema>

export const KongBatchWebhookSchema = z.object({
  abiPath: z.string(),
  chainId: z.number(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  subscription: WebhookSubscriptionSchema,
  vaults: z.array(AddressSchema),
})
export type KongBatchWebhook = z.infer<typeof KongBatchWebhookSchema>

export const OutputSchema = z.object({
  chainId: z.number(),
  address: AddressSchema,
  label: z.string(),
  component: z.string().nullish(),
  value: z
    .any()
    .transform((val) => {
      const result = z.number().safeParse(val)
      if (result.success && isFinite(result.data)) return result.data
      return undefined
    })
    .nullish(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
})
export type Output = z.infer<typeof OutputSchema>
