# Katana APR Service

This is a Next.js app that provides APR and points data for Yearn vaults on Katana via API endpoints. It is designed for serverless deployment (e.g., Vercel).

## Start Here

For a full explanation of how this service queries Kong and Merkl, how values are filtered, and why vault rewards may resolve to zero, read:

- [`docs/api-integration-guide.md`](./docs/api-integration-guide.md)

The service requires the server-only `YEARN_PRICES_API_KEY` to resolve Katana
spot prices. `YEARN_PRICES_BASE_URL` is optional and defaults to
`https://prices.yearn.dev`. Keep the API key in the server environment; it is
used for authenticated requests to the Yearn Price Service. Configure both
values in Doppler `katana-apr-service` / `prd` and `preview`; the existing
Vercel syncs deliver them to the server runtime. Do not add the key to
`next.config.ts` under `env`.

## Getting Started

Start the development server:

```bash
npm run dev
# or yarn dev / pnpm dev / bun dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the landing page and available API routes.

### API Endpoints

- **GET `/api/vaults`** — Returns the latest APR data for supported vaults.
- **GET `/api/health`** — Health check endpoint.

All API routes are defined in `src/app/api/`.

#### Example Usage

```bash
curl -i http://localhost:3000/api/vaults
```

Caching:

Responses from `GET /api/vaults` are cacheable at the edge/CDN via `Cache-Control` (`s-maxage` + `stale-while-revalidate`). You can inspect cache behavior using standard headers like `Age` (and Vercel headers when deployed).

Response body:

```json
{
  "0x...": { "...": "..." }
}
```

### Error Monitoring (Sentry)

Server-side errors and exceptions are reported to Sentry (errors only, no tracing). Reporting is a no-op until `SENTRY_DSN` is set.

Init lives in `src/observability.ts`; it is started from `src/instrumentation.ts` and errors are captured in the API route handlers.

---

This project uses [Next.js](https://nextjs.org) and is ready for deployment on [Vercel](https://vercel.com/).
