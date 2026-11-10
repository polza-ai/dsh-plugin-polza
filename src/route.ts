// Профиль маршрута `polza` в форме, которую ест PiAiAdapter.
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { PiAiAdapterOptions, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { Api, AuthContext, Credential, CredentialStore, Model, Provider } from '@earendil-works/pi-ai'
import { POLZA_PROVIDER_ID } from './contract.ts'
import { FALLBACK_CONTEXT_WINDOW, FALLBACK_MAX_TOKENS, polzaCompat } from './models.ts'

/** Учётки pi-ai этому маршруту не нужны: ключ приходит опцией запроса. */
class NoCredentials implements CredentialStore {
  read(): Promise<Credential | undefined> { return Promise.resolve(undefined) }
  list(): Promise<readonly []> { return Promise.resolve([]) }
  modify(_id: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> { return fn(undefined) }
  delete(): Promise<void> { return Promise.resolve() }
}

const NO_AMBIENT_AUTH: AuthContext = {
  env: () => Promise.resolve(undefined),
  fileExists: () => Promise.resolve(false),
}

export const POLZA_AUTH: PiAiAdapterOptions['auth'] = { credentials: new NoCredentials(), authContext: NO_AMBIENT_AUTH }

/** Ключ, который harness уже разрешил, — pi-ai только передаёт его как Bearer. */
function harnessApiKeyAuth(): Provider['auth'] {
  return {
    apiKey: {
      name: 'Polza',
      resolve: ({ credential }) => Promise.resolve({
        auth: credential?.key === undefined ? {} : { apiKey: credential.key },
        source: 'Polza',
      }),
    },
  } as Provider['auth']
}

/** Модель из белого списка, которой ещё нет в каталоге (каталог не загрузился). */
export function fallbackModel(id: string, provider: string, baseUrl: string): Model<Api> {
  return {
    id, name: id, api: 'openai-completions', provider, baseUrl,
    input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false, contextWindow: FALLBACK_CONTEXT_WINDOW, maxTokens: FALLBACK_MAX_TOKENS,
    compat: polzaCompat(id),
  } as Model<Api>
}

export interface PolzaProfileInput {
  models: readonly Model<Api>[]
  keyRef: CredentialRef
  provider?: string
  displayName?: string
  retryPath?: string
}

export function buildPolzaProfile(input: PolzaProfileInput): ResolvedPiAiProviderProfile {
  const provider = input.provider ?? POLZA_PROVIDER_ID
  const displayName = input.displayName ?? 'Polza'
  const api = openAICompletionsApi()
  const models = [...input.models]
  const piProvider = {
    id: provider,
    name: displayName,
    ...models[0] === undefined ? {} : { baseUrl: models[0].baseUrl },
    auth: harnessApiKeyAuth(),
    getModels: () => models,
    stream: (model, context, options) => api.stream(model, context, options),
    streamSimple: (model, context, options) => api.streamSimple(model, context, options),
  } as Provider
  return {
    provider,
    displayName,
    apiKeyEnv: input.keyRef,
    streamIdleTimeoutMs: 300_000,
    maxRequestImageBytes: 20 * 1024 * 1024,
    maxRequestImages: 50,
    imageOffloadCountQuantum: 10,
    requestImagePixelBudget: 2048 * 2048,
    requestImageMaxBytes: 1024 * 1024,
    retryPolicy: resolveRetryPolicy(undefined, input.retryPath ?? 'llm-polza.retryPolicy'),
    piProvider,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
  }
}
