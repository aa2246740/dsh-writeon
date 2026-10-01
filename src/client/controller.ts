import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { docHash, validateAnchor, type FlatLeaf } from '../domain/anchors.js'
import { SCHEMA_VERSION, type Entities, type LabRun, type ProjectFile, type VariantGroup } from '../domain/entities.js'
import { newProject } from '../domain/serialize.js'
import { deserializeProject, serializeProject } from '../domain/serialize.js'
import { newId, newRequestId, newRunId } from '../domain/ids.js'
import { countWords, graphemeLength, sentenceRanges, wordRanges } from '../domain/segment.js'
import { computeStats, type DocStats } from '../domain/stats.js'
import { extractJson, type AiProxyRequest } from '../domain/contract.js'
import { validateAlternatives, validateDiagnose, validateTrim } from '../domain/contract-validate.js'
import { alternativesPrompt, labPrompt, trimPrompt, type LabGoal } from '../domain/prompts.js'
import { schema, emptyDoc } from '../editor/schema.js'
import { decoKey, entitiesKey, getEntities, setDecorations, undoCommand, redoCommand, undoPlugin, decoPlugin, entitiesPlugin, canUndo, canRedo, type DecoSpec } from '../editor/plugin.js'
import { anchorPos, flatten, fragmentJSON, ghostRanges, groupRange } from '../editor/model.js'
import * as cmd from '../editor/commands.js'
import { HttpProvider, TestProvider, type AiProvider } from './ai-provider.js'
import { Presence, deleteProject, kvGet, kvSet, listProjects, loadProject, saveProject } from './storage.js'

export interface ModelChoice { provider: string; model: string; label: string }

export interface UiState {
  phase: 'welcome' | 'loading' | 'ready' | 'error'
  projectId: string | null
  projects: { id: string; title: string; updatedAt: number }[]
  saved: 'clean' | 'dirty' | 'saving' | 'error'
  savedAt?: number
  sidePanel: 'none' | 'alternatives' | 'overflow' | 'lab'
  focusGroupId?: string
  hoverGid?: string
  activeRunId?: string
  walkIndex?: number
  models: ModelChoice[]
  modelSel?: ModelChoice
  providerKind: 'http' | 'test' | 'none'
  aiBusy?: string
  notice?: string
  readOnly: boolean
  conflictTab: boolean
  hidden: boolean
  stats: DocStats
  confirmShare?: { kind: 'x'; text: string }
  sharePreview?: { text: string; stats: DocStats }
  error?: string
  language: 'zh' | 'en'
}

type Listener = () => void

const AUTOSAVE_MS = 600

export class WriteOnController {
  private view: EditorView | null = null
  private ui: UiState
  private listeners = new Set<Listener>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private presence = new Presence()
  private pending = new Map<string, { runId: string; kind: string; abort: AbortController }>()
  private provider: AiProvider = new HttpProvider()
  private testProvider = new TestProvider()
  private project: ProjectFile | null = null
  private disposeFns: (() => void)[] = []
  private destroyed = false

  constructor(private host: { selectPanel(id: string | null): void }) {
    this.ui = {
      phase: 'loading', projectId: null, projects: [], saved: 'clean',
      sidePanel: 'none', models: [], providerKind: 'none', readOnly: false,
      conflictTab: false, hidden: false,
      stats: { words: 0, chars: 0, minutes: 0, paragraphs: 0, sentences: 0 },
      language: (navigator.language ?? 'en').startsWith('zh') ? 'zh' : 'en',
    }
  }

  // ---- React bridge -------------------------------------------------------

  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l) }
  getSnapshot = (): UiState => this.ui
  private set(patch: Partial<UiState>): void {
    if (this.destroyed) return
    this.ui = { ...this.ui, ...patch }
    for (const l of this.listeners) l()
  }
  private notice(text: string): void {
    this.set({ notice: text })
    setTimeout(() => { if (this.ui.notice === text) this.set({ notice: undefined }) }, 2600)
  }

  get editorView(): EditorView | null { return this.view }
  get entities(): Entities { return this.view === null ? { groups: {}, ghosts: {}, overflow: {}, runs: {} } : getEntities(this.view.state).entities }
  get contentVersion(): number { return this.view === null ? 0 : getEntities(this.view.state).contentVersion }

  // ---- Lifecycle ----------------------------------------------------------

  async mount(el: HTMLElement): Promise<void> {
    const lastOpen = await kvGet<string>('lastOpenId').catch(() => undefined)
    const projects = await listProjects().catch(() => [])
    this.set({ projects })
    this.initEditor(el)
    const forceTest = new URLSearchParams(location.search).get('woprovider') === 'test'
    if (forceTest) {
      this.provider = this.testProvider
      this.set({ providerKind: 'test' })
    } else {
      this.set({ providerKind: 'http' })
    }
    void this.refreshModels()
    if (lastOpen !== undefined && projects.some(p => p.id === lastOpen)) await this.openDoc(lastOpen)
    else this.set({ phase: 'welcome' })
  }

  private initEditor(el: HTMLElement): void {
    const state = EditorState.create({
      schema,
      plugins: [
        entitiesPlugin(),
        decoPlugin(),
        undoPlugin(),
        keymap({
          'Mod-z': undoCommand,
          'Mod-y': redoCommand,
          'Shift-Mod-z': redoCommand,
          'Shift-Mod-$': redoCommand,
        }),
        keymap(baseKeymap),
      ],
    })
    this.view = new EditorView(el, {
      state,
      dispatchTransaction: tr => this.onTransaction(tr),
      handleDOMEvents: {
        mousemove: (view, ev) => {
          const pos = view.posAtCoords({ left: ev.clientX, top: ev.clientY })
          const gid = pos === null ? undefined : cmd.groupAt(view.state.doc, this.entities, pos.pos)?.id
          if (gid !== this.ui.hoverGid) { this.set({ hoverGid: gid }); this.rebuildDecorations() }
          return false
        },
      },
      editable: () => !this.ui.readOnly,
    })
    this.disposeFns.push(() => { this.view?.destroy(); this.view = null })
  }

  private onTransaction(tr: Transaction): void {
    if (this.view === null) return
    this.view.updateState(this.view.state.apply(tr))
    this.set({
      saved: 'dirty',
      stats: this.computeStats(),
    })
    this.markStaleRuns()
    this.rebuildDecorations()
    this.scheduleSave()
  }

  /** Runs whose base no longer matches the doc become stale on any edit. */
  private markStaleRuns(): void {
    const e = this.entities
    const stale = Object.values(e.runs).filter(r => r.status === 'pending' && r.baseRevision !== this.contentVersion)
    for (const run of stale) {
      this.dispatchEntities({ runs: { [run.id]: { ...run, status: 'stale' } } })
    }
    if (stale.length > 0 && this.ui.activeRunId !== undefined && stale.some(r => r.id === this.ui.activeRunId)) {
      this.set({ activeRunId: undefined, walkIndex: undefined })
      this.notice(this.ui.language === 'zh' ? '预览已失效（文档有改动）' : 'Preview invalidated by edits')
    }
  }

  /** Dispatch an entity-only patch transaction. */
  private dispatchEntities(patch: import('../editor/plugin.js').EntityPatch): void {
    if (this.view === null) return
    const tr = this.view.state.tr.setMeta(entitiesKey, patch)
    this.view.updateState(this.view.state.apply(tr))
  }

  dispatch(cmdResult: cmd.CmdResult, undoTag?: string): boolean {
    if (this.view === null || !cmdResult.ok) {
      if (!cmdResult.ok && cmdResult.error === 'partial-cross') this.notice(this.ui.language === 'zh' ? '选择只部分覆盖了候选——已自动扩展' : 'Selection crossed a variant — expanded')
      return false
    }
    if (undoTag !== undefined) cmdResult.tr.setMeta('writeon:undoTag', undoTag)
    this.onTransaction(cmdResult.tr)
    return true
  }

  private computeStats(): DocStats {
    if (this.view === null) return this.ui.stats
    return computeStats(flatten(this.view.state.doc).map(l => ({ text: l.text })))
  }

  /** Recompute overlay decorations: diagnostics + trim preview + focus dim. */
  rebuildDecorations(): void {
    if (this.view === null) return
    const specs: DecoSpec[] = []
    const e = this.entities
    const doc = this.view.state.doc
    for (const run of Object.values(e.runs)) {
      if (run.status !== 'pending' && run.status !== 'done') continue
      for (const p of run.proposals) {
        if (p.status === 'keep' || p.status === 'cut' || p.status === 'skip') continue
        const leaf = flatten(doc).find(l => l.leafId === p.anchor.leafId)
        if (leaf === undefined) continue
        const from = anchorPos(leaf, p.anchor.from)
        const to = anchorPos(leaf, p.anchor.to)
        if (run.mode === 'trim' && run.id === this.ui.activeRunId) {
          if (p.status === 'pending') specs.push({ kind: 'trim', from, to })
        } else if (run.mode === 'lab-mark' || run.mode === 'lab-fix') {
          specs.push({ kind: 'diag', from, to, cls: p.category })
        }
      }
    }
    // Focus dim: when the alternatives panel has focus, dim everything outside
    // the focused group's active range — a third, separate dimming model.
    if (this.ui.focusGroupId !== undefined) {
      const g = e.groups[this.ui.focusGroupId]
      const r = g === undefined ? null : groupRange(doc, g.id, g.scope)
      if (r !== null) {
        if (r.from > 0) specs.push({ kind: 'focusdim', from: 0, to: r.from })
        if (r.to < doc.content.size) specs.push({ kind: 'focusdim', from: r.to, to: doc.content.size })
      }
    }
    this.view.updateState(this.view.state.apply(setDecorations(this.view.state, specs)))
  }

  // ---- Project persistence ------------------------------------------------

  private snapshot(): ProjectFile {
    const view = this.view
    if (view === null || this.project === null) throw new Error('no doc')
    const e = getEntities(view.state).entities
    // Write back each group's live fragment into its current option (original never touched).
    const groups = { ...e.groups }
    for (const [gid, g] of Object.entries(groups)) {
      if (g.deleted || g.currentOptionId === g.originalOptionId) continue
      const r = groupRange(view.state.doc, gid, g.scope)
      if (r === null) continue
      const cur = g.options[g.currentOptionId]
      if (cur !== undefined) groups[gid] = { ...g, options: { ...g.options, [cur.id]: { ...cur, fragment: fragmentJSON(view.state.doc, r.innerFrom, r.innerTo) } } }
    }
    return {
      ...this.project,
      doc: view.state.doc.toJSON(),
      entities: { ...e, groups },
      meta: { ...this.project.meta, updatedAt: Date.now(), title: this.deriveTitle() },
      revision: this.project.revision + 1,
    }
  }

  private deriveTitle(): string {
    if (this.view === null) return 'Untitled'
    const first = flatten(this.view.state.doc).map(l => l.text.trim()).find(t => t !== '')
    return (first ?? 'Untitled').slice(0, 60)
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.saveNow(), AUTOSAVE_MS)
  }

  async saveNow(): Promise<void> {
    if (this.view === null || this.project === null || this.ui.readOnly) return
    if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null }
    this.set({ saved: 'saving' })
    try {
      const file = this.snapshot()
      await saveProject(file)
      this.project = file
      this.set({ saved: 'clean', savedAt: Date.now() })
      void kvSet('lastOpenId', file.id)
    } catch {
      this.set({ saved: 'error' })
      this.notice(this.ui.language === 'zh' ? '保存失败' : 'Save failed')
    }
  }

  async newDoc(): Promise<void> {
    await this.saveNow()
    const id = newId('doc')
    this.project = newProject(id, emptyDoc().toJSON())
    this.project.revision = 0
    this.loadIntoView(this.project)
    this.set({ phase: 'ready', projectId: id, saved: 'dirty', sidePanel: 'none', conflictTab: false })
    await this.saveNow()
    this.presence.start(id, () => this.set({ conflictTab: true, readOnly: true }))
    this.set({ projects: await listProjects() })
  }

  async openDoc(id: string): Promise<void> {
    const file = await loadProject(id)
    if (file === undefined) { this.notice('not found'); return }
    if (file.schemaVersion !== SCHEMA_VERSION) {
      const r = deserializeProject(serializeProject(file), id)
      if ('error' in r) { this.set({ phase: 'error', error: r.error.detail }); return }
      this.project = r.project
    } else {
      this.project = file
    }
    this.loadIntoView(this.project)
    this.set({ phase: 'ready', projectId: id, saved: 'clean', conflictTab: false, readOnly: false })
    this.presence.stop(this.ui.projectId ?? '')
    this.presence.start(id, () => this.set({ conflictTab: true, readOnly: true }))
    await kvSet('lastOpenId', id)
  }

  private loadIntoView(file: ProjectFile): void {
    if (this.view === null) return
    let doc
    try {
      doc = schema.nodeFromJSON(file.doc)
    } catch {
      doc = emptyDoc()
    }
    const state = EditorState.create({ schema, doc, plugins: this.view.state.plugins })
    this.view.updateState(state)
    // Rehydrate entities: stored entities + tombstoned groups restored as-is.
    const tr = this.view.state.tr.setMeta(entitiesKey, { __replace: file.entities } satisfies import('../editor/plugin.js').EntityPatch)
    tr.setMeta('writeon:noHistory', true)
    tr.setMeta('writeon:noReconcile', true)
    this.view.updateState(this.view.state.apply(tr))
    this.set({ stats: this.computeStats() })
    this.rebuildDecorations()
  }

  async removeDoc(id: string): Promise<void> {
    await deleteProject(id)
    if (this.ui.projectId === id) { this.set({ phase: 'welcome', projectId: null }); return }
    this.set({ projects: await listProjects() })
  }

  async exportDoc(): Promise<void> {
    await this.saveNow()
    if (this.project === null) return
    const blob = new Blob([serializeProject(this.snapshot())], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${this.deriveTitle() || 'writeon'}.writeon.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async importDoc(file: File): Promise<void> {
    const text = await file.text()
    const r = deserializeProject(text, newId('doc'))
    if ('error' in r) {
      this.notice(this.ui.language === 'zh' ? `导入失败：${r.error.detail}` : `Import failed: ${r.error.detail}`)
      return
    }
    await this.saveNow()
    this.project = { ...r.project, id: newId('doc') }
    this.loadIntoView(this.project)
    this.set({ phase: 'ready', projectId: this.project.id, saved: 'dirty' })
    await this.saveNow()
    this.set({ projects: await listProjects() })
  }

  // ---- Editor commands ----------------------------------------------------

  createVariantCmd(scope: 'word' | 'sentence' | 'paragraph'): void {
    if (this.view === null) return
    const sel = this.view.state.selection
    // Caret inside a word → snap to that word for word scope.
    if (sel.empty && scope === 'word') {
      const $pos = sel.$from
      const text = $pos.parent.textContent
      const off = $pos.parentOffset
      const wr = wordRanges(text).find(r => off >= r.from && off <= r.to)
      if (wr !== undefined) {
        const tr = this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, $pos.start() + wr.from, $pos.start() + wr.to))
        this.onTransaction(tr)
      }
    }
    const r = cmd.createVariant(this.view.state, this.entities, scope)
    if (!r.ok && r.error === 'partial-cross') {
      const { from, to } = cmd.expandVariantRange(this.view.state, this.entities)
      this.onTransaction(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, from, to)))
      const r2 = cmd.createVariant(this.view.state, this.entities, scope)
      if (r2.ok) { this.dispatch(r2, 'variant-create'); this.openAlternatives() }
      return
    }
    if (r.ok) { this.dispatch(r, 'variant-create'); this.openAlternatives() }
    else this.notice(r.error)
  }

  openAlternatives(): void { this.set({ sidePanel: 'alternatives' }) }
  openOverflow(): void { this.set({ sidePanel: 'overflow' }) }
  openLab(): void { this.set({ sidePanel: 'lab' }) }
  closePanel(): void { this.set({ sidePanel: 'none', focusGroupId: undefined }); this.rebuildDecorations() }

  selectOption(gid: string, oid: string): void {
    if (this.view === null) return
    this.dispatch(cmd.selectOption(this.view.state, this.entities, gid, oid), 'variant-select')
  }

  cycleOption(gid: string, dir: 1 | -1): void {
    if (this.view === null) return
    this.dispatch(cmd.cycleOption(this.view.state, this.entities, gid, dir), 'variant-cycle')
  }

  editOption(gid: string, oid: string, text: string): void {
    if (this.view === null) return
    this.dispatch(cmd.editOptionText(this.view.state, this.entities, gid, oid, text), 'variant-edit')
  }

  deleteOption(gid: string, oid: string): void {
    if (this.view === null) return
    const r = cmd.deleteOption(this.view.state, this.entities, gid, oid)
    if (r.ok) this.dispatch(r, 'variant-delete')
    else this.notice(this.ui.language === 'zh' ? '原文不可删除' : 'The original cannot be deleted')
  }

  addManualOption(gid: string): void {
    if (this.view === null) return
    const group = this.entities.groups[gid]
    if (group === undefined) return
    const range = groupRange(this.view.state.doc, gid, group.scope)
    const cur = range === null ? '' : this.view.state.doc.textBetween(range.innerFrom, range.innerTo, '\0', '\0')
    this.dispatch(cmd.addOptions(this.view.state, this.entities, gid, [`✍ ${cur}`], 'author', group.scope), 'variant-add')
  }

  ghostToggle(): void {
    if (this.view === null) return
    const sel = this.view.state.selection
    // Caret inside a ghost → revive; selection → ghost it.
    if (sel.empty) {
      const r = cmd.reviveGhost(this.view.state, { pos: sel.from })
      if (r.ok) { this.dispatch(r, 'ghost-revive'); return }
      this.notice(this.ui.language === 'zh' ? '光标不在 Ghost 中' : 'Caret is not inside a ghost')
      return
    }
    const r = cmd.ghostSelection(this.view.state)
    if (r.ok) this.dispatch(r, 'ghost')
    else if (r.error === 'already-ghost') {
      const rv = cmd.reviveGhost(this.view.state, { pos: sel.from })
      if (rv.ok) this.dispatch(rv, 'ghost-revive')
    } else this.notice(r.error)
  }

  reviveGhostAt(pos: number): void {
    if (this.view === null) return
    const r = cmd.reviveGhost(this.view.state, { pos })
    if (r.ok) this.dispatch(r, 'ghost-revive')
  }

  stashSelection(): void {
    if (this.view === null) return
    const r = cmd.stashSelection(this.view.state, this.entities)
    if (r.ok) { this.dispatch(r, 'stash'); this.openOverflow() }
    else this.notice(r.error)
  }

  insertOverflow(itemId: string, at?: number): void {
    if (this.view === null) return
    const r = cmd.insertOverflowCopy(this.view.state, this.entities, itemId, at)
    if (r.ok) this.dispatch(r, 'overflow-insert')
  }

  deleteOverflowItem(itemId: string): void {
    if (this.view === null) return
    this.dispatch(cmd.deleteOverflowItem(this.view.state, itemId), 'overflow-delete')
  }

  updateOverflowText(itemId: string, text: string): void {
    if (this.view === null) return
    this.dispatch(cmd.updateOverflowText(this.view.state, this.entities, itemId, text), 'overflow-edit')
  }

  undo(): void { if (this.view !== null) undoCommand(this.view.state, tr => this.onTransaction(tr)) }
  redo(): void { if (this.view !== null) redoCommand(this.view.state, tr => this.onTransaction(tr)) }
  canUndo(): boolean { return this.view !== null && canUndo(this.view.state) }
  canRedo(): boolean { return this.view !== null && canRedo(this.view.state) }

  // ---- AI pipeline --------------------------------------------------------

  private async refreshModels(): Promise<void> {
    const models = await this.provider.listModels()
    if (models.length === 0 && this.provider.kind === 'http') {
      this.set({ models, providerKind: 'none' })
      return
    }
    this.set({ models, modelSel: this.ui.modelSel ?? models[0] })
  }

  setModel(sel: ModelChoice): void { this.set({ modelSel: sel }) }

  switchProvider(kind: 'http' | 'test'): void {
    this.provider = kind === 'test' ? this.testProvider : new HttpProvider()
    this.set({ providerKind: kind, models: [], modelSel: undefined })
    void this.refreshModels()
  }

  private activeProvider(): AiProvider { return this.provider }

  private async callModel(args: { requestId: string; system?: string; user: string; kind: string; runId: string }): Promise<{ ok: boolean; text?: string; requestId: string }> {
    const sel = this.ui.modelSel
    if (sel === undefined) return { ok: false, requestId: '' }
    const requestId = args.requestId
    const abort = new AbortController()
    this.pending.set(requestId, { runId: args.runId, kind: args.kind, abort })
    this.set({ aiBusy: args.kind })
    const req: AiProxyRequest = { requestId, provider: sel.provider, model: sel.model, user: args.user, system: args.system, temperature: 0.4 }
    try {
      const res = await this.activeProvider().complete(req, abort.signal)
      this.pending.delete(requestId)
      if (this.pending.size === 0) this.set({ aiBusy: undefined })
      return { ok: res.ok, text: res.text, requestId }
    } catch {
      this.pending.delete(requestId)
      if (this.pending.size === 0) this.set({ aiBusy: undefined })
      return { ok: false, requestId }
    }
  }

  cancelAi(): void {
    for (const p of this.pending.values()) p.abort.abort()
    this.pending.clear()
    this.set({ aiBusy: undefined })
  }

  /** AI alternatives for a group: validate then append options. */
  async aiAlternatives(gid: string, count = 3): Promise<void> {
    if (this.view === null) return
    const group = this.entities.groups[gid]
    if (group === undefined) return
    const range = groupRange(this.view.state.doc, gid, group.scope)
    if (range === null) return
    const target = this.view.state.doc.textBetween(range.innerFrom, range.innerTo, '\0', '\0')
    const $r = this.view.state.doc.resolve(range.from)
    const context = $r.parent.isTextblock ? $r.parent.textContent : this.view.state.doc.textBetween(Math.max(0, range.from - 200), Math.min(this.view.state.doc.content.size, range.to + 200), ' ', ' ')
    const leaves = flatten(this.view.state.doc)
    const requestId = newRequestId()
    const base = { requestId, baseRevision: this.contentVersion, baseHash: docHash(leaves) }
    const runId = newRunId()
    const prompt = alternativesPrompt({ requestId, baseRevision: base.baseRevision, baseHash: base.baseHash, scope: group.scope, target, context, count })
    const { ok, text } = await this.callModel({ requestId, user: prompt, kind: 'alternatives', runId })
    if (!ok || text === undefined) { this.notice(this.ui.language === 'zh' ? '模型调用失败' : 'Model call failed'); return }
    const valid = validateAlternatives(extractJson(text), base)
    if (!valid.ok) { this.notice(`AI response rejected: ${valid.reason}`); return }
    this.dispatch(cmd.addOptions(this.view.state, this.entities, gid, valid.response.items.map(i => i.text), 'ai', group.scope), 'variant-ai')
    this.openAlternatives()
  }

  /** Lab goal: diagnose (mark) or fix. */
  async runLab(goal: LabGoal): Promise<void> {
    if (this.view === null) return
    const fix = goal === 'fix-punctuation'
    const leaves = flatten(this.view.state.doc)
    const baseRevision = this.contentVersion
    const baseHash = docHash(leaves)
    const runId = newRunId()
    const requestId = newRequestId()
    const prompt = labPrompt({ requestId, baseRevision, baseHash, goal, fix, leaves: leaves.map(l => ({ leafId: l.leafId, text: l.text })), language: this.ui.language })
    const { ok, text } = await this.callModel({ requestId, user: prompt, kind: fix ? 'fix' : 'diagnose', runId })
    if (!ok || text === undefined) { this.notice(this.ui.language === 'zh' ? '模型调用失败' : 'Model call failed'); return }
    const valid = validateDiagnose(extractJson(text), { requestId, baseRevision, baseHash }, leaves, fix ? 'fix' : 'diagnose')
    if (!valid.ok) {
      this.rejectRun({ id: runId, mode: fix ? 'lab-fix' : 'lab-mark', goal, baseRevision, baseHash, createdAt: Date.now() }, valid.reason)
      return
    }
    const run: LabRun = {
      id: runId, mode: fix ? 'lab-fix' : 'lab-mark', goal, baseRevision, baseHash,
      proposals: valid.response.proposals.map(p => ({
        id: newId('prop'),
        anchor: { leafId: p.leafId, from: p.from, to: p.to, quote: p.quote },
        category: p.category, reason: p.reason,
        before: p.quote, after: p.after, status: 'pending',
      })),
      status: 'pending', createdAt: Date.now(),
    }
    this.dispatch(cmd.putRun(this.view.state, run))
    this.set({ activeRunId: runId })
    this.rebuildDecorations()
    if (run.proposals.length === 0) this.notice(this.ui.language === 'zh' ? '没有建议' : 'No suggestions')
  }

  /** Persist a rejected AI response as a visible run row so the call leaves a durable record. */
  private rejectRun(run: Omit<LabRun, 'proposals' | 'status'>, reason: string): void {
    if (this.view === null) return
    this.dispatch(cmd.putRun(this.view.state, { ...run, proposals: [], status: 'rejected' }))
    this.notice(`AI response rejected: ${reason}`)
  }

  /** Trim at a level; Original=restore baseline handled separately. */
  async runTrim(level: number): Promise<void> {
    if (this.view === null) return
    const leaves = flatten(this.view.state.doc)
    const baseRevision = this.contentVersion
    const baseHash = docHash(leaves)
    const currentWords = leaves.reduce((n, l) => n + countWords(l.text), 0)
    const targetWords = Math.max(1, Math.round(currentWords * (1 - level / 100)))
    const runId = newRunId()
    const requestId = newRequestId()
    const prompt = trimPrompt({ requestId, baseRevision, baseHash, level, targetWords, currentWords, leaves: leaves.map(l => ({ leafId: l.leafId, text: l.text })), language: this.ui.language })
    const baselineDoc = this.view.state.doc.toJSON()
    const { ok, text } = await this.callModel({ requestId, user: prompt, kind: 'trim', runId })
    if (!ok || text === undefined) { this.notice(this.ui.language === 'zh' ? '模型调用失败' : 'Model call failed'); return }
    const valid = validateTrim(extractJson(text), { requestId, baseRevision, baseHash, level }, leaves)
    if (!valid.ok) {
      this.rejectRun({ id: runId, mode: 'trim', level, baseRevision, baseHash, baselineDoc, baselineStats: { words: currentWords }, createdAt: Date.now() }, valid.reason)
      return
    }
    const run: LabRun = {
      id: runId, mode: 'trim', level, baseRevision, baseHash,
      baselineDoc, baselineStats: { words: currentWords },
      proposals: valid.response.cuts.map(c => ({
        id: newId('prop'),
        anchor: { leafId: c.leafId, from: c.from, to: c.to, quote: c.quote },
        category: 'trim', reason: c.reason, status: 'pending',
      })),
      status: 'pending', createdAt: Date.now(),
    }
    this.dispatch(cmd.putRun(this.view.state, run))
    this.set({ activeRunId: runId })
    this.rebuildDecorations()
  }

  /** Review actions on proposals. */
  keepProposal(runId: string, proposalId: string): void {
    if (this.view === null) return
    this.dispatch(cmd.setProposalStatus(this.view.state, this.entities, runId, proposalId, 'keep'))
    this.rebuildDecorations()
  }
  cutProposal(runId: string, proposalId: string): void {
    if (this.view === null) return
    this.dispatch(cmd.setProposalStatus(this.view.state, this.entities, runId, proposalId, 'cut'))
    this.rebuildDecorations()
  }
  skipProposal(runId: string, proposalId: string): void {
    if (this.view === null) return
    this.dispatch(cmd.setProposalStatus(this.view.state, this.entities, runId, proposalId, 'skip'))
    this.rebuildDecorations()
  }

  /** Fix-goal proposals apply one at a time at review. */
  acceptFix(runId: string, proposalId: string): void {
    if (this.view === null) return
    const run = this.entities.runs[runId]
    const p = run?.proposals.find(x => x.id === proposalId)
    if (run === undefined || p === undefined || p.after === undefined) return
    const leaves = flatten(this.view.state.doc)
    const leaf = leaves.find(l => l.leafId === p.anchor.leafId)
    if (leaf === undefined) { this.notice('stale anchor'); return }
    const from = anchorPos(leaf, p.anchor.from)
    const to = anchorPos(leaf, p.anchor.to)
    if (this.view.state.doc.textBetween(from, to, '\0', '\0') !== p.anchor.quote) {
      this.notice(this.ui.language === 'zh' ? '建议已过期（原文已变）' : 'Proposal is stale (text changed)')
      this.dispatch(cmd.setProposalStatus(this.view.state, this.entities, runId, proposalId, 'conflict'))
      this.rebuildDecorations()
      return
    }
    const tr = this.view.state.tr.replaceWith(from, to, schema.text(p.after))
    this.onTransaction(tr)
    this.dispatch(cmd.setProposalStatus(this.view.state, this.entities, runId, proposalId, 'cut'), 'fix-accept')
  }

  /** Apply all pending/cut proposals of a trim run in one transaction. */
  makeTheCuts(runId: string): void {
    if (this.view === null) return
    const leaves = flatten(this.view.state.doc).map(l => ({ leafId: l.leafId, textStart: l.textStart }))
    const r = cmd.applyTrimCuts(this.view.state, this.entities, runId, leaves)
    if (r.ok) {
      this.dispatch(r, 'trim-apply')
      this.rebuildDecorations()
      this.notice(this.ui.language === 'zh' ? '已裁剪（Ctrl+Z 撤销全部）' : 'Cuts applied (Ctrl+Z undoes all)')
    } else {
      this.dispatch(cmd.updateRun(this.view.state, this.entities, runId, run => ({ ...run, status: 'conflict' })))
      this.notice(this.ui.language === 'zh' ? '裁剪冲突：文本已变化' : 'Cut conflict: text changed')
      this.rebuildDecorations()
    }
  }

  /** Done reviewing: exit review mode, clear preview decorations, keep results. */
  doneReview(runId: string): void {
    if (this.view === null) return
    this.dispatch(cmd.updateRun(this.view.state, this.entities, runId, run => ({ ...run, status: 'done' })))
    this.set({ activeRunId: undefined, walkIndex: undefined })
    this.rebuildDecorations()
  }

  /** Original: restore the doc captured when the trim run started. */
  restoreOriginal(runId: string): void {
    if (this.view === null) return
    const r = cmd.restoreBaseline(this.view.state, this.entities, runId)
    if (r.ok) this.dispatch(r, 'trim-original')
    this.set({ activeRunId: undefined, walkIndex: undefined })
    this.rebuildDecorations()
  }

  /** Walkthrough: focus proposal i, offer Keep/Cut/Skip. */
  walkTo(runId: string, index: number): void {
    const run = this.entities.runs[runId]
    if (run === undefined || this.view === null) return
    this.set({ walkIndex: index })
    const p = run.proposals[index]
    if (p !== undefined) {
      const leaves = flatten(this.view.state.doc)
      const leaf = leaves.find(l => l.leafId === p.anchor.leafId)
      if (leaf !== undefined) {
        const pos = anchorPos(leaf, p.anchor.from)
        this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(this.view.state.doc.resolve(pos))))
        ;(this.view.domAtPos(pos).node as HTMLElement | null)?.scrollIntoView?.({ block: 'center' })
      }
    }
  }

  // ---- Share / misc -------------------------------------------------------

  sharePreview(): void {
    if (this.view === null) return
    const text = flatten(this.view.state.doc).map(l => l.text).join('\n\n')
    this.set({ sharePreview: { text, stats: this.computeStats() } })
  }

  confirmShareX(): void {
    if (this.view === null) return
    const text = flatten(this.view.state.doc).map(l => l.text).join('\n\n')
    this.set({ confirmShare: { kind: 'x', text }, sharePreview: undefined })
  }

  closeOverlays(): void {
    this.set({ confirmShare: undefined, sharePreview: undefined })
  }

  doShareX(): void {
    const s = this.ui.confirmShare
    this.set({ confirmShare: undefined })
    if (s === undefined) return
    const url = `https://twitter.com/intent/post?text=${encodeURIComponent(s.text.slice(0, 4000))}`
    window.open(url, '_blank', 'noopener')
  }

  setFocusGroup(gid: string | undefined): void {
    this.set({ focusGroupId: gid })
    this.rebuildDecorations()
  }

  toggleHidden(): void { this.set({ hidden: !this.ui.hidden }) }

  destroy(): void {
    this.destroyed = true
    if (this.saveTimer !== null) { clearTimeout(this.saveTimer); void this.saveNow() }
    this.presence.stop(this.ui.projectId ?? '')
    for (const p of this.pending.values()) p.abort.abort()
    for (const f of this.disposeFns) f()
  }
}
