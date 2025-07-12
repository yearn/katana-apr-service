import { NextResponse } from 'next/server'

export async function GET(): Promise<ReturnType<typeof NextResponse.json>> {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
}
