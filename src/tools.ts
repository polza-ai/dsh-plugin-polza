// Инструменты агента: генерация картинок и видео через Media API Пользы.
// Результат сохраняется в рабочую папку сессии (polza-media/), картинка — ещё и
// вложением, чтобы модель её видела, а карточка в чате могла показать.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, download, generateMedia } from './media.ts'

export { IMAGE_TOOL, VIDEO_TOOL } from './tool-names.ts'
import { IMAGE_TOOL, VIDEO_TOOL } from './tool-names.ts'

export interface ToolDeps {
  baseUrl: string
  apiKey: () => Promise<string>
  attachments: () => Context['attachments'] | undefined
  /** Учесть стоимость генерации в расходе сессии. */
  recordCost: (sessionId: string, model: string, rub: number) => void
}

const IMAGE_TYPES: Record<string, ImageMediaType> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

function extFromMime(mime: string, fallback: string): string {
  const sub = mime.split(';')[0]?.split('/')[1]?.toLowerCase() ?? ''
  if (sub === 'jpeg') return 'jpg'
  if (/^(png|jpg|webp|gif|mp4|webm|quicktime)$/u.test(sub)) return sub === 'quicktime' ? 'mov' : sub
  return fallback
}

function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-zа-я0-9]+/giu, '-').replace(/^-+|-+$/gu, '').slice(0, 40)
  return slug.length > 0 ? slug : 'media'
}

async function inputImages(paths: readonly string[] | undefined, cwd: string): Promise<{ type: 'base64'; data: string }[] | undefined> {
  if (paths === undefined || paths.length === 0) return undefined
  return Promise.all(paths.map(async (path) => {
    const full = isAbsolute(path) ? path : resolve(cwd, path)
    const bytes = await readFile(full)
    const ext = full.split('.').pop()?.toLowerCase() ?? 'png'
    return { type: 'base64' as const, data: `data:${IMAGE_TYPES[ext] ?? 'image/png'};base64,${bytes.toString('base64')}` }
  }))
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', required: true },
    files: { type: 'array', required: true, items: { type: 'string' } },
    urls: { type: 'array', required: true, items: { type: 'string' } },
    costRub: { type: 'number' },
    warnings: { type: 'array', items: { type: 'string' } },
    images: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          name: { type: 'string' },
        },
      },
    },
  },
} as const

interface MediaToolValue {
  model: string
  files: string[]
  urls: string[]
  costRub?: number
  warnings?: string[]
  images?: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number; name?: string }[]
}

function render(kind: 'image' | 'video', value: MediaToolValue): ContentBlock[] {
  const lines = [
    `${kind === 'image' ? 'Картинки' : 'Видео'} сгенерированы моделью ${value.model}${value.costRub == null ? '' : ` (≈ ${value.costRub} ₽)`}.`,
    ...value.files.map(file => `Файл: ${file}`),
    ...value.urls.map(url => `Ссылка (7 дней): ${url}`),
    ...(value.warnings ?? []).map(warning => `Предупреждение: ${warning}`),
  ]
  const blocks: ContentBlock[] = [{ type: 'text', text: lines.join('\n') }]
  for (const image of value.images ?? []) blocks.push({ type: 'image', attachment: image as unknown as ImageAttachmentRef })
  return blocks
}

export function registerMediaTools(ctx: Context, deps: ToolDeps): void {
  const outputDir = async (agent: unknown, signal: AbortSignal): Promise<{ cwd: string; dir: string }> => {
    const wd = ctx.get('workingDirectory')
    const cwd = wd !== undefined && agent !== undefined ? await wd.ensure(agent as never, signal) : process.cwd()
    const dir = join(cwd, 'polza-media')
    await mkdir(dir, { recursive: true })
    return { cwd, dir }
  }

  const save = async (kind: 'image' | 'video', prompt: string, model: string, urls: string[], dir: string, signal: AbortSignal) => {
    const stamp = new Date().toISOString().replace(/[-:T]/gu, '').slice(0, 14)
    const files: string[] = []
    const images: NonNullable<MediaToolValue['images']> = []
    for (const [index, url] of urls.entries()) {
      const { bytes, mime } = await download(url, signal)
      const ext = extFromMime(mime, kind === 'image' ? 'png' : 'mp4')
      const file = join(dir, `${stamp}-${slugify(prompt)}${urls.length > 1 ? `-${index + 1}` : ''}.${ext}`)
      await writeFile(file, bytes)
      files.push(file)
      const mediaType = IMAGE_TYPES[ext]
      const attachments = deps.attachments()
      if (kind === 'image' && mediaType !== undefined && attachments !== undefined) {
        try {
          const ref = await attachments.saveImage({ data: bytes, mediaType, name: basename(file) })
          images.push({ attachmentId: String(ref.attachmentId), mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height, ...ref.name ? { name: ref.name } : {} })
        } catch {
          // слишком большая картинка для вложения — файл всё равно сохранён
        }
      }
    }
    return { model, files, urls, images }
  }

  ctx.tools.register(defineTool({
    name: IMAGE_TOOL,
    description: 'Generate or edit images with Polza.ai image models (Gemini Nano Banana, GPT Image, Seedream, FLUX, YandexART…). '
      + 'Saves results into polza-media/ in the working directory and returns the images. Costs money on the user\'s Polza balance.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What to draw, in any language. For edits describe the change.' },
      model: { type: 'string', description: `Polza image model id; default ${DEFAULT_IMAGE_MODEL}.` },
      aspect_ratio: { type: 'string', description: 'e.g. 1:1, 16:9, 9:16, 4:3, 3:2, auto.' },
      resolution: { type: 'string', enum: ['0.5K', '1K', '2K', '4K'], description: 'Output resolution where supported.' },
      count: { type: 'integer', description: 'Number of images (1–4).' },
      input_images: { type: 'array', items: { type: 'string' }, description: 'Paths of reference or source images to edit.' },
    },
    output: { schema: RESULT_SCHEMA, render: (_args, value) => render('image', value as MediaToolValue), presentationMeta: (_args, value) => ({ files: value.files, model: value.model }) },
    timeoutMs: 6 * 60_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { cwd, dir } = await outputDir(exec.agent, exec.signal)
      const model = args.model ?? DEFAULT_IMAGE_MODEL
      const images = await inputImages(args.input_images, cwd)
      const result = await generateMedia(deps.baseUrl, await deps.apiKey(), {
        kind: 'image', model, signal: exec.signal,
        input: {
          prompt: args.prompt,
          ...args.aspect_ratio ? { aspect_ratio: args.aspect_ratio } : {},
          ...args.resolution ? { image_resolution: args.resolution } : {},
          ...args.count ? { max_images: Math.max(1, Math.min(4, args.count)) } : {},
          ...images ? { images } : {},
        },
      })
      if (result.urls.length === 0) throw new Error(`модель ${model} не вернула картинок${result.text ? `: ${result.text}` : ''}`)
      if (result.costRub != null && exec.agent) deps.recordCost(String(exec.agent.id), model, result.costRub)
      const saved = await save('image', args.prompt, model, result.urls, dir, exec.signal)
      return { ...saved, ...result.costRub == null ? {} : { costRub: result.costRub }, ...result.warnings.length ? { warnings: result.warnings } : {} }
    },
  }))

  ctx.tools.register(defineTool({
    name: VIDEO_TOOL,
    description: 'Generate a short video with Polza.ai video models (Seedance, Kling, Veo, Wan, Hailuo, Grok Imagine…), '
      + 'from text or from a start image. Takes minutes. Saves the mp4 into polza-media/. Costs money on the user\'s Polza balance.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Scene and motion description.' },
      model: { type: 'string', description: `Polza video model id; default ${DEFAULT_VIDEO_MODEL}.` },
      duration: { type: 'integer', description: 'Seconds, e.g. 4, 5, 8, 10 (model dependent).' },
      aspect_ratio: { type: 'string', description: 'e.g. 16:9, 9:16, 1:1.' },
      resolution: { type: 'string', description: 'e.g. 480p, 720p, 1080p.' },
      start_image: { type: 'string', description: 'Path of an image to animate (image-to-video).' },
    },
    output: { schema: RESULT_SCHEMA, render: (_args, value) => render('video', value as MediaToolValue), presentationMeta: (_args, value) => ({ files: value.files, model: value.model }) },
    timeoutMs: 25 * 60_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { cwd, dir } = await outputDir(exec.agent, exec.signal)
      const model = args.model ?? DEFAULT_VIDEO_MODEL
      const images = await inputImages(args.start_image ? [args.start_image] : undefined, cwd)
      const result = await generateMedia(deps.baseUrl, await deps.apiKey(), {
        kind: 'video', model, signal: exec.signal,
        input: {
          prompt: args.prompt,
          ...args.duration ? { duration: String(args.duration) } : {},
          ...args.aspect_ratio ? { aspect_ratio: args.aspect_ratio } : {},
          ...args.resolution ? { resolution: args.resolution } : {},
          ...images ? { images } : {},
        },
      })
      if (result.urls.length === 0) throw new Error(`модель ${model} не вернула видео`)
      if (result.costRub != null && exec.agent) deps.recordCost(String(exec.agent.id), model, result.costRub)
      const saved = await save('video', args.prompt, model, result.urls, dir, exec.signal)
      return { ...saved, ...result.costRub == null ? {} : { costRub: result.costRub }, ...result.warnings.length ? { warnings: result.warnings } : {} }
    },
  }))
}
