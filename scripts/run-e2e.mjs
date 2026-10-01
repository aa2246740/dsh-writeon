#!/usr/bin/env node
/**
 * E2E runner: restarts a real `dsh web` host (fresh one-time token), runs the
 * Playwright suite against it, and writes verification/<run-id>/ artifacts.
 *
 *   node scripts/run-e2e.mjs [--grep pattern]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_DIR = process.env.WO_HOST_DIR ?? '/Users/devin/work/dsh-host-writeon'
const LOG = '/tmp/dsh-web-e2e.log'
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const VERIFY = join(ROOT, 'verification', runId)
mkdirSync(join(VERIFY, 'screenshots'), { recursive: true })
mkdirSync(join(VERIFY, 'logs'), { recursive: true })

const grepIdx = process.argv.indexOf('--grep')
const grep = grepIdx >= 0 ? process.argv[grepIdx + 1] : undefined

// Kill any prior dsh web on :3080, then start fresh (fresh one-time token).
try { spawnSync('pkill', ['-f', 'dsh web'], { stdio: 'ignore' }) } catch { /* none */ }
await new Promise(r => setTimeout(r, 1500))
const host = spawn('npx', ['dsh', 'web', '--no-open'], { cwd: HOST_DIR, env: process.env })
host.stdout.pipe(process.stdout)
host.stderr.pipe(process.stderr)

const url = await new Promise((resolve, reject) => {
  let buf = ''
  host.stdout.on('data', d => {
    buf += String(d)
    const m = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.exec(buf)
    if (m !== null) resolve(m[0])
  })
  setTimeout(() => reject(new Error(`host did not print URL; log:\n${buf}`)), 45_000)
})
console.log(`[run-e2e] host: ${url.replace(/token=\S+/, 'token=<redacted>')}`)
writeFileSync(join(VERIFY, 'logs', 'host-url.txt'), url + '\n')

const args = ['playwright', 'test']
if (grep !== undefined) args.push('--grep', grep)
const child = spawn('npx', args, {
  cwd: ROOT,
  env: { ...process.env, DSH_URL: url, WO_VERIFY_DIR: VERIFY },
  stdio: 'inherit',
})
child.on('exit', code => {
  host.kill()
  const manifest = {
    runId,
    startedAt: runId,
    host: 'dsh web @deepseek-ai/dsh@0.2.0-rc.2',
    plugin: 'dsh-writeon (link install)',
    provider: 'zai-coding-cn/glm-5.3-flash (ZHIPU_API_KEY) + writeon-test deterministic',
    exitCode: code,
  }
  writeFileSync(join(VERIFY, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`[run-e2e] exit ${code}; artifacts in ${VERIFY}`)
  process.exit(code ?? 1)
})
