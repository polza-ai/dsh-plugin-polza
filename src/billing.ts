// Ошибки денег от Пользы (HTTP 402 INSUFFICIENT_BALANCE) → понятный текст со ссылкой
// на пополнение. Баланс и лимит ключа различаются только текстом сообщения.
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'

export const DASHBOARD_URL = 'https://polza.ai/dashboard'
export const KEYS_URL = 'https://polza.ai/dashboard/api-keys'

export type BillingKind = 'balance' | 'key-limit'

export interface BillingAlert {
  kind: BillingKind
  message: string
  at: number
}

/** Это ошибка денег Пользы? Какая именно. */
export function classifyBilling(failure: { message: string; code?: string; status?: number }): BillingKind | undefined {
  const text = failure.message
  const paymentRequired = failure.status === 402 || /INSUFFICIENT_BALANCE|\b402\b/u.test(text)
  if (/лимит|limit balance|reservation exceeds/iu.test(text) && (paymentRequired || /Достигнут/u.test(text))) return 'key-limit'
  if (/Недостаточно средств|Insufficient funds|INSUFFICIENT_BALANCE/iu.test(text) || (paymentRequired && failure.code === 'QUOTA')) return 'balance'
  return undefined
}

export function billingMessage(kind: BillingKind, original: string): string {
  const available = original.match(/доступно:?\s*([\d\s.,]+)\s*₽/u)?.[1]?.trim()
  return kind === 'balance'
    ? `Польза: недостаточно средств${available ? ` (доступно ${available} ₽)` : ''}. Пополните баланс: ${DASHBOARD_URL}`
    : `Польза: исчерпан лимит расходов ключа. Поднимите лимит ключа в ${KEYS_URL} или войдите заново с новым лимитом.`
}

/** Переписать финальную ошибку стрима и брошенный LlmError, если это ошибка денег. */
export async function* withBillingErrors(
  inner: AsyncIterable<StreamChunk>,
  report: (alert: BillingAlert) => void,
): AsyncIterable<StreamChunk> {
  try {
    for await (const chunk of inner) {
      if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
        const failure: LlmFailure = chunk.reason.failure
        const kind = classifyBilling(failure)
        if (kind !== undefined) {
          const message = billingMessage(kind, failure.message)
          report({ kind, message, at: Date.now() })
          yield { ...chunk, reason: { kind: 'error', failure: { ...failure, code: 'QUOTA', message } } }
          continue
        }
      }
      yield chunk
    }
  } catch (error) {
    if (error instanceof LlmError) {
      const kind = classifyBilling({ message: error.message, code: error.code, ...(error as { status?: number }).status === undefined ? {} : { status: (error as { status?: number }).status as number } })
      if (kind !== undefined) {
        const message = billingMessage(kind, error.message)
        report({ kind, message, at: Date.now() })
        throw new LlmError(message, 'QUOTA', { cause: error })
      }
    }
    throw error
  }
}
