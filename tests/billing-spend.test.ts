import { describe, expect, it } from 'vitest'
import { billingMessage, classifyBilling, withBillingErrors } from '../src/billing.ts'
import { cacheHitRate, priceRub } from '../src/spend.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

describe('402 от Пользы', () => {
  it('отличает нехватку баланса от лимита ключа', () => {
    expect(classifyBilling({ status: 402, message: 'Недостаточно средств. Требуется: 1 ₽, доступно: 0,40 ₽ (баланс: 0,40 ₽)' })).toBe('balance')
    expect(classifyBilling({ status: 402, message: 'Достигнут дневной лимит по сумме' })).toBe('key-limit')
    expect(classifyBilling({ message: '402 {"error":{"code":"INSUFFICIENT_BALANCE","message":"Insufficient funds"}}' })).toBe('balance')
    expect(classifyBilling({ status: 500, message: 'upstream error' })).toBeUndefined()
  })

  it('пишет понятный текст с суммой и ссылкой', () => {
    expect(billingMessage('balance', 'Недостаточно средств. Требуется: 1 ₽, доступно: 0,40 ₽')).toContain('доступно 0,40 ₽')
    expect(billingMessage('key-limit', '')).toContain('лимит')
  })

  it('переписывает финальную ошибку стрима в QUOTA', async () => {
    async function* inner(): AsyncIterable<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP_402', status: 402, message: 'Недостаточно средств' } } }
    }
    const alerts: unknown[] = []
    const out: StreamChunk[] = []
    for await (const chunk of withBillingErrors(inner(), alert => { alerts.push(alert) })) out.push(chunk)
    expect(out[0]).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'QUOTA' } } })
    expect(alerts).toHaveLength(1)
  })
})

describe('расход и кэш', () => {
  const model = { pricing: { promptPerMillion: 100, completionPerMillion: 500, cacheReadPerMillion: 10, cacheWritePerMillion: 125 } } as never
  it('считает рубли по всем видам токенов', () => {
    expect(priceRub(model, { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBeCloseTo(100 + 50 + 10)
    expect(priceRub(undefined, { inputTokens: 10 })).toBeNull()
  })
  it('доля кэша — от всего входа', () => {
    expect(cacheHitRate({ input: 4, output: 3, cacheRead: 7577, cacheWrite: 603 })).toBeCloseTo(7577 / 8184)
    expect(cacheHitRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })
})
