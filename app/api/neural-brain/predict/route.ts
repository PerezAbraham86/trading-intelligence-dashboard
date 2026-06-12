import { NextRequest, NextResponse } from 'next/server'
import { buildNeuralBrainScorecard, NeuralBrainInput } from '@/lib/neuralBrain'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as NeuralBrainInput
    const scorecard = buildNeuralBrainScorecard(payload || {})
    return NextResponse.json(scorecard)
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
    note: 'Send candles, scorecards, mlFeatures, overlayPayload/chartOverlays, unifiedIntelligence, and externalData to receive Neural Brain probabilities.',
    createdAt: new Date().toISOString(),
  })
}
