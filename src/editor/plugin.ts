import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Step } from 'prosemirror-transform'
import type { Entities, VariantGroup } from '../domain/entities.js'
import { emptyEntities } from '../domain/entities.js'
import { newId } from '../domain/ids.js'
import { fragmentJSON, groupRange, liveGroupIds, stepsTouchRange } from './model.js'

/** Entity patch entry: a record value replaces the entity, null deletes it. */
export interface EntityPatch {
  __replace?: Entities
  groups?: Record<string, VariantGroup | null>
  ghosts?: Record<string, { id: string; createdAt: number } | null>
  overflow?: Entities['overflow'] extends Record<string, infer T> ? Record<string, T | null> : never
  runs?: Entities['runs'] extends Record<string, infer T> ? Record<string, T | null> : never
}

function applyPatch(entities: Entities, patch: EntityPatch): Entities {
  if (patch.__replace !== undefined) return patch.__replace
  const out: Entities = { ...entities, groups: { ...entities.groups }, ghosts: { ...entities.ghosts }, overflow: { ...entities.overflow }, runs: { ...entities.runs } }
  for (const [k, v] of Object.entries(patch.groups ?? {})) {
    if (v === null) delete out.groups[k]
    else out.groups[k] = v
  }
  for (const [k, v] of Object.entries(patch.ghosts ?? {})) {
    if (v === null) delete out.ghosts[k]
    else out.ghosts[k] = v
  }
  for (const [k, v] of Object.entries(patch.overflow ?? {})) {
    if (v === null) delete out.overflow[k]
    else out.overflow[k] = v
  }
  for (const [k, v] of Object.entries(patch.runs ?? {})) {
    if (v === null) delete out.runs[k]
    else out.runs[k] = v
  }
  return out
}

export interface EntitiesState {
  entities: Entities
  /** Monotonic counter of document-changing transactions — the revision anchors reference. */
  contentVersion: number
}

export const entitiesKey = new PluginKey<EntitiesState>('writeon-entities')

function cloneEntities(e: Entities): Entities {
  return JSON.parse(JSON.stringify(e)) as Entities
}

/**
 * Post-edit reconciliation inside one apply (never a second transaction):
 * - groups whose markers disappeared become tombstones (kept for undo)
 * - typing inside the live ORIGINAL option forks a new author option so the
 *   original snapshot stays immutable; typing inside an AI option stamps
 *   editedBy=user
 * Transactions tagged `writeon:noReconcile` (undo/replay/structured inserts)
 * skip this pass entirely.
 */
function reconcile(entities: Entities, tr: Transaction, state: EditorState): Entities {
  if (tr.getMeta('writeon:noReconcile') === true) return entities
  const live = liveGroupIds(state.doc)
  let out: Entities | null = null
  const ensure = () => {
    if (out === null) out = { ...entities, groups: { ...entities.groups } }
    return out
  }
  for (const [gid, group] of Object.entries(entities.groups)) {
    const scope = group.scope
    const inDoc = live.has(gid)
    const range = groupRange(state.doc, gid, scope)
    if (!group.deleted && (!inDoc || range === null)) {
      ensure().groups[gid] = { ...group, deleted: true }
      continue
    }
    if (group.deleted || range === null) continue
    const touched = stepsTouchRange(tr.steps as never[], range.innerFrom, range.innerTo)
    if (!touched) continue
    if (group.currentOptionId === group.originalOptionId) {
      const original = group.options[group.originalOptionId]
      const fork = {
        id: newId('opt'),
        origin: 'author' as const,
        editedBy: 'user' as const,
        fragment: fragmentJSON(state.doc, range.innerFrom, range.innerTo),
        createdAt: Date.now(),
      }
      const next: VariantGroup = {
        ...group,
        currentOptionId: fork.id,
        options: { ...group.options, [fork.id]: { ...fork, origin: original !== undefined && original.origin === 'ai' ? 'ai' : 'author' } },
      }
      ensure().groups[gid] = next
    } else {
      const cur = group.options[group.currentOptionId]
      if (cur !== undefined && cur.origin === 'ai' && cur.editedBy !== 'user') {
        const next: VariantGroup = {
          ...group,
          options: { ...group.options, [cur.id]: { ...cur, editedBy: 'user' } },
        }
        ensure().groups[gid] = next
      }
    }
  }
  return out ?? entities
}

export function entitiesPlugin(): Plugin<EntitiesState> {
  return new Plugin<EntitiesState>({
    key: entitiesKey,
    state: {
      init: (_config, _state): EntitiesState => ({ entities: emptyEntities(), contentVersion: 0 }),
      apply: (tr, prev, _old, state): EntitiesState => {
        let entities = prev.entities
        const patch = tr.getMeta(entitiesKey) as EntityPatch | undefined
        if (patch !== undefined) entities = applyPatch(entities, patch)
        if (!tr.docChanged) return { entities, contentVersion: prev.contentVersion }
        entities = reconcile(entities, tr, state)
        return { entities, contentVersion: prev.contentVersion + 1 }
      },
    },
  })
}

export function getEntities(state: EditorState): EntitiesState {
  return entitiesKey.getState(state) ?? { entities: emptyEntities(), contentVersion: 0 }
}

// ---------------------------------------------------------------------------
// Decorations plugin — ephemeral overlays only (trim preview, diagnostics,
// focus dimming). Ghost dimming lives on the ghost mark itself; variant
// boundary markers render through their own node classes. The three dimming
// models never share a representation.
// ---------------------------------------------------------------------------

export interface DecoSpec {
  kind: 'trim' | 'diag' | 'focusdim' | 'hint'
  from: number
  to: number
  /** extra css class suffix, e.g. goal name for diag */
  cls?: string
}

export const decoKey = new PluginKey<DecorationSet>('writeon-deco')

export function decoPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: decoKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set, _old, state) => {
        const specs = tr.getMeta(decoKey) as DecoSpec[] | undefined
        if (specs !== undefined) {
          return DecorationSet.create(state.doc, specs.map(s =>
            Decoration.inline(s.from, s.to, { class: `wod-${s.kind}${s.cls !== undefined ? ` ${s.cls}` : ''}` }, { spec: s })))
        }
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
      },
    },
    props: {
      decorations: state => decoKey.getState(state),
    },
  })
}

export function setDecorations(state: EditorState, specs: DecoSpec[]): Transaction {
  return state.tr.setMeta(decoKey, specs)
}

// ---------------------------------------------------------------------------
// Undo — custom history that records entity-table snapshots alongside inverted
// steps, so domain commands (variant select, stash, apply-trim…) revert
// atomically: one undo restores document AND entities together.
// ---------------------------------------------------------------------------

interface UndoEntry {
  /** Forward steps of the recorded transaction (for redo). */
  steps: Step[]
  /** Inverted steps against the pre-transaction doc (for undo). */
  inverted: Step[]
  entitiesBefore: Entities
  entitiesAfter: Entities
  selBefore: { from: number; to: number }
  selAfter: { from: number; to: number }
  time: number
  tag: string
}

interface UndoState {
  undo: UndoEntry[]
  redo: UndoEntry[]
}

export const undoKey = new PluginKey<UndoState>('writeon-undo')
const GROUP_MS = 700

function invertSteps(tr: Transaction, beforeDoc: Parameters<Step['invert']>[0]): Step[] {
  // Re-apply each step to reconstruct the intermediate docs its successors invert against.
  const inverted: Step[] = []
  let doc = beforeDoc
  for (const step of tr.steps) {
    inverted.push(step.invert(doc))
    const res = step.apply(doc)
    if (res.doc == null) break
    doc = res.doc
  }
  return inverted
}

export function undoPlugin(): Plugin<UndoState> {
  return new Plugin<UndoState>({
    key: undoKey,
    state: {
      init: (): UndoState => ({ undo: [], redo: [] }),
      apply: (tr, prev, old, state): UndoState => {
        const op = tr.getMeta('writeon:historyOp') as 'undo' | 'redo' | undefined
        if (op === 'undo') {
          const entry = prev.undo[prev.undo.length - 1]
          return entry === undefined ? prev : { undo: prev.undo.slice(0, -1), redo: [...prev.redo, entry] }
        }
        if (op === 'redo') {
          const entry = prev.redo[prev.redo.length - 1]
          return entry === undefined ? prev : { undo: [...prev.undo, entry], redo: prev.redo.slice(0, -1) }
        }
        if (tr.getMeta('writeon:noHistory') === true) return prev
        const hasEntityPatch = tr.getMeta(entitiesKey) !== undefined
        if (!tr.docChanged && !hasEntityPatch) return prev
        const entities = getEntities(state).entities
        const entitiesBefore = getEntities(old).entities
        const tag = (tr.getMeta('writeon:undoTag') as string | undefined) ?? (tr.docChanged ? 'edit' : 'entities')
        const entry: UndoEntry = {
          steps: [...tr.steps],
          inverted: tr.docChanged ? invertSteps(tr, old.doc) : [],
          entitiesBefore: cloneEntities(entitiesBefore),
          entitiesAfter: cloneEntities(entities),
          selBefore: { from: old.selection.from, to: old.selection.to },
          selAfter: { from: state.selection.from, to: state.selection.to },
          time: Date.now(),
          tag,
        }
        const undo = [...prev.undo]
        const last = undo[undo.length - 1]
        // Group consecutive same-tag edits (typing bursts, IME commits).
        if (last !== undefined && last.tag === tag && tr.docChanged && entry.time - last.time < GROUP_MS && last.steps.length > 0) {
          last.steps.push(...entry.steps)
          // Undo walks inverted[] from the end, so the newer transaction's
          // inversions belong at the tail — unshift would invert the older
          // steps against a doc they were not built for and step() would throw.
          last.inverted.push(...entry.inverted)
          last.entitiesAfter = entry.entitiesAfter
          last.selAfter = entry.selAfter
          last.time = entry.time
        } else {
          undo.push(entry)
          if (undo.length > 400) undo.shift()
        }
        return { undo, redo: [] }
      },
    },
  })
}

export function canUndo(state: EditorState): boolean {
  return (undoKey.getState(state)?.undo.length ?? 0) > 0
}
export function canRedo(state: EditorState): boolean {
  return (undoKey.getState(state)?.redo.length ?? 0) > 0
}

function restoreSelection(tr: Transaction, sel: { from: number; to: number }): void {
  const max = tr.doc.content.size
  const from = Math.min(sel.from, max)
  const to = Math.min(sel.to, max)
  try {
    tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to), -1))
  } catch {
    tr.setSelection(Selection.atEnd(tr.doc))
  }
}

/** Undo the most recent recorded transaction: restores doc, entities, and selection atomically. */
export function undoCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const entry = undoKey.getState(state)?.undo.at(-1)
  if (entry === undefined) return false
  if (dispatch !== undefined) {
    const tr = state.tr
    for (let i = entry.inverted.length - 1; i >= 0; i -= 1) tr.step(entry.inverted[i])
    tr.setMeta(entitiesKey, { __replace: entry.entitiesBefore } satisfies EntityPatch)
    restoreSelection(tr, entry.selBefore)
    tr.setMeta('writeon:historyOp', 'undo')
    tr.setMeta('writeon:noReconcile', true)
    tr.setMeta('writeon:undoTag', 'undo')
    dispatch(tr)
  }
  return true
}

/** Redo replays the recorded forward steps plus the entity snapshot — one entry, one transaction. */
export function redoCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const entry = undoKey.getState(state)?.redo.at(-1)
  if (entry === undefined) return false
  if (dispatch !== undefined) {
    const tr = state.tr
    for (const step of entry.steps) tr.step(step)
    tr.setMeta(entitiesKey, { __replace: entry.entitiesAfter } satisfies EntityPatch)
    restoreSelection(tr, entry.selAfter)
    tr.setMeta('writeon:historyOp', 'redo')
    tr.setMeta('writeon:noReconcile', true)
    tr.setMeta('writeon:undoTag', 'redo')
    dispatch(tr)
  }
  return true
}
