// Белый список моделей пикера: файл $DSH_HOME/polza/models.json, правится из UI.
// Пока файла нет, действует поле `models` конфигурации (стартовый набор).
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic.ts'
import { polzaModelSlugSchema } from './contract.ts'

const MAX_MODELS = 200

export function normalizeWhitelist(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error('models: ожидался массив слагов')
  const out: string[] = []
  for (const item of raw) {
    const parsed = polzaModelSlugSchema.safeParse(item)
    if (!parsed.success) throw new Error(`models: «${String(item)}» — не слаг вида vendor/model`)
    if (!out.includes(parsed.data)) out.push(parsed.data)
  }
  if (out.length > MAX_MODELS) throw new Error(`models: не больше ${MAX_MODELS}`)
  return out
}

export class WhitelistStore {
  private stored: readonly string[] | undefined

  constructor(private readonly path: string, private readonly fallback: () => readonly string[], private readonly onChange: () => void) {}

  /** Текущий список; одна и та же ссылка, пока список не менялся. */
  current(): readonly string[] {
    return this.stored ?? this.fallback()
  }

  /** true — список задан из UI, а не конфигурацией. */
  customized(): boolean {
    return this.stored !== undefined
  }

  async load(): Promise<void> {
    try {
      this.stored = Object.freeze(normalizeWhitelist(JSON.parse(await readFile(this.path, 'utf8'))))
      this.onChange()
    } catch {
      // нет файла или он битый — работаем от конфигурации
    }
  }

  async save(models: unknown): Promise<readonly string[]> {
    const next = Object.freeze(normalizeWhitelist(models))
    await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`)
    this.stored = next
    this.onChange()
    return next
  }
}
