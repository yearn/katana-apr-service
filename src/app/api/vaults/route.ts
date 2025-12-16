import { NextResponse } from 'next/server'
import { DataCacheService } from '../../services/dataCache'

const dataCacheService = new DataCacheService()
export const dynamic = 'force-dynamic'

function getCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function getCacheControlHeaderValue(): string {
  // Vercel edge caching: cache at the CDN, not in the client.
  // - max-age=0: browsers should not cache
  // - s-maxage: CDN cache TTL
  // - stale-while-revalidate: serve stale while refreshing in the background
  return 'public, max-age=0, s-maxage=900, stale-while-revalidate=600'
}

export async function GET(): Promise<NextResponse> {
  const headers: Record<string, string> = {
    ...getCORSHeaders(),
    'Cache-Control': getCacheControlHeaderValue(),
  }
  try {
    const data = await dataCacheService.generateVaultAPRData()
    return NextResponse.json(data, { status: 200, headers })
  } catch (error) {
    const err = error as Error
    const errorHeaders: Record<string, string> = {
      ...getCORSHeaders(),
      'Cache-Control': 'no-store',
    }
    return NextResponse.json(
      {
        message: 'An error occurred while fetching data.',
        error: err.message,
      },
      { status: 502, headers: errorHeaders }
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
