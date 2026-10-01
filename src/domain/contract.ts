/**
 * AI wire contract — the JSON shapes the model must return, plus the
 * client→host proxy envelope. Validation lives in contract-validate.ts.
 * The contract never assumes structured output: models answer with a JSON
 * code block; the program parses and validates strictly.
 */

/** Client → host proxy request. `provider`/`model` are DSH catalog ids. */
export interface AiProxyRequest {
  requestId: string
  provider: string
  model: string
  system?: string
  user: string
  temperature?: number
  maxTokens?: number
}

/** Host → client proxy response. `text` is the assembled completion. */
export interface AiProxyResponse {
  ok: boolean
  requestId: string
  text?: string
  reason?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

export type AiResponseKind = 'alternatives' | 'diagnose' | 'fix' | 'trim'

interface BaseFields {
  kind: AiResponseKind
  requestId: string
  baseRevision: number
  baseHash: string
}

export interface AlternativesResponse extends BaseFields {
  kind: 'alternatives'
  items: { text: string; reason?: string }[]
}

export interface DiagnoseResponse extends BaseFields {
  kind: 'diagnose' | 'fix'
  proposals: {
    leafId: string
    from: number
    to: number
    quote: string
    category: string
    reason?: string
    /** fix mode only: replacement text for the anchored range. */
    after?: string
  }[]
}

export interface TrimResponse extends BaseFields {
  kind: 'trim'
  level: number
  cuts: { leafId: string; from: number; to: number; quote: string; reason?: string }[]
}

export type AiStructuredResponse = AlternativesResponse | DiagnoseResponse | TrimResponse

/**
 * Extract the JSON payload from raw model text: prefer the last ```json code
 * block, else the largest balanced {...} span. Returns the parsed object.
 */
export function extractJson(raw: string): unknown | undefined {
  const fenced = [...raw.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)]
  const candidates: string[] = []
  if (fenced.length > 0) candidates.push(fenced[fenced.length - 1][1])
  // Fallback: outermost balanced braces.
  const start = raw.indexOf('{')
  if (start !== -1) {
    let depth = 0, end = -1
    for (let i = start; i < raw.length; i += 1) {
      const c = raw[i]
      if (c === '{') depth += 1
      else if (c === '}') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    if (end !== -1) candidates.push(raw.slice(start, end + 1))
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c)
    } catch {
      continue
    }
  }
  return undefined
}
