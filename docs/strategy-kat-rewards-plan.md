# Strategy-Level KAT Rewards In `GET /api/vaults`

## Summary

- Reuse the existing `strategies[]` entries in the vault payload; do not add a new endpoint or parallel breakdown object.
- Surface raw strategy APR on each active Morpho/Sushi strategy via `strategyRewardsAPR`, and keep `rewardToken` / `underlyingContract` populated there.
- Keep top-level `apr.extra.katanaAppRewardsAPR` and legacy `katanaRewardsAPR` aligned with the existing live service semantics; this work is only for strategy-level visibility.
- Extend `/api/webhook` to emit strategy-addressed KAT APR rows alongside the existing vault-level component rows so Kong can ingest the same strategy data.

## Key Changes

- Orchestration in `DataCacheService`:
  - Instantiate `MorphoAprCalculator` and `SushiAprCalculator` alongside `YearnAprCalculator`.
  - Include all three result maps in `generateVaultAPRData()` and flatten them into a single per-vault result set.
  - Keep `katanaRewardsAPR` as the legacy alias of the existing vault-level `katanaAppRewardsAPR` value.
- Strategy payload shaping:
  - Populate `strategies[].strategyRewardsAPR` as the raw strategy APR in decimal form (`apr / 100`), not the weighted vault contribution.
  - Populate `strategies[].rewardToken` and `strategies[].underlyingContract` from the matched Morpho/Sushi result.
  - For active Morpho/Sushi strategies with no pool mapping or no Merkl opportunity, emit `strategyRewardsAPR: 0`; keep token/pool metadata undefined if it cannot be resolved.
  - Leave unrelated strategies untouched.
- Vault-level rollup:
  - Keep `apr.extra.katanaAppRewardsAPR` and `katanaRewardsAPR` unchanged from the existing Yearn vault-level calculation path.
  - Do not roll strategy APRs into the vault-level `apr.extra` fields in this change.
- Calculator and matching behavior:
  - Keep the existing Morpho/Sushi calculators; they already produce per-strategy APR candidates keyed by strategy address.
  - Update the strategy aggregation path so it does not rely on a single `find()` match for strategy decoration when complete strategy coverage is required.
  - Adjust `calculateStrategyAPR()` to return an explicit zero-result placeholder even when the pool lookup is missing, so eligible strategies still surface in the response.
  - Keep the current per-protocol wrapped-KAT address logic unless upstream campaigns change; no token-price conversion is needed for this feature because these calculators already return APR, not raw reward amounts.
- Public API / docs:
  - No new public endpoint.
  - The public contract change is: `YearnStrategy.strategyRewardsAPR` becomes populated for active Morpho/Sushi strategies.
  - Top-level `katanaAppRewardsAPR`/`katanaRewardsAPR` should remain consistent with the existing live response.
  - `POST /api/webhook` should keep the existing five vault-level components and add strategy-addressed `katRewardsAPR` rows using the incoming estimated-APR label.
  - Update the API guide to document the difference between raw per-strategy APR and the unchanged vault-level reward fields.

## Test Plan

- Extend `dataCache` tests to cover:
  - A vault with Yearn + Morpho + Sushi results where raw strategy APRs are exposed on strategies while top-level app rewards APR remains unchanged.
  - Zero-result Morpho/Sushi strategies still appearing with `strategyRewardsAPR: 0`.
  - Legacy alias `katanaRewardsAPR` remaining aligned with `katanaAppRewardsAPR`.
- Add calculator tests for:
  - Missing pool mapping returning a zero strategy result instead of disappearing.
  - Missing opportunity returning zero APR with stable strategy output.
- Keep route tests focused on `GET /api/vaults`:
  - Verify the serialized response includes populated `strategyRewardsAPR` on strategies.
  - Verify top-level `katanaAppRewardsAPR` remains consistent with the pre-existing vault-level reward semantics.
- Extend webhook tests to cover:
  - existing vault-level components remaining unchanged
  - strategy-addressed `katRewardsAPR` rows being emitted for strategies with `strategyRewardsAPR`

## Assumptions

- `GET /api/vaults` remains the richer debugging surface, while `/api/webhook` only needs numeric strategy APR rows for Kong.
- `strategyRewardsAPR` is additive strategy metadata only; this change does not alter top-level `apr.extra` values.
- Morpho and Sushi strategy detection continues to rely on the current `strategy.name` matching rules (`Morpho` and `Steer`).
