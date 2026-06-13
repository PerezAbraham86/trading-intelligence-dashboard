import { NextRequest, NextResponse } from 'next/server'
import { labelNeuralBrainSnapshot } from '@/lib/neuralBrainMemory'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const id = String(payload?.id || '').trim()

    if (!id) {
      return NextResponse.json(
        {
          eventType: 'NEURAL_BRAIN_MEMORY_OUTCOME',
          status: 'Error',
          error: 'Missing snapshot id',
          createdAt: new Date().toISOString(),
        },
        { status: 400 },
      )
    }

    return NextResponse.json(labelNeuralBrainSnapshot(id, payload || {}))
  } catch (error) {
    return NextResponse.json(
      {
        eventType: 'NEURAL_BRAIN_MEMORY_OUTCOME',
        status: 'Error',
        error: error instanceof Error ? error.message : 'Unknown Neural Brain outcome error',
        createdAt: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
