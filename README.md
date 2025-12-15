# Katana APR Service

This is a Next.js app that provides APR and points data for Yearn vaults on Katana via API endpoints. It is designed for serverless deployment (e.g., Vercel).

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

Useful response headers:

- `X-Cache`: `HIT` / `MISS` / `EXPIRED` / `REFRESH` / `STALE` / `ERROR`
- `X-Generated-At`: when the APR snapshot was generated
- `X-Cache-TTL-Seconds`: in-process TTL used by the serverless function

To force a refresh (requires `APR_SERVICE_REFRESH_TOKEN`):

```bash
curl -i -H "x-refresh-token: $APR_SERVICE_REFRESH_TOKEN" "http://localhost:3000/api/vaults?refresh=1"
```

Response body:

```json
{
  "0x...": { "...": "..." }
}
```

---

This project uses [Next.js](https://nextjs.org) and is ready for deployment on [Vercel](https://vercel.com/).
