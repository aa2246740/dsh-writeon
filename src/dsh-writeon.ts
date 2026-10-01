import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { trustedRequest, json, readJson } from './host/http.js'

/**
 * dsh-writeon — Write On host plugin.
 * Registers two same-origin routes under the DSH web server:
 *   GET  /api/writeon/models  → the deployment's live model catalog
 *   POST /api/writeon/ai      → a one-shot llm.stream call (text in, text out)
 * No session state is touched: every call is identity-free and the request
 * body carries everything the model sees (contract: ../domain/contract.ts).
 */

export const name = 'dsh-writeon'

export const inject = ['llm', 'webServer', 'sessionController']

interface LlmService {
  stream(options: {
    provider: string
    model: string
    messages: { role: 'user'; content: { type: 'text'; text: string }[] }[]
    system?: string
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<{ type: string; index?: number; text?: string; block?: { type: string; text?: string }; usage?: { inputTokens?: number; outputTokens?: number }; reason?: { kind: string } }>
}

interface WebServerService {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
}

interface SessionControllerService {
  modelCatalog(): Promise<{
    groups: { id: string; name: string; models: { id: string; name: string }[] }[]
    default?: { provider: string; model: string }
  }>
}

export function apply(ctx: Context): void {
  const llm = (ctx as unknown as { llm: LlmService }).llm
  const webServer = (ctx as unknown as { webServer: WebServerService }).webServer
  const sessionController = (ctx as unknown as { sessionController: SessionControllerService }).sessionController

  const getModels = async (req: IncomingMessage, res: ServerResponse) => {
    if (!trustedRequest(req)) return json(res, 403, { ok: false, reason: 'untrusted' })
    try {
      const catalog = await sessionController.modelCatalog()
      json(res, 200, { groups: catalog.groups, default: catalog.default ?? null })
    } catch (e) {
      json(res, 500, { ok: false, reason: e instanceof Error ? e.message : 'catalog failed' })
    }
  }

  const postAi = async (req: IncomingMessage, res: ServerResponse) => {
    if (!trustedRequest(req)) return json(res, 403, { ok: false, reason: 'untrusted' })
    let body: { requestId?: string; provider?: string; model?: string; system?: string; user?: string; temperature?: number; maxTokens?: number }
    try {
      body = (await readJson(req)) as typeof body
    } catch {
      return json(res, 400, { ok: false, reason: 'bad-json' })
    }
    if (typeof body.requestId !== 'string' || typeof body.provider !== 'string' || typeof body.model !== 'string' || typeof body.user !== 'string') {
      return json(res, 400, { ok: false, reason: 'missing-fields' })
    }
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    try {
      let text = ''
      const blockTexts = new Map<number, string>()
      let finishKind = 'unknown'
      let usage: { inputTokens?: number; outputTokens?: number } | undefined
      for await (const chunk of llm.stream({
        provider: body.provider,
        model: body.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: body.user }] }],
        system: body.system,
        temperature: body.temperature,
        maxTokens: body.maxTokens ?? 4096,
        signal: abort.signal,
      })) {
        if (chunk.type === 'text-delta' && typeof chunk.index === 'number' && typeof chunk.text === 'string') {
          text += chunk.text
        } else if (chunk.type === 'block-end' && chunk.block !== undefined && chunk.block.type === 'text' && typeof chunk.block.text === 'string') {
          blockTexts.set(chunk.index ?? 0, chunk.block.text)
        } else if (chunk.type === 'usage' && chunk.usage !== undefined) {
          usage = chunk.usage
        } else if (chunk.type === 'finish' && chunk.reason !== undefined) {
          finishKind = chunk.reason.kind
        }
      }
      // Prefer assembled block text when present (matches provider ordering).
      if (blockTexts.size > 0) {
        text = [...blockTexts.keys()].sort((a, b) => a - b).map(i => blockTexts.get(i)).join('')
      }
      const ok = finishKind === 'stop' || finishKind === 'end_turn' || finishKind === 'length' || text.length > 0
      json(res, 200, { ok, requestId: body.requestId, text, reason: finishKind, usage })
    } catch (e) {
      if (abort.signal.aborted || res.destroyed) return
      json(res, 200, { ok: false, requestId: body.requestId, reason: e instanceof Error ? e.message : 'stream failed' })
    }
  }

  ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/writeon/models', handler: getModels }))
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/writeon/ai', handler: postAi }))
}
