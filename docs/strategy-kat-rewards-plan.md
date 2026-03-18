# Strategy-Level KAT Rewards In `GET /api/vaults`

## Summary

- Reuse the existing `strategies[]` entries in the vault payload; do not add a new endpoint or parallel breakdown object.
- Surface raw strategy APR on each active Morpho/Sushi strategy via `strategyRewardsAPR`, and keep `rewardToken` / `underlyingContract` populated there.
- Change top-level `apr.extra.katanaAppRewardsAPR` to mean total app rewards across all paths: Yearn vault-level rewards plus weighted Morpho/Sushi strategy contributions.
- Keep `/api/webhook` unchanged for now; this feature only changes the vault response shape.

## Key Changes

- Orchestration in `DataCacheService`:
  - Instantiate `MorphoAprCalculator` and `SushiAprCalculator` alongside `YearnAprCalculator`.
  - Include all three result maps in `generateVaultAPRData()` and flatten them into a single per-vault result set.
  - Keep `katanaRewardsAPR` as the legacy alias of the new total `katanaAppRewardsAPR`, not just the Yearn-vault subset.
- Strategy payload shaping:
  - Populate `strategies[].strategyRewardsAPR` as the raw strategy APR in decimal form (`apr / 100`), not the weighted vault contribution.
  - Populate `strategies[].rewardToken` and `strategies[].underlyingContract` from the matched Morpho/Sushi result.
  - For active Morpho/Sushi strategies with no pool mapping or no Merkl opportunity, emit `strategyRewardsAPR: 0`; keep token/pool metadata undefined if it cannot be resolved.
  - Leave unrelated strategies untouched.
- Vault-level rollup:
  - Compute strategy contribution APR internally as `rawStrategyApr * effectiveWeight`.
  - Use `effectiveWeight = strategy.totalDebt / vault.tvl.totalAssets` when both values are parseable and positive.
  - Fallback to `strategy.details.debtRatio / 10000` when actual debt weighting cannot be computed; clamp weight to `[0, 1]`.
  - Set `apr.extra.katanaAppRewardsAPR = yearnVaultRewards + sum(strategy contributions)`.
- Calculator and matching behavior:
  - Keep the existing Morpho/Sushi calculators; they already produce per-strategy APR candidates keyed by strategy address.
  - Update the strategy aggregation path so it does not rely on a single `find()` match for strategy decoration when complete strategy coverage is required.
  - Adjust `calculateStrategyAPR()` to return an explicit zero-result placeholder even when the pool lookup is missing, so eligible strategies still surface in the response.
  - Keep the current per-protocol wrapped-KAT address logic unless upstream campaigns change; no token-price conversion is needed for this feature because these calculators already return APR, not raw reward amounts.
- Public API / docs:
  - No new public endpoint.
  - The public contract change is: `YearnStrategy.strategyRewardsAPR` becomes populated for active Morpho/Sushi strategies, and top-level `katanaAppRewardsAPR`/`katanaRewardsAPR` becomes the full weighted total.
  - Update the API guide to document the difference between raw per-strategy APR and weighted vault total.

## Test Plan

- Extend `dataCache` tests to cover:
  - A vault with Yearn + Morpho + Sushi results where raw strategy APRs are exposed on strategies and the top-level app rewards APR is the weighted total.
  - Zero-result Morpho/Sushi strategies still appearing with `strategyRewardsAPR: 0`.
  - Legacy alias `katanaRewardsAPR` matching the new total.
- Add calculator tests for:
  - Missing pool mapping returning a zero strategy result instead of disappearing.
  - Missing opportunity returning zero APR with stable strategy output.
- Keep route tests focused on `GET /api/vaults`:
  - Verify the serialized response includes populated `strategyRewardsAPR` on strategies.
  - Verify top-level `katanaAppRewardsAPR` reflects the weighted total, not just the Yearn-vault reward.
- No webhook test changes beyond confirming existing component outputs remain unchanged.

## Assumptions

- Only `GET /api/vaults` needs strategy-level breakdown; `/api/webhook` remains top-level component-only.
- `strategyRewardsAPR` is the raw APR for that strategy, so it will not sum directly to the top-level vault APR; the top-level field is weighted by allocation.
- Actual `totalDebt` weighting is preferred over `debtRatio`, with `debtRatio` only as fallback.
- Morpho and Sushi strategy detection continues to rely on the current `strategy.name` matching rules (`Morpho` and `Steer`).
