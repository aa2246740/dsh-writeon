import { Slice, Fragment, type Node as PMNode } from 'prosemirror-model'
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import type { Entities, LabRun, OverflowItem, Proposal, Scope, VariantGroup, VariantOption } from '../domain/entities.js'
import { newId } from '../domain/ids.js'
import { articleFor, isArticle, matchCase } from '../domain/article.js'
import { schema } from './schema.js'
import { entitiesKey, type EntityPatch } from './plugin.js'
import { expandToEnclose, expandToWholeGroups, firstWord, fragmentJSON, ghostRanges, groupRange, partialCross, singleTextblock, wordBefore } from './model.js'

/**
 * Domain commands: every mutation is ONE PM transaction carrying doc steps
 * plus an entity patch, so undo/redo restores both atomically. Commands are
 * pure transforms — they never dispatch; the controller does.
 */

export type CmdResult = { ok: true; tr: Transaction } | { ok: false; error: string; conflicts?: string[] }
const ok = (tr: Transaction): CmdResult => ({ ok: true, tr })
const fail = (error: string, conflicts?: string[]): CmdResult => ({ ok: false, error, conflicts })

function gidScopes(entities: Entities): Map<string, Scope> {
  const m = new Map<string, Scope>()
  for (const [id, g] of Object.entries(entities.groups)) if (!g.deleted) m.set(id, g.scope)
  return m
}

function groupRangeOrNull(state: EditorState, group: VariantGroup) {
  return groupRange(state.doc, group.id, group.scope)
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** Create a variant group over the current selection. */
export function createVariant(state: EditorState, entities: Entities, scope: Scope): CmdResult {
  const { from, to, empty } = state.selection
  if (empty) return fail('empty-selection')
  const scopes = gidScopes(entities)
  const conflicts = partialCross(state.doc, from, to, scopes)
  if (conflicts.length > 0) return fail('partial-cross', conflicts)

  const gid = newId(scope === 'paragraph' ? 'vp' : scope === 'sentence' ? 'vs' : 'vw')
  const now = Date.now()
  const tr = state.tr

  if (scope === 'paragraph') {
    // Auto-expand to whole sibling blocks under the selection's shared parent.
    const $from = state.doc.resolve(from)
    const $to = state.doc.resolve(to)
    const range = $from.blockRange($to)
    if (range === null) return fail('cross-block')
    const parentStart = $from.start(range.depth)
    let coverFrom = -1
    let coverTo = -1
    range.parent.forEach((child, off, i) => {
      if (i === range.startIndex) coverFrom = parentStart + off
      if (i === range.endIndex - 1) coverTo = parentStart + off + child.nodeSize
    })
    if (coverFrom < 0 || coverTo < 0) return fail('cross-block')
    const fragment = fragmentJSON(state.doc, coverFrom, coverTo)
    const opt: VariantOption = { id: newId('opt'), origin: 'author', fragment, createdAt: now }
    const group: VariantGroup = { id: gid, scope, originalOptionId: opt.id, currentOptionId: opt.id, options: { [opt.id]: opt }, createdAt: now }
    tr.wrap(range, [{ type: schema.nodes.vblock, attrs: { gid } }])
    tr.setMeta(entitiesKey, { groups: { [gid]: group } } satisfies EntityPatch)
    tr.setMeta('writeon:noReconcile', true)
    return ok(tr)
  }

  if (singleTextblock(state.doc, from, to) === null) return fail('cross-block')
  const fragment = fragmentJSON(state.doc, from, to)
  const opt: VariantOption = { id: newId('opt'), origin: 'author', fragment, createdAt: now }
  const group: VariantGroup = { id: gid, scope, originalOptionId: opt.id, currentOptionId: opt.id, options: { [opt.id]: opt }, createdAt: now }
  tr.insert(to, schema.nodes.vend.create({ gid }))
  tr.insert(from, schema.nodes.vstart.create({ gid }))
  tr.setMeta(entitiesKey, { groups: { [gid]: group } } satisfies EntityPatch)
  tr.setMeta('writeon:noReconcile', true)
  return ok(tr)
}

/** Expand a would-be variant range to fully cover every partially crossed group. */
export function expandVariantRange(state: EditorState, entities: Entities): { from: number; to: number } {
  const { from, to } = state.selection
  return expandToWholeGroups(state.doc, from, to, gidScopes(entities))
}

/** Replace a group's live range with another option — the atomic variant switch. */
export function selectOption(state: EditorState, entities: Entities, gid: string, optionId: string): CmdResult {
  const group = entities.groups[gid]
  if (group === undefined || group.deleted) return fail('no-group')
  const target = group.options[optionId]
  if (target === undefined) return fail('no-option')
  const range = groupRangeOrNull(state, group)
  if (range === null) return fail('no-range')

  const tr = state.tr
  // Write the outgoing live content back into its option (original never mutates).
  const options = { ...group.options }
  const outgoing = group.options[group.currentOptionId]
  if (outgoing !== undefined && group.currentOptionId !== group.originalOptionId) {
    options[outgoing.id] = { ...outgoing, fragment: fragmentJSON(state.doc, range.innerFrom, range.innerTo) }
  }
  const nodes = (target.fragment as unknown[]).map(n => schema.nodeFromJSON(n))
  const isInline = nodes.length === 0 || nodes[0].isInline
  if (isInline && group.scope !== 'paragraph') {
    tr.replace(range.innerFrom, range.innerTo, new Slice(Fragment.from(nodes), 0, 0))
  } else if (!isInline && group.scope === 'paragraph') {
    tr.replace(range.innerFrom, range.innerTo, new Slice(Fragment.from(nodes), 0, 0))
  } else {
    return fail('scope-mismatch')
  }

  // a/an linking in the SAME transaction — conservative when pronunciation unknown.
  if (group.scope === 'word') {
    const prev = wordBefore(state.doc, range.innerFrom)
    const replacementText = nodes.map(n => n.textContent).join('')
    const next = isArticle(prev?.word ?? '') ? articleFor(firstWord(replacementText)) : null
    if (prev !== null && next !== null && prev.word.toLowerCase() !== next) {
      tr.insertText(matchCase(prev.word, next), prev.from, prev.to)
    }
  }

  options[target.id] = target
  tr.setMeta(entitiesKey, {
    groups: { [gid]: { ...group, currentOptionId: optionId, options } },
  } satisfies EntityPatch)
  return ok(tr)
}

/** Cycle to the next/previous option (order: original first, then by createdAt). */
export function cycleOption(state: EditorState, entities: Entities, gid: string, dir: 1 | -1): CmdResult {
  const group = entities.groups[gid]
  if (group === undefined || group.deleted) return fail('no-group')
  const order = Object.values(group.options).sort((a, b) =>
    (a.id === group.originalOptionId ? -1 : b.id === group.originalOptionId ? 1 : a.createdAt - b.createdAt))
  const idx = order.findIndex(o => o.id === group.currentOptionId)
  const next = order[(idx + dir + order.length) % order.length]
  if (next === undefined || next.id === group.currentOptionId) return fail('no-next')
  return selectOption(state, entities, gid, next.id)
}

/** Append AI (or manual) options to a group without switching. */
export function addOptions(state: EditorState, entities: Entities, gid: string, texts: string[], origin: 'author' | 'ai', scope: Scope): CmdResult {
  const group = entities.groups[gid]
  if (group === undefined || group.deleted) return fail('no-group')
  const options = { ...group.options }
  const now = Date.now()
  for (const t of texts) {
    const text = t.trim()
    if (text === '') continue
    const fragment = scope === 'paragraph'
      ? [{ type: 'paragraph', content: [{ type: 'text', text }] }]
      : [{ type: 'text', text }]
    const opt: VariantOption = { id: newId('opt'), origin, fragment, createdAt: now }
    options[opt.id] = opt
  }
  const tr = state.tr.setMeta(entitiesKey, { groups: { [gid]: { ...group, options } } } satisfies EntityPatch)
  return ok(tr)
}

/** Update an option's text from the panel; live range replaced when it is active. */
export function editOptionText(state: EditorState, entities: Entities, gid: string, optionId: string, text: string): CmdResult {
  const group = entities.groups[gid]
  const opt = group?.options[optionId]
  if (group === undefined || opt === undefined || group.deleted) return fail('no-option')
  const isBlock = group.scope === 'paragraph'
  const fragment = isBlock
    ? [{ type: 'paragraph', content: text === '' ? undefined : [{ type: 'text', text }] }]
    : [{ type: 'text', text }]
  const options = { ...group.options, [optionId]: { ...opt, fragment } }
  const tr = state.tr
  if (group.currentOptionId === optionId) {
    const range = groupRangeOrNull(state, group)
    if (range === null) return fail('no-range')
    const nodes = fragment.map(n => schema.nodeFromJSON(n))
    tr.replace(range.innerFrom, range.innerTo, new Slice(Fragment.from(nodes), 0, 0))
    tr.setMeta('writeon:noReconcile', true)
  }
  tr.setMeta(entitiesKey, { groups: { [gid]: { ...group, options } } } satisfies EntityPatch)
  return ok(tr)
}

/** Remove an option (original can never be removed; removing the active one reverts to original). */
export function deleteOption(state: EditorState, entities: Entities, gid: string, optionId: string): CmdResult {
  const group = entities.groups[gid]
  if (group === undefined || group.deleted) return fail('no-group')
  if (optionId === group.originalOptionId) return fail('original-immutable')
  const opt = group.options[optionId]
  if (opt === undefined) return fail('no-option')
  const options = { ...group.options }
  delete options[optionId]
  const tr = state.tr
  if (group.currentOptionId === optionId) {
    const range = groupRangeOrNull(state, group)
    if (range === null) return fail('no-range')
    const orig = group.options[group.originalOptionId]
    const nodes = (orig.fragment as unknown[]).map(n => schema.nodeFromJSON(n))
    tr.replace(range.innerFrom, range.innerTo, new Slice(Fragment.from(nodes), 0, 0))
    tr.setMeta('writeon:noReconcile', true)
  }
  tr.setMeta(entitiesKey, {
    groups: { [gid]: { ...group, currentOptionId: group.currentOptionId === optionId ? group.originalOptionId : group.currentOptionId, options } },
  } satisfies EntityPatch)
  return ok(tr)
}

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

/** Ghost the current selection: one ghost span per contiguous covered run. */
export function ghostSelection(state: EditorState): CmdResult {
  const { from, to, empty } = state.selection
  if (empty) return fail('empty-selection')
  // Refuse to ghost over an already-ghosted position (a second sid would orphan the first).
  let already = false
  state.doc.nodesBetween(from, to, node => {
    if (node.isText && node.marks.some(m => m.type.name === 'ghost')) already = true
    return true
  })
  if (already) return fail('already-ghost')
  const sid = newId('gh')
  const tr = state.tr.addMark(from, to, schema.marks.ghost.create({ sid }))
  tr.setMeta(entitiesKey, { ghosts: { [sid]: { id: sid, createdAt: Date.now() } } } satisfies EntityPatch)
  return ok(tr)
}

/** Revive: remove the ghost mark over the span under `pos` (or over `sid`). */
export function reviveGhost(state: EditorState, at: { pos?: number; sid?: string }): CmdResult {
  let sid = at.sid
  if (sid === undefined && at.pos !== undefined) {
    for (const r of ghostRanges(state.doc)) {
      if (at.pos >= r.from && at.pos <= r.to) { sid = r.sid; break }
    }
  }
  if (sid === undefined) return fail('no-ghost')
  const ranges = ghostRanges(state.doc).filter(r => r.sid === sid)
  if (ranges.length === 0) return fail('no-ghost')
  const tr = state.tr
  for (const r of ranges) tr.removeMark(r.from, r.to, schema.marks.ghost)
  tr.setMeta(entitiesKey, { ghosts: { [sid]: null } } satisfies EntityPatch)
  return ok(tr)
}

// ---------------------------------------------------------------------------
// Overflow
// ---------------------------------------------------------------------------

/**
 * Stash the selection into Overflow: auto-expands to whole variant boundaries,
 * cuts the range, and records the cut content plus the ids of the entities it
 * carries. Entity records stay in the table as tombstones — the item can
 * always be pasted back (copies get fresh ids).
 */
export function stashSelection(state: EditorState, entities: Entities): CmdResult {
  const sel = state.selection
  if (sel.empty) return fail('empty-selection')
  const scopes = gidScopes(entities)
  const { from, to } = expandToEnclose(state.doc, sel.from, sel.to, scopes)
  const fragment = fragmentJSON(state.doc, from, to)
  // Entity ids referenced inside the fragment.
  const groupIds: string[] = []
  const ghostIds: string[] = []
  const walk = (nodes: unknown[]) => {
    for (const n of nodes as { type?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: unknown[] }[]) {
      if ((n.type === 'vstart' || n.type === 'vend' || n.type === 'vblock') && typeof n.attrs?.gid === 'string') {
        if (!groupIds.includes(n.attrs.gid)) groupIds.push(n.attrs.gid)
      }
      for (const m of n.marks ?? []) if (m.type === 'ghost' && typeof m.attrs?.sid === 'string' && !ghostIds.includes(m.attrs.sid)) ghostIds.push(m.attrs.sid)
      if (Array.isArray(n.content)) walk(n.content)
    }
  }
  walk(fragment)
  const item: OverflowItem = {
    id: newId('ov'),
    fragment,
    entities: {
      groups: Object.fromEntries(groupIds.map(g => [g, entities.groups[g]]).filter(([, v]) => v !== undefined)),
      ghostIds,
    },
    createdAt: Date.now(),
  }
  const tr = state.tr.delete(from, to)
  tr.setMeta(entitiesKey, { overflow: { [item.id]: item } } satisfies EntityPatch)
  return ok(tr)
}

function remapFragmentIds(fragment: unknown[], gidMap: Map<string, string>, sidMap: Map<string, string>): unknown[] {
  const clone = JSON.parse(JSON.stringify(fragment)) as { type?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: unknown[] }[]
  const walk = (nodes: typeof clone) => {
    for (const n of nodes) {
      if (n.attrs !== undefined) {
        if (typeof n.attrs.gid === 'string' && gidMap.has(n.attrs.gid)) n.attrs.gid = gidMap.get(n.attrs.gid)
        if (typeof n.attrs.sid === 'string' && sidMap.has(n.attrs.sid)) n.attrs.sid = sidMap.get(n.attrs.sid)
      }
      for (const m of n.marks ?? []) {
        if (m.attrs !== undefined && typeof m.attrs.sid === 'string' && sidMap.has(m.attrs.sid)) m.attrs.sid = sidMap.get(m.attrs.sid)
      }
      if (Array.isArray(n.content)) walk(n.content as typeof clone)
    }
  }
  walk(clone)
  return clone
}

/**
 * Paste an Overflow item back: always a copy with fresh entity ids (the panel
 * item stays). `at` defaults to the end of the document as new blocks.
 */
export function insertOverflowCopy(state: EditorState, entities: Entities, itemId: string, at?: number): CmdResult {
  const item = entities.overflow[itemId]
  if (item === undefined) return fail('no-item')
  const gidMap = new Map<string, string>()
  const sidMap = new Map<string, string>()
  for (const gid of Object.keys(item.entities.groups)) gidMap.set(gid, newId('vg'))
  for (const sid of item.entities.ghostIds) sidMap.set(sid, newId('gh'))
  const remapped = remapFragmentIds(item.fragment, gidMap, sidMap)
  const nodes = remapped.map(n => schema.nodeFromJSON(n))
  const isInline = nodes.length > 0 && nodes[0].isInline

  const pos = at ?? (isInline ? state.selection.from : state.doc.content.size)
  const tr = state.tr.insert(pos, Fragment.from(nodes))
  const groupsPatch: Record<string, VariantGroup> = {}
  const ghostsPatch: Record<string, { id: string; createdAt: number }> = {}
  for (const [oldGid, src] of Object.entries(item.entities.groups)) {
    const newGid = gidMap.get(oldGid)
    if (newGid === undefined) continue
    groupsPatch[newGid] = { ...(src as VariantGroup), id: newGid, deleted: false }
  }
  for (const [oldSid, newSid] of sidMap) ghostsPatch[newSid] = { id: newSid, createdAt: Date.now() }
  tr.setMeta(entitiesKey, { groups: groupsPatch, ghosts: ghostsPatch } satisfies EntityPatch)
  tr.setMeta('writeon:noReconcile', true)
  return ok(tr)
}

/** Edit an overflow item's stored fragment from the panel (plain-text rewrite). */
export function updateOverflowText(state: EditorState, entities: Entities, itemId: string, text: string): CmdResult {
  const item = entities.overflow[itemId]
  if (item === undefined) return fail('no-item')
  const fragment = [{ type: 'paragraph', content: text === '' ? undefined : [{ type: 'text', text }] }]
  const next: OverflowItem = { ...item, fragment, entities: { groups: {}, ghostIds: [] } }
  const tr = state.tr.setMeta(entitiesKey, { overflow: { [itemId]: next } } satisfies EntityPatch)
  return ok(tr)
}

export function deleteOverflowItem(state: EditorState, itemId: string): CmdResult {
  const tr = state.tr.setMeta(entitiesKey, { overflow: { [itemId]: null } } satisfies EntityPatch)
  return ok(tr)
}

// ---------------------------------------------------------------------------
// Lab runs / proposals
// ---------------------------------------------------------------------------

export function putRun(state: EditorState, run: LabRun): CmdResult {
  const tr = state.tr.setMeta(entitiesKey, { runs: { [run.id]: run } } satisfies EntityPatch)
  return ok(tr)
}

export function updateRun(state: EditorState, entities: Entities, runId: string, mutate: (run: LabRun) => LabRun): CmdResult {
  const run = entities.runs[runId]
  if (run === undefined) return fail('no-run')
  const tr = state.tr.setMeta(entitiesKey, { runs: { [runId]: mutate(run) } } satisfies EntityPatch)
  return ok(tr)
}

export function setProposalStatus(state: EditorState, entities: Entities, runId: string, proposalId: string, status: Proposal['status']): CmdResult {
  const run = entities.runs[runId]
  if (run === undefined) return fail('no-run')
  const proposals = run.proposals.map(p => p.id === proposalId ? { ...p, status } : p)
  const tr = state.tr.setMeta(entitiesKey, { runs: { [runId]: { ...run, proposals } } } satisfies EntityPatch)
  return ok(tr)
}

/**
 * Commit a trim run: validates every still-pending/cut proposal against the
 * CURRENT document, then deletes them all in one transaction. Any invalid or
 * boundary-crossing cut marks the run conflict and nothing is applied —
 * Make-the-cuts is all-or-nothing.
 */
export function applyTrimCuts(
  state: EditorState,
  entities: Entities,
  runId: string,
  leafs: { leafId: string; textStart: number }[],
): CmdResult {
  const run = entities.runs[runId]
  if (run === undefined) return fail('no-run')
  if (run.status !== 'pending' && run.status !== 'done') return fail(`run-${run.status}`)
  const cuts = run.proposals.filter(p => p.status === 'pending' || p.status === 'cut')
  const spans: { from: number; to: number; id: string }[] = []
  for (const p of cuts) {
    const leaf = leafs.find(l => l.leafId === p.anchor.leafId)
    if (leaf === undefined) {
      return fail('conflict', [p.id])
    }
    const from = leaf.textStart + p.anchor.from
    const to = leaf.textStart + p.anchor.to
    // Re-verify the quote at apply time — the anchor must still hit the same text.
    if (state.doc.textBetween(from, to, '\0', '\0') !== p.anchor.quote) return fail('conflict', [p.id])
    // A cut must not swallow variant boundary markers.
    let crossesMarker = false
    state.doc.nodesBetween(from, to, node => {
      if (node.type.name === 'vstart' || node.type.name === 'vend' || node.type.name === 'vblock') crossesMarker = true
      return true
    })
    if (crossesMarker) return fail('conflict', [p.id])
    spans.push({ from, to, id: p.id })
  }
  spans.sort((a, b) => b.from - a.from)
  const tr = state.tr
  for (const s of spans) tr.delete(s.from, s.to)
  const proposals = run.proposals.map(p =>
    cuts.some(c => c.id === p.id) ? { ...p, status: 'cut' as const } : p)
  tr.setMeta(entitiesKey, { runs: { [runId]: { ...run, proposals, status: 'applied' } } } satisfies EntityPatch)
  tr.setMeta('writeon:undoTag', 'trim-apply')
  return ok(tr)
}

/** Restore a trim run's baseline document (the "Original" action after cuts). */
export function restoreBaseline(state: EditorState, entities: Entities, runId: string): CmdResult {
  const run = entities.runs[runId]
  const baseline = run?.baselineDoc
  if (run === undefined || baseline === undefined) return fail('no-baseline')
  const doc = schema.nodeFromJSON(baseline)
  const tr = state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0))
  tr.setMeta('writeon:noReconcile', true)
  tr.setMeta('writeon:undoTag', 'trim-original')
  return ok(tr)
}

/** Move selection into a group's active range (used by panel focus + cycle keys). */
export function selectGroupRange(state: EditorState, entities: Entities, gid: string): CmdResult {
  const group = entities.groups[gid]
  if (group === undefined || group.deleted) return fail('no-group')
  const range = groupRangeOrNull(state, group)
  if (range === null) return fail('no-range')
  const tr = state.tr.setSelection(TextSelection.create(state.doc, range.innerFrom, range.innerTo))
  return ok(tr)
}

/** Group under a document position (smallest containing live range). */
export function groupAt(doc: PMNode, entities: Entities, pos: number): VariantGroup | undefined {
  let best: VariantGroup | undefined
  let bestSize = Infinity
  for (const g of Object.values(entities.groups)) {
    if (g.deleted) continue
    const r = groupRange(doc, g.id, g.scope)
    if (r !== null && pos >= r.from && pos <= r.to && r.to - r.from < bestSize) {
      best = g
      bestSize = r.to - r.from
    }
  }
  return best
}
