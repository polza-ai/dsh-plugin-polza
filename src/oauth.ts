// «Войти через Пользу»: OAuth 2.0 authorization code + PKCE без client_id.
// Ответ /auth/token — бессрочный ключ `pza_…`. Коллбэк ловит одноразовый
// HTTP-сервер на 127.0.0.1; вставка кода/URL — запасной путь.
// Протокол перенесён из bb-plugin-polza (src/polza/oauth.ts).
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { trimSlash } from './catalog.ts'

const LOGIN_TIMEOUT_MS = 10 * 60_000

export interface PkcePair {
  verifier: string
  challenge: string
  state: string
}

export function createPkce(): PkcePair {
  const verifier = randomBytes(48).toString('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(24).toString('base64url'),
  }
}

export function authorizeUrl(baseUrl: string, pkce: PkcePair, callbackUrl: string, appName: string): string {
  const url = new URL(`${trimSlash(baseUrl)}/auth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('callback_url', callbackUrl)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', pkce.state)
  url.searchParams.set('app_name', appName)
  return url.toString()
}

/** Обменять код на ключ. */
export async function exchangeCode(
  baseUrl: string,
  input: { code: string; verifier: string; callbackUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${trimSlash(baseUrl)}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.verifier,
      callback_url: input.callbackUrl,
    }),
  })
  const body = await response.json().catch(() => null) as { key?: unknown; error?: { message?: unknown }; message?: unknown } | null
  if (!response.ok) {
    const detail = typeof body?.error?.message === 'string' ? body.error.message : typeof body?.message === 'string' ? body.message : 'без подробностей'
    throw new Error(`Польза не приняла код (HTTP ${response.status}): ${detail}`)
  }
  if (typeof body?.key !== 'string' || body.key.length === 0) throw new Error('Польза вернула неожиданный ответ на обмен кода')
  return body.key
}

/** Код и state из вставленного текста: полный URL коллбэка, query-строка или голый код. */
export function parsePastedCallback(pasted: string): { code: string; state: string | null } {
  const text = pasted.trim()
  const fromParams = (params: URLSearchParams) => {
    const error = params.get('error')
    if (error) throw new Error(error === 'access_denied' ? 'Доступ отклонён на странице согласия Пользы' : `Польза вернула ошибку «${error}»`)
    const code = params.get('code')
    if (!code) throw new Error('В адресе нет параметра code')
    return { code, state: params.get('state') }
  }
  if (/^https?:\/\//iu.test(text)) return fromParams(new URL(text).searchParams)
  if (text.includes('code=')) return fromParams(new URLSearchParams(text.replace(/^\?/u, '')))
  if (!/^[A-Za-z0-9._~-]{8,512}$/u.test(text)) throw new Error('Это не похоже на код авторизации Пользы')
  return { code: text, state: null }
}

export interface LoopbackLogin {
  /** Адрес страницы согласия — открыть в браузере. */
  url: string
  /** Ключ после подтверждения в браузере. */
  key: Promise<string>
  close(): void
}

const DONE_HTML = '<!doctype html><meta charset="utf-8"><title>Polza</title>'
  + '<body style="font:16px system-ui;padding:3em">Готово — ключ Пользы сохранён в DeepSeek Harness. Окно можно закрыть.</body>'

/** Поднять коллбэк на 127.0.0.1 и вернуть URL согласия плюс обещание ключа. */
export async function startLoopbackLogin(options: {
  baseUrl: string
  appName: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<LoopbackLogin> {
  const pkce = createPkce()
  let settle!: { resolve: (key: string) => void; reject: (error: unknown) => void }
  const key = new Promise<string>((resolve, reject) => { settle = { resolve, reject } })
  let callbackUrl = ''
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return }
    let parsed: { code: string; state: string | null }
    try {
      parsed = parsePastedCallback(url.toString())
      if (parsed.state !== pkce.state) throw new Error('state не совпал — начните вход заново')
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(String((error as Error).message))
      settle.reject(error)
      return
    }
    exchangeCode(options.baseUrl, { code: parsed.code, verifier: pkce.verifier, callbackUrl }, options.fetchImpl)
      .then((apiKey) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_HTML)
        settle.resolve(apiKey)
      })
      .catch((error: unknown) => {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end(String((error as Error).message))
        settle.reject(error)
      })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  callbackUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
  const timer = setTimeout(() => { settle.reject(new Error('Вход не завершён за 10 минут')) }, LOGIN_TIMEOUT_MS)
  const onAbort = () => { settle.reject(new Error('Вход отменён')) }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const close = () => {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    server.close()
    server.closeAllConnections()
  }
  void key.then(close, close)
  return { url: authorizeUrl(options.baseUrl, pkce, callbackUrl, options.appName), key, close }
}

/** Команда открытия URL. На Windows не `cmd /c start`: cmd режет URL по `&`
 *  и Польза получает только `?response_type=code`. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]]
  return ['xdg-open', [url]]
}

/** Открыть URL в системном браузере; ошибку глотаем — URL всё равно показан. */
export function openInBrowser(url: string): void {
  const [command, args] = browserCommand(url)
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // нет браузера — пользователь откроет ссылку сам
  }
}
