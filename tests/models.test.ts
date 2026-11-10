import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePolzaCatalog } from '../src/contract.ts'
import { polzaCompat, thinkingLevelMap, toPiModel } from '../src/models.ts'

const catalog = parsePolzaCatalog(JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url), 'utf8')))
const byId = (id: string) => {
  const model = catalog.find(entry => entry.id === id)
  if (model === undefined) throw new Error(`fixture has no ${id}`)
  return model
}

describe('catalog → pi-ai model', () => {
  it('reads reasoning without an explicit effort list as low/medium/high', () => {
    const model = toPiModel(byId('anthropic/claude-sonnet-5.5'), 'polza', 'https://polza.ai/api/v1')
    expect(model.reasoning).toBe(true)
    expect(model.thinkingLevelMap).toEqual({ off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null })
    expect(model.input).toEqual(['text', 'image'])
    expect(model.contextWindow).toBe(1_000_000)
    expect(model.compat).toMatchObject({ thinkingFormat: 'openrouter', maxTokensField: 'max_tokens', cacheControlFormat: 'anthropic' })
  })

  it('keeps xhigh/max when the catalog lists them and refuses off on mandatory reasoning', () => {
    const map = thinkingLevelMap(byId('anthropic/claude-fable-5.2'))
    expect(map).toMatchObject({ off: null, xhigh: 'xhigh', max: 'max' })
  })

  it('allows off only when the catalog lists none', () => {
    expect(thinkingLevelMap(byId('openai/gpt-6.1-terra'))?.off).toBe('none')
  })

  it('marks a model without reasoning parameters as non-reasoning', () => {
    const model = toPiModel(byId('qwen/qwen3-coder-next'), 'polza', 'https://polza.ai/api/v1')
    expect(model.reasoning).toBe(false)
    expect(model.thinkingLevelMap).toBeUndefined()
    expect(model.input).toEqual(['text'])
  })

  it('sends cache_control only to Anthropic models', () => {
    expect(polzaCompat('openai/gpt-5.4')).not.toHaveProperty('cacheControlFormat')
  })
})
