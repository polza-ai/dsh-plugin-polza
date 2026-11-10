// Клиент к /api/polza/* хоста плюс общий стор состояния для всех мест UI.
import type { CatalogRow, PolzaState } from '../http-api.ts'

export type { CatalogRow, PolzaState }

function url(path: string): string {
  return new URL(`api/polza/${path}`, document.baseURI).href
}

async function call<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const response = await fetch(url(path), {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    ...init?.body === undefined ? {} : { body: JSON.stringify(init.body) },
  })
  const data = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}

export interface Snapshot {
  state: PolzaState | null
  loading: boolean
  error: string | null
}

const POLL_MS = 60_000
const LOGIN_POLL_MS = 1_500

/** Один стор на вкладку: раздел настроек, чип в сайдбаре и карточка Models читают одно и то же. */
export class PolzaStore {
  private snapshot: Snapshot = { state: null, loading: true, error: null }
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private catalogPromise: Promise<CatalogRow[]> | undefined
  private disposed = false

  readonly getSnapshot = (): Snapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(): () => void {
    void this.refresh()
    return () => {
      this.disposed = true
      clearTimeout(this.timer)
      this.listeners.clear()
    }
  }

  private set(next: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }

  async refresh(force = false): Promise<void> {
    clearTimeout(this.timer)
    try {
      const state = await call<PolzaState>(`state${force ? '?refresh=1' : ''}`)
      this.set({ state, loading: false, error: null })
    } catch (error) {
      this.set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
    if (this.disposed) return
    this.timer = setTimeout(() => { void this.refresh() }, this.snapshot.state?.login.pending === true ? LOGIN_POLL_MS : POLL_MS)
  }

  async login(): Promise<string> {
    const { url: authorize } = await call<{ url: string }>('login', { method: 'POST', body: {} })
    await this.refresh()
    return authorize
  }

  async cancelLogin(): Promise<void> {
    await call('login-cancel', { method: 'POST', body: {} })
    await this.refresh()
  }

  async logout(): Promise<void> {
    await call('logout', { method: 'POST', body: {} })
    await this.refresh(true)
  }

  async saveKey(key: string): Promise<void> {
    await call('key', { method: 'POST', body: { key } })
    await this.refresh(true)
  }

  async saveModels(models: readonly string[]): Promise<void> {
    await call('models', { method: 'POST', body: { models } })
    await this.refresh()
  }

  pickerIcons(): Promise<Record<string, string>> {
    return call<{ models: Record<string, string> }>('icons').then(data => data.models)
  }

  catalog(force = false): Promise<CatalogRow[]> {
    if (force || this.catalogPromise === undefined) {
      this.catalogPromise = call<{ models: CatalogRow[] }>('catalog').then(data => data.models)
      this.catalogPromise.catch(() => { this.catalogPromise = undefined })
    }
    return this.catalogPromise
  }
}

export function formatRub(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  const abs = Math.abs(amount)
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : 2
  return `${amount.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ₽`
}
