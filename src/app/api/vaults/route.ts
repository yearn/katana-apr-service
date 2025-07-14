import { NextResponse } from 'next/server'
import { DataCacheService } from '../../services/dataCache'

const dataCacheService = new DataCacheService()
let cachedData: unknown = null

const allowedOriginRegex =
  /^https:\/\/yearn-x-katana-[a-zA-Z0-9\-]+-yearn\.vercel\.app$/

function getCORSHeaders(
  origin: string | null
): Record<string, string> | undefined {
  if (origin && allowedOriginRegex.test(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  }
  return undefined
}

export async function GET(request: Request): Promise<NextResponse> {
  const origin = request.headers.get('origin')
  const headers = getCORSHeaders(origin)
  try {
    if (!cachedData) {
      cachedData = await dataCacheService.generateVaultAPRData()
    }
    return NextResponse.json(cachedData, headers ? { headers } : undefined)
  } catch (error) {
    const err = error as Error
    return NextResponse.json(
      {
        message: 'An error occurred while fetching data.',
        error: err.message,
      },
      headers ? { status: 500, headers } : { status: 500 }
    )
  }
}

// Handle preflight OPTIONS requests
export function OPTIONS(request: Request): NextResponse {
  const origin = request.headers.get('origin')
  const headers = getCORSHeaders(origin)
  return new NextResponse(
    null,
    headers ? { status: 204, headers } : { status: 204 }
  )
}
