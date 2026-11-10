// Пресеты списка моделей пикера. Собраны по проду Пользы 2026-11-10: чат-модели за 30 дней,
// по числу организаций, только с поддержкой инструментов (агенту без них нельзя).
export interface ModelPreset {
  id: 'popular' | 'coding' | 'cheap'
  models: readonly string[]
}

export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    id: 'popular',
    models: [
      'anthropic/claude-sonnet-5.5',
      'deepseek/deepseek-v4.1-flash-1017',
      'anthropic/claude-haiku-5.5',
      'openai/gpt-6-luna',
      'anthropic/claude-opus-5.5',
      'z-ai/glm-5.3-flash',
      'google/gemini-3.8-flash',
      'openai/gpt-6.1-sol',
      'deepseek/deepseek-v4-pro',
    ],
  },
  {
    id: 'coding',
    models: [
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-opus-5.5',
      'openai/gpt-6.1-sol',
      'google/gemini-4-argon',
      'deepseek/deepseek-v4-pro',
      'z-ai/glm-5.3',
      'moonshotai/kimi-k3.1-pro',
      'qwen/qwen3-coder-next',
    ],
  },
  {
    id: 'cheap',
    models: [
      'deepseek/deepseek-v4.1-flash-1017',
      'z-ai/glm-5.3-flash',
      'openai/gpt-6-luna',
      'deepseek/deepseek-v4-flash',
      'minimax/minimax-m3.1-flash',
      'qwen/qwen3.8-flash',
      'anthropic/claude-haiku-5.5',
    ],
  },
]

/** Стартовый список нового пользователя — «Популярные». */
export const STARTER_MODELS: readonly string[] = MODEL_PRESETS[0]!.models
