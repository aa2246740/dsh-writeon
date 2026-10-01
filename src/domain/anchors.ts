import { isGraphemeBoundary } from './segment.js'

/**
 * Anchors: stable references into the flattened document a model saw.
 * A leaf = one text block's plain text in doc order (variants contribute only
 * the active branch; ghost text is normal text to the model).
 * Positions are UTF-16 offsets inside that leaf's text.
 */

export interface FlatLeaf {
  /** Stable leaf id — the PM block's bid. */
  leafId: string
  /** PM position where the leaf's text starts, for mapping anchors back. */
  textStart: number
  text: string
}

export interface Anchor {
  leafId: string
  /** [from, to) UTF-16 offsets inside leaf text; to===from allowed (caret). */
  from: number
  to: number
  quote: string
}

/** djb2-style hex hash of a string — enough to fingerprint the base the model saw. */
export function textHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** Hash over the flattened leaves — what goes into AI requests as baseHash. */
export function docHash(leaves: FlatLeaf[]): string {
  return textHash(leaves.map(l => `${l.leafId}\0${l.text}`).join('\x01'))
}

export interface AnchorError {
  kind:
    | 'unknown-leaf'
    | 'range-out-of-bounds'
    | 'quote-mismatch'
    | 'grapheme-boundary'
    | 'empty-range'
  detail: string
}

/** Validate one anchor against the current flatten. Returns the leaf on success. */
export function validateAnchor(
  leaves: FlatLeaf[],
  anchor: Anchor,
): { leaf: FlatLeaf } | { error: AnchorError } {
  const leaf = leaves.find(l => l.leafId === anchor.leafId)
  if (leaf === undefined) return { error: { kind: 'unknown-leaf', detail: `leaf ${anchor.leafId} not found` } }
  const { from, to } = anchor
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > leaf.text.length || from > to) {
    return { error: { kind: 'range-out-of-bounds', detail: `[${from},${to}) outside leaf of ${leaf.text.length}` } }
  }
  const actual = leaf.text.slice(from, to)
  if (actual !== anchor.quote) {
    return { error: { kind: 'quote-mismatch', detail: `quote ${JSON.stringify(anchor.quote)} != ${JSON.stringify(actual)}` } }
  }
  if (!isGraphemeBoundary(leaf.text, from) || !isGraphemeBoundary(leaf.text, to)) {
    return { error: { kind: 'grapheme-boundary', detail: `range splits a grapheme` } }
  }
  return { leaf }
}

/**
 * Strict validation first; on a quote-mismatch alone, fall back to
 * repairAnchor — the strict error otherwise stands.
 */
export function resolveAnchor(
  leaves: FlatLeaf[],
  anchor: Anchor,
): { leaf: FlatLeaf; anchor: Anchor } | { error: AnchorError } {
  const strict = validateAnchor(leaves, anchor)
  if (!('error' in strict)) return { leaf: strict.leaf, anchor }
  if (strict.error.kind !== 'quote-mismatch') return { error: strict.error }
  const leaf = leaves.find(l => l.leafId === anchor.leafId)
  if (leaf === undefined) return { error: strict.error }
  const repaired = repairAnchor(leaf, anchor)
  if (repaired === null) return { error: strict.error }
  return { leaf, anchor: repaired }
}

/**
 * Repair an anchor whose offsets do not land on its quote. Models often get
 * the quote text right but compute offsets wrong — when the quote occurs
 * exactly once in the leaf, the anchor is repaired to that occurrence.
 * Returns the repaired anchor, or null when the quote is absent/ambiguous
 * (the strict validation error then stands).
 */
export function repairAnchor(leaf: FlatLeaf, anchor: Anchor): Anchor | null {
  if (anchor.quote === '') return null
  const first = leaf.text.indexOf(anchor.quote)
  if (first < 0 || leaf.text.indexOf(anchor.quote, first + 1) >= 0) return null
  const repaired: Anchor = { ...anchor, from: first, to: first + anchor.quote.length }
  if (!isGraphemeBoundary(leaf.text, repaired.from) || !isGraphemeBoundary(leaf.text, repaired.to)) return null
  return repaired
}

/**
 * Check that a proposed cut/deletion set is acceptable: every anchor valid,
 * non-overlapping, and sorted-by-position-able. Returns validated proposals or
 * the first error.
 */
export function validateCuts(
  leaves: FlatLeaf[],
  cuts: { anchor: Anchor }[],
): { ok: true } | { ok: false; error: AnchorError; index: number } {
  const byLeaf = new Map<string, { from: number; to: number }[]>()
  for (let i = 0; i < cuts.length; i += 1) {
    const v = resolveAnchor(leaves, cuts[i].anchor)
    if ('error' in v) return { ok: false, error: v.error, index: i }
    cuts[i].anchor.from = v.anchor.from
    cuts[i].anchor.to = v.anchor.to
    const span = { from: v.anchor.from, to: v.anchor.to }
    const list = byLeaf.get(cuts[i].anchor.leafId) ?? []
    for (const prev of list) {
      if (span.from < prev.to && span.to > prev.from) {
        return { ok: false, error: { kind: 'range-out-of-bounds', detail: `cut [${span.from},${span.to}) overlaps [${prev.from},${prev.to})` }, index: i }
      }
    }
    list.push(span)
    byLeaf.set(cuts[i].anchor.leafId, list)
  }
  return { ok: true }
}
