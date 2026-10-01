import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { WriteOnController, UiState } from './controller.js'
import { groupRange } from '../editor/model.js'
import { groupAt, selectGroupRange } from '../editor/commands.js'
import type { LabGoal } from '../domain/prompts.js'

type T = (key: keyof typeof import('./i18n.js').dictionaries.en) => string

interface PageProps {
  controller: WriteOnController
  t: T
  /** Switch the DSH main panel (used by "back to chat"). */
  selectPanel: (id: string | null) => void
}

function useUi(controller: WriteOnController): UiState {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot)
}

/** Left rail of the workspace: doc list + panel switch. */
function DocBar({ c, t }: { c: WriteOnController; t: T }) {
  const ui = useUi(c)
  return (
    <div className="wo-docbar" data-testid="wo-docbar">
      <button data-testid="wo-newdoc" className="wo-btn" onClick={() => void c.newDoc()}>{t('newDoc')}</button>
      <div className="wo-doclist">
        {ui.projects.map(p => (
          <button
            key={p.id}
            className={`wo-docitem${p.id === ui.projectId ? ' active' : ''}`}
            data-testid={`wo-doc-${p.id}`}
            onClick={() => void c.openDoc(p.id)}
          >
            <span className="wo-docitem-title">{p.title || t('untitled')}</span>
            <span className="wo-docitem-del" data-testid={`wo-doc-del-${p.id}`} title={t('deleteDoc')}
              onClick={e => { e.stopPropagation(); if (confirm(t('deleteDocConfirm'))) void c.removeDoc(p.id) }}>×</span>
          </button>
        ))}
      </div>
      <div className="wo-docbar-io">
        <button className="wo-btn wo-small" data-testid="wo-export" onClick={() => void c.exportDoc()}>{t('export')}</button>
        <label className="wo-btn wo-small" data-testid="wo-import-label">
          {t('import')}
          <input type="file" accept=".json" hidden data-testid="wo-import"
            onChange={e => { const f = e.target.files?.[0]; if (f !== undefined) void c.importDoc(f); e.target.value = '' }} />
        </label>
      </div>
    </div>
  )
}

function StatsBar({ c, t }: { c: WriteOnController; t: T }) {
  const ui = useUi(c)
  const s = ui.stats
  return (
    <div className="wo-stats" data-testid="wo-stats">
      <span>{s.words} {t('words')}</span>
      <span>{s.chars} {t('chars')}</span>
      <span>~{s.minutes} {t('minutes')}</span>
      <span className={`wo-savestate wo-save-${ui.saved}`} data-testid="wo-savestate">
        {ui.saved === 'clean' ? t('saved') : ui.saved === 'saving' ? t('saving') : ui.saved === 'error' ? t('saveFailed') : t('dirty')}
      </span>
      <label className="wo-modelpick">
        {t('model')}
        <select
          data-testid="wo-model"
          value={ui.modelSel === undefined ? '' : `${ui.modelSel.provider}:::${ui.modelSel.model}`}
          onChange={e => {
            const m = ui.models.find(x => `${x.provider}:::${x.model}` === e.target.value)
            if (m !== undefined) c.setModel(m)
          }}
        >
          {ui.models.length === 0 && <option value="">{t('noModel')}</option>}
          {ui.models.map(m => <option key={`${m.provider}:::${m.model}`} value={`${m.provider}:::${m.model}`}>{m.label}</option>)}
        </select>
      </label>
      {ui.aiBusy !== undefined && <span className="wo-busy" data-testid="wo-busy">{t('aiBusy')}</span>}
    </div>
  )
}

function Toolbar({ c, t, selectPanel }: { c: WriteOnController; t: T; selectPanel: (id: string | null) => void }) {
  const ui = useUi(c)
  return (
    <div className={`wo-toolbar${ui.hidden ? ' wo-hidden' : ''}`} data-testid="wo-toolbar">
      <button className="wo-btn wo-small" data-testid="wo-back" title={t('backToChat')} onClick={() => selectPanel(null)}>←</button>
      <button className="wo-btn wo-small" data-testid="wo-undo" disabled={!c.canUndo()} onClick={() => c.undo()} title="Ctrl+Z">{t('undo')}</button>
      <button className="wo-btn wo-small" data-testid="wo-redo" disabled={!c.canRedo()} onClick={() => c.redo()} title="Ctrl+Shift+Z">{t('redo')}</button>
      <span className="wo-sep" />
      <button className="wo-btn wo-small" data-testid="wo-alt-word" onClick={() => c.createVariantCmd('word')} title="Alt+Enter">W±</button>
      <button className="wo-btn wo-small" data-testid="wo-alt-sentence" onClick={() => c.createVariantCmd('sentence')}>{t('newSentence')}</button>
      <button className="wo-btn wo-small" data-testid="wo-alt-paragraph" onClick={() => c.createVariantCmd('paragraph')}>{t('newParagraph')}</button>
      <button className="wo-btn wo-small" data-testid="wo-ghost" onClick={() => c.ghostToggle()} title="Ctrl+/" >{t('ghostToggle')}</button>
      <button className="wo-btn wo-small" data-testid="wo-stash" onClick={() => c.stashSelection()} title="Ctrl+Shift+X">{t('stash')}</button>
      <span className="wo-sep" />
      <button className="wo-btn wo-small" data-testid="wo-panel-alt" onClick={() => c.openAlternatives()}>{t('alternatives')}</button>
      <button className="wo-btn wo-small" data-testid="wo-panel-overflow" onClick={() => c.openOverflow()}>{t('overflow')}</button>
      <button className="wo-btn wo-small" data-testid="wo-panel-lab" onClick={() => c.openLab()}>{t('lab')}</button>
      <button className="wo-btn wo-small" data-testid="wo-share" onClick={() => c.sharePreview()} title="Ctrl+Shift+P">{t('share')}</button>
      <span className="wo-flex" />
      <button className="wo-btn wo-small" data-testid="wo-hide" onClick={() => c.toggleHidden()} title="Alt+Shift+Z">{t('hideControls')}</button>
      <button className="wo-btn wo-small" data-testid="wo-save" onClick={() => void c.saveNow()} title="Ctrl+S">{t('save')}</button>
    </div>
  )
}

function OptionRow({ c, t, gid, optionId, text, active, isOriginal, origin }: {
  c: WriteOnController; t: T; gid: string; optionId: string; text: string
  active: boolean; isOriginal: boolean; origin: string
}) {
  return (
    <div className={`wo-opt${active ? ' active' : ''}`} data-testid={`wo-opt-${optionId}`}>
      <span className="wo-opt-badge">{isOriginal ? t('original') : origin === 'ai' ? 'AI' : '✍'}</span>
      <span className="wo-opt-text" onClick={() => c.selectOption(gid, optionId)}>{text === '' ? '…' : text}</span>
      <span className="wo-opt-acts">
        {!active && <button className="wo-btn wo-mini" data-testid={`wo-opt-use-${optionId}`} onClick={() => c.selectOption(gid, optionId)}>{t('useThis')}</button>}
        <button className="wo-btn wo-mini" data-testid={`wo-opt-edit-${optionId}`} onClick={() => {
          const next = prompt(t('edit'), text)
          if (next !== null) c.editOption(gid, optionId, next)
        }}>{t('edit')}</button>
        {!isOriginal && <button className="wo-btn wo-mini" data-testid={`wo-opt-del-${optionId}`} onClick={() => c.deleteOption(gid, optionId)}>{t('delete')}</button>}
      </span>
    </div>
  )
}

function AlternativesPanel({ c, t }: { c: WriteOnController; t: T }) {
  const ui = useUi(c)
  const groups = Object.values(c.entities.groups).filter(g => !g.deleted)
  return (
    <div className="wo-side" data-testid="wo-panel-alternatives"
      onFocus={() => { if (ui.focusGroupId !== undefined) return }}
      onBlur={() => c.setFocusGroup(undefined)}>
      <div className="wo-side-head">{t('alternatives')}</div>
      {groups.length === 0 && <div className="wo-side-empty">Alt+Enter</div>}
      {groups.map(g => {
        const live = c.editorView === null ? null : (() => { const r = groupRange(c.editorView.state.doc, g.id, g.scope); return r })()
        const opts = Object.values(g.options).sort((a, b) => (a.id === g.originalOptionId ? -1 : b.id === g.originalOptionId ? 1 : a.createdAt - b.createdAt))
        const liveText = live !== null && c.editorView !== null
          ? c.editorView.state.doc.textBetween(live.innerFrom, live.innerTo, '\u0000', ' ')
          : ''
        return (
          <div className="wo-group" key={g.id} data-testid={`wo-group-${g.id}`}
            onMouseEnter={() => c.setFocusGroup(g.id)} onMouseLeave={() => c.setFocusGroup(undefined)}>
            <div className="wo-group-head" onClick={() => {
              const view = c.editorView
              if (view === null) return
              view.focus()
              const r = cmd_select(view, c, g.id)
              void r
            }}>
              <span className="wo-group-scope">{g.scope}</span>
              <button className="wo-btn wo-mini" data-testid={`wo-group-prev-${g.id}`} onClick={e => { e.stopPropagation(); c.cycleOption(g.id, -1) }}>↑</button>
              <button className="wo-btn wo-mini" data-testid={`wo-group-next-${g.id}`} onClick={e => { e.stopPropagation(); c.cycleOption(g.id, 1) }}>↓</button>
            </div>
            {opts.map(o => (
              <OptionRow key={o.id} c={c} t={t} gid={g.id} optionId={o.id}
                text={o.id === g.currentOptionId && liveText !== '' ? liveText : fragText(o.fragment)}
                active={o.id === g.currentOptionId} isOriginal={o.id === g.originalOptionId} origin={o.origin} />
            ))}
            <div className="wo-group-acts">
              <button className="wo-btn wo-mini" data-testid={`wo-group-manual-${g.id}`} onClick={() => c.addManualOption(g.id)}>{t('manualAlternative')}</button>
              <button className="wo-btn wo-mini" data-testid={`wo-group-ai-${g.id}`} onClick={() => void c.aiAlternatives(g.id)} disabled={ui.providerKind === 'none' || ui.aiBusy !== undefined}>{t('aiAlternatives')}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function fragText(fragment: unknown[]): string {
  const walk = (nodes: unknown[]): string =>
    (nodes as { type?: string; text?: string; content?: unknown[] }[]).map(n =>
      n.type === 'text' ? (n.text ?? '') : Array.isArray(n.content) ? walk(n.content) : '').join('')
  return walk(fragment)
}

function cmd_select(view: NonNullable<WriteOnController['editorView']>, c: WriteOnController, gid: string) {
  const r = selectGroupRange(view.state, c.entities, gid)
  if (r.ok) view.dispatch(r.tr)
  return r
}

function OverflowPanel({ c, t }: { c: WriteOnController; t: T }) {
  const items = Object.values(c.entities.overflow).sort((a, b) => b.createdAt - a.createdAt)
  return (
    <div className="wo-side" data-testid="wo-panel-overflow">
      <div className="wo-side-head">{t('overflow')}</div>
      {items.length === 0 && <div className="wo-side-empty">Ctrl+Shift+X</div>}
      {items.map(item => (
        <div className="wo-ovitem" key={item.id} data-testid={`wo-ov-${item.id}`}
          draggable
          onDragStart={e => {
            e.dataTransfer.setData('application/x-writeon-overflow', item.id)
            e.dataTransfer.effectAllowed = 'copy'
          }}>
          <div className="wo-ov-text">{fragText(item.fragment)}</div>
          <div className="wo-ov-acts">
            <button className="wo-btn wo-mini" data-testid={`wo-ov-insert-${item.id}`} onClick={() => c.insertOverflow(item.id)}>{t('insertBack')}</button>
            <button className="wo-btn wo-mini" data-testid={`wo-ov-edit-${item.id}`} onClick={() => {
              const next = prompt(t('edit'), fragText(item.fragment))
              if (next !== null) c.updateOverflowText(item.id, next)
            }}>{t('edit')}</button>
            <button className="wo-btn wo-mini" data-testid={`wo-ov-del-${item.id}`} onClick={() => c.deleteOverflowItem(item.id)}>{t('delete')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}

const LAB_GOALS: { key: LabGoal; labelKey: keyof typeof import('./i18n.js').dictionaries.en }[] = [
  { key: 'fix-punctuation', labelKey: 'fixPunctuation' },
  { key: 'weakest-sentences', labelKey: 'weakestSentences' },
  { key: 'long-sentences', labelKey: 'longSentences' },
  { key: 'convoluted-sentences', labelKey: 'convolutedSentences' },
  { key: 'tone-misfit', labelKey: 'toneMisfit' },
  { key: 'hedges-filler', labelKey: 'hedgesFiller' },
]

function LabPanel({ c, t }: { c: WriteOnController; t: T }) {
  const ui = useUi(c)
  const runs = Object.values(c.entities.runs).sort((a, b) => b.createdAt - a.createdAt)
  const active = runs.find(r => r.id === ui.activeRunId)
  return (
    <div className="wo-side" data-testid="wo-panel-lab">
      <div className="wo-side-head">{t('lab')}</div>
      {LAB_GOALS.map(g => (
        <button key={g.key} className="wo-btn wo-lab-goal" data-testid={`wo-lab-${g.key}`}
          disabled={ui.providerKind === 'none' || ui.aiBusy !== undefined}
          onClick={() => void c.runLab(g.key)}>{t(g.labelKey)}</button>
      ))}
      <div className="wo-trimrow">
        <span>{t('trimTitle')}:</span>
        {[10, 20, 30, 50].map(level => (
          <button key={level} className="wo-btn wo-mini" data-testid={`wo-trim-${level}`}
            disabled={ui.providerKind === 'none' || ui.aiBusy !== undefined}
            onClick={() => void c.runTrim(level)}>{level}%</button>
        ))}
      </div>
      {runs.filter(r => r.status !== 'done' && r.status !== 'applied').map(run => (
        <div key={run.id} className={`wo-run wo-run-${run.status}`} data-testid={`wo-run-${run.id}`}>
          <div className="wo-run-head">{run.mode}{run.goal !== undefined ? ` · ${run.goal}` : ''}{run.level !== undefined ? ` · ${run.level}%` : ''} · {run.status}</div>
          {run.proposals.map(p => (
            <div key={p.id} className={`wo-prop wo-prop-${p.status}`} data-testid={`wo-prop-${p.id}`}
              onClick={() => c.walkTo(run.id, run.proposals.indexOf(p))}>
              <span className="wo-prop-q">“{p.anchor.quote}”</span>
              {p.reason !== undefined && <span className="wo-prop-r">{p.reason}</span>}
              {p.after !== undefined && <span className="wo-prop-a">→ {p.after}</span>}
              {run.mode === 'lab-fix' && p.status === 'pending' &&
                <button className="wo-btn wo-mini" data-testid={`wo-prop-fix-${p.id}`}
                  onClick={e => { e.stopPropagation(); c.acceptFix(run.id, p.id) }}>{t('useThis')}</button>}
              {(run.mode === 'trim' || run.mode === 'lab-mark') && p.status === 'pending' && (
                <span className="wo-prop-acts">
                  <button className="wo-btn wo-mini" data-testid={`wo-prop-keep-${p.id}`} onClick={e => { e.stopPropagation(); c.keepProposal(run.id, p.id) }}>{t('keep')}</button>
                  {run.mode === 'trim' && <button className="wo-btn wo-mini" data-testid={`wo-prop-cut-${p.id}`} onClick={e => { e.stopPropagation(); c.cutProposal(run.id, p.id) }}>{t('cut')}</button>}
                  <button className="wo-btn wo-mini" data-testid={`wo-prop-skip-${p.id}`} onClick={e => { e.stopPropagation(); c.skipProposal(run.id, p.id) }}>{t('skip')}</button>
                </span>
              )}
            </div>
          ))}
          {run.proposals.length === 0 && <div className="wo-side-empty">{t('noSuggestions')}</div>}
        </div>
      ))}
      {active !== undefined && active.mode === 'trim' && (
        <div className="wo-reviewbar" data-testid="wo-reviewbar">
          <button className="wo-btn wo-mini" data-testid="wo-walk" onClick={() => {
            const idx = ui.walkIndex === undefined ? 0 : (ui.walkIndex + 1) % Math.max(1, active.proposals.length)
            c.walkTo(active.id, idx)
          }}>{t('walkthrough')}</button>
          <button className="wo-btn wo-mini" data-testid="wo-makecuts" onClick={() => c.makeTheCuts(active.id)}>{t('makeCuts')}</button>
          <button className="wo-btn wo-mini" data-testid="wo-original" onClick={() => c.restoreOriginal(active.id)}>{t('original')}</button>
          <button className="wo-btn wo-mini" data-testid="wo-done" onClick={() => c.doneReview(active.id)}>{t('done')}</button>
        </div>
      )}
    </div>
  )
}

function ShareOverlay({ c, t }: { c: WriteOnController; t: T }) {
  const ui = useUi(c)
  const eggRef = useRef<HTMLButtonElement>(null)
  const nearMisses = useRef(0)
  if (ui.sharePreview === undefined && ui.confirmShare === undefined) return null
  return (
    <div className="wo-overlay" data-testid="wo-overlay" onClick={e => { if (e.target === e.currentTarget) c.closeOverlays() }}>
      <div className="wo-dialog">
        {ui.sharePreview !== undefined && (
          <>
            <div className="wo-dialog-head">{t('sharePreview')}</div>
            <pre className="wo-share-text" data-testid="wo-share-text">{ui.sharePreview.text.slice(0, 2000)}</pre>
            <div className="wo-dialog-stats">{ui.sharePreview.stats.words} {t('words')} · {ui.sharePreview.stats.chars} {t('chars')}</div>
            <div className="wo-dialog-acts">
              <button className="wo-btn wo-small" data-testid="wo-copy" onClick={() => void navigator.clipboard.writeText(ui.sharePreview?.text ?? '')}>{t('copy')}</button>
              <button className="wo-btn wo-small" data-testid="wo-tox" onClick={() => c.confirmShareX()}>{t('shareX')}</button>
              <button
                ref={eggRef}
                className="wo-btn wo-small wo-egg"
                data-testid="wo-egg"
                onMouseMove={e => {
                  const el = eggRef.current
                  if (el === null) return
                  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
                  const r = el.getBoundingClientRect()
                  const dx = e.clientX - (r.left + r.width / 2)
                  const dy = e.clientY - (r.top + r.height / 2)
                  if (Math.hypot(dx, dy) < 60) {
                    nearMisses.current += 1
                    const jitter = nearMisses.current > 4 ? 'explode' : ''
                    if (jitter === 'explode') {
                      el.classList.add('wo-egg-boom')
                      setTimeout(() => { el.style.display = 'none' }, 450)
                      return
                    }
                    const parent = el.parentElement?.getBoundingClientRect()
                    if (parent !== undefined) {
                      const nx = Math.max(0, Math.min(parent.width - r.width, r.left - parent.left + dx * -1.4))
                      const ny = Math.max(0, Math.min(parent.height - r.height, r.top - parent.top + dy * -1.4))
                      el.style.position = 'relative'
                      el.style.left = `${nx - (r.left - parent.left)}px`
                      el.style.top = `${ny - (r.top - parent.top)}px`
                    }
                  }
                }}
              >
                {t('linkedin')}
              </button>
              <button className="wo-btn wo-small" data-testid="wo-overlay-close" onClick={() => c.closeOverlays()}>{t('cancel')}</button>
            </div>
          </>
        )}
        {ui.confirmShare !== undefined && (
          <>
            <div className="wo-dialog-head">{t('shareX')}</div>
            <div className="wo-dialog-body">{t('shareXConfirm')}</div>
            <pre className="wo-share-text">{ui.confirmShare.text.slice(0, 2000)}</pre>
            <div className="wo-dialog-acts">
              <button className="wo-btn wo-small" data-testid="wo-tox-confirm" onClick={() => c.doShareX()}>{t('shareX')}</button>
              <button className="wo-btn wo-small" data-testid="wo-tox-cancel" onClick={() => c.closeOverlays()}>{t('cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The workspace root: toolbar + doc list + editor canvas + side panel. */
export function WriteOnPage(props: PageProps) {
  const { controller: c, t, selectPanel } = props
  const mountRef = useRef<HTMLDivElement>(null)
  const ui = useUi(c)

  useEffect(() => {
    const el = mountRef.current
    if (el === null) return
    void c.mount(el)
    const onKey = (ev: KeyboardEvent) => {
      const view = c.editorView
      if (view?.composing === true || ev.isComposing) return
      const mod = ev.ctrlKey || ev.metaKey
      if (mod && ev.shiftKey && (ev.key === 'A' || ev.key === 'a')) { ev.preventDefault(); c.createVariantCmd('word') }
      else if (mod && ev.shiftKey && (ev.key === 'G' || ev.key === 'g')) {
        ev.preventDefault()
        const view2 = c.editorView
        if (view2 !== null) {
          const g = groupAtSelection(view2, c)
          if (g !== undefined) void c.aiAlternatives(g.id)
          else c.createVariantCmd('word')
        }
      }
      else if (mod && ev.key === '/') { ev.preventDefault(); c.ghostToggle() }
      else if (mod && ev.shiftKey && (ev.key === 'X' || ev.key === 'x')) { ev.preventDefault(); c.stashSelection() }
      else if (mod && ev.shiftKey && (ev.key === 'P' || ev.key === 'p')) { ev.preventDefault(); c.sharePreview() }
      else if (mod && ev.key === 's') { ev.preventDefault(); void c.saveNow() }
      else if (mod && ev.key === 'o') { ev.preventDefault(); /* open list is the docbar */ }
      else if (ev.altKey && ev.shiftKey && (ev.key === 'Z' || ev.key === 'z')) { ev.preventDefault(); c.toggleHidden() }
      else if (ev.altKey && ev.key === 'Enter') {
        ev.preventDefault()
        const view2 = c.editorView
        if (view2 !== null) {
          const g = groupAtSelection(view2, c)
          if (g !== undefined) { c.setFocusGroup(g.id); c.openAlternatives() }
          else c.createVariantCmd('word')
        }
      }
    }
    const onDrop = (ev: DragEvent) => {
      const itemId = ev.dataTransfer?.getData('application/x-writeon-overflow')
      if (itemId === undefined || itemId === '') return
      const view = c.editorView
      if (view === null) return
      ev.preventDefault()
      const pos = view.posAtCoords({ left: ev.clientX, top: ev.clientY })?.pos
      c.insertOverflow(itemId, pos)
    }
    const onDragOver = (ev: DragEvent) => { ev.preventDefault() }
    const el2 = mountRef.current?.closest('.wo-root') as HTMLElement | null
    el2?.addEventListener('keydown', onKey)
    el2?.addEventListener('drop', onDrop)
    el2?.addEventListener('dragover', onDragOver)
    return () => {
      el2?.removeEventListener('keydown', onKey)
      el2?.removeEventListener('drop', onDrop)
      el2?.removeEventListener('dragover', onDragOver)
    }
  }, [c])

  // Ghost click-to-revive is editor-side via DOM event; handled in controller's view events.

  return (
    <div className="wo-root" data-testid="wo-root">
      <Toolbar c={c} t={t} selectPanel={selectPanel} />
      <div className="wo-body">
        <DocBar c={c} t={t} />
        <div className="wo-canvas" data-testid="wo-canvas">
          {ui.conflictTab && (
            <div className="wo-conflict" data-testid="wo-conflict">
              <strong>{t('conflictTitle')}</strong> {t('conflictBody')}
            </div>
          )}
          <div className="wo-editorwrap">
            <div ref={mountRef} className="wo-editor" data-testid="wo-editor" />
          </div>
          <StatsBar c={c} t={t} />
        </div>
        {ui.sidePanel === 'alternatives' && <AlternativesPanel c={c} t={t} />}
        {ui.sidePanel === 'overflow' && <OverflowPanel c={c} t={t} />}
        {ui.sidePanel === 'lab' && <LabPanel c={c} t={t} />}
      </div>
      {ui.notice !== undefined && <div className="wo-notice" data-testid="wo-notice">{ui.notice}</div>}
      {ui.pendingExpand !== undefined && (
        <div className="wo-notice wo-expandbar" data-testid="wo-expandbar">
          <span>{t('expandPrompt')}</span>
          <button className="wo-btn wo-mini" data-testid="wo-expand-yes" onClick={() => c.confirmExpand()}>{t('expand')}</button>
          <button className="wo-btn wo-mini" data-testid="wo-expand-no" onClick={() => c.cancelExpand()}>{t('cancel')}</button>
        </div>
      )}
      <ShareOverlay c={c} t={t} />
      {ui.phase === 'welcome' && (
        <div className="wo-overlay" data-testid="wo-welcome" onClick={e => { if (e.target === e.currentTarget) return }}>
          <div className="wo-dialog">
            <div className="wo-dialog-head">{t('welcome')}</div>
            <div className="wo-dialog-body">{t('welcomeHint')}</div>
            <div className="wo-dialog-acts">
              <button className="wo-btn" data-testid="wo-welcome-new" onClick={() => void c.newDoc()}>{t('newDoc')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function groupAtSelection(view: NonNullable<WriteOnController['editorView']>, c: WriteOnController) {
  return groupAt(view.state.doc, c.entities, view.state.selection.from)
}
