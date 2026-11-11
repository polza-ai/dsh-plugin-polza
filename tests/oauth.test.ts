import { describe, expect, it } from 'vitest'
import { authorizeUrl, browserCommand, createPkce } from '../src/oauth.ts'

describe('открытие страницы согласия', () => {
  const url = authorizeUrl('https://polza.ai/api', createPkce(), 'http://127.0.0.1:5555/callback', 'DeepSeek Harness')

  it('на Windows не идёт через cmd, который режет URL по &', () => {
    const [command, args] = browserCommand(url, 'win32')
    expect(command).not.toBe('cmd')
    expect(args.at(-1)).toBe(url)
  })

  it('URL несёт все параметры PKCE', () => {
    const params = new URL(url).searchParams
    for (const name of ['response_type', 'callback_url', 'code_challenge', 'code_challenge_method', 'state']) expect(params.get(name)).toBeTruthy()
  })
})
