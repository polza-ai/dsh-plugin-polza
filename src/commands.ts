// Команда /polza: вход, ключ, выход, баланс, модели, поиск по каталогу.
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { fetchPolzaAccount, formatAccount } from './account.ts'
import type { PolzaCatalogStore } from './catalog.ts'
import { formatPolzaPriceLabel } from './contract.ts'
import type { PolzaCatalogModel } from './contract.ts'
import { openInBrowser, startLoopbackLogin } from './oauth.ts'

export interface PolzaCommandDeps {
  baseUrl: string
  keyRef: CredentialRef
  keyName: string
  credentials: () => Context['credentials'] | undefined
  currentKey: () => Promise<string | undefined>
  whitelist: () => readonly string[]
  catalog: PolzaCatalogStore
  onKeyChanged: () => void
}

const HELP = [
  '/polza login — войти через polza.ai в браузере (ключ сохранится в harness)',
  '/polza key pza_… — сохранить готовый ключ',
  '/polza logout — удалить ключ',
  '/polza balance — баланс и лимит ключа',
  '/polza models — модели в пикере',
  '/polza catalog <поиск> — найти модель в каталоге Пользы',
].join('\n')

const ok = (text: string): CommandResult => ({ kind: 'success', text })
const fail = (text: string): CommandResult => ({ kind: 'error', text })

function line(model: PolzaCatalogModel): string {
  const price = formatPolzaPriceLabel(model.pricing)
  const ctx = model.contextLength === null ? '' : ` · ${Math.round(model.contextLength / 1000)}K`
  return `${model.id}${price === null ? '' : ` · ${price}`}${ctx}`
}

export function registerPolzaCommand(ctx: Context, deps: PolzaCommandDeps): void {
  const credentials = () => {
    const service = deps.credentials()
    if (service === undefined) throw new Error('в этой сборке нет хранилища учётных данных')
    return service
  }

  const saveKey = async (key: string): Promise<void> => {
    await credentials().set(deps.keyRef, key)
    deps.onKeyChanged()
  }

  const handlers: Record<string, (rest: string, signal: AbortSignal) => Promise<CommandResult>> = {
    async login(_rest, signal) {
      const login = await startLoopbackLogin({ baseUrl: deps.baseUrl, appName: 'DeepSeek Harness', signal })
      openInBrowser(login.url)
      ctx.logger.info(`[dsh-plugin-polza] вход: ${login.url}`)
      try {
        await saveKey(await login.key)
      } finally {
        login.close()
      }
      const account = await fetchPolzaAccount(deps.baseUrl, (await deps.currentKey()) ?? '')
      return ok(`Вход выполнен, ключ сохранён в ${deps.keyName}. Модели Polza появились в пикере.\n${formatAccount(account)}`)
    },

    async key(rest) {
      const key = rest.trim()
      if (!/^pza_[A-Za-z0-9_-]{8,}$/u.test(key)) return fail('Ожидался ключ вида pza_… (polza.ai → Ключи API)')
      await saveKey(key)
      return ok(`Ключ сохранён в ${deps.keyName}.`)
    },

    async logout() {
      await credentials().unset(deps.keyRef)
      deps.onKeyChanged()
      return ok(`Ключ ${deps.keyName} удалён из хранилища harness. Если он задан в окружении или .env — уберите и там.`)
    },

    async balance() {
      const key = await deps.currentKey()
      if (key === undefined) return fail('Нет ключа Пользы. /polza login')
      return ok(formatAccount(await fetchPolzaAccount(deps.baseUrl, key)))
    },

    async models() {
      await deps.catalog.refresh()
      const rows = deps.whitelist().map((id) => {
        const entry = deps.catalog.get(id)
        return entry === undefined ? `${id} · нет в каталоге` : line(entry)
      })
      return ok(`${rows.join('\n')}\n\nСписок задаётся полем models плагина llm-polza в ~/.dsh/profiles/<профиль>/cordis.patch.yml.`)
    },

    async catalog(rest) {
      await deps.catalog.refresh()
      const query = rest.trim().toLowerCase()
      const found = deps.catalog.current()
        .filter(model => query.length === 0 || model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query))
      if (found.length === 0) return fail(`В каталоге нет «${rest.trim()}»`)
      const shown = found.slice(0, 40).map(line)
      return ok(`${shown.join('\n')}${found.length > shown.length ? `\n… ещё ${found.length - shown.length}` : ''}`)
    },
  }

  ctx.commands.register({
    name: 'polza',
    description: 'Polza.ai: вход, баланс, модели',
    input: { hint: 'login | key pza_… | logout | balance | models | catalog <поиск>' },
    // В строке может быть ключ — не пишем её в лог сессии.
    recordInput: false,
    handler: async ({ rawInput, signal }) => {
      const [sub = '', ...rest] = rawInput.trim().split(/\s+/u)
      const handler = handlers[sub.toLowerCase()]
      if (handler === undefined) return ok(HELP)
      try {
        return await handler(rest.join(' '), signal)
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
    },
  })
}
