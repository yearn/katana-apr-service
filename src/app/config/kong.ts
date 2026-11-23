const KONG_API_URL = 'https://kong.yearn.farm/api/rest'

// Worker-origin requests to the legacy .fi endpoint can self-redirect.
// Normalize the known API alias too: deployments may still inline it at build time.
export function resolveKongApiUrl(value?: string): string {
  const baseUrl = value?.trim().replace(/\/+$/, '') || KONG_API_URL
  return baseUrl === 'https://kong.yearn.fi/api/rest' ? KONG_API_URL : baseUrl
}
