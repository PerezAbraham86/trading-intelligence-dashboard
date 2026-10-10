const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('Next exports every existing dashboard page as real HTML', () => {
  assert.equal(require('../../next.config.js').output, 'export')
  for (const route of ['', 'academy', 'indicators', 'membership', 'shop', 'signals', 'trading-room']) {
    const filename = path.join('out', route, 'index.html')
    assert.ok(fs.statSync(filename).size > 1000, `${route || '/'} must have exported HTML`)
  }
  assert.ok(fs.existsSync('out/_next/static'))
})

test('Static output does not contain server API routes', () => {
  assert.equal(fs.existsSync('out/api/neural-brain'), false)
  assert.equal(fs.existsSync('app/api/neural-brain/predict/route.ts'), false)
})

test('Neural Brain requests use the configured FastAPI backend', () => {
  const api = fs.readFileSync('lib/backendApi.ts', 'utf8')
  assert.ok(api.includes('process.env.NEXT_PUBLIC_API_BASE_URL'))
  assert.ok(api.includes('https://trading-intelligence-dashboard-1.onrender.com'))
  const hook = fs.readFileSync('hooks/useNeuralBrain.ts', 'utf8')
  const context = fs.readFileSync('components/AiBrainContextPanel.tsx', 'utf8')
  assert.ok(hook.includes("fetch(backendApiUrl('/api/neural-brain/predict')"))
  assert.ok(context.includes("fetch(backendApiUrl('/api/neural-brain/snapshots')"))
  assert.equal(context.includes('Promise.allSettled'), false)
})
