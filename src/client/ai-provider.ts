import type { AiProxyRequest, AiProxyResponse } from '../domain/contract.js'

/**
 * Model access: two independent providers behind one tiny interface.
 * - `http`   — the DSH host proxy at /api/writeon/* (real configured providers)
 * - `test`   — a deterministic local provider for tests and offline runs
 * The verification harness exercises them as separate layers; a green test
 * provider never substitutes for real model integration.
 */

export interface AiProvider {
  kind: 'http' | 'test'
  complete(req: AiProxyRequest, signal: AbortSignal): Promise<AiProxyResponse>
  listModels(): Promise<{ provider: string; model: string; label: string }[]>
}

/** Same-origin fetch wrapper — the host route enforces trustedRequest itself. */
async function postJson<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`http ${res.status}`)
  return (await res.json()) as T
}

export class HttpProvider implements AiProvider {
  kind = 'http' as const

  async complete(req: AiProxyRequest, signal: AbortSignal): Promise<AiProxyResponse> {
    try {
      return await postJson<AiProxyResponse>('/api/writeon/ai', req, signal)
    } catch (e) {
      return { ok: false, requestId: req.requestId, reason: e instanceof Error && e.name === 'AbortError' ? 'cancelled' : 'unreachable' }
    }
  }

  async listModels() {
    try {
      const res = await fetch('/api/writeon/models', { credentials: 'same-origin' })
      if (!res.ok) return []
      const data = (await res.json()) as { groups: { id: string; models: { id: string; name?: string }[] }[] }
      const out: { provider: string; model: string; label: string }[] = []
      for (const g of data.groups) {
        for (const m of g.models) out.push({ provider: g.id, model: m.id, label: `${m.name ?? m.id} (${g.id})` })
      }
      return out
    } catch {
      return []
    }
  }
}

/**
 * Deterministic local provider used by automated tests and offline runs.
 * Returns structured JSON honoring the contract: echoes request fields and
 * derives alternatives/diagnoses/cuts from the prompt's TEXT section only.
 */
export class TestProvider implements AiProvider {
  kind = 'test' as const

  async complete(req: AiProxyRequest, signal: AbortSignal): Promise<AiProxyResponse> {
    if (signal.aborted) return { ok: false, requestId: req.requestId, reason: 'cancelled' }
    await new Promise(r => setTimeout(r, 5))
    const text = this.respond(req)
    return { ok: true, requestId: req.requestId, text, usage: { inputTokens: req.user.length, outputTokens: text.length } }
  }

  private respond(req: AiProxyRequest): string {
    const base = { requestId: req.requestId, baseRevision: 0, baseHash: '' }
    const rid = /"requestId":"([^"]+)"/.exec(req.user)?.[1] ?? req.requestId
    const rev = Number(/"baseRevision":(\d+)/.exec(req.user)?.[1] ?? 0)
    const hash = /"baseHash":"([^"]+)"/.exec(req.user)?.[1] ?? ''
    const leafs = [...req.user.matchAll(/\[leaf ([^\]]+)\]\n([\s\S]*?)(?=\n\n\[leaf|\n\nRespond|$)/g)]
      .map(m => ({ leafId: m[1], text: m[2] }))
    if (req.user.includes('"kind":"alternatives"')) {
      const target = /TARGET:\n([\s\S]*?)\n\nSURROUNDING/.exec(req.user)?.[1] ?? ''
      const items = ['concise', 'warmer', 'formal'].map(style =>
        ({ text: `[${style}] ${target.trim()}`, reason: `${style} phrasing` }))
      return JSON.stringify({ ...base, kind: 'alternatives', requestId: rid, baseRevision: rev, baseHash: hash, items })
    }
    if (req.user.includes('"kind":"diagnose"') || req.user.includes('"kind":"fix"')) {
      const fix = req.user.includes('"kind":"fix"')
      const proposals: unknown[] = []
      for (const leaf of leafs) {
        const m = /\bvery\b|\breally\b|I think\b/i.exec(leaf.text)
        if (m !== null) {
          proposals.push({
            leafId: leaf.leafId, from: m.index, to: m.index + m[0].length, quote: m[0],
            category: 'hedges-filler', reason: 'test hedge', ...(fix ? { after: '' } : {}),
          })
        }
      }
      return JSON.stringify({ ...base, kind: fix ? 'fix' : 'diagnose', requestId: rid, baseRevision: rev, baseHash: hash, proposals })
    }
    if (req.user.includes('"kind":"trim"')) {
      const level = Number(/"level":(\d+)/.exec(req.user)?.[1] ?? 10)
      const cuts: unknown[] = []
      for (const leaf of leafs) {
        const words = leaf.text.split(/\s+/).filter(w => w !== '')
        const cutCount = Math.max(0, Math.floor(words.length * level / 100))
        let pos = 0
        let taken = 0
        for (let i = 0; i < words.length && taken < cutCount; i += 1) {
          const idx = leaf.text.indexOf(words[i], pos)
          if (idx === -1) break
          if (i % 7 === 3 && words[i].length > 3) {
            cuts.push({ leafId: leaf.leafId, from: idx, to: idx + words[i].length, quote: words[i], reason: 'test cut' })
            taken += 1
          }
          pos = idx + words[i].length
        }
      }
      return JSON.stringify({ ...base, kind: 'trim', requestId: rid, baseRevision: rev, baseHash: hash, level, cuts })
    }
    return JSON.stringify({ ...base, kind: 'diagnose', requestId: rid, baseRevision: rev, baseHash: hash, proposals: [] })
  }

  async listModels() {
    return [{ provider: 'writeon-test', model: 'test-model', label: 'Test provider (deterministic)' }]
  }
}
