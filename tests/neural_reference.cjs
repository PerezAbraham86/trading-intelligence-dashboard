// Run the original TypeScript learner as an independent parity oracle.
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const { buildNeuralBrainScorecard } = require(path.join(root, 'neuralBrain.js'))
const online = require(path.join(root, 'neuralBrainOnline.js'))
const inputs = JSON.parse(fs.readFileSync(0, 'utf8'))
const bases = inputs.map(buildNeuralBrainScorecard)
const predictions = []
for (let i = 0; i < 12; i++) {
  const base = bases[i % bases.length]
  online.learnOnlineFromSnapshot({
    ...base, decisionStrength: 60, riskStatus: 'Aligned',
    scorecardInputs: { inputs: base.inputs, request: inputs[i % inputs.length] },
    outcome: { targetHit: i % 3 !== 0, reversalHappened: i % 3 === 0, chopHappened: i % 4 === 0 },
  })
  predictions.push(online.applyOnlineBrainPrediction(base))
}
process.stdout.write(JSON.stringify({ bases, predictions, state: JSON.parse(fs.readFileSync(process.env.NEURAL_BRAIN_ONLINE_MODEL_FILE, 'utf8')) }))
