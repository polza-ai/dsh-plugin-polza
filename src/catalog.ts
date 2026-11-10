// Каталог чат-моделей Пользы: публичный GET {base}/v1/models?type=chat.
// Последний удачный ответ лежит на диске, чтобы пикер не ждал сеть при старте.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parsePolzaCatalog } from './contract.ts'
import type { PolzaCatalogModel } from './contract.ts'

const CATALOG_PATH = '/v1/models?type=chat'
const CATALOG_TIMEOUT_MS = 90_000

export interface FetchCatalogOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/** Скачать каталог. Бросает при сетевой или HTTP-ошибке и при пустом ответе. */
export async function fetchPolzaCatalog(baseUrl: string, options: FetchCatalogOptions = {}): Promise<PolzaCatalogModel[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = options.signal === undefined
    ? AbortSignal.timeout(CATALOG_TIMEOUT_MS)
    : AbortSignal.any([options.signal, AbortSignal.timeout(CATALOG_TIMEOUT_MS)])
  const response = await fetchImpl(`${trimSlash(baseUrl)}${CATALOG_PATH}`, {
    headers: { accept: 'application/json', 'accept-language': 'ru' },
    signal,
  })
  if (!response.ok) throw new Error(`каталог Пользы ответил HTTP ${response.status}`)
  const models = parsePolzaCatalog(await response.json())
  if (models.length === 0) throw new Error('каталог Пользы пуст')
  return models
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/u, '')
}

interface CacheFile {
  baseUrl: string
  fetchedAt: string
  models: PolzaCatalogModel[]
}

export interface CatalogStoreOptions {
  baseUrl: string
  /** Файл кэша; undefined — без диска. */
  cachePath?: string
  ttlMs: number
  load?: (baseUrl: string) => Promise<PolzaCatalogModel[]>
  now?: () => number
  onChange: (models: readonly PolzaCatalogModel[]) => void
  onError?: (error: unknown) => void
}

/**
 * Синхронный снимок каталога плюс фоновое обновление. `current()` никогда не
 * ждёт сеть: адаптер строит профиль синхронно на каждом запросе.
 */
export class PolzaCatalogStore {
  private models: readonly PolzaCatalogModel[] = []
  private byId = new Map<string, PolzaCatalogModel>()
  private fetchedAt = 0
  private pending: Promise<void> | undefined
  private readonly load: (baseUrl: string) => Promise<PolzaCatalogModel[]>
  private readonly now: () => number

  constructor(private readonly options: CatalogStoreOptions) {
    this.load = options.load ?? (baseUrl => fetchPolzaCatalog(baseUrl))
    this.now = options.now ?? Date.now
  }

  current(): readonly PolzaCatalogModel[] {
    return this.models
  }

  get(id: string): PolzaCatalogModel | undefined {
    return this.byId.get(id)
  }

  /** Поднять кэш с диска, затем обновить из сети, если он устарел. */
  async start(): Promise<void> {
    const cached = await this.readCache()
    if (cached !== undefined) {
      this.fetchedAt = Date.parse(cached.fetchedAt) || 0
      this.publish(cached.models)
    }
    await this.refresh()
  }

  /** Обновить, если кэш старше ttl (или `force`). Ошибка оставляет прежний снимок. */
  refresh(force = false): Promise<void> {
    if (!force && this.models.length > 0 && this.now() - this.fetchedAt < this.options.ttlMs) return Promise.resolve()
    this.pending ??= this.load(this.options.baseUrl)
      .then(async (models) => {
        this.fetchedAt = this.now()
        this.publish(models)
        await this.writeCache(models)
      })
      .catch((error: unknown) => { this.options.onError?.(error) })
      .finally(() => { this.pending = undefined })
    return this.pending
  }

  private publish(models: readonly PolzaCatalogModel[]): void {
    this.models = models
    this.byId = new Map(models.map(model => [model.id, model] as const))
    this.options.onChange(models)
  }

  private async readCache(): Promise<CacheFile | undefined> {
    if (this.options.cachePath === undefined) return undefined
    try {
      const parsed = JSON.parse(await readFile(this.options.cachePath, 'utf8')) as CacheFile
      if (parsed.baseUrl !== this.options.baseUrl || !Array.isArray(parsed.models)) return undefined
      // Кэш старого формата (без иконок) перечитываем из сети.
      if (parsed.models.some(model => !('iconSlug' in model))) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  private async writeCache(models: readonly PolzaCatalogModel[]): Promise<void> {
    const path = this.options.cachePath
    if (path === undefined) return
    try {
      await mkdir(dirname(path), { recursive: true })
      const body: CacheFile = { baseUrl: this.options.baseUrl, fetchedAt: new Date(this.now()).toISOString(), models: [...models] }
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(body))
      await rename(tmp, path)
    } catch (error) {
      this.options.onError?.(error)
    }
  }
}
