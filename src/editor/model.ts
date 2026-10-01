import type { Node as PMNode, Slice } from 'prosemirror-model'
import type { FlatLeaf } from '../domain/anchors.js'
import type { Scope } from '../domain/entities.js'

/**
 * Document queries — everything here derives positions from the doc itself,
 * never from stored coordinates. A group range lives between its marker
 * nodes; a ghost range is a contiguous run of `ghost` marks.
 */

export interface GroupRange {
  /** Positions covering the markers themselves: [from, to). */
  from: number
  to: number
  /** Positions covering the active content inside the markers. */
  innerFrom: number
  innerTo: number
  /** PM node for paragraph scope (the vblock). */
  node?: PMNode
}

/** Locate a variant group's live range by gid. Null when any marker is missing. */
export function groupRange(doc: PMNode, gid: string, scope: Scope): GroupRange | null {
  if (scope === 'paragraph') {
    let found: GroupRange | null = null
    doc.descendants((node, pos) => {
      if (node.type.name === 'vblock' && node.attrs.gid === gid) {
        found = { from: pos, to: pos + node.nodeSize, innerFrom: pos + 1, innerTo: pos + node.nodeSize - 1, node }
        return false
      }
      return true
    })
    return found
  }
  let start = -1
  let end = -1
  doc.descendants((node, pos) => {
    if (node.type.name === 'vstart' && node.attrs.gid === gid) { start = pos; return false }
    if (node.type.name === 'vend' && node.attrs.gid === gid) { end = pos; return false }
    return true
  })
  if (start === -1 || end === -1 || end <= start) return null
  return { from: start, to: end + 1, innerFrom: start + 1, innerTo: end }
}

/** All live group ids present in the doc (with scope). */
export function liveGroupIds(doc: PMNode): Map<string, Scope> {
  const out = new Map<string, Scope>()
  doc.descendants(node => {
    if (node.type.name === 'vblock') out.set(node.attrs.gid as string, 'paragraph')
    else if (node.type.name === 'vstart') {
      const gid = node.attrs.gid as string
      if (!out.has(gid)) out.set(gid, 'word') // refined by caller via entity scope
    }
    return true
  })
  return out
}

/** The content inside a range as node JSON — a fragment suitable for an option. */
export function fragmentJSON(doc: PMNode, from: number, to: number): unknown[] {
  const slice: Slice = doc.slice(from, to)
  return slice.content.toJSON() as unknown[]
}

/** Flattened leaves for AI calls: every textblock in doc order. */
export function flatten(doc: PMNode): FlatLeaf[] {
  const leaves: FlatLeaf[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      leaves.push({ leafId: `b${pos}`, textStart: pos + 1, text: node.textContent })
      return false // do not descend into textblock children
    }
    return true
  })
  return leaves
}

/** Map an anchor inside a leaf to a PM position. */
export function anchorPos(leaf: FlatLeaf, offset: number): number {
  return leaf.textStart + offset
}

export interface GhostRange { sid: string; from: number; to: number }

/** Contiguous ranges per ghost id — marks split per text node but merge when adjacent. */
export function ghostRanges(doc: PMNode): GhostRange[] {
  const raw: GhostRange[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    const mark = node.marks.find(m => m.type.name === 'ghost')
    if (mark !== undefined) raw.push({ sid: mark.attrs.sid as string, from: pos, to: pos + node.nodeSize })
    return true
  })
  // Merge adjacent ranges carrying the same sid.
  const merged: GhostRange[] = []
  for (const r of raw) {
    const prev = merged[merged.length - 1]
    if (prev !== undefined && prev.sid === r.sid && prev.to === r.from) prev.to = r.to
    else merged.push({ ...r })
  }
  return merged
}

/**
 * Groups whose marker ranges the [from,to) span crosses partially (intersects
 * a group range without fully covering it or being fully inside it).
 * Fully-contained groups are legal nesting and do not conflict.
 */
export function partialCross(doc: PMNode, from: number, to: number, gidScopes: Map<string, Scope>): string[] {
  const conflicts = new Set<string>()
  for (const [gid, scope] of gidScopes) {
    const r = groupRange(doc, gid, scope)
    if (r === null) continue
    const covers = from <= r.from && to >= r.to
    const inside = from >= r.from && to <= r.to
    const touches = from < r.to && to > r.from
    if (touches && !covers && !inside) conflicts.add(gid)
  }
  return [...conflicts]
}

/** Expand [from,to) just enough to fully cover every group it partially crosses. */
export function expandToWholeGroups(doc: PMNode, from: number, to: number, gidScopes: Map<string, Scope>): { from: number; to: number } {
  let changed = true
  while (changed) {
    changed = false
    for (const [gid, scope] of gidScopes) {
      const r = groupRange(doc, gid, scope)
      if (r === null) continue
      const covers = from <= r.from && to >= r.to
      const inside = from >= r.from && to <= r.to
      const touches = from < r.to && to > r.from
      if (touches && !covers && !inside) {
        from = Math.min(from, r.from)
        to = Math.max(to, r.to)
        changed = true
      }
    }
  }
  return { from, to }
}

/**
 * Expand [from,to) until it fully COVERS every group it touches — Stash's rule.
 * Unlike expandToWholeGroups, a selection strictly inside a group still expands
 * outward to the group's boundaries so markers never get orphaned mid-cut.
 */
export function expandToEnclose(doc: PMNode, from: number, to: number, gidScopes: Map<string, Scope>): { from: number; to: number } {
  let changed = true
  while (changed) {
    changed = false
    for (const [gid, scope] of gidScopes) {
      const r = groupRange(doc, gid, scope)
      if (r === null) continue
      const covers = from <= r.from && to >= r.to
      const touches = from < r.to && to > r.from
      if (touches && !covers) {
        from = Math.min(from, r.from)
        to = Math.max(to, r.to)
        changed = true
      }
    }
  }
  return { from, to }
}

/** Whether [from,to) lies inside a single textblock (word/sentence scope legality). */
export function singleTextblock(doc: PMNode, from: number, to: number): { parent: PMNode; pos: number } | null {
  const $from = doc.resolve(from)
  if (!$from.parent.isTextblock) return null
  const $to = doc.resolve(to)
  if ($to.parent !== $from.parent) return null
  return { parent: $from.parent, pos: $from.start() - 1 }
}

/**
 * Whether any step of `tr` touched content inside [from,to) in NEW positions.
 * Steps whose map output only covers the boundary markers do not count.
 */
export function stepsTouchRange(steps: readonly { getMap(): { forEach(cb: (oS: number, oE: number, nS: number, nE: number) => void): void } }[], from: number, to: number): boolean {
  let touched = false
  for (const step of steps) {
    step.getMap().forEach((_oS, _oE, nS, nE) => {
      if (nS < to && nE > from) touched = true
    })
    if (touched) return true
  }
  return false
}

/** The latin word immediately before `pos` inside its textblock — for a/an linking.
 * Trailing marker atoms (\0) and whitespace are skipped so `a |cat|` finds `a`. */
export function wordBefore(doc: PMNode, pos: number): { word: string; from: number; to: number } | null {
  const $pos = doc.resolve(pos)
  if (!$pos.parent.isTextblock) return null
  const raw = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 80), $pos.parentOffset, '\0', '\0')
  const trailing = /[\0\s]+$/.exec(raw)?.[0].length ?? 0
  const str = raw.slice(0, raw.length - trailing)
  const m = /([A-Za-z]+)$/.exec(str)
  if (m === null) return null
  const wordEnd = pos - trailing
  return { word: m[1], from: wordEnd - m[1].length, to: wordEnd }
}

/** First latin word of a replacement text — the word that follows the article. */
export function firstWord(text: string): string {
  const m = /[A-Za-z]+/.exec(text)
  return m === null ? '' : m[0]
}
