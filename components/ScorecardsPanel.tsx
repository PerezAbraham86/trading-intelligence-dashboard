import React from 'react'

type ScorecardBundle = {
  version?: string
  asOfTime?: unknown
  symbolPrice?: number
  overall?: {
    direction?: string
    netBias?: number
    confirmationScore?: number
    conflictScore?: number
    bullScore?: number
    bearScore?: number
    contextScore?: number
  }
  smc?: {
    qualityScore?: number
    bullishEvents?: number
    bearishEvents?: number
  }
  orderBlocks?: {
    qualityScore?: number
    bullishZones?: number
    bearishZones?: number
  }
  pdZones?: {
    qualityScore?: number
  }
  liquidityProfile?: {
    qualityScore?: number
    profileBinCount?: number
    strongBins?: number
  }
  nrtr?: {
    direction?: string
    agreesWithSmc?: boolean
  }
  ghost?: {
    direction?: string
    confidence?: number
    count?: number
  }
  hiddenContext?: {
    qualityScore?: number
    eqhEqlCount?: number
    fvgCount?: number
    sweepCount?: number
    displacementCount?: number
    inducementCount?: number
  }
  activeFactors?: Record<string, number>
}

type MlFeatures = Record<string, number | string | boolean | null | undefined>

type ScorecardsPanelProps = {
  scorecards?: ScorecardBundle | null
  mlFeatures?: MlFeatures | null
  compact?: boolean
}

function formatNumber(value: unknown, decimals = 0) {
  const number = Number(value)

  if (!Number.isFinite(number)) return '—'

  return number.toFixed(decimals)
}

function formatSigned(value: unknown, decimals = 0) {
  const number = Number(value)

  if (!Number.isFinite(number)) return '—'

  return `${number > 0 ? '+' : ''}${number.toFixed(decimals)}`
}

function directionColor(direction?: string) {
  const value = String(direction ?? '').toLowerCase()

  if (value.includes('bull')) return 'text-emerald-300'
  if (value.includes('bear')) return 'text-red-300'

  return 'text-yellow-300'
}

function meterColor(value: unknown) {
  const number = Number(value)

  if (!Number.isFinite(number)) return 'bg-slate-700'
  if (number >= 70) return 'bg-emerald-400'
  if (number >= 45) return 'bg-yellow-400'

  return 'bg-red-400'
}

function ScoreRow({
  label,
  value,
  suffix = '',
}: {
  label: string
  value: unknown
  suffix?: string
}) {
  const number = Number(value)
  const width = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-400">{label}</span>
        <span className="text-[11px] font-semibold text-slate-100">
          {formatNumber(value, 0)}
          {suffix}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${meterColor(width)}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

export default function ScorecardsPanel({
  scorecards,
  mlFeatures,
  compact = false,
}: ScorecardsPanelProps) {
  if (!scorecards) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0b1020] p-4">
        <div className="text-sm font-semibold text-slate-100">ML Scorecards</div>
        <div className="mt-1 text-xs text-slate-500">Waiting for unified overlay scorecards.</div>
      </div>
    )
  }

  const overall = scorecards.overall ?? {}
  const hidden = scorecards.hiddenContext ?? {}
  const activeFactors = scorecards.activeFactors ?? {}

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0b1020] p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">ML Scorecards</div>
          <div className="mt-1 text-[11px] text-slate-500">
            SMC + OB + PD + DLM + Ghost + NRTR linked into ML-ready features
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-black/25 px-3 py-2 text-right">
          <div className={`text-xs font-semibold uppercase ${directionColor(overall.direction)}`}>
            {overall.direction ?? 'Neutral'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Net {formatSigned(overall.netBias, 1)}
          </div>
        </div>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-3'}`}>
        <ScoreRow label="Overall Confirmation" value={overall.confirmationScore} suffix="%" />
        <ScoreRow label="Conflict Risk" value={overall.conflictScore} suffix="%" />
        <ScoreRow label="SMC Quality" value={(scorecards.smc?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="Order Block Quality" value={(scorecards.orderBlocks?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="PD Zone Quality" value={(scorecards.pdZones?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="Liquidity Profile Quality" value={(scorecards.liquidityProfile?.qualityScore ?? 0) * 10} suffix="%" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] text-slate-300 md:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="text-slate-500">NRTR</div>
          <div className={`mt-1 font-semibold ${directionColor(scorecards.nrtr?.direction)}`}>
            {scorecards.nrtr?.direction ?? 'neutral'}
          </div>
          <div className="mt-1 text-slate-500">
            SMC agree: {scorecards.nrtr?.agreesWithSmc ? 'Yes' : 'No'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="text-slate-500">Ghost</div>
          <div className={`mt-1 font-semibold ${directionColor(scorecards.ghost?.direction)}`}>
            {scorecards.ghost?.direction ?? 'neutral'}
          </div>
          <div className="mt-1 text-slate-500">
            Conf {formatNumber(scorecards.ghost?.confidence, 0)}%
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="text-slate-500">Hidden Context</div>
          <div className="mt-1 font-semibold text-slate-100">
            {formatNumber(hidden.qualityScore, 1)}/10
          </div>
          <div className="mt-1 text-slate-500">
            S:{hidden.sweepCount ?? 0} D:{hidden.displacementCount ?? 0} I:{hidden.inducementCount ?? 0}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="text-slate-500">ML Features</div>
          <div className="mt-1 font-semibold text-slate-100">
            {mlFeatures ? Object.keys(mlFeatures).length : 0}
          </div>
          <div className="mt-1 text-slate-500">
            Factors {Object.values(activeFactors).reduce((sum, value) => sum + Number(value || 0), 0)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2 text-center text-[10px] text-slate-400">
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{activeFactors.smcEvents ?? 0}</div>
          <div>SMC</div>
        </div>
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{activeFactors.orderBlocks ?? 0}</div>
          <div>OB</div>
        </div>
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{activeFactors.profileBins ?? 0}</div>
          <div>DLM</div>
        </div>
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{hidden.fvgCount ?? 0}</div>
          <div>FVG</div>
        </div>
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{hidden.eqhEqlCount ?? 0}</div>
          <div>EQH/EQL</div>
        </div>
      </div>
    </div>
  )
}
