// Иконки провайдеров моделей с CDN Пользы (icons.polza.ai, набор lobehub, моно-SVG
// на currentColor). Кэш в памяти и на диске; клиент получает их текстом и рисует маской.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const CDN = 'https://icons.polza.ai'
const MAX_BYTES = 64 * 1024
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const MISS_RETRY_MS = 6 * 3_600_000

export class PolzaIconStore {
  private readonly memory = new Map<string, string>()
  private readonly misses = new Map<string, number>()
  private readonly pending = new Map<string, Promise<string | undefined>>()

  constructor(private readonly dir: string, private readonly fetchImpl: typeof fetch = fetch) {}

  /** `rememberMiss: false` — слаг угадан, промах не запоминаем. */
  get(slug: string, options: { rememberMiss?: boolean } = {}): Promise<string | undefined> {
    if (!SLUG.test(slug)) return Promise.resolve(undefined)
    const hit = this.memory.get(slug)
    if (hit !== undefined) return Promise.resolve(hit)
    if (Date.now() - (this.misses.get(slug) ?? 0) < MISS_RETRY_MS) return Promise.resolve(undefined)
    let pending = this.pending.get(slug)
    if (pending === undefined) {
      pending = this.load(slug, options.rememberMiss ?? true).finally(() => { this.pending.delete(slug) })
      this.pending.set(slug, pending)
    }
    return pending
  }

  private async load(slug: string, rememberMiss: boolean): Promise<string | undefined> {
    const file = join(this.dir, `${slug}.svg`)
    try {
      const cached = await readFile(file, 'utf8')
      if (isSvg(cached)) { this.memory.set(slug, cached); return cached }
    } catch { /* нет в кэше */ }
    try {
      const response = await this.fetchImpl(`${CDN}/${slug}.svg`, { signal: AbortSignal.timeout(10_000) })
      const text = response.ok ? await response.text() : ''
      if (!isSvg(text)) { if (rememberMiss) this.misses.set(slug, Date.now()); return undefined }
      this.memory.set(slug, text)
      await mkdir(this.dir, { recursive: true })
      await writeFile(file, text).catch(() => {})
      return text
    } catch {
      if (rememberMiss) this.misses.set(slug, Date.now())
      return undefined
    }
  }
}

function isSvg(text: string): boolean {
  return text.length > 0 && text.length <= MAX_BYTES && text.trimStart().startsWith('<svg')
}
