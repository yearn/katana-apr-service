import { NextResponse } from 'next/server'
import { DataCacheService } from '../../services/dataCache'

const dataCacheService = new DataCacheService()
let cachedData: unknown = null

function getCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function GET(): Promise<NextResponse> {
  const headers = getCORSHeaders()
  try {
    if (!cachedData) {
      cachedData = await dataCacheService.generateVaultAPRData()
    }
    return NextResponse.json(cachedData, { headers })
  } catch (error) {
    const err = error as Error
    return NextResponse.json(
      {
        message: 'An error occurred while fetching data.',
        error: err.message,
      },
      { status: 500, headers }
    )
  }
}

// Handle preflight OPTIONS requests
export function OPTIONS(): NextResponse {
  const headers = getCORSHeaders()
  return new NextResponse(null, { status: 204, headers })
}
