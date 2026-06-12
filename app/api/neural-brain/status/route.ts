import { NextResponse } from 'next/server'
import { NEURAL_BRAIN_VERSION } from '@/lib/neuralBrain'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    eventType: 'NEURAL_BRAIN_STATUS',
    status: 'Ready',
    engineVersion: NEURAL_BRAIN_VERSION,
    modelType: 'phase1_weighted_neural_scorecard',
    trainedModelReady: false,
    routes: {
      predict: '/api/neural-brain/predict',
      status: '/api/neural-brain/status',
    },
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
    note: 'Phase 1 is an observer/scorer. It does not control entries, exits, or ghost candles yet.',
    createdAt: new Date().toISOString(),
  })
}
