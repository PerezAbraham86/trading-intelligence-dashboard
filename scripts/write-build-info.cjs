// Public deployment identity only; never export configuration or secrets.
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

let commit = process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || ''
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    commit = 'unknown'
  }
}
if (!/^[a-f0-9]{40}$/.test(commit)) commit = 'unknown'
fs.mkdirSync('public', { recursive: true })
fs.writeFileSync('public/build-info.json', JSON.stringify({ commit, builtAt: new Date().toISOString() }) + '\n')
