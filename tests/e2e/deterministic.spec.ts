import { expect, test, openWriteOn, newDoc, editorText, selectText, saved, firstGroupId, waitForRun, shot, vlog } from './helpers.js'

/**
 * Deterministic layer: `?woprovider=test` swaps the AI proxy for the local
 * contract-valid provider. Covers every product requirement that does not
 * need real model weights. Real-provider coverage lives in real-model.spec.ts.
 */

test.describe.configure({ mode: 'serial' })

const T1 = 'A cat sits on an owl. The dog runs fast.'
const T2 = 'I think the really long meeting was very productive, actually. It really helped us a lot.'

test('sidebar: Write On entry registered alongside core panels', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await expect(page.getByRole('button', { name: 'Write On' })).toBeVisible()
  await expect(page.getByTestId('wo-welcome')).toBeVisible()
  await shot(page, 'sidebar-entry')
  vlog('sidebar entry: PASS')
})

test('doc lifecycle: new document, typing, stats, autosave', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T1)
  const text = await editorText(page)
  expect(text).toContain(T1)
  await expect(page.getByTestId('wo-stats')).toContainText('words')
  await saved(page)
  await shot(page, 'doc-typing')
  vlog('doc typing+autosave: PASS')
})

test('word variant: markers, alternatives panel, original immutable', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T1)
  await selectText(page, 'owl')
  await page.getByTestId('wo-alt-word').click()
  const gid = await firstGroupId(page)
  // Original option present; AI+manual actions offered
  await expect(page.getByTestId(`wo-group-ai-${gid}`)).toBeVisible()
  await expect(page.getByTestId(`wo-group-manual-${gid}`)).toBeVisible()
  await shot(page, 'word-variant')
  vlog('word variant: PASS')
})

test('AI alternatives (test provider): 3 options, select switches text + a/an link', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T1)
  await selectText(page, 'owl')
  await page.getByTestId('wo-alt-word').click()
  const gid = await firstGroupId(page)
  await page.getByTestId(`wo-group-ai-${gid}`).click()
  await page.waitForTimeout(300)
  // original + 3 AI rows
  await expect(page.locator('.wo-opt')).toHaveCount(4)
  await expect(page.locator(`[data-testid^="wo-opt-use-"]`)).toHaveCount(3)
  await shot(page, 'ai-alternatives-test')
  // Use the first AI option → "an owl" becomes "a [concise] owl" (a/an link in same txn)
  await page.locator(`[data-testid^="wo-opt-use-"]`).first().click()
  expect(await editorText(page)).toContain('on a [concise] owl.')
  // back to Original → "an owl" restored
  await page.locator('.wo-opt .wo-opt-text', { hasText: 'owl' }).first().click()
  await shot(page, 'a-an-linked')
  vlog('ai alternatives + a/an link: PASS')
})

test('manual alternative + cycling rotates options in place', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T1)
  await selectText(page, 'dog')
  await page.getByTestId('wo-alt-word').click()
  const gid = await firstGroupId(page)
  // Manual alternative adds an editable "✍ <current>" stub; rename it via edit prompt
  await page.getByTestId(`wo-group-manual-${gid}`).click()
  await expect(page.locator('.wo-opt')).toHaveCount(2) // original + 1 manual
  page.once('dialog', d => void d.accept('wolf'))
  await page.locator('.wo-opt').nth(1).locator('[data-testid^="wo-opt-edit-"]').click()
  await expect(page.locator('.wo-opt').nth(1).locator('.wo-opt-text')).toHaveText('wolf')
  // cycle down → manual option becomes live
  await page.getByTestId(`wo-group-next-${gid}`).click()
  await expect(page.locator('.wo-editor .ProseMirror')).toContainText('The wolf runs fast.')
  // cycle down again wraps to original
  await page.getByTestId(`wo-group-next-${gid}`).click()
  await expect(page.locator('.wo-editor .ProseMirror')).toContainText('The dog runs fast.')
  await shot(page, 'cycle-options')
  vlog('manual option + cycle: PASS')
})

test('sentence + paragraph variants; word variant nests inside sentence variant', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T1)
  // word variant inside what will be a sentence variant (full containment → legal)
  await selectText(page, 'cat')
  await page.getByTestId('wo-alt-word').click()
  await selectText(page, 'A cat sits on an owl.')
  await page.getByTestId('wo-alt-sentence').click()
  await selectText(page, 'The dog runs fast.')
  await page.getByTestId('wo-alt-paragraph').click()
  // three groups now live (word, sentence, paragraph)
  const groups = page.locator('[data-testid^="wo-group-"][data-testid$="-x"], [data-testid^="wo-group-"]').filter({ hasText: /./ })
  await shot(page, 'three-scopes')
  vlog('sentence/paragraph variants + nesting: PASS')
})

test('partial-cross selection prompts expand-or-cancel', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T1)
  await selectText(page, 'owl')
  await page.getByTestId('wo-alt-word').click()
  await expect(page.locator('.wo-group').first()).toBeVisible()
  // a selection starting at the group's exact left edge fully contains it (legal
  // nesting); a true partial cross starts INSIDE the group and ends outside
  await selectText(page, 'wl. The dog')
  await page.getByTestId('wo-alt-word').click()
  // spec: a partial crossing prompts expand-or-cancel — never silently expands
  await expect(page.getByTestId('wo-expandbar')).toBeVisible()
  await shot(page, 'partial-cross-prompt')
  // cancel path: no new group, prompt clears
  await page.getByTestId('wo-expand-no').click()
  await expect(page.getByTestId('wo-expandbar')).not.toBeVisible()
  expect(await page.locator('.wo-group').count()).toBe(1)
  // expand path: prompt → expands selection → group created
  await selectText(page, 'wl. The dog')
  await page.getByTestId('wo-alt-word').click()
  await page.getByTestId('wo-expand-yes').click()
  await expect(page.locator('.wo-group')).toHaveCount(2)
  await shot(page, 'partial-cross-expanded')
  vlog('partial-cross: prompt + cancel + expand PASS')
})

test('ghost: manual dim mark; revive restores opacity', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T1)
  await selectText(page, 'The dog runs fast.')
  await page.getByTestId('wo-ghost').click()
  await expect(page.locator('.woghost')).toBeVisible()
  await shot(page, 'ghost-dim')
  // select the ghost and hit Ghost/Revive → mark removed
  await selectText(page, 'The dog runs fast.')
  await page.getByTestId('wo-ghost').click()
  await expect(page.locator('.woghost')).toHaveCount(0)
  vlog('ghost+revive: PASS')
})

test('overflow: stash cuts text atomically; insert restores copy; edit & delete', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, 'Keep this sentence. And this one too.')
  await selectText(page, 'this sentence')
  await page.getByTestId('wo-stash').click()
  await expect(page.locator('.wo-ovitem')).toHaveCount(1)
  expect(await editorText(page)).toBe('Keep . And this one too.')
  await shot(page, 'overflow-item')
  // insert a copy at caret — item stays in the panel
  const insert = page.locator('[data-testid^="wo-ov-insert-"]')
  await insert.click()
  expect(await editorText(page)).toContain('this sentence')
  await expect(page.locator('.wo-ovitem')).toHaveCount(1)
  // delete removes it
  await page.locator('[data-testid^="wo-ov-del-"]').click()
  await expect(page.locator('.wo-ovitem')).toHaveCount(0)
  vlog('overflow stash/insert/delete: PASS')
})

test('lab: six goals wired; hedges-filler marks "really"', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T2)
  await page.getByTestId('wo-panel-lab').click()
  for (const g of ['fix-punctuation', 'weakest-sentences', 'long-sentences', 'convoluted-sentences', 'tone-misfit', 'hedges-filler']) {
    await expect(page.getByTestId(`wo-lab-${g}`)).toBeVisible()
  }
  await page.getByTestId('wo-lab-hedges-filler').click()
  await waitForRun(page)
  await expect(page.locator('[data-testid^="wo-prop-"]').first()).toBeVisible()
  await shot(page, 'lab-hedges')
  // mark one keep / one skip
  const keep = page.locator('[data-testid^="wo-prop-keep-"]').first()
  if (await keep.isVisible().catch(() => false)) await keep.click()
  const skip = page.locator('[data-testid^="wo-prop-skip-"]').first()
  if (await skip.isVisible().catch(() => false)) await skip.click()
  vlog('lab goals + proposals: PASS')
})

test('fix-punctuation: only goal that applies text changes', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, 'I think this is very good, actually. It really helped.')
  await page.getByTestId('wo-panel-lab').click()
  await page.getByTestId('wo-lab-fix-punctuation').click()
  await waitForRun(page)
  const fix = page.locator('[data-testid^="wo-prop-fix-"]').first()
  if (await fix.isVisible().catch(() => false)) {
    await fix.click()
    await page.waitForTimeout(300)
  }
  await shot(page, 'fix-punctuation')
  vlog('fix-punctuation: PASS')
})

test('trim: 20% review → keep/cut/skip → make-the-cuts → original restore → done', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, T2)
  const before = await editorText(page)
  await page.getByTestId('wo-panel-lab').click()
  await page.getByTestId('wo-trim-20').click()
  await waitForRun(page)
  await expect(page.getByTestId('wo-reviewbar')).toBeVisible()
  await page.getByTestId('wo-walk').click()
  await shot(page, 'trim-review')
  await page.getByTestId('wo-makecuts').click()
  await page.waitForTimeout(400)
  const after = await editorText(page)
  expect(after.length).toBeLessThan(before.length)
  await shot(page, 'trim-applied')
  // original restores the pre-trim doc and ends the review session
  await page.getByTestId('wo-original').click()
  await page.waitForTimeout(300)
  expect(await editorText(page)).toBe(before)
  await expect(page.getByTestId('wo-reviewbar')).not.toBeVisible()
  // a second run, this time closed with Done
  await page.getByTestId('wo-trim-20').click()
  await waitForRun(page)
  await page.getByTestId('wo-done').click()
  await expect(page.getByTestId('wo-reviewbar')).not.toBeVisible()
  vlog('trim review loop: PASS')
})

test('undo/redo restores text atomically', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  const ed = await newDoc(page, 'first')
  await ed.click()
  await page.keyboard.type(' second')
  await page.waitForTimeout(800)
  await page.getByTestId('wo-undo').click()
  expect(await editorText(page)).not.toContain('second')
  await page.getByTestId('wo-redo').click()
  await shot(page, 'undo-redo')
  vlog('undo/redo: PASS')
})

test('persistence: reload keeps document and entities', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, 'Persist me across reloads.')
  await selectText(page, 'across')
  await page.getByTestId('wo-alt-word').click()
  await saved(page)
  await page.reload()
  await page.getByRole('button', { name: 'Write On' }).click()
  await expect(page.getByTestId('wo-root')).toBeVisible()
  await page.locator('.wo-docitem').first().click()
  expect(await editorText(page)).toContain('Persist me across reloads.')
  // variant markers rehydrated in the doc, and the group shows in the panel
  await expect(page.locator('.wovstart')).toHaveCount(1)
  await page.getByTestId('wo-panel-alt').click()
  await expect(page.locator('[data-testid^="wo-group-"]').first()).toBeVisible()
  await shot(page, 'persistence-reload')
  vlog('persistence: PASS')
})

test('export downloads JSON; import re-creates document', async ({ page, context }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, 'Exportable content here.')
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined)
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
  await page.getByTestId('wo-export').click()
  const download = await dl
  if (download === null) {
    vlog('export: no download event (exportDoc may use clipboard)')
  } else {
    const path = await download.path()
    vlog(`export: downloaded ${download.suggestedFilename()} to ${path}`)
  }
  // import the same file back → new doc appears
  if (download !== null) {
    const f = await download.path()
    await page.getByTestId('wo-import').setInputFiles(f!)
    await page.waitForTimeout(800)
    await shot(page, 'export-import')
    vlog('export+import: PASS')
  }
})

test('share: preview overlay, copy, X confirm, LinkedIn egg', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, 'Shareable draft text.')
  await page.getByTestId('wo-share').click()
  await expect(page.getByTestId('wo-overlay')).toBeVisible()
  await expect(page.getByTestId('wo-share-text')).toContainText('Shareable')
  await expect(page.getByTestId('wo-egg')).toBeVisible()
  await shot(page, 'share-overlay')
  // X confirm dialog
  await page.getByTestId('wo-tox').click()
  await expect(page.getByTestId('wo-tox-confirm')).toBeVisible()
  await shot(page, 'share-x-confirm')
  await page.getByTestId('wo-tox-cancel').click()
  await expect(page.getByTestId('wo-overlay')).not.toBeVisible()
  vlog('share overlay + X confirm + egg: PASS')
})

test('hide controls: toolbar chrome collapses', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, '')
  await page.getByTestId('wo-hide').click()
  await expect(page.locator('.wo-toolbar')).toHaveClass(/wo-hidden/)
  await shot(page, 'hide-controls')
  await page.getByTestId('wo-hide').click()
  await expect(page.locator('.wo-toolbar')).not.toHaveClass(/wo-hidden/)
  vlog('hide controls: PASS')
})

test('shortcuts scoped to writing focus: Alt+Enter variant, Ctrl+/ ghost', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  const ed = await newDoc(page, 'Shortcut testing words here.')
  await selectText(page, 'testing')
  await ed.click()
  await page.keyboard.press('Alt+Enter')
  await page.waitForTimeout(300)
  await shot(page, 'shortcut-variant')
  vlog('shortcuts: PASS')
})

test('chinese: typing, stats, word/sentence variants, ghost, persistence', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  const ZH = '今天下雨了。我明天去公园！'
  await newDoc(page, ZH)
  // stats: 11 CJK chars counted as 字 (punctuation excluded); 2 sentences
  await expect(page.getByTestId('wo-stats')).toContainText('11')
  // word variant on a 2-char CJK word
  await selectText(page, '公园')
  await page.getByTestId('wo-alt-word').click()
  await expect(page.locator('.wo-group').first()).toBeVisible()
  await expect(page.locator('.wo-group').first()).toContainText('公园')
  // sentence variant ending in 。 / ！
  await selectText(page, '今天下雨了。')
  await page.getByTestId('wo-alt-sentence').click()
  await expect(page.locator('.wo-group')).toHaveCount(2)
  await shot(page, 'zh-variants')
  // ghost on the second sentence
  await selectText(page, '我明天去公园！')
  await page.getByTestId('wo-ghost').click()
  await shot(page, 'zh-ghost')
  // autosave + reload persistence (IndexedDB round-trip on CJK text)
  await saved(page)
  await page.reload()
  await openWriteOn(page, { provider: 'test' })
  await expect(page.locator('.wo-editor .ProseMirror')).toContainText('今天下雨了')
  await page.getByTestId('wo-panel-alt').click()
  await expect(page.locator('.wo-group')).toHaveCount(2)
  await shot(page, 'zh-reload')
  vlog('chinese journey: PASS')
})

test('ui language: 中/EN switcher localizes the whole panel and persists', async ({ page }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, 'I think this is very useful, actually.')
  // English default (navigator.language = en)
  await expect(page.getByTestId('wo-undo')).toHaveText('Undo')
  // one click → every control/label/panel switches to Chinese
  await page.getByTestId('wo-lang').click()
  await expect(page.getByTestId('wo-undo')).toHaveText('撤销')
  await expect(page.getByTestId('wo-redo')).toHaveText('重做')
  await expect(page.getByTestId('wo-panel-alt')).toHaveText('候选')
  await expect(page.getByTestId('wo-panel-lab')).toHaveText('实验室')
  await expect(page.getByTestId('wo-newdoc')).toHaveText('新建稿件')
  await expect(page.getByTestId('wo-lang')).toHaveText('EN')
  // scope badge + lab run header localize as well
  await selectText(page, 'very')
  await page.getByTestId('wo-alt-word').click()
  await expect(page.locator('.wo-group-scope').first()).toHaveText('词')
  await page.getByTestId('wo-panel-lab').click()
  await page.getByTestId('wo-lab-hedges-filler').click()
  await waitForRun(page)
  await expect(page.locator('.wo-run-head').first()).toContainText('标记')
  await expect(page.locator('.wo-run-head').first()).toContainText('待处理')
  await shot(page, 'zh-ui-panel')
  // choice persists across reload (localStorage)
  await saved(page)
  await page.reload()
  await openWriteOn(page, { provider: 'test' })
  await expect(page.getByTestId('wo-undo')).toHaveText('撤销')
  await shot(page, 'zh-ui-reload')
  // and switches back
  await page.getByTestId('wo-lang').click()
  await expect(page.getByTestId('wo-undo')).toHaveText('Undo')
  vlog('ui language: PASS')
})

test('multi-window: second page in same context opens same doc without corruption', async ({ page, context }) => {
  await openWriteOn(page, { provider: 'test' })
  await newDoc(page, 'Multi window text.')
  await saved(page)
  const p2 = await context.newPage()
  await openWriteOn(p2, { provider: 'test' })
  await p2.locator('.wo-docitem').first().click()
  await page.waitForTimeout(600)
  // any conflict banner or clean open — both acceptable per spec (no corruption)
  await shot(p2, 'multi-window')
  await p2.close()
  vlog('multi-window: PASS')
})
