import { expect, test, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Verification run directory — the runner script sets WO_VERIFY_DIR. */
export const VERIFY_DIR = process.env.WO_VERIFY_DIR ?? join(process.cwd(), 'verification', 'latest')
mkdirSync(join(VERIFY_DIR, 'screenshots'), { recursive: true })
mkdirSync(join(VERIFY_DIR, 'logs'), { recursive: true })

let shotN = 0
/** Named, ordered screenshot into verification/<run>/screenshots/. */
export async function shot(page: Page, name: string) {
  shotN += 1
  const file = join(VERIFY_DIR, 'screenshots', `${String(shotN).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

/** Open the DSH web app, dismiss the preview notice, and enter the Write On panel. */
export async function openWriteOn(page: Page, opts: { provider?: 'test' | 'http' } = {}) {
  const base = (process.env.DSH_URL ?? 'http://127.0.0.1:3080').replace(/\/$/, '')
  const url = new URL(base)
  await page.goto(url.toString())
  const cont = page.getByRole('button', { name: 'Continue' })
  if (await cont.isVisible().catch(() => false)) await cont.click()
  // The one-time-token URL is rewritten to '/' after auth — re-navigate with
  // the provider flag so the client sees it at mount time.
  if (opts.provider === 'test' && !page.url().includes('woprovider=test')) {
    const u = new URL(page.url())
    u.searchParams.set('woprovider', 'test')
    await page.goto(u.toString())
  }
  await page.getByRole('button', { name: 'Write On' }).click()
  await expect(page.getByTestId('wo-root')).toBeVisible()
  return page
}

/** Create a fresh document and type body text (one paragraph per \n). */
export async function newDoc(page: Page, text: string) {
  // The welcome overlay covers the docbar — wait a beat for React to settle,
  // then click whichever create affordance is actually reachable.
  const welcome = page.getByTestId('wo-welcome-new')
  try {
    await welcome.waitFor({ state: 'visible', timeout: 2000 })
    await welcome.click()
  } catch {
    await page.getByTestId('wo-newdoc').click()
  }
  const editor = page.locator('.wo-editor .ProseMirror')
  await expect(editor).toBeVisible()
  if (text !== '') {
    await editor.click()
    await page.keyboard.type(text, { delay: 1 })
  }
  await page.waitForTimeout(700) // autosave debounce
  return editor
}

export async function editorText(page: Page) {
  const raw = await page.locator('.wo-editor .ProseMirror').innerText()
  return raw.replace(/​/g, '').replace(/\n+$/, '')
}

/**
 * Select text in the ProseMirror editor by DOM range. Finds the first
 * occurrence of `text` inside a text node and selects [i, i+len). PM's
 * selectionchange observer syncs view state.
 */
/**
 * Select text in the ProseMirror editor by DOM range. Variant marker atoms
 * (.wovstart/.wovend) render a placeholder ZWSP that is not document text —
 * they are skipped so a range may span markers. Paragraph boundaries count
 * as one newline, matching textContent concatenation.
 */
export async function selectText(page: Page, text: string, occurrence = 0) {
  const found = await page.locator('.wo-editor .ProseMirror').evaluate((el, { text, occurrence }) => {
    const SKIP = '.wovstart,.wovend'
    const nodes: Text[] = []
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = walker.nextNode()) !== null) {
      const parent = (n as Text).parentElement
      if (parent !== null && parent.closest(SKIP) !== null) continue
      nodes.push(n as Text)
    }
    // cumulative plain-text offsets; block-level siblings add a '\n'
    const offs: number[] = []
    let acc = 0
    for (const t of nodes) {
      offs.push(acc)
      acc += (t.textContent ?? '').length
      let p: Element | null = t.parentElement
      while (p !== null && p !== el) {
        if (p.nextElementSibling !== null && /^(P|H1|H2|H3|DIV|LI)$/.test(p.tagName)) { acc += 1; break }
        p = p.parentElement
      }
    }
    // haystack with the same '\n' insertions as the offset walk
    let hay2 = ''
    for (const t of nodes) {
      hay2 += t.textContent ?? ''
      let p: Element | null = t.parentElement
      while (p !== null && p !== el) {
        if (p.nextElementSibling !== null && /^(P|H1|H2|H3|DIV|LI)$/.test(p.tagName)) { hay2 += '\n'; break }
        p = p.parentElement
      }
    }
    let pos = -1
    let hits = 0
    let from = 0
    while ((pos = hay2.indexOf(text, from)) >= 0) {
      if (hits === occurrence) break
      hits += 1
      from = pos + 1
    }
    if (pos < 0) return false
    const locate = (offset: number): [Text, number] | null => {
      for (let i = 0; i < nodes.length; i++) {
        const start = offs[i]!
        const end = start + (nodes[i]!.textContent ?? '').length
        if (offset >= start && offset <= end) return [nodes[i]!, offset - start]
      }
      return null
    }
    const s = locate(pos)
    const e = locate(pos + text.length)
    if (s === null || e === null) return false
    const r = el.ownerDocument.createRange()
    r.setStart(s[0], s[1])
    r.setEnd(e[0], e[1])
    const sel = el.ownerDocument.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    return true
  }, { text, occurrence })
  expect(found, `text "${text}" should exist in editor`).toBe(true)
  // Give PM a beat to observe the selectionchange.
  await page.waitForTimeout(150)
}

/**
 * Save status indicator until 'clean'. Waits out the autosave debounce
 * (600 ms) + IDB write first — a still-showing 'Saved' could be a stale
 * badge from the previous flush, so timing out the debounce is required.
 */
export async function saved(page: Page) {
  await page.waitForTimeout(1200)
  await expect(page.getByTestId('wo-savestate')).toHaveText(/Saved|saved/)
}

/** First alternatives group testid → group id. */
export async function firstGroupId(page: Page) {
  const g = page.locator('[data-testid^="wo-group-"]').first()
  await expect(g).toBeVisible()
  return (await g.getAttribute('data-testid'))!.replace('wo-group-', '')
}

/** True when a lab/trim run finished producing proposals or empty-state. */
export async function waitForRun(page: Page) {
  await expect(page.locator('[data-testid^="wo-run-"]').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('wo-busy')).not.toBeVisible({ timeout: 30_000 })
}

export { expect, test }

/** Append a line into the verification run log. */
export function vlog(line: string) {
  writeFileSync(join(VERIFY_DIR, 'logs', 'e2e.log'), `${new Date().toISOString()} ${line}\n`, { flag: 'a' })
}
