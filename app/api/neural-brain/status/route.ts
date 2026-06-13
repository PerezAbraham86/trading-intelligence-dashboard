import { NextResponse } from 'next/server'
import { NEURAL_BRAIN_VERSION } from '@/lib/neuralBrain'
import { getNeuralBrainMemoryStatus } from '@/lib/neuralBrainMemory'
import { getOnlineBrainStatus } from '@/lib/neuralBrainOnline'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    eventType: 'NEURAL_BRAIN_STATUS',
    status: 'Ready',
    engineVersion: NEURAL_BRAIN_VERSION,
    modelType: 'phase3_river_style_online_updates',
    trainedModelReady: getOnlineBrainStatus().onlineReady,
    phase: 'phase3_river_style_online_updates',
    routes: {
      predict: '/api/neural-brain/predict',
      status: '/api/neural-brain/status',
      snapshots: '/api/neural-brain/snapshots',
      outcomes: '/api/neural-brain/outcomes',
      onlineStatus: '/api/neural-brain/online-status',
    },
    memory: getNeuralBrainMemoryStatus(),
    online: getOnlineBrainStatus(),
    scorecards: [
      'buyConfidence',
      'sellConfidence',
      'reversalRisk',
      'targetHitProbability',
      'chopRisk',
      'bestDirection',
      'decision',
      'noTradeWarning',
    ],
    outcomeLabelsPlanned: [
      'targetHit',
      'reversalHappened',
      'chopHappened',
      'candlesToResult',
      'maxDrawdownBeforeTarget',
    ],
    note: 'Phase 3 adds River-style online logistic updates. The learner updates every time a saved Neural Brain snapshot receives an outcome label, then blends predictions once enough online examples are available.',
    createdAt: new Date().toISOString(),
  })
}
