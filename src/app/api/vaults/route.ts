import { NextResponse } from 'next/server'
import { DataCacheService, type APRDataCache } from '../../services/dataCache'

const dataCacheService = new DataCacheService()

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CacheState = {
  data: APRDataCache | null
  generatedAtMs: number
  inFlight: Promise<APRDataCache> | null
  lastError: string | null
  lastErrorAtMs: number
}

const cacheState: CacheState = {
  data: null,
  generatedAtMs: 0,
  inFlight: null,
  lastError: null,
  lastErrorAtMs: 0,
}

function getCacheTtlSeconds(): number {
  const raw = process.env.APR_CACHE_TTL_SECONDS
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return 60
  return Math.floor(parsed)
}

function getCacheControlHeaderValue(cacheTtlSeconds: number): string {
  const staleWhileRevalidateSeconds = cacheTtlSeconds * 5
  return `public, max-age=0, s-maxage=${cacheTtlSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`
}

function getCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-refresh-token',
  }
}

async function refreshCache(): Promise<APRDataCache> {
  if (!cacheState.inFlight) {
    cacheState.inFlight = (async () => {
      const data = await dataCacheService.generateVaultAPRData()
      if (Object.keys(data).length === 0) {
        throw new Error('No vault APR data generated')
      }
      cacheState.data = data
      cacheState.generatedAtMs = Date.now()
      cacheState.lastError = null
      cacheState.lastErrorAtMs = 0
      return data
    })()
      .catch((error: unknown) => {
        const err = error as Error
        cacheState.lastError = err.message || 'Unknown error'
        cacheState.lastErrorAtMs = Date.now()
        throw err
      })
      .finally(() => {
        cacheState.inFlight = null
      })
  }

  return cacheState.inFlight
}

export async function GET(request: Request): Promise<NextResponse> {
  const cacheTtlSeconds = getCacheTtlSeconds()
  const nowMs = Date.now()

  const headers: Record<string, string> = {
    ...getCORSHeaders(),
    'Cache-Control': getCacheControlHeaderValue(cacheTtlSeconds),
    'X-Cache-TTL-Seconds': cacheTtlSeconds.toString(),
  }

  const url = new URL(request.url)
  const wantsForceRefresh =
    url.searchParams.get('refresh') === '1' ||
    url.searchParams.get('refresh') === 'true'

  const refreshToken = process.env.APR_SERVICE_REFRESH_TOKEN
  const providedToken = request.headers.get('x-refresh-token')
  const forceRefresh =
    wantsForceRefresh && Boolean(refreshToken) && providedToken === refreshToken

  try {
    const isFresh =
      cacheState.data &&
      nowMs - cacheState.generatedAtMs < cacheTtlSeconds * 1000

    if (!forceRefresh && isFresh) {
      headers['X-Cache'] = 'HIT'
      headers['X-Generated-At'] = new Date(cacheState.generatedAtMs).toISOString()
      return NextResponse.json(cacheState.data, { headers })
    }

    const hadCachedData = Boolean(cacheState.data)
    const wasExpired = hadCachedData && !isFresh
    headers['X-Cache'] = forceRefresh
      ? hadCachedData
        ? 'REFRESH'
        : 'MISS'
      : wasExpired
      ? 'EXPIRED'
      : 'MISS'

    const data = await refreshCache()
    headers['X-Generated-At'] = new Date(cacheState.generatedAtMs).toISOString()
    return NextResponse.json(data, { headers })
  } catch (error) {
    const err = error as Error

    if (cacheState.data) {
      headers['X-Cache'] = 'STALE'
      headers['X-Generated-At'] = new Date(cacheState.generatedAtMs).toISOString()
      headers['X-Cache-Error'] = err.message || 'Unknown error'
      return NextResponse.json(cacheState.data, { headers })
    }

    headers['X-Cache'] = 'ERROR'
    return NextResponse.json(
      {
        message: 'An error occurred while fetching data.',
        error: err.message,
      },
      { status: 502, headers }
    )
  }
}

// Handle preflight OPTIONS requests
export function OPTIONS(): NextResponse {
  const headers: Record<string, string> = {
    ...getCORSHeaders(),
    'Cache-Control': 'public, max-age=0',
  }
  return new NextResponse(null, { status: 204, headers })
}
