// Настройки плагина из UI: $DSH_HOME/polza/settings.json.
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic.ts'
import { polzaModelSlugSchema } from './contract.ts'

export const DEFAULT_SIDE_MODEL = 'deepseek/deepseek-v4.1-flash-1017'

export interface PolzaPrefs {
  autoUpdate: boolean
  /** Модель для заголовков сессий и сжатия контекста; null — та же, что у разговора. */
  sideModel: string | null
  /** Порог «мало денег» в рублях для предупреждения. */
  lowBalanceRub: number
  /** Маршруты в порядке приоритета. Отсутствие записи включает автомаршрутизацию. */
  modelProviders: Record<string, readonly string[]>
}

const DEFAULTS: PolzaPrefs = { autoUpdate: true, sideModel: DEFAULT_SIDE_MODEL, lowBalanceRub: 50, modelProviders: {} }

export class PrefsStore {
  private value: PolzaPrefs = { ...DEFAULTS }
  private pending = Promise.resolve()

  constructor(private readonly path: string) {}

  current(): PolzaPrefs { return this.value }

  load(): Promise<void> {
    this.pending = this.pending.then(async () => {
      try {
        this.value = normalize({ ...DEFAULTS, ...JSON.parse(await readFile(this.path, 'utf8')) as object })
      } catch { /* по умолчанию */ }
    })
    return this.pending
  }

  update(patch: Partial<Omit<PolzaPrefs, 'modelProviders'>>): Promise<PolzaPrefs> {
    return this.transact(current => normalize({ ...current, ...patch, modelProviders: current.modelProviders }))
  }

  setModelProviders(model: string, providers: readonly string[]): Promise<PolzaPrefs> {
    return this.transact(current => {
      const modelProviders = { ...current.modelProviders }
      if (providers.length === 0) delete modelProviders[model]
      else modelProviders[model] = [...providers]
      return { ...current, modelProviders }
    })
  }

  private transact(update: (current: PolzaPrefs) => PolzaPrefs): Promise<PolzaPrefs> {
    const operation = this.pending.then(async () => {
      const next = update(this.value)
      await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`)
      this.value = next
      return next
    })
    this.pending = operation.then(() => {}, () => {})
    return operation
  }
}

function normalize(raw: Record<string, unknown>): PolzaPrefs {
  const side = raw['sideModel']
  const low = raw['lowBalanceRub']
  const providers = raw['modelProviders']
  const modelProviders = providers !== null && typeof providers === 'object'
    ? Object.fromEntries(Object.entries(providers).flatMap(([model, value]) => {
      if (!polzaModelSlugSchema.safeParse(model).success) return []
      const entries: unknown[] = Array.isArray(value) ? value : [value]
      const names = [...new Set(entries.filter((name): name is string => typeof name === 'string' && name.trim() !== ''))]
      return names.length === 0 ? [] : [[model, names] as const]
    }))
    : {}
  return {
    autoUpdate: typeof raw['autoUpdate'] === 'boolean' ? raw['autoUpdate'] : DEFAULTS.autoUpdate,
    modelProviders,
    sideModel: side === null || side === '' ? null : polzaModelSlugSchema.safeParse(side).success ? side as string : DEFAULTS.sideModel,
    lowBalanceRub: typeof low === 'number' && Number.isFinite(low) && low >= 0 ? low : DEFAULTS.lowBalanceRub,
  }
}
