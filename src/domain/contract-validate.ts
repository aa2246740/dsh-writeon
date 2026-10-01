import { resolveAnchor, validateCuts, type Anchor, type FlatLeaf } from './anchors.js'
import type { AiStructuredResponse, AlternativesResponse, DiagnoseResponse, TrimResponse } from './contract.js'

/**
 * Strict validation of model responses per the spec's contract rules:
 * echo of requestId/baseRevision/baseHash must match the pending run, and
 * every anchor must land exactly on the document the model saw.
 */

export type RejectReason =
  | 'not-json'
  | 'wrong-kind'
  | 'request-id-mismatch'
  | 'base-mismatch'
  | 'bad-payload'
  | 'bad-anchor'
  | 'empty'

export interface Rejected { ok: false; reason: RejectReason; detail: string }

export interface Accepted<T extends AiStructuredResponse> { ok: true; response: T }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkBase(
  v: Record<string, unknown>,
  expected: { requestId: string; baseRevision: number; baseHash: string },
): Rejected | null {
  if (v.requestId !== expected.requestId) {
    return { ok: false, reason: 'request-id-mismatch', detail: `response requestId ${String(v.requestId)} != ${expected.requestId}` }
  }
  if (v.baseRevision !== expected.baseRevision || v.baseHash !== expected.baseHash) {
    return { ok: false, reason: 'base-mismatch', detail: `base ${String(v.baseRevision)}/${String(v.baseHash)} != ${expected.baseRevision}/${expected.baseHash}` }
  }
  return null
}

function asAnchor(v: unknown): Anchor | null {
  if (!isObject(v)) return null
  const { leafId, from, to, quote } = v
  if (typeof leafId !== 'string' || typeof from !== 'number' || typeof to !== 'number' || typeof quote !== 'string') return null
  return { leafId, from, to, quote }
}

export function validateAlternatives(
  v: unknown,
  expected: { requestId: string; baseRevision: number; baseHash: string },
): Accepted<AlternativesResponse> | Rejected {
  if (!isObject(v)) return { ok: false, reason: 'not-json', detail: 'payload is not an object' }
  if (v.kind !== 'alternatives') return { ok: false, reason: 'wrong-kind', detail: `kind ${String(v.kind)}` }
  const base = checkBase(v, expected)
  if (base !== null) return base
  if (!Array.isArray(v.items) || v.items.length === 0) return { ok: false, reason: 'empty', detail: 'no alternatives' }
  const items: { text: string; reason?: string }[] = []
  const seen = new Set<string>()
  for (const item of v.items) {
    if (!isObject(item) || typeof item.text !== 'string') return { ok: false, reason: 'bad-payload', detail: 'item missing text' }
    const norm = item.text.normalize('NFC').trim()
    if (norm === '' || seen.has(norm)) continue
    seen.add(norm)
    items.push({ text: item.text, reason: typeof item.reason === 'string' ? item.reason : undefined })
  }
  if (items.length === 0) return { ok: false, reason: 'empty', detail: 'all alternatives empty or duplicate' }
  return { ok: true, response: { ...(v as unknown as AlternativesResponse), items } }
}

export function validateDiagnose(
  v: unknown,
  expected: { requestId: string; baseRevision: number; baseHash: string },
  leaves: FlatLeaf[],
  mode: 'diagnose' | 'fix',
): Accepted<DiagnoseResponse> | Rejected {
  if (!isObject(v)) return { ok: false, reason: 'not-json', detail: 'payload is not an object' }
  if (v.kind !== mode) return { ok: false, reason: 'wrong-kind', detail: `kind ${String(v.kind)}, expected ${mode}` }
  const base = checkBase(v, expected)
  if (base !== null) return base
  if (!Array.isArray(v.proposals)) return { ok: false, reason: 'bad-payload', detail: 'proposals missing' }
  if (v.proposals.length === 0) return { ok: true, response: { ...(v as unknown as DiagnoseResponse), proposals: [] } }
  const proposals: DiagnoseResponse['proposals'] = []
  for (const p of v.proposals) {
    if (!isObject(p)) return { ok: false, reason: 'bad-payload', detail: 'proposal is not an object' }
    const anchor = asAnchor(p)
    if (anchor === null) return { ok: false, reason: 'bad-payload', detail: 'proposal missing anchor fields' }
    const va = resolveAnchor(leaves, anchor)
    if ('error' in va) return { ok: false, reason: 'bad-anchor', detail: `${va.error.kind}: ${va.error.detail}` }
    if (typeof p.category !== 'string' || p.category === '') return { ok: false, reason: 'bad-payload', detail: 'proposal missing category' }
    if (mode === 'fix' && typeof p.after !== 'string') return { ok: false, reason: 'bad-payload', detail: 'fix proposal missing "after"' }
    proposals.push({
      ...va.anchor,
      category: p.category,
      reason: typeof p.reason === 'string' ? p.reason : undefined,
      after: mode === 'fix' ? (typeof p.after === 'string' ? p.after : undefined) : undefined,
    })
  }
  return { ok: true, response: { kind: mode, requestId: expected.requestId, baseRevision: expected.baseRevision, baseHash: expected.baseHash, proposals } }
}

export function validateTrim(
  v: unknown,
  expected: { requestId: string; baseRevision: number; baseHash: string; level: number },
  leaves: FlatLeaf[],
): Accepted<TrimResponse> | Rejected {
  if (!isObject(v)) return { ok: false, reason: 'not-json', detail: 'payload is not an object' }
  if (v.kind !== 'trim') return { ok: false, reason: 'wrong-kind', detail: `kind ${String(v.kind)}` }
  const base = checkBase(v, expected)
  if (base !== null) return base
  if (v.level !== expected.level) return { ok: false, reason: 'bad-payload', detail: `level ${String(v.level)} != ${expected.level}` }
  if (!Array.isArray(v.cuts)) return { ok: false, reason: 'bad-payload', detail: 'cuts missing' }
  const cuts: { anchor: Anchor; reason?: string }[] = []
  for (const c of v.cuts) {
    if (!isObject(c)) return { ok: false, reason: 'bad-payload', detail: 'cut is not an object' }
    const anchor = asAnchor(c)
    if (anchor === null) return { ok: false, reason: 'bad-payload', detail: 'cut missing anchor fields' }
    if (anchor.from === anchor.to) return { ok: false, reason: 'bad-anchor', detail: 'empty cut range' }
    cuts.push({ anchor, reason: typeof c.reason === 'string' ? c.reason : undefined })
  }
  const vc = validateCuts(leaves, cuts)
  if (!vc.ok) return { ok: false, reason: 'bad-anchor', detail: `${vc.error.kind} at index ${vc.index}: ${vc.error.detail}` }
  return {
    ok: true,
    response: {
      kind: 'trim', requestId: expected.requestId, baseRevision: expected.baseRevision, baseHash: expected.baseHash,
      level: expected.level,
      cuts: cuts.map(c => ({ ...c.anchor, reason: c.reason })),
    },
  }
}
