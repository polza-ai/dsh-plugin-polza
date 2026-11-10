// Браузерная половина dsh-plugin-polza: раздел «Польза» в настройках, баланс в
// сайдбаре, карточка на странице Models и иконки провайдеров у моделей Polza в пикере.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { PolzaStore } from './api.ts'
import { injectCss, pickerIconsCss, PolzaMark } from './brand.tsx'
import { BalanceChip, ModelsFooterCard } from './Chip.tsx'
import { DICTIONARIES, NS } from './locale.ts'
import type { T } from './locale.ts'
import { PolzaSection } from './Section.tsx'

export const name = 'polza-ui'
export const inject = ['slots', 'locale']

const PACKAGE = 'dsh-plugin-polza'

export function apply(ctx: Context): void {
  // Типы слотов harness строгие и закрытые; здесь регистрируем через узкий интерфейс.
  const slots = ctx.slots as unknown as {
    inject: (name: string, fn: () => (() => void) | Iterable<() => void>) => () => void
    register: (options: Record<string, unknown>, component: (props: never) => unknown) => () => void
  }
  const locale = ctx.locale as unknown as {
    register: (ns: string, dicts: Record<string, Record<string, string>>) => () => void
    bind: (ns: string) => T
  }
  ctx.effect(() => locale.register(NS, DICTIONARIES), 'polza: dictionaries')
  ctx.effect(() => injectCss(PACKAGE), 'polza: styles')
  const t = locale.bind(NS)

  const store = new PolzaStore()
  ctx.effect(() => store.start(), 'polza: account store')

  // Иконки провайдеров в пикере: пересобираем стиль, когда меняется белый список.
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset['plugin'] = PACKAGE
    tag.dataset['pluginCss'] = `${PACKAGE}/picker-icons.css`
    document.head.appendChild(tag)
    let shown = ''
    const sync = () => {
      const models = store.getSnapshot().state?.models.join('\n')
      if (models === undefined || models === shown) return
      shown = models
      store.pickerIcons().then((icons) => { tag.textContent = pickerIconsCss(icons) }, () => { shown = '' })
    }
    const unsubscribe = store.subscribe(sync)
    sync()
    return () => { unsubscribe(); tag.remove() }
  }, 'polza: picker icons')

  slots.inject('settings.section', () => slots.register({
    name: 'settings.section', id: 'polza', order: 5, label: () => t('nav'), locale: NS,
    inject: () => ({ store }),
  }, PolzaSection as never))

  slots.inject('settings.section.icon', () => slots.register({
    name: 'settings.section.icon', id: 'polza',
  }, (({ size }: { size: number }) => <PolzaMark size={size} />) as never))

  slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action', id: 'polza-balance', locale: NS,
    inject: () => ({ store }),
  }, BalanceChip as never))

  slots.inject('settings.models.footer', () => slots.register({
    name: 'settings.models.footer', id: 'polza', locale: NS,
    inject: () => ({ store }),
  }, ModelsFooterCard as never))
}
