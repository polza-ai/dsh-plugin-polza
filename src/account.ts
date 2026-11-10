// Баланс организации и лимит ключа: GET /v2/balance, /v1/key (Bearer pza_…).
import { trimSlash } from './catalog.ts'
import { formatRub } from './contract.ts'

const REQUEST_TIMEOUT_MS = 12_000

export class PolzaHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function getJson(baseUrl: string, path: string, apiKey: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${trimSlash(baseUrl)}${path}`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new PolzaHttpError(response.status, `${path}: HTTP ${response.status}`)
  const body: unknown = await response.json()
  return body !== null && typeof body === 'object' ? body as Record<string, unknown> : {}
}

function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

export interface PolzaAccount {
  balance: { amount: number | null; available: number | null } | null
  key: { label: string | null; limit: number | null; remaining: number | null; reset: string | null; usageDaily: number | null; usageMonthly: number | null } | null
  /** 401/403 — ключ отозван, нужен повторный вход. */
  revoked: boolean
  errors: string[]
}

export async function fetchPolzaAccount(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<PolzaAccount> {
  const [balance, key] = await Promise.allSettled([
    getJson(baseUrl, '/v2/balance', apiKey, fetchImpl),
    getJson(baseUrl, '/v1/key', apiKey, fetchImpl),
  ])
  const failures = [balance, key].filter(result => result.status === 'rejected')
  return {
    balance: balance.status === 'fulfilled'
      ? { amount: num(balance.value['amount']), available: num(balance.value['available']) }
      : null,
    key: key.status === 'fulfilled'
      ? {
        label: typeof key.value['label'] === 'string' ? key.value['label'] : null,
        limit: num(key.value['limit']),
        remaining: num(key.value['limit_remaining']),
        reset: typeof key.value['limit_reset'] === 'string' ? key.value['limit_reset'] : null,
        usageDaily: num(key.value['usage_daily']),
        usageMonthly: num(key.value['usage_monthly']),
      }
      : null,
    revoked: failures.some(result => result.reason instanceof PolzaHttpError && (result.reason.status === 401 || result.reason.status === 403)),
    errors: failures.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)),
  }
}

const RESET_LABEL: Record<string, string> = { daily: 'в день', weekly: 'в неделю', monthly: 'в месяц', never: 'всего' }

export function formatAccount(account: PolzaAccount): string {
  if (account.revoked) return 'Польза отклонила ключ (отозван или удалён). Войдите заново: /polza login'
  const lines: string[] = []
  if (account.balance !== null) {
    const { amount, available } = account.balance
    lines.push(`Баланс: ${amount === null ? '—' : formatRub(amount)}${available !== null && available !== amount ? ` (доступно ${formatRub(available)})` : ''}`)
  }
  if (account.key !== null) {
    const { label, limit, remaining, reset, usageDaily, usageMonthly } = account.key
    if (limit !== null) {
      lines.push(`Лимит ключа${label ? ` «${label}»` : ''}: ${formatRub(limit)} ${RESET_LABEL[reset ?? ''] ?? ''}`.trimEnd()
        + (remaining === null ? '' : `, осталось ${formatRub(remaining)}`))
    } else {
      lines.push(`Ключ${label ? ` «${label}»` : ''}: без лимита`)
    }
    if (usageDaily !== null || usageMonthly !== null) {
      lines.push(`Расход ключа: сегодня ${formatRub(usageDaily ?? 0)}, за месяц ${formatRub(usageMonthly ?? 0)}`)
    }
  }
  for (const error of account.errors) lines.push(`Ошибка: ${error}`)
  lines.push('Пополнить: https://polza.ai/dashboard')
  return lines.join('\n')
}
