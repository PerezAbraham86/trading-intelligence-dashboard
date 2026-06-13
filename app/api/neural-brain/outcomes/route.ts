import { NextRequest, NextResponse } from 'next/server'
import { getRecentNeuralBrainSnapshots, labelNeuralBrainSnapshot } from '@/lib/neuralBrainMemory'
import { learnOnlineFromSnapshot } from '@/lib/neuralBrainOnline'

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

    const outcome = labelNeuralBrainSnapshot(id, payload || {})
    let onlineLearning: ReturnType<typeof learnOnlineFromSnapshot> | null = null

    if (outcome.updated) {
      const recent = getRecentNeuralBrainSnapshots({ limit: 5000 })
      const snapshot = recent.snapshots.find((item) => item.id === id)

      if (snapshot?.outcome) {
        onlineLearning = learnOnlineFromSnapshot(snapshot)
      }
    }

    return NextResponse.json({
      ...outcome,
      phase: 'phase3_river_style_online_updates',
      onlineLearning,
    })
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
