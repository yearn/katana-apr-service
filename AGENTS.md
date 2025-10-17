# Repository Guidelines

## Project Structure & Module Organization

Core application code lives in `src/app`, using the Next.js App Router. API handlers sit under `src/app/api`, while shared DTOs and helper types reside in `src/app/types`. Business logic is grouped by concern within `src/app/services` (`aprCalcs`, `pointsCalcs`, `externalApis`, caching utilities), so keep new computations alongside their peers. Configuration helpers stay in `src/app/config`, and example payloads for the marketing surface belong in `src/app/quick-apys`. Static assets (favicons, images) should be added to `public`, not embedded in source files.

## Build, Test, and Development Commands

Install dependencies with `bun install` (the lockfile tracks Bun). Use `bun run dev` for the Turbopack-powered local server, and visit `http://localhost:3000` for the landing page and API explorer. Run `bun run build` to produce the production bundle, `bun run start` to serve it locally, `bun run lint` to apply Next.js + TypeScript ESLint rules, and `bun run test` for watch mode unit tests. Prefer `bun run test:run` in CI or when you need a deterministic, single-pass run.

## Coding Style & Naming Conventions

This codebase favors concise, typed modules: new files should be TypeScript-first and export explicit types. Follow the existing two-space indentation and trailing comma style you see in `src/app/page.tsx`. Components and hooks use `PascalCase` and `camelCase` respectively; computed constants should be `UPPER_SNAKE_CASE` only when shared across modules. Allow ESLint to guide edge cases (`next/typescript`, `@typescript-eslint/recommended`); run `bun run lint` before sending reviews to catch boundary warnings (`no-explicit-any`, `explicit-module-boundary-types`).

## Testing Guidelines

Vitest powers unit coverage. Co-locate tests with their subjects using the `*.test.ts` suffix (see `src/app/services/pointsCalcs/steerPointsCalculator.test.ts` for the pattern). Structure suites with `describe` blocks that mirror the module surface, and prefer arranging fixtures with lightweight helpers over hard-coded constants. Run `bun run test` during development and ensure `bun run test:run` passes before opening a pull request; include focused assertions for every branch that manipulates APR or points math.

## Commit & Pull Request Guidelines

Commit history uses short, lowercase prefixes (`fix:`, `chore:`, `test/build:`). Follow that convention and write imperative summaries that explain the change, not the outcome. Each pull request should: describe the user-facing impact, reference relevant issues or incident tickets, list testing performed (commands and results), and attach screenshots or sample responses when API output changes. Request review from a maintainer in `@yearn`; keep PRs focused on a single feature or bug to speed review.
