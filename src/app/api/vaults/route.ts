import { NextResponse } from 'next/server'
import { DataCacheService } from '../../services/dataCache'

const dataCacheService = new DataCacheService()
let cachedData: unknown = null

export async function GET(): Promise<ReturnType<typeof NextResponse.json>> {
  try {
    if (!cachedData) {
      cachedData = await dataCacheService.generateVaultAPRData()
    }
    return NextResponse.json(cachedData)
  } catch (error) {
    const err = error as Error
    return NextResponse.json(
      {
        message: 'An error occurred while fetching data.',
        error: err.message,
      },
      { status: 500 }
    )
  }
}
