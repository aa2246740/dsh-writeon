import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { schema } from '../../src/editor/schema.js'
import { entitiesPlugin, undoPlugin, getEntities, undoCommand, redoCommand, canUndo, canRedo } from '../../src/editor/plugin.js'
import { flatten, groupRange, ghostRanges, liveGroupIds } from '../../src/editor/model.js'
import * as cmd from '../../src/editor/commands.js'
import { emptyEntities, SCHEMA_VERSION, type LabRun } from '../../src/domain/entities.js'

function mkState(text: string, sel?: { from: number; to: number }): EditorState {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: text === '' ? [{ type: 'paragraph' }] : [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
  let state = EditorState.create({ schema, doc, plugins: [entitiesPlugin(), undoPlugin()] })
  if (sel !== undefined) {
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, sel.from, sel.to)))
  }
  return state
}

function entities(state: EditorState) { return getEntities(state).entities }
function apply(state: EditorState, r: ReturnType<typeof cmd.createVariant>): EditorState {
  if (!r.ok) throw new Error(`command failed: ${r.error}`)
  return state.apply(r.tr)
}

describe('createVariant', () => {
  it('word scope wraps selection in markers and records the group', () => {
    let s = mkState('hello world', { from: 7, to: 12 })
    const r = cmd.createVariant(s, entities(s), 'word')
    expect(r.ok).toBe(true)
    s = apply(s, r)
    const groups = entities(s).groups
    expect(Object.keys(groups)).toHaveLength(1)
    const g = Object.values(groups)[0]!
    expect(g.scope).toBe('word')
    expect(g.currentOptionId).toBe(g.originalOptionId)
    const range = groupRange(s.doc, g.id, 'word')!
    expect(s.doc.textBetween(range.innerFrom, range.innerTo)).toBe('world')
  })
  it('paragraph scope wraps the block in a vblock', () => {
    let s = mkState('one paragraph', { from: 1, to: 5 })
    s = apply(s, cmd.createVariant(s, entities(s), 'paragraph'))
    const g = Object.values(entities(s).groups)[0]!
    expect(g.scope).toBe('paragraph')
    const range = groupRange(s.doc, g.id, 'paragraph')!
    expect(s.doc.nodeAt(range.from)!.type.name).toBe('vblock')
    expect(s.doc.textBetween(range.innerFrom, range.innerTo)).toBe('one paragraph')
  })
  it('fails on empty selection', () => {
    const s = mkState('abc', { from: 2, to: 2 })
    expect(cmd.createVariant(s, entities(s), 'word').ok).toBe(false)
  })
  it('partial-cross returns conflicts', () => {
    let s = mkState('hello world and beyond', { from: 7, to: 12 }) // variant on "world"
    s = apply(s, cmd.createVariant(s, entities(s), 'word'))
    // select from inside the group to outside — partially crosses the vend marker
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 9, 20)))
    const r = cmd.createVariant(s, entities(s), 'sentence')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('partial-cross')
  })
  it('full containment nests: word group inside a sentence group', () => {
    let s = mkState('hello brave world', { from: 7, to: 12 }) // "brave"
    s = apply(s, cmd.createVariant(s, entities(s), 'word'))
    // now select the whole sentence including the group
    const leaves = flatten(s.doc)
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, leaves[0]!.textStart, leaves[0]!.textStart + 'hello brave world'.length)))
    const r = cmd.createVariant(s, entities(s), 'sentence')
    expect(r.ok).toBe(true)
    s = apply(s, r)
    expect(Object.keys(entities(s).groups)).toHaveLength(2)
  })
})

describe('selectOption / a-an linking', () => {
  function setupWordVariant(text: string, wordFrom: number, wordTo: number, alts: string[]) {
    let s = mkState(text, { from: wordFrom, to: wordTo })
    s = apply(s, cmd.createVariant(s, entities(s), 'word'))
    const gid = Object.keys(entities(s).groups)[0]!
    s = apply(s, cmd.addOptions(s, entities(s), gid, alts, 'ai', 'word'))
    return { s, gid }
  }
  it('switches the live range to the option text', () => {
    let { s, gid } = setupWordVariant('hello world', 7, 12, ['earth'])
    const aiOpt = Object.values(entities(s).groups[gid]!.options).find(o => o.origin === 'ai')!
    s = apply(s, cmd.selectOption(s, entities(s), gid, aiOpt.id))
    expect(s.doc.textContent).toBe('hello earth')
    expect(entities(s).groups[gid]!.currentOptionId).toBe(aiOpt.id)
  })
  it('a→an in the same transaction when next word starts with vowel', () => {
    let { s, gid } = setupWordVariant('a cat sits', 3, 6, ['owl'])
    const aiOpt = Object.values(entities(s).groups[gid]!.options).find(o => o.origin === 'ai')!
    s = apply(s, cmd.selectOption(s, entities(s), gid, aiOpt.id))
    expect(s.doc.textContent).toBe('an owl sits')
  })
  it('an→a likewise', () => {
    let { s, gid } = setupWordVariant('an owl sits', 4, 7, ['cat'])
    const aiOpt = Object.values(entities(s).groups[gid]!.options).find(o => o.origin === 'ai')!
    s = apply(s, cmd.selectOption(s, entities(s), gid, aiOpt.id))
    expect(s.doc.textContent).toBe('a cat sits')
  })
  it('conservative: article kept when next-word pronunciation is unknown', () => {
    let { s, gid } = setupWordVariant('a cat sits', 3, 6, ['ezzplo']) // vowel-onset, not in any dict/rule
    const aiOpt = Object.values(entities(s).groups[gid]!.options).find(o => o.origin === 'ai')!
    s = apply(s, cmd.selectOption(s, entities(s), gid, aiOpt.id))
    expect(s.doc.textContent).toBe('a ezzplo sits') // 'a' preserved, never guessed
  })
  it('no preceding article → nothing to link', () => {
    let s = mkState('owl sits', { from: 1, to: 4 })
    s = apply(s, cmd.createVariant(s, entities(s), 'word'))
    const gid = Object.keys(entities(s).groups)[0]!
    s = apply(s, cmd.addOptions(s, entities(s), gid, ['cat'], 'ai', 'word'))
    const aiOpt = Object.values(entities(s).groups[gid]!.options).find(o => o.origin === 'ai')!
    s = apply(s, cmd.selectOption(s, entities(s), gid, aiOpt.id))
    expect(s.doc.textContent).toBe('cat sits')
  })
  it('outgoing live content is written back to its option', () => {
    let { s, gid } = setupWordVariant('hello world', 7, 12, ['earth', 'globe'])
    const opts = Object.values(entities(s).groups[gid]!.options).filter(o => o.origin === 'ai')
    s = apply(s, cmd.selectOption(s, entities(s), gid, opts[0]!.id))
    // edit the live range text then switch away — the edited text must persist in the option
    const range = groupRange(s.doc, gid, 'word')!
    s = s.apply(s.tr.insertText('X', range.innerFrom + 1))
    s = apply(s, cmd.selectOption(s, entities(s), gid, opts[1]!.id))
    expect(s.doc.textContent).toBe('hello globe')
    const opt0 = entities(s).groups[gid]!.options[opts[0]!.id]!
    const text = JSON.stringify(opt0.fragment)
    expect(text).toContain('eXarth')
  })
})

describe('fork-on-edit', () => {
  it('typing inside a live original option forks a new author option', () => {
    let s = mkState('hello world', { from: 7, to: 12 })
    s = apply(s, cmd.createVariant(s, entities(s), 'word'))
    const gid = Object.keys(entities(s).groups)[0]!
    const g0 = entities(s).groups[gid]!
    const range = groupRange(s.doc, gid, 'word')!
    s = s.apply(s.tr.insertText('wide ', range.innerFrom))
    const g1 = entities(s).groups[gid]!
    expect(g1.currentOptionId).not.toBe(g0.originalOptionId)
    expect(Object.keys(g1.options)).toHaveLength(2)
    // original fragment unchanged
    expect(JSON.stringify(g1.options[g1.originalOptionId]!.fragment)).toBe(JSON.stringify(g0.options[g0.originalOptionId]!.fragment))
    expect(s.doc.textContent).toBe('hello wide world')
  })
  it('markers deleted → group becomes tombstone', () => {
    let s = mkState('hello world', { from: 7, to: 12 })
    s = apply(s, cmd.createVariant(s, entities(s), 'word'))
    const gid = Object.keys(entities(s).groups)[0]!
    const range = groupRange(s.doc, gid, 'word')!
    s = s.apply(s.tr.delete(range.from, range.to))
    expect(entities(s).groups[gid]!.deleted).toBe(true)
    expect(liveGroupIds(s.doc).has(gid)).toBe(false)
  })
})

describe('ghost', () => {
  it('ghost selection creates a span; revive removes it', () => {
    let s = mkState('some words here', { from: 1, to: 5 })
    s = apply(s, cmd.ghostSelection(s))
    const sid = Object.keys(entities(s).ghosts)[0]!
    const gr = ghostRanges(s.doc)
    expect(gr).toHaveLength(1)
    expect(gr[0]!.sid).toBe(sid)
    s = apply(s, cmd.reviveGhost(s, { sid }))
    expect(ghostRanges(s.doc)).toHaveLength(0)
    expect(Object.keys(entities(s).ghosts)).toHaveLength(0)
  })
  it('refuses to ghost over already-ghosted text', () => {
    let s = mkState('some words here', { from: 1, to: 5 })
    s = apply(s, cmd.ghostSelection(s))
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 2, 8)))
    expect(cmd.ghostSelection(s).ok).toBe(false)
  })
})

describe('overflow stash / insert', () => {
  it('stash cuts text into an overflow item; insert restores a copy with new ids', () => {
    let s = mkState('keep this sentence.', { from: 6, to: 19 })
    s = apply(s, cmd.createVariant(s, entities(s), 'word'))
    const oldGid = Object.keys(entities(s).groups)[0]!
    // stash the whole variant (auto-expands to cover it)
    const g = groupRange(s.doc, oldGid, 'word')!
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, g.innerFrom, g.innerTo)))
    s = apply(s, cmd.stashSelection(s, entities(s)))
    expect(s.doc.textContent).toBe('keep .')
    const item = Object.values(entities(s).overflow)[0]!
    expect(item.entities.groups[oldGid]).toBeDefined()
    // insert a copy — fresh ids, panel item stays
    s = apply(s, cmd.insertOverflowCopy(s, entities(s), item.id))
    expect(s.doc.textContent).toContain('this')
    const newGroups = Object.keys(entities(s).groups).filter(id => entities(s).groups[id]!.deleted !== true)
    expect(newGroups).toHaveLength(1)
    expect(newGroups[0]).not.toBe(oldGid)
    expect(entities(s).overflow[item.id]).toBeDefined() // copy, not move
  })
  it('updateOverflowText rewrites to plain paragraph', () => {
    let s = mkState('stash me', { from: 1, to: 9 })
    s = apply(s, cmd.stashSelection(s, entities(s)))
    const item = Object.values(entities(s).overflow)[0]!
    s = apply(s, cmd.updateOverflowText(s, entities(s), item.id, 'rewritten'))
    const frag = entities(s).overflow[item.id]!.fragment as { content?: { text: string }[] }[]
    expect(frag[0]!.content![0]!.text).toBe('rewritten')
  })
})

describe('trim run apply (all-or-nothing)', () => {
  function mkTrimRun(s: EditorState, quotes: { quote: string; from: number; to: number }[]): LabRun {
    const leaves = flatten(s.doc)
    const leaf = leaves[0]!
    return {
      id: 'run_t1', mode: 'trim', level: 30, baseRevision: 0, baseHash: 'x',
      proposals: quotes.map((q, i) => ({
        id: `p${i}`,
        anchor: { leafId: leaf.leafId, from: q.from, to: q.to, quote: q.quote },
        category: 'trim', status: 'pending' as const,
      })),
      status: 'pending', createdAt: Date.now(),
    }
  }
  it('deletes every cut in one transaction', () => {
    let s = mkState('the quick brown fox')
    // leaf text "the quick brown fox": delete "quick " (4..10) and "fox" (16..19)
    const run = mkTrimRun(s, [
      { quote: 'quick ', from: 4, to: 10 },
      { quote: 'fox', from: 16, to: 19 },
    ])
    s = apply(s, cmd.putRun(s, run))
    const r = cmd.applyTrimCuts(s, entities(s), 'run_t1', flatten(s.doc))
    expect(r.ok).toBe(true)
    s = apply(s, r)
    expect(s.doc.textContent).toBe('the brown ')
    const run2 = entities(s).runs['run_t1']!
    expect(run2.status).toBe('applied')
    expect(run2.proposals.every(p => p.status === 'cut')).toBe(true)
  })
  it('quote mismatch → conflict, nothing applied', () => {
    let s = mkState('the quick brown fox')
    const run = mkTrimRun(s, [{ quote: 'WRONG', from: 4, to: 9 }])
    s = apply(s, cmd.putRun(s, run))
    const r = cmd.applyTrimCuts(s, entities(s), 'run_t1', flatten(s.doc))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('conflict')
    expect(s.doc.textContent).toBe('the quick brown fox')
  })
})

describe('baseline restore + undo', () => {
  it('restoreBaseline puts the stored doc back and clears pending marks', () => {
    let s = mkState('before trim text')
    const baseline = s.doc.toJSON()
    const run: LabRun = {
      id: 'run_b', mode: 'trim', level: 30, baseRevision: 0, baseHash: 'h',
      baselineDoc: baseline,
      proposals: [],
      status: 'pending', createdAt: Date.now(),
    }
    s = apply(s, cmd.putRun(s, run))
    s = s.apply(s.tr.insertText('EXTRA ', 1))
    expect(s.doc.textContent).not.toBe('before trim text')
    s = apply(s, cmd.restoreBaseline(s, entities(s), 'run_b'))
    expect(s.doc.textContent).toBe('before trim text')
  })
  it('undo restores doc and entities atomically', () => {
    let s = mkState('hello world', { from: 7, to: 12 })
    s = apply(s, cmd.createVariant(s, entities(s), 'word'))
    expect(Object.keys(entities(s).groups)).toHaveLength(1)
    // undo: doc back AND group gone
    undoCommand(s, tr => { s = s.apply(tr) })
    expect(s.doc.textContent).toBe('hello world')
    expect(Object.keys(entities(s).groups)).toHaveLength(0)
    expect(Object.keys(liveGroupIds(s.doc))).toHaveLength(0)
    // redo
    redoCommand(s, tr => { s = s.apply(tr) })
    expect(Object.keys(entities(s).groups)).toHaveLength(1)
  })
  it('grouped typing undoes newest-first: two quick edits revert together', () => {
    let s = mkState('')
    s = s.apply(s.tr.insertText('first', 1))
    s = s.apply(s.tr.insertText(' second', s.doc.content.size - 1))
    // both keystroke bursts grouped into one entry (< GROUP_MS apart)
    undoCommand(s, tr => { s = s.apply(tr) })
    expect(s.doc.textContent).toBe('')
    redoCommand(s, tr => { s = s.apply(tr) })
    expect(s.doc.textContent).toBe('first second')
  })
  it('canUndo/canRedo reflect stacks', () => {
    let s = mkState('abc')
    expect(canUndo(s)).toBe(false)
    s = s.apply(s.tr.insertText('x', 1))
    expect(canUndo(s)).toBe(true)
    undoCommand(s, tr => { s = s.apply(tr) })
    expect(s.doc.textContent).toBe('abc')
    expect(canRedo(s)).toBe(true)
  })
})
