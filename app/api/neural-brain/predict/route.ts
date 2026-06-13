import { NextRequest, NextResponse } from 'next/server'
import { buildNeuralBrainScorecard, NeuralBrainInput } from '@/lib/neuralBrain'
import { saveNeuralBrainSnapshot } from '@/lib/neuralBrainMemory'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as NeuralBrainInput
    const scorecard = buildNeuralBrainScorecard(payload || {})

    const memory = saveNeuralBrainSnapshot({
      ...scorecard,
      buyConfidence: scorecard.buyConfidence,
      sellConfidence: scorecard.sellConfidence,
      targetHitProbability: scorecard.targetHitProbability,
      reversalRisk: scorecard.reversalRisk,
      chopRisk: scorecard.chopRisk,
      bestDirection: scorecard.bestDirection,
      decision: scorecard.decision,
      decisionStrength: Math.abs(scorecard.buyConfidence - scorecard.sellConfidence),
      riskStatus: scorecard.noTradeWarning ? 'Risk Watch' : 'Aligned',
      scorecardInputs: {
        inputs: scorecard.inputs,
        explain: scorecard.explain,
        request: payload || {},
      },
      source: 'neural_brain_predict_route',
      timestamp: scorecard.createdAt,
    })

    return NextResponse.json({
      ...scorecard,
      memory,
    })
  } catch (error) {
    return NextResponse.json(
      {
        eventType: 'NEURAL_BRAIN_SCORECARD',
        status: 'Error',
        error: error instanceof Error ? error.message : 'Unknown Neural Brain error',
        createdAt: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    eventType: 'NEURAL_BRAIN_SCORECARD',
    status: 'Ready',
    route: '/api/neural-brain/predict',
    method: 'POST',
    phase: 'phase2_snapshot_memory',
    note: 'Send candles, scorecards, mlFeatures, overlayPayload/chartOverlays, unifiedIntelligence, and externalData to receive Neural Brain probabilities. Each prediction is saved as a Neural Brain memory snapshot.',
    memoryRoutes: {
      snapshots: '/api/neural-brain/snapshots',
      outcomes: '/api/neural-brain/outcomes',
      status: '/api/neural-brain/status',
    },
    createdAt: new Date().toISOString(),
  })
}
