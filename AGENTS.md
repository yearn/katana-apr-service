# Repository Guidelines

## Project Structure & Module Organization

- `src/app`: Next.js App Router entry.
  - `api/*/route.ts`: HTTP endpoints (e.g., `src/app/api/vaults/route.ts`).
  - `services/`: APR calculation, external API, and on-chain helpers (e.g., `dataCache.ts`, `aprCalcs/*`).
  - `config/`: Runtime configuration and chain setup.
  - `types/`: Shared TypeScript types and contract ABIs.
- `public/`: Static assets.
- Root configs: `eslint.config.mjs`, `next.config.ts`, `tsconfig.json`, `.env.example`.

## Build, Test, and Development Commands

- `npm run dev`: Start local dev server with Turbopack.
- `npm run build`: Create production build.
- `npm start`: Run the production server locally.
- `npm run lint`: Lint the codebase using ESLint.
Examples:
- Run the health check: `curl http://localhost:3000/api/health`
- Fetch APR data: `curl http://localhost:3000/api/vaults`

## Coding Style & Naming Conventions

- Language: TypeScript + React (Next.js App Router).
- Linting: ESLint (`next/core-web-vitals`, `next/typescript`, `@typescript-eslint`). Fix warnings before PR.
- Naming: PascalCase for classes, camelCase for functions/vars, file names in `services/` use lowerCamelCase (e.g., `dataCache.ts`).
- Modules: Prefer named exports; keep files focused and small.
- API routes follow Next.js convention: `src/app/api/<name>/route.ts` with `GET`, `OPTIONS`, etc.

## Testing Guidelines

- No formal test runner is configured. Validate endpoints via `curl` or API clients.
- Add targeted unit tests if introducing complex logic; colocate under the feature directory or propose a test setup in your PR.
- Ensure `npm run lint` and `npm run build` pass before pushing.

## Commit & Pull Request Guidelines

- Commit style: conventional prefixes observed in history (`feat:`, `fix:`, `chore:`). Use imperative mood and concise scope.
- Branch naming: short, descriptive; optional type prefix (e.g., `feat--quick-apys-page`).
- PRs must include: clear description, rationale, screenshots for UI changes, reproduction steps for bug fixes, and linked issues.
- Checklist: updated docs if needed, no secrets committed, `.env.example` updated when adding new env vars, lint/build passing.

## Security & Configuration Tips

- Copy `.env.example` to `.env` and set `RPC_URL_KATANA`, `YDAEMON_BASE_URI`, `MERKL_BASE_URI` as needed. Never commit real secrets.
- Review `src/app/config` for chain IDs and endpoints before deploying.
