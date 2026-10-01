import { expect, test, openWriteOn, newDoc, editorText, selectText, firstGroupId, shot, vlog } from './helpers.js'

/**
 * Real-model layer: no `woprovider=test` — calls go through the DSH host's
 * /api/writeon/ai → ctx.llm.stream → the configured provider (zai-coding-cn /
 * GLM). Proves the genuine model link end-to-end inside the real host.
 */

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test('real model: catalog lists zai-coding-cn and picker selects it', async ({ page }) => {
  await openWriteOn(page)
  await newDoc(page, 'x')
  const sel = page.getByTestId('wo-model')
  await expect(sel).toBeVisible()
  const labels = await sel.locator('option').allTextContents()
  vlog(`models: ${labels.join(', ')}`)
  expect(labels.join(' ')).toContain('zai-coding-cn')
  await shot(page, 'real-model-catalog')
})

test('real model: AI alternatives returns model-written options', async ({ page }) => {
  await openWriteOn(page)
  await newDoc(page, 'A cat sits on an owl. The dog runs fast.')
  await selectText(page, 'owl')
  await page.getByTestId('wo-alt-word').click()
  const gid = await firstGroupId(page)
  await page.getByTestId(`wo-group-ai-${gid}`).click()
  // real model: allow generous streaming time
  await expect(page.locator('[data-testid^="wo-opt-use-"]')).toHaveCount(3, { timeout: 60_000 })
  await shot(page, 'real-alternatives')
  const first = page.locator('[data-testid^="wo-opt-use-"]').first()
  await first.click()
  const text = await editorText(page)
  expect(text).toContain('on a') // article linked for whatever consonant-onset word landed
  await shot(page, 'real-alternatives-used')
  vlog('real alternatives: PASS')
})

async function pickFlash(page: import('@playwright/test').Page) {
  await page.getByTestId('wo-model').selectOption({ label: 'GLM-5.3-Flash (zai-coding-cn)' })
}

test('real model: lab goal produces proposals over real text', async ({ page }) => {
  test.setTimeout(200_000)
  await openWriteOn(page)
  await newDoc(page, 'I think the meeting was very productive and it really really helped us actually.')
  await pickFlash(page)
  await page.getByTestId('wo-panel-lab').click()
  await page.getByTestId('wo-lab-hedges-filler').click()
  await expect(page.locator('[data-testid^="wo-run-"]').first()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('wo-busy')).not.toBeVisible({ timeout: 180_000 })
  if (await page.locator('.wo-run-rejected').first().isVisible().catch(() => false)) {
    vlog('first lab response rejected by contract — retrying once')
    await page.getByTestId('wo-lab-hedges-filler').click()
  }
  await expect(page.locator('.wo-run:not(.wo-run-rejected)').first()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('wo-busy')).not.toBeVisible({ timeout: 180_000 })
  await shot(page, 'real-lab-run')
  vlog('real lab run: PASS')
})

test('real model: trim produces a proposal list', async ({ page }) => {
  test.setTimeout(200_000)
  await openWriteOn(page)
  await newDoc(page, 'The committee deliberated extensively on the matter and eventually concluded that the proposal was fundamentally sound.')
  await pickFlash(page)
  await page.getByTestId('wo-panel-lab').click()
  await page.getByTestId('wo-trim-20').click()
  // A rejected response now lands as a durable `rejected` run row; real models are
  // stochastic, so allow one honest retry before requiring a usable run.
  await expect(page.locator('[data-testid^="wo-run-"]').first()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('wo-busy')).not.toBeVisible({ timeout: 180_000 })
  if (await page.locator('.wo-run-rejected').first().isVisible().catch(() => false)) {
    vlog('first trim response rejected by contract — retrying once')
    await page.getByTestId('wo-trim-20').click()
  }
  await expect(page.locator('.wo-run:not(.wo-run-rejected)').first()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('wo-busy')).not.toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('wo-reviewbar')).toBeVisible()
  await shot(page, 'real-trim-review')
  vlog('real trim: PASS')
})
