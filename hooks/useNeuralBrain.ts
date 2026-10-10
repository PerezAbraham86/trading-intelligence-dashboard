'use client'

import { useEffect, useState } from 'react'
import type { NeuralBrainInput, NeuralBrainScorecard } from '@/lib/neuralBrain'
import { backendApiUrl } from '@/lib/backendApi'

export function useNeuralBrain(input: NeuralBrainInput | null) {
  const [prediction, setPrediction] = useState<NeuralBrainScorecard | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setPrediction(null)
    setError(null)
    if (!input) return
    const controller = new AbortController()
    // Coalesce rapid overlay updates without generating unnecessary memory rows.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(backendApiUrl('/api/neural-brain/predict'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input), signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Neural Brain unavailable (${response.status})`)
        const payload = await response.json()
        if (!controller.signal.aborted) setPrediction(payload)
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Neural Brain unavailable')
      }
    }, 800)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [input])
  return { prediction, error }
}
