import type { NextConfig } from "next";

// Doppler syncs app variables to Vercel for remote builds and server runtime.
// Retain the existing build-time overrides below. The Price Service API key
// is read at runtime and must not be added to Next.js's public env config.
const INLINED_ENV = [
  "RPC_URL_KATANA",
  "KONG_WEBHOOK_SECRET",
  "COINGECKO_API_KEY",
  "KONG_BASE_URI",
  "MERKL_BASE_URI",
  "COINGECKO_BASE_URI",
  "COINGECKO_KATANA_COIN_ID",
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
