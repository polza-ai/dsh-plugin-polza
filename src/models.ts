// Модель каталога Пользы → дескриптор pi-ai для Chat Completions Пользы.
import type { Api, Model, OpenAICompletionsCompat, ThinkingLevelMap } from '@earendil-works/pi-ai'
import type { PolzaCatalogModel } from './contract.ts'
import { formatPolzaPriceLabel } from './contract.ts'

/** Уровни pi-ai в порядке эскалации (см. dsh-llm-pi-ai THINKING_LEVELS). */
const PI_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Без явного списка усилий у рассуждающей модели — стандартная тройка. */
const DEFAULT_EFFORTS = ['low', 'medium', 'high']

/** Окно и потолок вывода, когда каталог их не знает. */
export const FALLBACK_CONTEXT_WINDOW = 128_000
export const FALLBACK_MAX_TOKENS = 32_000

/**
 * Chat Completions Пользы — диалект OpenRouter: `reasoning: { effort }`,
 * `max_tokens`, `cache_control` в сообщениях для моделей Anthropic,
 * без `store` и роли `developer` (её понимают не все апстримы).
 */
export function polzaCompat(modelId: string): OpenAICompletionsCompat {
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    maxTokensField: 'max_tokens',
    thinkingFormat: 'openrouter',
    ...modelId.startsWith('anthropic/') ? { cacheControlFormat: 'anthropic' as const } : {},
  }
}

/**
 * Карта уровней: поддержанные каталогом идут как есть, прочие — `null`
 * (pi-ai исключает их из выбора). `off` разрешён, только если каталог
 * перечисляет `none` и модель не рассуждает принудительно; иначе при
 * невыбранном уровне в запрос ничего не уходит и действует умолчание Пользы.
 */
export function thinkingLevelMap(model: PolzaCatalogModel): ThinkingLevelMap | undefined {
  const efforts = effortsOf(model)
  if (efforts === undefined) return undefined
  const map: ThinkingLevelMap = {}
  map.off = efforts.includes('none') && !model.reasoningMandatory ? 'none' : null
  for (const level of PI_LEVELS) map[level] = efforts.includes(level) ? level : null
  return map
}

function effortsOf(model: PolzaCatalogModel): string[] | undefined {
  const listed = model.reasoningEfforts?.map(effort => effort.toLowerCase())
  if (listed !== undefined) return listed.some(effort => effort !== 'none') ? listed : undefined
  return model.supportsReasoning ? DEFAULT_EFFORTS : undefined
}

/** «Anthropic: Claude Sonnet 5.5» → «Claude Sonnet 5.5»: вендор и так виден в id. */
export function displayName(model: PolzaCatalogModel): string {
  const short = model.name.replace(/^[^:]{1,40}:\s*/u, '').trim()
  return short.length > 0 ? short : model.id
}

/** Строка для пикера: цена за миллион токенов и окно контекста. */
export function describe(model: PolzaCatalogModel): string {
  const parts: string[] = []
  const price = formatPolzaPriceLabel(model.pricing)
  if (price !== null) parts.push(price)
  if (model.contextLength !== null) parts.push(`${Math.round(model.contextLength / 1000)}K контекст`)
  return parts.join(' · ')
}

/** Дескриптор pi-ai для одной модели каталога. */
export function toPiModel(model: PolzaCatalogModel, provider: string, baseUrl: string): Model<Api> {
  const levels = thinkingLevelMap(model)
  const contextWindow = model.contextLength ?? FALLBACK_CONTEXT_WINDOW
  return {
    id: model.id,
    name: displayName(model),
    api: 'openai-completions',
    provider,
    baseUrl,
    input: model.inputModalities.includes('image') ? ['text', 'image'] : ['text'],
    // Цены каталога в рублях; pi-ai считает стоимость в своей валюте, поэтому не подставляем.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: levels !== undefined,
    ...levels === undefined ? {} : { thinkingLevelMap: levels },
    contextWindow,
    maxTokens: Math.min(model.maxCompletionTokens ?? FALLBACK_MAX_TOKENS, contextWindow),
    compat: polzaCompat(model.id),
  } as Model<Api>
}
