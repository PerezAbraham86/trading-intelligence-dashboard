import { NextRequest, NextResponse } from 'next/server'
import {
  getNeuralBrainMemoryStatus,
  getRecentNeuralBrainSnapshots,
  saveNeuralBrainSnapshot,
} from '@/lib/neuralBrainMemory'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const result = saveNeuralBrainSnapshot(payload || {})
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        eventType: 'NEURAL_BRAIN_MEMORY_SAVE',
        status: 'Error',
        error: error instanceof Error ? error.message : 'Unknown Neural Brain memory error',
        createdAt: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = Number(searchParams.get('limit') || '100')
  const symbol = searchParams.get('symbol') || undefined
  const timeframe = searchParams.get('timeframe') || undefined

  return NextResponse.json({
    ...getRecentNeuralBrainSnapshots({ limit, symbol, timeframe }),
    summary: getNeuralBrainMemoryStatus(),
  })
}
