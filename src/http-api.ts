// HTTP API для клиентской части: /api/polza/* как точные Fetch-маршруты ctx.connection
// (доверие Host/Origin и cookie-авторизацию владельца проверяет harness до нас).
import { fetchPolzaAccount } from './account.ts'
import type { PolzaAccount } from './account.ts'
import type { PolzaCatalogStore } from './catalog.ts'
import type { PolzaCatalogModel } from './contract.ts'
import { describe, displayName, thinkingLevelMap } from './models.ts'
import { openInBrowser, startLoopbackLogin } from './oauth.ts'
import type { WhitelistStore } from './whitelist.ts'
import type { PolzaIconStore } from './icons.ts'

export const API_PREFIX = '/api/polza'
const MAX_BODY = 64 * 1024
const ACCOUNT_TTL_MS = 20_000

export interface PolzaApiDeps {
  baseUrl: string
  currentKey: () => Promise<string | undefined>
  saveKey: (key: string) => Promise<void>
  removeKey: () => Promise<void>
  catalog: PolzaCatalogStore
  whitelist: WhitelistStore
  icons: PolzaIconStore
  log: (message: string) => void
}

/** Модель каталога в форме для UI. */
export interface CatalogRow {
  id: string
  name: string
  vendor: string
  description: string
  shortDescription: string | null
  contextLength: number | null
  reasoning: boolean
  image: boolean
  promptRub: number | null
  completionRub: number | null
}

function row(model: PolzaCatalogModel): CatalogRow {
  return {
    id: model.id,
    name: displayName(model),
    vendor: model.name.match(/^([^:]{1,40}):/u)?.[1]?.trim() ?? model.vendor,
    description: describe(model),
    shortDescription: model.shortDescription,
    contextLength: model.contextLength,
    reasoning: thinkingLevelMap(model) !== undefined,
    image: model.inputModalities.includes('image'),
    promptRub: model.pricing?.promptPerMillion ?? null,
    completionRub: model.pricing?.completionPerMillion ?? null,
  }
}

export interface PolzaState {
  signedIn: boolean
  keyHint: string | null
  login: { pending: boolean; url: string | null; error: string | null }
  account: PolzaAccount | null
  models: string[]
  customized: boolean
}

function keyHint(key: string): string {
  return key.length <= 12 ? 'pza_••••' : `${key.slice(0, 8)}••••${key.slice(-4)}`
}

export class PolzaApi {
  private login: { pending: boolean; url: string | null; error: string | null; cancel?: () => void } = { pending: false, url: null, error: null }
  private account: { key: string; at: number; value: PolzaAccount } | undefined

  constructor(private readonly deps: PolzaApiDeps) {}

  async state(refresh = false): Promise<PolzaState> {
    const key = await this.deps.currentKey()
    let account: PolzaAccount | null = null
    if (key !== undefined) {
      if (refresh || this.account === undefined || this.account.key !== key || Date.now() - this.account.at > ACCOUNT_TTL_MS) {
        this.account = { key, at: Date.now(), value: await fetchPolzaAccount(this.deps.baseUrl, key) }
      }
      account = this.account.value
    }
    const { cancel: _cancel, ...login } = this.login
    return {
      signedIn: key !== undefined,
      keyHint: key === undefined ? null : keyHint(key),
      login,
      account,
      models: [...this.deps.whitelist.current()],
      customized: this.deps.whitelist.customized(),
    }
  }

  async startLogin(): Promise<{ url: string }> {
    this.login.cancel?.()
    const controller = new AbortController()
    const flow = await startLoopbackLogin({ baseUrl: this.deps.baseUrl, appName: 'DeepSeek Harness', signal: controller.signal })
    this.login = { pending: true, url: flow.url, error: null, cancel: () => { controller.abort() } }
    openInBrowser(flow.url)
    flow.key
      .then(async (key) => {
        await this.deps.saveKey(key)
        this.account = undefined
        this.login = { pending: false, url: null, error: null }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        this.login = { pending: false, url: null, error: error instanceof Error ? error.message : String(error) }
        this.deps.log(`вход не удался: ${this.login.error}`)
      })
    return { url: flow.url }
  }

  cancelLogin(): void {
    this.login.cancel?.()
    this.login = { pending: false, url: null, error: null }
  }

  async logout(): Promise<void> {
    this.cancelLogin()
    await this.deps.removeKey()
    this.account = undefined
  }

  /** SVG иконок провайдеров для моделей пикера: { modelId: svg }. */
  async pickerIcons(): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    // Слаг иконки берётся из каталога: без него догадка по префиксу id промахивается (moonshotai ≠ moonshot).
    if (this.deps.catalog.current().length === 0) await this.deps.catalog.refresh()
    await Promise.all(this.deps.whitelist.current().map(async (id) => {
      const model = this.deps.catalog.get(id)
      const slug = model?.iconSlug ?? id.split('/')[0]
      if (slug === undefined) return
      const svg = await this.deps.icons.get(slug, { rememberMiss: model?.iconSlug != null })
      if (svg !== undefined) out[id] = svg
    }))
    return out
  }

  async catalogRows(): Promise<CatalogRow[]> {
    await this.deps.catalog.refresh()
    return this.deps.catalog.current().map(row)
  }

  /** Точные Fetch-маршруты для ctx.connection.fetch (доверие и авторизацию проверяет harness). */
  routes(): PolzaRoute[] {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
    const guard = (fn: (request: Request) => Promise<Response>) => async (request: Request) => {
      try { return await fn(request) } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400) }
    }
    const body = async (request: Request): Promise<Record<string, unknown>> => {
      const text = await request.text()
      if (text.length > MAX_BODY) throw new Error('тело запроса слишком большое')
      return text.length === 0 ? {} : JSON.parse(text) as Record<string, unknown>
    }
    return [
      { path: `${API_PREFIX}/state`, methods: ['GET'], fetch: guard(async request => json(await this.state(new URL(request.url).searchParams.get('refresh') === '1'))) },
      { path: `${API_PREFIX}/login`, methods: ['POST'], fetch: guard(async () => json(await this.startLogin())) },
      { path: `${API_PREFIX}/login-cancel`, methods: ['POST'], fetch: guard(async () => { this.cancelLogin(); return json({ ok: true }) }) },
      { path: `${API_PREFIX}/logout`, methods: ['POST'], fetch: guard(async () => { await this.logout(); return json({ ok: true }) }) },
      { path: `${API_PREFIX}/key`, methods: ['POST'], fetch: guard(async (request) => {
        const raw = (await body(request))['key']
        const key = typeof raw === 'string' ? raw.trim() : ''
        if (!/^pza_[A-Za-z0-9_-]{8,}$/u.test(key)) return json({ error: 'Ожидался ключ вида pza_…' }, 400)
        await this.deps.saveKey(key)
        this.account = undefined
        return json({ ok: true })
      }) },
      { path: `${API_PREFIX}/icons`, methods: ['GET'], fetch: guard(async () => json({ models: await this.pickerIcons() })) },
      { path: `${API_PREFIX}/catalog`, methods: ['GET'], fetch: guard(async () => json({ models: await this.catalogRows() })) },
      { path: `${API_PREFIX}/models`, methods: ['POST'], fetch: guard(async request => json({ models: await this.deps.whitelist.save((await body(request))['models']) })) },
    ]
  }
}

export interface PolzaRoute {
  path: string
  methods: ('GET' | 'POST')[]
  fetch: (request: Request) => Promise<Response>
}
