import { NextRequest, NextResponse } from 'next/server'
import { DataCacheService } from '../services/dataCache'

const dataCacheService = new DataCacheService()
let cachedData: any = null

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { pathname } = new URL(request.url)

    // Health check
    if (pathname.endsWith('/health')) {
      return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
      })
    }

    // Main data route
    if (pathname.endsWith('/vaults') || pathname.endsWith('/vaults/')) {
      try {
        if (!cachedData) {
          cachedData = await dataCacheService.generateVaultAPRData()
        }
        return NextResponse.json(cachedData)
      } catch (error: any) {
        return NextResponse.json(
          {
            message: 'An error occurred while fetching data.',
            error: error.message,
          },
          { status: 500 }
        )
      }
    }

    // Not found
    return new NextResponse('Not Found', { status: 404 })
  } catch (error: any) {
    return NextResponse.json(
      { message: 'An unexpected error occurred.', error: error.message },
      { status: 500 }
    )
  }
}
