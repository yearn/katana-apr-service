import type { NextConfig } from "next";

// Runtime config sourced from 1Password and injected at `vercel build` time
// (see .github/workflows/deploy.yml). Listed vars are inlined into the build
// output so nothing has to live in Vercel's env store. All are referenced
// server-side only, so they never reach the client bundle.
const INLINED_ENV = [
  "RPC_URL_KATANA",
  "KONG_WEBHOOK_SECRET",
  "COINGECKO_API_KEY",
  "KONG_BASE_URI",
  "YDAEMON_BASE_URI",
  "MERKL_BASE_URI",
  "COINGECKO_BASE_URI",
  "COINGECKO_KATANA_COIN_ID",
  // ponytail: present in 1Password but not yet read by any code, so these are
  // no-ops until something references the matching process.env.* key.
  "KATANA_APR_SERVICE_API",
  "MERKL_API_KEY",
] as const;

// Only inline vars that are actually set, so code-level `|| default` fallbacks
// still apply when a var is absent (e.g. local dev).
const env = Object.fromEntries(
  INLINED_ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])),
);

const nextConfig: NextConfig = {
  env,
};

export default nextConfig;
