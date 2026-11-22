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
 *   name: '@polza-ai/dsh-plugin-polza'
 *   config:
 *     models: [anthropic/claude-sonnet-5.5, openai/gpt-5.4]
 * ```
 *
 * @module @polza-ai/dsh-plugin-polza
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { BillingAlert } from './billing.ts'
import { withGatewayErrors } from './gateway-errors.ts'
import { providerReasoningLevels } from './provider-reasoning.ts'
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
import { describe, modelBadge, toPiModel } from './models.ts'
import { buildPolzaProfile, fallbackModel, POLZA_AUTH } from './route.ts'
import { registerPolzaCommand } from './commands.ts'
import { WhitelistStore } from './whitelist.ts'
import { PolzaApi } from './http-api.ts'
import { PolzaIconStore } from './icons.ts'
import { SpendLedger } from './spend.ts'
import { PrefsStore } from './prefs.ts'
import { updatePolza } from './startup-update.ts'
import type { UpdateResult } from './startup-update.ts'
import { registerMediaTools } from './tools.ts'
import { transcribe } from './media.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-tools'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {} from '@deepseek-ai/dsh-client-connection'

export const name = 'llm-polza'
export const inject = ['llm']

export interface Config {
  baseURL: string
  apiKeyEnv: import('@deepseek-ai/cordis').Volatile<string>
  models: import('@deepseek-ai/cordis').Volatile<string[]>
  catalogTtlHours: number
}

export const Config: z<Config> = z.object({
  baseURL: z.string().default(POLZA_DEFAULT_BASE_URL)
    .description('Корень API Пользы; инференс идёт в {baseURL}/v1, вход — в {baseURL}/auth.'),
  apiKeyEnv: z.string().default('POLZA_API_KEY').volatile()
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
  constructor(
    options: ConstructorParameters<typeof PiAiAdapter>[0],
    private readonly catalogEntry: (id: string) => PolzaCatalogModel | undefined,
    private readonly hooks: {
      loadProviders: (model: string) => Promise<unknown>
      billing: (alert: BillingAlert) => void
      usage: (options: GenerateOptions, chunk: StreamChunk) => void
    },
  ) {
    super(options)
  }

  private wrap(options: GenerateOptions, inner: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const hooks = this.hooks
    return (async function* () {
      for await (const chunk of withGatewayErrors(inner, hooks.billing, options.reasoningEffort)) {
        if (chunk.type === 'usage') hooks.usage(options, chunk)
        yield chunk
      }
    })()
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.hooks.loadProviders(options.model)
    options.signal?.throwIfAborted()
    yield* this.wrap(options, () => super.stream(options))
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    await this.hooks.loadProviders(model)
    signal?.throwIfAborted()
    const prepared = await super.prepareCall(provider, model, signal)
    return { model: prepared.model, stream: options => this.wrap(options, () => prepared.stream(options)) }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const models = await super.listModels(provider)
    return models.map((model) => {
      const entry = this.catalogEntry(model.id)
      if (entry === undefined) return model
      const description = describe(entry)
      const badge = modelBadge(entry)
      return {
        ...model,
        ...description.length === 0 ? {} : { description },
        ...badge === undefined ? {} : { badge },
      }
    })
  }
}

export function apply(ctx: Context, config: Config): void {
  const baseUrl = trimSlash(config.baseURL)
  const inferenceUrl = `${baseUrl}/v1`
  const keyName = () => config.apiKeyEnv.get()
  const keyRef = () => credentialRef(keyName())
  const modelsUpdated = () => { ctx.emit('llm/models-updated', PROVIDER) }

  const catalog = new PolzaCatalogStore({
    baseUrl,
    cachePath: join(dshHome(), 'polza', 'catalog.json'),
    ttlMs: config.catalogTtlHours * 3_600_000,
    onChange: () => { memo = undefined; modelsUpdated() },
    onProvidersChange: () => { memo = undefined; modelsUpdated() },
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

  const prefs = new PrefsStore(join(dshHome(), 'polza', 'settings.json'))
  const prefsReady = prefs.load()
  let update: UpdateResult = { status: 'unsupported' }
  let checkUpdates: (() => Promise<void>) | undefined
  ctx.inject(['pluginManager', 'connection'], (scope) => {
    scope.effect(() => {
      const controller = new AbortController()
      let pending: Promise<void> | undefined
      const run = (install: boolean) => {
        if (pending !== undefined) return pending
        if (update.status === 'restart-required') return Promise.resolve()
        const enabled = () => !install || prefs.current().autoUpdate
        update = { status: enabled() ? 'checking' : 'idle' }
        pending = updatePolza(scope.pluginManager, install, enabled, controller.signal)
          .then(result => { if (!controller.signal.aborted) update = result })
          .catch(() => { if (!controller.signal.aborted) update = { status: 'error' } })
          .finally(() => { pending = undefined })
        return pending
      }
      checkUpdates = () => run(false)
      void prefsReady.then(() => { if (!controller.signal.aborted) return run(true) })
      return () => {
        controller.abort()
        checkUpdates = undefined
      }
    }, 'polza: startup update')
  })

  const reportedMissing = new Set<string>()
  let memo: { whitelist: readonly string[]; profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> } | undefined

  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const whitelist = models.current()
    if (memo?.whitelist === whitelist) return memo.profiles
    const loaded = catalog.current().length > 0
    const routeModels: Model<Api>[] = []
    for (const id of new Set(whitelist)) {
      const entry = catalog.get(id)
      if (entry !== undefined) {
        const providers = catalog.currentProviders(id)
        const levels = providers?.length
          ? providerReasoningLevels(new Map(providers.map(({ name, reasoningLevels }) => [name, reasoningLevels])))
          : undefined
        routeModels.push(toPiModel(entry, PROVIDER, inferenceUrl, levels))
      }
      else if (!loaded) routeModels.push(fallbackModel(id, PROVIDER, inferenceUrl))
      else if (!reportedMissing.has(id)) {
        reportedMissing.add(id)
        ctx.logger.warn(`${LOG} модели «${id}» нет в каталоге Пользы — пропущена`)
      }
    }
    const profile = buildPolzaProfile({
      models: routeModels, keyRef: keyRef(), retryPath: `${name}.retryPolicy`,
      modelProviders: id => prefs.current().modelProviders[id],
      providerDetails: id => catalog.currentProviders(id),
    })
    memo = { whitelist, profiles: new Map([[PROVIDER, profile]]) }
    return memo.profiles
  }

  /** Ключ pza_… или undefined, если его нет. */
  const currentKey = async (): Promise<string | undefined> => {
    const credentials = services.credentials
    const ref = keyRef()
    const value = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    return value === undefined || value.length === 0 ? undefined : assertUsableApiKey(value, 'dsh-plugin-polza', ref)
  }

  const adapter = new PolzaAdapter({
    profiles,
    resolveApiKey: async () => {
      const key = await currentKey()
      if (key !== undefined) return key
      throw new LlmError(
        `Польза: нет ключа ${keyName()}. Войдите командой /polza login или сохраните ключ: /polza key pza_…`,
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
  }, id => catalog.get(id), {
    loadProviders: model => models.current().includes(model)
      ? catalog.loadProviders(model).catch(() => undefined)
      : Promise.resolve(),
    billing: (alert) => { api.reportBilling(alert) },
    usage: (options, chunk) => { api.reportUsage(options, chunk) },
  })

  ctx.llm.registerAdapter([PROVIDER], adapter)
  // Desktop onboarding and Models resolve configured provider keys from this directory.
  ctx.llm.registerConfigurableProviders([{
    provider: PROVIDER, displayName: 'Polza', settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: [],
  }])
  ctx.inject(['settings'], (scope) => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.on('loader/volatile-update', () => { memo = undefined; modelsUpdated() })
  // Ключ сохранили или удалили вне плагина (Models, файл учёток) — пикер перечитает список.
  ctx.on('credentials/reference-updated', (ref) => { if (ref === keyRef()) modelsUpdated() })

  const modelsReady = models.load()
  ctx.effect(() => {
    const timer = setInterval(() => { void catalog.refresh() }, Math.max(config.catalogTtlHours, 0.25) * 3_600_000)
    void catalog.start()
    return () => { clearInterval(timer) }
  })

  // Служебные вызовы (заголовок сессии, сжатие контекста) на маршруте polza — дешёвой модели из настроек.
  const redirected = new WeakSet<object>()
  ctx.on('llm/stream', (options, next) => {
    const side = prefs.current().sideModel
    const purpose = (options as { purpose?: string }).purpose
    if (side === null || redirected.has(options) || options.provider !== PROVIDER || options.model === side
      || (purpose !== 'session-title' && purpose !== 'compaction')) return next()
    const { reasoningEffort: _effort, ...rest } = options
    const copy = { ...rest, model: side } as typeof options
    redirected.add(copy)
    return ctx.llm.stream(copy)
  })

  const spend = new SpendLedger(join(dshHome(), 'polza', 'spend.json'), (error) => { ctx.logger.warn(`${LOG} расход: %s`, String(error)) })
  ctx.effect(() => { void spend.load(); return () => { void spend.save() } }, 'polza: spend ledger')
  const credentialsOrThrow = () => {
    const service = services.credentials
    if (service === undefined) throw new Error('в этой сборке нет хранилища учётных данных')
    return service
  }
  let defaultModel: Context['agentDefaultModel'] | undefined
  ctx.inject(['agentDefaultModel'], (scope) => {
    scope.effect(() => {
      defaultModel = scope.agentDefaultModel
      return () => { defaultModel = undefined }
    })
  })
  const saveKey = async (key: string) => {
    const firstConnection = await currentKey().catch(() => undefined) === undefined
    await credentialsOrThrow().set(keyRef(), key)
    modelsUpdated()
    const defaults = defaultModel
    if (!firstConnection || defaults === undefined) return
    const previous = defaults.currentSelection()
    if (previous.provider !== 'deepseek-account' && previous.provider !== 'deepseek-official') return
    try {
      await modelsReady
      await catalog.refresh()
      const available = await ctx.llm.listModels(PROVIDER)
      const model = models.current().find(id => available.some(entry => entry.id === id) && catalog.get(id)?.supportsTools === true)
      if (model === undefined || await currentKey() !== key) return
      const current = defaults.currentSelection()
      if (current.provider !== previous.provider || current.model !== previous.model
        || current.reasoningEffort !== previous.reasoningEffort) return
      await defaults.saveSelection({ provider: PROVIDER, model })
      modelsUpdated()
    } catch {
      ctx.logger.warn(`${LOG} не удалось выбрать модель Пользы по умолчанию`)
    }
  }
  const removeKey = async () => {
    await credentialsOrThrow().unset(keyRef())
    modelsUpdated()
  }
  const api = new PolzaApi({
    baseUrl,
    currentKey,
    saveKey,
    removeKey,
    catalog,
    whitelist: models,
    icons: new PolzaIconStore(join(dshHome(), 'polza', 'icons')),
    spend,
    prefs,
    update: () => update,
    checkUpdates: () => checkUpdates?.() ?? Promise.resolve(),
    log: (message) => { ctx.logger.warn(`${LOG} ${message}`) },
  })
  ctx.inject(['connection'], (scope) => {
    for (const route of api.routes()) {
      scope.effect(() => scope.connection.fetch.register({ ...route, requestBody: 'buffered' }), `polza: ${route.path}`)
    }
  })

  ctx.inject(['tools'], (child) => {
    registerMediaTools(child, {
      baseUrl,
      apiKey: async () => {
        const key = await currentKey()
        if (key === undefined) throw new Error('нет ключа Пользы: войдите в Настройки → Польза')
        return key
      },
      attachments: () => services.attachments,
      recordCost: (sessionId, model, rub) => { spend.recordCost(sessionId, model, rub) },
    })
  })

  // Голосовой ввод harness (экспериментальный бандл): распознавание GigaAM через Пользу.
  ctx.inject(['speechToText'], (child) => {
    child.effect(() => child.speechToText.register({
      info: {
        id: brandString<SpeechProviderId>('polza-gigaam'),
        name: 'Польза · GigaAM',
        location: 'cloud',
        languages: ['auto', 'ru', 'en'],
      },
      transcribe: async (input, signal) => {
        const key = await currentKey()
        if (key === undefined) throw new Error('нет ключа Пользы: войдите в Настройки → Польза')
        const started = Date.now()
        const text = await transcribe(baseUrl, key, input.audio, 'audio/wav', {
          ...input.language === 'auto' ? {} : { language: input.language }, signal,
        })
        return { text, audioSeconds: Math.max(0, input.audio.byteLength - 44) / 32_000, inferenceSeconds: (Date.now() - started) / 1000 }
      },
    }), 'polza: speech provider')
  })

  ctx.inject(['commands'], (child) => {
    registerPolzaCommand(child, {
      baseUrl,
      keyName,
      currentKey,
      saveKey,
      removeKey,
      whitelist: () => models.current(),
      catalog,
    })
  })
}
