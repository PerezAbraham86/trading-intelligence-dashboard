import { NextRequest, NextResponse } from 'next/server'
import { buildNeuralBrainScorecard, NeuralBrainInput } from '@/lib/neuralBrain'
import { saveNeuralBrainSnapshot } from '@/lib/neuralBrainMemory'
import { applyOnlineBrainPrediction, getOnlineBrainStatus } from '@/lib/neuralBrainOnline'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as NeuralBrainInput
    const baseScorecard = buildNeuralBrainScorecard(payload || {})
    const scorecard = applyOnlineBrainPrediction(baseScorecard)

    const memory = saveNeuralBrainSnapshot({
      ...scorecard,
      buyConfidence: scorecard.buyConfidence,
      sellConfidence: scorecard.sellConfidence,
      targetHitProbability: scorecard.targetHitProbability,
      reversalRisk: scorecard.reversalRisk,
      chopRisk: scorecard.chopRisk,
      bestDirection: scorecard.bestDirection,
      decision: scorecard.decision,
      decisionStrength: scorecard.onlineLearning.blended.decisionStrength,
      riskStatus: scorecard.noTradeWarning ? 'Risk Watch' : 'Aligned',
      scorecardInputs: {
        inputs: scorecard.inputs,
        explain: scorecard.explain,
        onlineLearning: scorecard.onlineLearning,
        request: payload || {},
      },
      source: 'neural_brain_predict_route_phase3_online',
      timestamp: scorecard.createdAt,
    })

    return NextResponse.json({
      ...scorecard,
      memory,
      onlineStatus: getOnlineBrainStatus(),
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
    phase: 'phase3_river_style_online_updates',
    note: 'Send candles, scorecards, mlFeatures, overlayPayload/chartOverlays, unifiedIntelligence, and externalData to receive Neural Brain probabilities. Each prediction is saved as memory and blended with the online learner once enough labeled outcomes are available.',
    memoryRoutes: {
      snapshots: '/api/neural-brain/snapshots',
      outcomes: '/api/neural-brain/outcomes',
      status: '/api/neural-brain/status',
      onlineStatus: '/api/neural-brain/online-status',
    },
    online: getOnlineBrainStatus(),
    createdAt: new Date().toISOString(),
  })
}
