# Vault APR Debugging

This workflow helps diagnose why a vault returns fallback data (`apr: 0`, `breakdown: []`) by tracing each decision stage in the APR pipeline.

## Debug Env Flags

Set these flags before running the API locally:

```bash
APR_DEBUG_ENABLED=true
APR_DEBUG_VAULT_ADDRESS=0x93Fec6639717b6215A48E5a72a162C50DCC40d68 # optional
APR_DEBUG_SAMPLE_LIMIT=50 # optional, applies when no vault filter is set
```

- `APR_DEBUG_ENABLED`: turns structured APR debug logs on.
- `APR_DEBUG_VAULT_ADDRESS`: optional filter for one vault.
- `APR_DEBUG_SAMPLE_LIMIT`: optional cap for unique vaults logged in one run.

## Test Commands

```bash
bun run test:run -- src/app/services/aprCalcs/debugLogger.test.ts
bun run test:run -- src/app/services/aprCalcs/utils.test.ts
bun run test:run -- src/app/services/dataCache.test.ts
bun run test:run -- src/app/api/vaults/route.test.ts
```

## Live Smoke Command

Inspect a single vault:

```bash
bun run test:vault-debug:live -- --vault 0x93Fec6639717b6215A48E5a72a162C50DCC40d68
```

Inspect multiple vaults:

```bash
bun run test:vault-debug:live -- --all --limit 100
```

## Reason Codes

- `NO_OPPORTUNITY`: no Merkl opportunity matched the vault address.
- `NO_CAMPAIGNS`: opportunity exists but campaign list is empty.
- `NO_APR_BREAKDOWN_MATCH`: campaigns exist, but no campaign ID matched `aprRecord.breakdowns`.
- `TOKEN_FILTERED_OUT`: APR breakdown exists, but reward token is not in the allowlist.
- `APR_CALCULATED`: at least one campaign passed breakdown + token filters.

## Debug Stages in Service Logs

- `vault_fetch`
- `opportunity_fetch`
- `opportunity_lookup`
- `campaign_scan`
- `campaign_apr_match`
- `token_filter`
- `result_summary`
- `fallback`
