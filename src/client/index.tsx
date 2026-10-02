import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { WriteOnPage } from './WriteOnPage.js'
import { WriteOnIcon } from './WriteOnIcon.js'
import { WriteOnController } from './controller.js'
import { dictionaries, NS } from './i18n.js'
import { css } from './styles.js'

export const name = 'dsh-writeon/client'
export const inject = ['slots', 'locale', 'layout']

const PANEL_ID = 'writeon'

interface SlotsService {
  inject(name: string, fn: () => () => void): void
  register(spec: Record<string, unknown>, component: unknown): () => void
}
interface LocaleService {
  register(ns: string, dict: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string) => string
}
interface LayoutService { selectPanel(id: string | null): void }

/** Client apply: registers the sidebar 写作 entry and the main-area workspace panel. */
export function apply(ctx: Context): void {
  const slots = (ctx as unknown as { slots: SlotsService }).slots
  const locale = (ctx as unknown as { locale: LocaleService }).locale
  const layout = (ctx as unknown as { layout: LayoutService }).layout

  ctx.effect(() => locale.register(NS, dictionaries))
  const t = locale.bind(NS)

  // Styles ride the fiber lifecycle: removed when the plugin is disabled.
  const styleTag = document.createElement('style')
  styleTag.dataset.plugin = 'dsh-writeon'
  styleTag.textContent = css
  document.head.appendChild(styleTag)
  ctx.effect(() => () => styleTag.remove())

  const controller = new WriteOnController({
    selectPanel: id => layout.selectPanel(id),
    // Panel notices follow the host locale — the bound t re-resolves per call.
    tr: key => t(key),
  })
  ctx.effect(() => () => controller.destroy())

  slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    label: () => t('panel'),
  }, WriteOnIcon))

  slots.inject('main', () => slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({
      controller,
      selectPanel: (id: string | null) => layout.selectPanel(id),
      locale,
    }),
  }, WriteOnPage))
}
