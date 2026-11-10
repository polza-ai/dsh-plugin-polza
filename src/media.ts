// Media API Пользы: POST /v1/media (async) + опрос GET /v1/media/{id}; картинки и видео.
// Распознавание речи: POST /v1/audio/transcriptions (OpenAI-совместимо), GigaAM.
import { trimSlash } from './catalog.ts'

export const DEFAULT_IMAGE_MODEL = 'google/gemini-nano-banana-2.1'
export const DEFAULT_VIDEO_MODEL = 'bytedance/seedance-2-mini'
export const DEFAULT_STT_MODEL = 'ai-sage/gigaam-v3'

const POLL_MS = 4_000
const IMAGE_TIMEOUT_MS = 5 * 60_000
const VIDEO_TIMEOUT_MS = 20 * 60_000

export class PolzaApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

interface MediaStatus {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  data?: { url?: string; b64_json?: string; revised_prompt?: string }[] | { url?: string; duration?: number }
  usage?: { cost_rub?: number; cost?: number; duration_seconds?: number }
  error?: { code?: string; message?: string; metadata?: { raw?: string } }
  warnings?: string[]
  content?: string
}

export interface MediaResult {
  id: string
  urls: string[]
  costRub: number | null
  warnings: string[]
  text: string | null
}

async function request<T>(baseUrl: string, apiKey: string, path: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(`${trimSlash(baseUrl)}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
      ...init.body === undefined ? {} : { 'content-type': 'application/json' },
    },
    ...init.body === undefined ? {} : { body: JSON.stringify(init.body) },
    ...init.form === undefined ? {} : { body: init.form },
    ...init.signal === undefined ? {} : { signal: init.signal },
  })
  const body = await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } }
  if (!response.ok) {
    throw new PolzaApiError(response.status, body.error?.code ?? `HTTP_${response.status}`, body.error?.message ?? `Польза ответила HTTP ${response.status}`)
  }
  return body
}

export interface MediaRequest {
  model: string
  input: Record<string, unknown>
  kind: 'image' | 'video'
  signal?: AbortSignal
  onProgress?: (status: string, elapsedMs: number) => void
}

/** Запустить генерацию и дождаться результата. */
export async function generateMedia(baseUrl: string, apiKey: string, req: MediaRequest): Promise<MediaResult> {
  const started = Date.now()
  let status = await request<MediaStatus>(baseUrl, apiKey, '/v1/media', {
    method: 'POST', body: { model: req.model, input: req.input, async: true }, ...req.signal ? { signal: req.signal } : {},
  })
  const deadline = started + (req.kind === 'video' ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS)
  while (status.status === 'pending' || status.status === 'processing') {
    req.onProgress?.(status.status, Date.now() - started)
    if (Date.now() > deadline) throw new Error(`генерация ${status.id} не завершилась за ${Math.round((deadline - started) / 60_000)} мин`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_MS)
      req.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('отменено')) }, { once: true })
    })
    status = await request<MediaStatus>(baseUrl, apiKey, `/v1/media/${encodeURIComponent(status.id)}`, req.signal ? { signal: req.signal } : {})
  }
  if (status.status !== 'completed') {
    const error = status.error
    throw new PolzaApiError(0, error?.code ?? status.status.toUpperCase(), error?.message ?? error?.metadata?.raw ?? `генерация ${status.status}`)
  }
  const items = Array.isArray(status.data) ? status.data : status.data ? [status.data] : []
  return {
    id: status.id,
    urls: items.map(item => item.url).filter((url): url is string => typeof url === 'string'),
    costRub: status.usage?.cost_rub ?? status.usage?.cost ?? null,
    warnings: status.warnings ?? [],
    text: status.content ?? null,
  }
}

/** Скачать результат (ссылки Пользы живут 7 дней). */
export async function download(url: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
  const response = await fetch(url, signal ? { signal } : {})
  if (!response.ok) throw new Error(`не скачался результат: HTTP ${response.status}`)
  return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get('content-type') ?? 'application/octet-stream' }
}

/** Распознать речь. audio — байты записи, mime — её тип (audio/webm, audio/wav…). */
export async function transcribe(baseUrl: string, apiKey: string, audio: Uint8Array, mime: string, options: { model?: string; language?: string; signal?: AbortSignal } = {}): Promise<string> {
  const ext = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('mpeg') ? 'mp3' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mime }), `speech.${ext}`)
  form.append('model', options.model ?? DEFAULT_STT_MODEL)
  form.append('language', options.language ?? 'ru')
  form.append('response_format', 'json')
  const body = await request<{ text?: string }>(baseUrl, apiKey, '/v1/audio/transcriptions', { method: 'POST', form, ...options.signal ? { signal: options.signal } : {} })
  return (body.text ?? '').trim()
}
