# Kong Integration Guide For Katana Strategy Rewards

## Purpose

This guide is for the Kong implementer who needs to carry the new strategy-level KAT reward data from `katana-apr-service` into Kong.

The goal is to preserve the existing vault-level estimated APR flow while also exposing per-strategy KAT reward APR for Katana Yearn v3 vault compositions.

## Current Status

What already exists in this repo:

- `GET /api/vaults` now includes per-strategy fields on Morpho and Steer strategies:
  - `strategyRewardsAPR`
  - `rewardToken`
  - `underlyingContract`
- `POST /api/webhook` now returns:
  - the existing five vault-level components on the vault address
  - strategy-addressed `katRewardsAPR` rows for strategies with `strategyRewardsAPR`
- Top-level vault fields in `apr.extra` remain unchanged.

What this means for Kong:

- Kong already ingests the existing vault-level webhook outputs from `https://katana-apr.yearn.fi/api/webhook`.
- Kong can now receive strategy-addressed outputs from this service as long as the deployed webhook includes the latest changes.

## Verified Kong Flow

The following paths were verified in `../kong`.

### 1. Subscription

Kong subscribes to the Katana APR webhook here:

- [subscriptions.yaml](/home/ross/code/yearn/kong/config/subscriptions.yaml)

Relevant entry:

- `id: S_KATANA_APR`
- `url: https://katana-apr.yearn.fi/api/webhook`
- `abiPath: yearn/3/vault`
- `labels: ['katana-estimated-apr']`
- `filter.chainIds: [747474]`

### 2. What Kong POSTs to the webhook

Kong’s webhook extractor sends this payload shape:

- [webhook.ts](/home/ross/code/yearn/kong/packages/ingest/extract/webhook.ts)

Schema:

```ts
{
  abiPath: string
  chainId: number
  blockNumber: bigint
  blockTime: bigint
  subscription: WebhookSubscription
  vaults: string[]
}
```

The extractor signs the request with `Kong-Signature`.

### 3. What Kong accepts back

Kong expects an array of `OutputSchema` rows:

- [types.ts](/home/ross/code/yearn/kong/packages/lib/types.ts)

Shape:

```ts
{
  chainId: number
  address: `0x${string}`
  label: string
  component: string | null
  value: number | null
  blockNumber: bigint
  blockTime: bigint
}
```

Important constraint:

- The webhook extractor rejects outputs whose `label` is not included in the subscription’s `labels`.
- With the current subscription, only `katana-estimated-apr` is accepted.

This is enforced in:

- [webhook.ts](/home/ross/code/yearn/kong/packages/ingest/extract/webhook.ts)

### 4. Where Kong stores the outputs

Kong stores each output row in the `output` table keyed by:

- `chain_id`
- `address`
- `label`
- `component`
- `block_time`

### 5. How vault estimated APR is loaded today

The v3 vault snapshot hook reads estimated APR from the `output` table here:

- [hook.ts](/home/ross/code/yearn/kong/packages/ingest/abis/yearn/3/vault/snapshot/hook.ts)
- [apy-apr.ts](/home/ross/code/yearn/kong/packages/ingest/helpers/apy-apr.ts)

It calls:

```ts
getLatestEstimatedAprV3(chainId, address)
```

That helper:

- selects the latest output rows for the vault address where `label LIKE '%-estimated-apr'`
- builds a schemaless `components` object
- returns:

```ts
{
  type: label,
  apr?: number,
  apy?: number,
  components: Record<string, number | null>
}
```

For the current Katana vault-level webhook rows, this lands in:

- `snapshot.performance.estimated`

### 6. Strategy hydration already exists in Kong REST snapshots

This is the key detail.

Kong’s REST vault snapshot layer already has logic to hydrate strategy-level estimated APR from the `output` table:

- [db.ts](/home/ross/code/yearn/kong/packages/web/app/api/rest/snapshot/db.ts)

It does this in `hydrateStrategyEstimatedApr(...)`.

What it currently does:

- gets the vault snapshot
- extracts strategy addresses from `snapshot.composition`
- resolves the vault’s estimated APR label
- queries `output` rows for both:
  - the vault address
  - any strategy address in that composition
- maps APR-like components onto:
  - `composition[i].performance.estimated.apr`
  - `composition[i].performance.estimated.apy`

Important constraint:

- This REST hydrator reuses the vault label.
- It does not independently look up a separate strategy label.

That means strategy-addressed webhook outputs can already show up in Kong vault snapshots if:

1. they are written to the `output` table
2. they use the same label family as the vault, currently `katana-estimated-apr`

## Recommended Integration Path

### Recommendation

Use strategy-addressed webhook outputs, but keep the existing label:

- `label: 'katana-estimated-apr'`
- `address: <strategy address>`

Do not introduce a separate `katana-strategy-estimated-apr` label unless you also plan to change Kong.

Why this is the best path:

- no subscription change required
- no webhook extractor change required
- no REST vault snapshot hydration change required
- strategy data can already be attached to `snapshot.composition[*].performance.estimated`

### What changed in `katana-apr-service`

The webhook now extends:

- [route.ts](/home/ross/code/yearn/katana-apr-service/src/app/api/webhook/route.ts)

It keeps the current vault-level outputs unchanged.

It additionally emits strategy-level rows for strategies where `strategyRewardsAPR` is present:

- `chainId`: webhook payload chain id
- `address`: `strategy.address`
- `label`: the incoming subscription label, currently `katana-estimated-apr`
- `component`: an APR-like name such as `katRewardsAPR`
- `value`: `strategy.strategyRewardsAPR`
- `blockNumber`
- `blockTime`

Example response rows:

```json
[
  {
    "chainId": 747474,
    "address": "0x80c34BD3A3569E126e7055831036aa7b212cB159",
    "label": "katana-estimated-apr",
    "component": "katanaAppRewardsAPR",
    "value": 0.0052,
    "blockNumber": "123",
    "blockTime": "456"
  },
  {
    "chainId": 747474,
    "address": "0x78EC25FBa1bAf6b7dc097Ebb8115A390A2a4Ee12",
    "label": "katana-estimated-apr",
    "component": "katRewardsAPR",
    "value": 0.0028,
    "blockNumber": "123",
    "blockTime": "456"
  }
]
```

## What this gives you in Kong without Kong code changes

If the webhook emits strategy-addressed rows using `katana-estimated-apr`, Kong’s existing REST vault snapshot path should already be able to hydrate:

- `vault.performance.estimated` from vault-addressed rows
- `vault.composition[*].performance.estimated` from strategy-addressed rows

This is the lowest-friction integration.

## When Kong Code Changes Are Still Needed

### Case 1. You want a separate strategy label

If you want strategy rows to use a different label such as:

- `katana-strategy-estimated-apr`

then Kong needs changes in at least these places:

1. [subscriptions.yaml](/home/ross/code/yearn/kong/config/subscriptions.yaml)
   Add the new label to `S_KATANA_APR.labels`.
2. [webhook.ts](/home/ross/code/yearn/kong/packages/ingest/extract/webhook.ts)
   The extractor currently rejects labels not present in the subscription.
3. [db.ts](/home/ross/code/yearn/kong/packages/web/app/api/rest/snapshot/db.ts)
   `resolveEstimatedAprLabel()` and `fetchLatestEstimatedAprRows()` currently assume one vault label.

### Case 2. You want strategy estimated APR in the strategy snapshot itself

The v3 strategy snapshot hook currently does not load estimated APR:

- [hook.ts](/home/ross/code/yearn/kong/packages/ingest/abis/yearn/3/strategy/snapshot/hook.ts)

It only returns:

- `asset`
- `meta`
- `lastReportDetail`

If Kong consumers need strategy estimated APR on the dedicated strategy snapshot object, add a small change there:

1. import `getLatestEstimatedAprV3`
2. query the strategy address
3. attach a `performance.estimated` object to the returned strategy snapshot

This is optional if the consumer only needs strategy estimated APR through vault composition snapshots.

## Important Semantics For The Kong Integrator

### 1. Vault and strategy rewards are not the same metric

The top-level vault field:

- `katanaAppRewardsAPR`

is still the existing vault-level value.

The strategy field:

- `strategyRewardsAPR`

is the raw KAT reward APR for that strategy.

Those numbers are not expected to match or sum 1:1.

### 2. Why strategy rows matter

Morpho and Steer strategies can receive:

- KAT rewards
- non-KAT incentives

The non-KAT incentives are strategy-local and intended to be auto-compounded inside the strategy.
The KAT rewards are not auto-compounded there and need to be forwarded on to depositors.

That is why the strategy-level KAT APR is useful to expose independently in Kong.

### 3. Component naming caveat in Kong REST hydration

Kong’s current REST hydration logic only detects whether a component looks like an APR or APY metric.
It does not preserve rich component names when mapping strategy rows into `composition[*].performance.estimated`.

So if you emit:

- `katRewardsAPR`

the hydrator will effectively use it as:

- `performance.estimated.apr`

If the downstream consumer needs the exact component name preserved on strategies, Kong will need a follow-up change.

## Suggested Rollout Plan

1. Deploy the APR service with the webhook changes.
2. Trigger Kong ingestion for Katana vaults.
3. Verify strategy-addressed rows land in `output`.
4. Verify the Kong REST vault snapshot includes strategy-level `performance.estimated` under `composition`.
5. Only add Kong ingest changes if the consumer also needs dedicated strategy snapshot support or separate labels.

## Validation Checklist

### In `katana-apr-service`

- `POST /api/webhook` still returns the existing five vault-level components.
- The same response now includes strategy-addressed rows for strategies with `strategyRewardsAPR`.
- Strategy rows use:
  - the strategy address
  - the same `katana-estimated-apr` label
  - `component = 'katRewardsAPR'`

### In Kong

- `output` contains rows for:
  - vault addresses with `label = 'katana-estimated-apr'`
  - strategy addresses with `label = 'katana-estimated-apr'`
- `packages/web/app/api/rest/snapshot` returns strategy estimated APR under:
  - `snapshot.composition[*].performance.estimated`

## Summary

The cleanest verified path is:

- keep `S_KATANA_APR` as-is
- extend `katana-apr-service /api/webhook` to emit extra strategy-addressed rows
- reuse the existing `katana-estimated-apr` label

That should let Kong ingest the strategy reward APRs and expose them in REST vault composition snapshots without any Kong code change.

If Kong also needs first-class strategy snapshot support or a separate label namespace, then small Kong changes are required.
