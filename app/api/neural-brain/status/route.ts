import { NextResponse } from 'next/server'
import { NEURAL_BRAIN_VERSION } from '@/lib/neuralBrain'
import { getNeuralBrainMemoryStatus } from '@/lib/neuralBrainMemory'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    eventType: 'NEURAL_BRAIN_STATUS',
    status: 'Ready',
    engineVersion: NEURAL_BRAIN_VERSION,
    modelType: 'phase1_weighted_neural_scorecard',
    trainedModelReady: false,
    phase: 'phase2_snapshot_memory',
    routes: {
      predict: '/api/neural-brain/predict',
      status: '/api/neural-brain/status',
      snapshots: '/api/neural-brain/snapshots',
      outcomes: '/api/neural-brain/outcomes',
    },
    memory: getNeuralBrainMemoryStatus(),
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
    note: 'Phase 2 saves Neural Brain snapshots for later outcome labeling and MLP/PyTorch training.',
    createdAt: new Date().toISOString(),
  })
}
