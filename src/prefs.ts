// Настройки плагина из UI: $DSH_HOME/polza/settings.json.
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic.ts'
import { polzaModelSlugSchema } from './contract.ts'

export const DEFAULT_SIDE_MODEL = 'deepseek/deepseek-v4.1-flash-1017'

export interface PolzaPrefs {
  /** Модель для заголовков сессий и сжатия контекста; null — та же, что у разговора. */
  sideModel: string | null
  /** Порог «мало денег» в рублях для предупреждения. */
  lowBalanceRub: number
}

const DEFAULTS: PolzaPrefs = { sideModel: DEFAULT_SIDE_MODEL, lowBalanceRub: 50 }

export class PrefsStore {
  private value: PolzaPrefs = { ...DEFAULTS }

  constructor(private readonly path: string) {}

  current(): PolzaPrefs { return this.value }

  async load(): Promise<void> {
    try { this.value = normalize({ ...DEFAULTS, ...JSON.parse(await readFile(this.path, 'utf8')) as object }) } catch { /* по умолчанию */ }
  }

  async update(patch: Partial<PolzaPrefs>): Promise<PolzaPrefs> {
    const next = normalize({ ...this.value, ...patch })
    await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`)
    this.value = next
    return next
  }
}

function normalize(raw: Record<string, unknown>): PolzaPrefs {
  const side = raw['sideModel']
  const low = raw['lowBalanceRub']
  return {
    sideModel: side === null || side === '' ? null : polzaModelSlugSchema.safeParse(side).success ? side as string : DEFAULTS.sideModel,
    lowBalanceRub: typeof low === 'number' && Number.isFinite(low) && low >= 0 ? low : DEFAULTS.lowBalanceRub,
  }
}
