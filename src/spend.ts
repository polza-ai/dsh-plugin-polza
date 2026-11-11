// Расход в рублях по сессиям harness: токены каждого вызова маршрута polza × цены каталога.
// Это оценка (биллинг Пользы — в её кабинете). Хранится в $DSH_HOME/polza/spend.json.
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic.ts'
import type { PolzaCatalogModel } from './contract.ts'

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface SessionSpend {
  rub: number
  calls: number
  tokens: TokenTotals
  /** Расход последнего вызова. */
  lastRub: number
  lastModel: string | null
  /** Вызовы без цены в каталоге: их токены не оценены. */
  unpriced: number
  updatedAt: number
  /** Разбивка по моделям: служебные вызовы видны отдельно. */
  models?: Record<string, { calls: number; rub: number }>
}

/** Доля входа, прочитанного из кэша. */
export function cacheHitRate(tokens: TokenTotals): number | null {
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return prompt === 0 ? null : tokens.cacheRead / prompt
}

export interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

const MAX_SESSIONS = 500
const SAVE_DELAY_MS = 2_000

export function priceRub(model: PolzaCatalogModel | undefined, usage: UsageLike): number | null {
  const pricing = model?.pricing
  if (pricing == null) return null
  const m = 1_000_000
  return (usage.inputTokens ?? 0) * pricing.promptPerMillion / m
    + (usage.cacheReadTokens ?? 0) * (pricing.cacheReadPerMillion ?? pricing.promptPerMillion) / m
    + (usage.cacheWriteTokens ?? 0) * (pricing.cacheWritePerMillion ?? pricing.promptPerMillion) / m
    + (usage.outputTokens ?? 0) * pricing.completionPerMillion / m
}

export class SpendLedger {
  private sessions = new Map<string, SessionSpend>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly path: string, private readonly onError: (error: unknown) => void) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, SessionSpend>
      this.sessions = new Map(Object.entries(raw))
    } catch { /* пусто */ }
  }

  get(sessionId: string): SessionSpend | undefined {
    return this.sessions.get(sessionId)
  }

  record(sessionId: string, modelId: string, model: PolzaCatalogModel | undefined, usage: UsageLike): void {
    const rub = priceRub(model, usage)
    const current = this.sessions.get(sessionId) ?? {
      rub: 0, calls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, lastRub: 0, lastModel: null, unpriced: 0, updatedAt: 0,
    }
    const next: SessionSpend = {
      rub: current.rub + (rub ?? 0),
      calls: current.calls + 1,
      tokens: {
        input: current.tokens.input + (usage.inputTokens ?? 0),
        output: current.tokens.output + (usage.outputTokens ?? 0),
        cacheRead: current.tokens.cacheRead + (usage.cacheReadTokens ?? 0),
        cacheWrite: current.tokens.cacheWrite + (usage.cacheWriteTokens ?? 0),
      },
      lastRub: rub ?? 0,
      lastModel: modelId,
      unpriced: current.unpriced + (rub === null ? 1 : 0),
      updatedAt: Date.now(),
      models: {
        ...current.models,
        [modelId]: { calls: (current.models?.[modelId]?.calls ?? 0) + 1, rub: (current.models?.[modelId]?.rub ?? 0) + (rub ?? 0) },
      },
    }
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, next)
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string)
    this.scheduleSave()
  }

  /** Готовая сумма (генерация картинки/видео): токенов нет, цену прислала Польза. */
  recordCost(sessionId: string, modelId: string, rub: number): void {
    const current = this.sessions.get(sessionId) ?? {
      rub: 0, calls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, lastRub: 0, lastModel: null, unpriced: 0, updatedAt: 0,
    }
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, {
      ...current,
      rub: current.rub + rub,
      lastRub: rub,
      lastModel: modelId,
      updatedAt: Date.now(),
      models: { ...current.models, [modelId]: { calls: (current.models?.[modelId]?.calls ?? 0) + 1, rub: (current.models?.[modelId]?.rub ?? 0) + rub } },
    })
    this.scheduleSave()
  }

  private scheduleSave(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.save() }, SAVE_DELAY_MS)
  }

  async save(): Promise<void> {
    clearTimeout(this.timer)
    try {
      await writeFileAtomic(this.path, JSON.stringify(Object.fromEntries(this.sessions)))
    } catch (error) {
      this.onError(error)
    }
  }
}
