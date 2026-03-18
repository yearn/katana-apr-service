# API Integration Guide (Start Here)

This is the primary reference for how this repository collects, filters, and serves APR data.

If you are debugging rewards, adding new vault types, or validating Merkl behavior, start here before reading individual source files.

## What This Service Does

At request time, the service:

1. Fetches Katana vaults from yDaemon.
2. Fetches live `ERC20LOGPROCESSOR` opportunities from Merkl (with campaigns).
3. Filters Merkl campaigns with a local blacklist.
4. Matches each vault to a Merkl opportunity.
5. Keeps only campaigns that:
   - have an APR breakdown entry, and
   - pay allowlisted KAT token addresses.
6. Aggregates APR and appends `apr.extra` fields.
7. Returns vault data from `GET /api/vaults`.

## Code Map

- API routes:
  - `src/app/api/vaults/route.ts`
  - `src/app/api/webhook/route.ts`
  - `src/app/api/health/route.ts`
- Orchestration and aggregation:
  - `src/app/services/dataCache.ts`
- External APIs:
  - `src/app/services/externalApis/yearnApi.ts`
  - `src/app/services/externalApis/merklApi.ts`
  - `src/app/services/externalApis/katanaPriceService.ts`
  - `src/app/services/externalApis/merklBlacklist.ts`
- APR matching logic:
  - `src/app/services/aprCalcs/yearnAprCalculator.ts`
  - `src/app/services/aprCalcs/utils.ts`
- Shared reward-token allowlist:
  - `src/app/services/katanaRewardTokens.ts`
- Points logic:
  - `src/app/services/pointsCalcs/steerPointsCalculator.ts`

## External APIs Queried

### yDaemon (vault universe)

Base URL (default):

- `https://ydaemon.yearn.fi`

Endpoint used by this repo:

- `GET /vaults/katana`

Query params used:

- `hideAlways=true`
- `orderBy=featuringScore`
- `orderDirection=desc`
- `strategiesDetails=withDetails`
- `strategiesCondition=inQueue`
- `chainIDs=747474`
- `limit=2500`

Example:

```bash
curl -sS 'https://ydaemon.yearn.fi/vaults/katana?hideAlways=true&orderBy=featuringScore&orderDirection=desc&strategiesDetails=withDetails&strategiesCondition=inQueue&chainIDs=747474&limit=2500'
```

### Merkl (opportunities and campaigns)

Base URL (default):

- `https://api.merkl.xyz`

Docs:

- HTML docs: `https://api.merkl.xyz/docs#tag/opportunities`
- OpenAPI JSON: `https://api.merkl.xyz/docs/json`

Main endpoint used by this repo:

- `GET /v4/opportunities` (works with or without trailing slash)

Primary params used in app code:

- `status=LIVE`
- `chainId=747474`
- `type=ERC20LOGPROCESSOR`
- `campaigns=true`

Useful documented filters for debugging:

- `identifier=<vaultAddress>`
- `campaignId=<onchainCampaignId>`
- `tags=<tag>`
- `mainProtocolId=<protocolId>`

Examples:

```bash
# Core query used by this service
curl -sS 'https://api.merkl.xyz/v4/opportunities?chainId=747474&type=ERC20LOGPROCESSOR&status=LIVE&campaigns=true'

# Find one opportunity by identifier (vault address)
curl -sS 'https://api.merkl.xyz/v4/opportunities/?chainId=747474&type=ERC20LOGPROCESSOR&status=LIVE&campaigns=true&identifier=0x80c34BD3A3569E126e7055831036aa7b212cB159'

# Find opportunities containing a specific campaign
curl -sS 'https://api.merkl.xyz/v4/opportunities/?chainId=747474&type=ERC20LOGPROCESSOR&status=LIVE&campaigns=true&campaignId=0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d'
```

### KAT price resolution utility

When this repo needs a local KAT token price, it resolves prices in this order:

1. CoinGecko by contract address on asset platform `katana`
2. yDaemon `GET /prices/all`

Notes:

- yDaemon returns `chainId -> tokenAddress -> priceString`.
- The yDaemon price strings use 6 decimals, matching the `yearn.fi` frontend path.
- Wrapped KAT addresses fall back to canonical KAT before returning `0`.

## End-to-End Pipeline

### 1) Vault fetch

`YearnApiService.getVaults()` fetches the Katana vault list from yDaemon.

### 2) Merkl fetch

`MerklApiService.getErc20LogProcessorOpportunities()` fetches Merkl opportunities and campaign payloads.

### 3) Blacklist filter

`MerklApiService.filterCampaigns()` removes campaign IDs in:

- `src/app/services/externalApis/merklBlacklist.ts`

Current excluded IDs:

- `0x487022e5f413f60e3e6aa251712f9c2d6601f01d14b565e779a61b68c173bd6c`
- `0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d`

### 4) Opportunity selection per vault

`calculateYearnVaultRewardsAPR()` uses `findBestOpportunityByAddress()`:

- Match candidates where `identifier == vaultAddress` or starts with `vaultAddress`.
- Prefer exact identifier matches.
- Prefer opportunities with campaigns/APR breakdown data.

This avoids selecting suffix variants like `0x...JUMPER` when a better exact match exists.

### 5) Campaign/APR match

For each campaign in the chosen opportunity:

- Campaign must have a matching APR breakdown:
  - `campaign.campaignId` equals `aprRecord.breakdowns[].identifier`
- Campaign reward token must be allowlisted in `KATANA_REWARD_TOKEN_ADDRESSES`:
  - `0x6E9C1F88a960fE63387eb4b71BC525a9313d8461`
  - `0x3ba1fbC4c3aEA775d335b31fb53778f46FD3a330`
  - `0x0161A31702d6CF715aaa912d64c6A190FD0093aa`

APR units:

- Merkl `breakdown.value` is a percent value (for example `0.56` means `0.56%`).
- Service converts to decimal by dividing by `100` before storing in `apr.extra.katanaAppRewardsAPR`.

### 6) Final vault output shaping

`DataCacheService.aggregateVaultResults()` sets:

- `apr.extra.katanaRewardsAPR` (legacy alias)
- `apr.extra.katanaAppRewardsAPR`
- `apr.extra.fixedRateKatanaRewards` (`0` post-TGE, kept for compatibility)
- `apr.extra.katanaBonusAPY` (`0` post-TGE, kept for compatibility)
- `apr.extra.katanaNativeYield` (`vault.apr.netAPR`)
- `apr.extra.steerPointsPerDollar` (from strategy debt-weighted rates)

## Why a Vault Can Show `katanaAppRewardsAPR = 0`

Most common reasons:

1. No Merkl opportunity matches the vault address.
2. Opportunity exists but has no campaigns.
3. Campaigns exist but none match APR breakdown identifiers.
4. Matching campaigns exist but reward token is not allowlisted.
5. Matching campaign was removed by local blacklist.

Debug tool:

```bash
bun run test:vault-debug:live -- --vault <0xVaultAddress>
```

Related doc:

- `docs/vault-apr-debug.md`

## Live Example Snapshots

These were sampled from live upstream APIs on **March 9, 2026 (America/New_York)** and can change over time.

### 1) yDaemon vault sample (USDC yVault)

Query:

```bash
curl -sS 'https://ydaemon.yearn.fi/vaults/katana?hideAlways=true&orderBy=featuringScore&orderDirection=desc&strategiesDetails=withDetails&strategiesCondition=inQueue&chainIDs=747474&limit=2500'
```

Snippet:

```json
{
  "address": "0x80c34BD3A3569E126e7055831036aa7b212cB159",
  "symbol": "yvvbUSDC",
  "name": "USDC yVault",
  "netAPR": 0.03392437419763983,
  "strategiesCount": 6
}
```

### 2) Merkl by identifier (USDC yVault)

Query:

```bash
curl -sS 'https://api.merkl.xyz/v4/opportunities/?chainId=747474&type=ERC20LOGPROCESSOR&status=LIVE&campaigns=true&identifier=0x80c34BD3A3569E126e7055831036aa7b212cB159'
```

Snippet:

```json
{
  "identifier": "0x80c34BD3A3569E126e7055831036aa7b212cB159",
  "tags": ["yearn"],
  "protocol": "yearn",
  "campaignCount": 197,
  "aprBreakdowns": [
    { "id": "1741685296625366069", "val": 0.2235032230390019 },
    { "id": "3105973045068130992", "val": 0.03591900439958706 },
    { "id": "367677271763782079", "val": 0.3066217926257951 }
  ],
  "apr": 0.5660440200643841
}
```

### 3) Merkl by identifier (Morpho-tagged `0x78EC...`)

Query:

```bash
curl -sS 'https://api.merkl.xyz/v4/opportunities/?chainId=747474&type=ERC20LOGPROCESSOR&status=LIVE&campaigns=true&identifier=0x78EC25FBa1bAf6b7dc097Ebb8115A390A2a4Ee12'
```

Snippet:

```json
{
  "identifier": "0x78EC25FBa1bAf6b7dc097Ebb8115A390A2a4Ee12",
  "name": "Hold ysvbUSDC",
  "tags": ["morpho"],
  "protocol": null,
  "campaignCount": 12,
  "aprBreakdowns": [
    { "id": "5698558020446595008", "val": 0.7495762369774704 }
  ],
  "firstRewardToken": {
    "address": "0x3ba1fbC4c3aEA775d335b31fb53778f46FD3a330",
    "symbol": "KAT"
  },
  "apr": 0.7495762369774704
}
```

### 4) Merkl by campaignId (AUSD blacklisted campaign)

Query:

```bash
curl -sS 'https://api.merkl.xyz/v4/opportunities/?chainId=747474&type=ERC20LOGPROCESSOR&status=LIVE&campaigns=true&campaignId=0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d'
```

Snippet:

```json
{
  "identifier": "0x93Fec6639717b6215A48E5a72a162C50DCC40d68",
  "name": "Deposit AUSD in AUSD yVault",
  "tags": ["sushiswap"],
  "aprBreakdownIds": [
    "0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d"
  ],
  "matchingCampaign": {
    "campaignId": "0xc5a22d022154d5c64ff14b2f4071f134eb83cf159f9f846ad0ba0908a755e86d",
    "rewardToken": {
      "address": "0x6E9C1F88a960fE63387eb4b71BC525a9313d8461",
      "symbol": "KAT"
    },
    "dailyRewards": 577.3809523809524,
    "apr": 22.05570796360016
  }
}
```

### 5) Service output shape (post-TGE computed extras)

From `DataCacheService.generateVaultAPRData()`:

```json
[
  {
    "address": "0x80c34BD3A3569E126e7055831036aa7b212cB159",
    "symbol": "yvvbUSDC",
    "name": "USDC yVault",
    "katanaAppRewardsAPR": 0.005709245156139802,
    "fixedRateKatanaRewards": 0,
    "katanaBonusAPY": 0,
    "katanaNativeYield": 0.03392437419763983,
    "steerPointsPerDollar": 0.1711
  },
  {
    "address": "0x93Fec6639717b6215A48E5a72a162C50DCC40d68",
    "symbol": "AUSD",
    "name": "AUSD yVault",
    "katanaAppRewardsAPR": 0,
    "fixedRateKatanaRewards": 0,
    "katanaBonusAPY": 0,
    "katanaNativeYield": 0.11184248250750017,
    "steerPointsPerDollar": 0.1294
  },
  {
    "address": "0xAa0362eCC584B985056E47812931270b99C91f9d",
    "symbol": "yvvbWBTC",
    "name": "WBTC yVault",
    "katanaAppRewardsAPR": 0,
    "fixedRateKatanaRewards": 0,
    "katanaBonusAPY": 0,
    "katanaNativeYield": 0.0006326777539145123,
    "steerPointsPerDollar": 0
  }
]
```

## Repository API Endpoints

### `GET /api/vaults`

- Regenerates vault APR data on each request.
- Response is keyed by vault address.
- Headers:
  - `Access-Control-Allow-Origin: *`
  - `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=60`

### `POST /api/webhook`

- Verifies `kong-signature` HMAC (`KONG_WEBHOOK_SECRET`).
- Accepts webhook body containing vault addresses.
- Emits one row per requested vault per component:
  - `katanaAppRewardsAPR`
  - `fixedRateKatanaRewards`
  - `katanaBonusAPY`
  - `katanaNativeYield`
  - `steerPointsPerDollar`

### `GET /api/health`

- Returns:

```json
{ "status": "ok", "timestamp": "<iso8601>" }
```

## Quick Troubleshooting Playbook

When a vault looks wrong:

1. Confirm vault exists in yDaemon query output.
2. Query Merkl by `identifier=<vaultAddress>`.
3. Check `aprRecord.breakdowns[].identifier`.
4. Verify matching `campaigns[].campaignId` still exists after blacklist.
5. Verify reward token is in `KATANA_REWARD_TOKEN_ADDRESSES`.
6. If multiple opportunities share an address prefix, ensure exact identifier match is chosen.
7. Run the live debug script:
   - `bun run test:vault-debug:live -- --vault <address>`
