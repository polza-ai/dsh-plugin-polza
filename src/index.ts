/**
 * Polza.ai как провайдер моделей DeepSeek Harness.
 *
 * Маршрут `polza` обслуживает `PiAiAdapter` из `@deepseek-ai/dsh-llm-pi-ai`
 * (стрим, картинки, replay, ошибки — его работа), а этот плагин даёт ему
 * профиль: модели из белого списка, описанные каталогом Пользы, и ключ из
 * хранилища учётных данных harness. Вход и баланс — команда `/polza`.
 *
 * ```yaml
 * - id: llm-polza
 *   name: dsh-plugin-polza
 *   config:
 *     models: [anthropic/claude-sonnet-5.5, openai/gpt-5.4]
 * ```
 *
 * @module dsh-plugin-polza
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import { PolzaCatalogStore, trimSlash } from './catalog.ts'
import { POLZA_DEFAULT_BASE_URL, POLZA_PROVIDER_ID, POLZA_STARTER_MODELS } from './contract.ts'
import type { PolzaCatalogModel } from './contract.ts'
import { describe, toPiModel } from './models.ts'
import { buildPolzaProfile, fallbackModel, POLZA_AUTH } from './route.ts'
import { registerPolzaCommand } from './commands.ts'
import { WhitelistStore } from './whitelist.ts'
import { PolzaApi } from './http-api.ts'
import { PolzaIconStore } from './icons.ts'
import type {} from '@deepseek-ai/dsh-client-connection'

export const name = 'llm-polza'
export const inject = ['llm']

export interface Config {
  baseURL: string
  apiKeyEnv: string
  models: import('@deepseek-ai/cordis').Volatile<string[]>
  catalogTtlHours: number
}

export const Config: z<Config> = z.object({
  baseURL: z.string().default(POLZA_DEFAULT_BASE_URL)
    .description('Корень API Пользы; инференс идёт в {baseURL}/v1, вход — в {baseURL}/auth.'),
  apiKeyEnv: z.string().default('POLZA_API_KEY')
    .description('Имя учётных данных с ключом pza_… (хранилище harness, окружение или .env).'),
  models: z.array(z.string()).default([...POLZA_STARTER_MODELS]).volatile()
    .description('Белый список моделей каталога Пользы в порядке пикера.'),
  catalogTtlHours: z.number().default(6)
    .description('Как часто перечитывать каталог Пользы, в часах.'),
}) as unknown as z<Config>

const PROVIDER = POLZA_PROVIDER_ID
const LOG = '[dsh-plugin-polza]'

export function dshHome(): string {
  return process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
}

/** PiAiAdapter с описаниями моделей (цена, окно) в пикере. */
class PolzaAdapter extends PiAiAdapter {
  constructor(options: ConstructorParameters<typeof PiAiAdapter>[0], private readonly catalogEntry: (id: string) => PolzaCatalogModel | undefined) {
    super(options)
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const models = await super.listModels(provider)
    return models.map((model) => {
      const entry = this.catalogEntry(model.id)
      const description = entry === undefined ? '' : describe(entry)
      return description.length === 0 ? model : { ...model, description }
    })
  }
}

export function apply(ctx: Context, config: Config): void {
  const baseUrl = trimSlash(config.baseURL)
  const inferenceUrl = `${baseUrl}/v1`
  const keyRef = credentialRef(config.apiKeyEnv)
  const modelsUpdated = () => { ctx.emit('llm/models-updated', PROVIDER) }

  const catalog = new PolzaCatalogStore({
    baseUrl,
    cachePath: join(dshHome(), 'polza', 'catalog.json'),
    ttlMs: config.catalogTtlHours * 3_600_000,
    onChange: () => { memo = undefined; modelsUpdated() },
    onError: (error) => { ctx.logger.warn(`${LOG} каталог: %s`, error instanceof Error ? error.message : String(error)) },
  })

  // Необязательные сервисы: доступны плагину только через ctx.inject, без него ctx.get() пуст.
  const services: { credentials?: Context['credentials']; attachments?: Context['attachments']; fs?: Context['fs'] } = {}
  for (const service of ['credentials', 'attachments', 'fs'] as const) {
    ctx.inject([service], (child) => {
      child.effect(() => {
        ;(services as Record<string, unknown>)[service] = child.get(service)
        return () => { delete services[service] }
      })
    })
  }

  const models = new WhitelistStore(
    join(dshHome(), 'polza', 'models.json'),
    () => config.models.get() ?? [],
    () => { memo = undefined; modelsUpdated() },
  )

  const reportedMissing = new Set<string>()
  let memo: { whitelist: readonly string[]; profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> } | undefined

  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const whitelist = models.current()
    if (memo?.whitelist === whitelist) return memo.profiles
    const loaded = catalog.current().length > 0
    const routeModels: Model<Api>[] = []
    for (const id of new Set(whitelist)) {
      const entry = catalog.get(id)
      if (entry !== undefined) routeModels.push(toPiModel(entry, PROVIDER, inferenceUrl))
      else if (!loaded) routeModels.push(fallbackModel(id, PROVIDER, inferenceUrl))
      else if (!reportedMissing.has(id)) {
        reportedMissing.add(id)
        ctx.logger.warn(`${LOG} модели «${id}» нет в каталоге Пользы — пропущена`)
      }
    }
    const profile = buildPolzaProfile({ models: routeModels, keyRef, retryPath: `${name}.retryPolicy` })
    memo = { whitelist, profiles: new Map([[PROVIDER, profile]]) }
    return memo.profiles
  }

  /** Ключ pza_… или undefined, если его нет. */
  const currentKey = async (): Promise<string | undefined> => {
    const credentials = services.credentials
    const value = credentials !== undefined
      ? (await credentials.resolve(keyRef))?.value
      : launchEnvironmentOf(ctx).get(keyRef)?.value
    return value === undefined || value.length === 0 ? undefined : assertUsableApiKey(value, 'dsh-plugin-polza', config.apiKeyEnv)
  }

  const adapter = new PolzaAdapter({
    profiles,
    resolveApiKey: async () => {
      const key = await currentKey()
      if (key !== undefined) return key
      throw new LlmError(
        `Польза: нет ключа ${config.apiKeyEnv}. Войдите командой /polza login или сохраните ключ: /polza key pza_…`,
        'MISSING_CREDENTIAL',
      )
    },
    auth: POLZA_AUTH,
    resolveAttachments: () => services.attachments,
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => services.fs?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ model, reason }) => {
      ctx.logger.warn(`${LOG} история ${model}: replay недоступен, отправляю нейтральный контент (${reason})`)
    },
  }, id => catalog.get(id))

  ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.on('loader/volatile-update', () => { memo = undefined; modelsUpdated() })
  // Ключ сохранили или удалили вне плагина (Models, файл учёток) — пикер перечитает список.
  ctx.on('credentials/reference-updated', (ref) => { if (ref === keyRef) modelsUpdated() })

  ctx.effect(() => {
    const timer = setInterval(() => { void catalog.refresh() }, Math.max(config.catalogTtlHours, 0.25) * 3_600_000)
    void models.load()
    void catalog.start()
    return () => { clearInterval(timer) }
  })

  const credentialsOrThrow = () => {
    const service = services.credentials
    if (service === undefined) throw new Error('в этой сборке нет хранилища учётных данных')
    return service
  }
  const api = new PolzaApi({
    baseUrl,
    currentKey,
    saveKey: async (key) => { await credentialsOrThrow().set(keyRef, key); modelsUpdated() },
    removeKey: async () => { await credentialsOrThrow().unset(keyRef); modelsUpdated() },
    catalog,
    whitelist: models,
    icons: new PolzaIconStore(join(dshHome(), 'polza', 'icons')),
    log: (message) => { ctx.logger.warn(`${LOG} ${message}`) },
  })
  ctx.inject(['connection'], (scope) => {
    for (const route of api.routes()) {
      scope.effect(() => scope.connection.fetch.register({ ...route, requestBody: 'buffered' }), `polza: ${route.path}`)
    }
  })

  ctx.inject(['commands'], (child) => {
    registerPolzaCommand(child, {
      baseUrl,
      keyRef,
      keyName: config.apiKeyEnv,
      credentials: () => services.credentials,
      currentKey,
      whitelist: () => models.current(),
      catalog,
      onKeyChanged: modelsUpdated,
    })
  })
}
