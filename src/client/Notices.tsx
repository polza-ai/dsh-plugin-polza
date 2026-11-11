// Уведомление о деньгах (shell.quota-notice) и карточки генерации в чате (tool.call.toolview).
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PolzaStore } from './api.ts'
import { PolzaBadge } from './brand.tsx'
import type { T } from './locale.ts'

export const DASHBOARD = 'https://polza.ai/dashboard'

export function QuotaNotice({ t, store, message, dismiss }: { t: T; store: PolzaStore; message: string; dismiss: () => void }) {
  const alert = store.getSnapshot().state?.alert
  return (
    <div className="pz-notice" role="alert">
      <PolzaBadge size={28} />
      <div className="pz-grow">
        <div className="pz-title">{alert?.kind === 'key-limit' ? t('noticeLimitTitle') : t('noticeBalanceTitle')}</div>
        <div className="pz-muted">{alert?.message ?? message}</div>
      </div>
      <Button variant="primary" size="sm" onClick={() => { window.open(DASHBOARD, '_blank', 'noopener,noreferrer') }}>{t('topUp')}</Button>
      <Button variant="ghost" size="sm" onClick={() => { void store.refresh(true); dismiss() }}>{t('close')}</Button>
    </div>
  )
}

interface ImageRef { attachmentId: string; mediaType: string; bytes: number; width: number; height: number; name?: string }
interface ToolViewProps {
  t: T
  phase: 'preparing' | 'start' | 'result'
  toolName: string
  block: { args?: unknown; argsRaw?: string; content?: readonly { type: string; text?: string; attachment?: ImageRef }[]; isError?: boolean; meta?: unknown; error?: { reason?: string; code?: string } }
  loadImage: (ref: never) => Promise<string>
  openFile: (path: string) => void
}

function findPrompt(value: unknown, depth = 0): string | undefined {
  if (value === null || typeof value !== 'object' || depth > 3) return undefined
  const record = value as Record<string, unknown>
  if (typeof record['prompt'] === 'string') return record['prompt']
  for (const nested of Object.values(record)) {
    const hit = findPrompt(nested, depth + 1)
    if (hit !== undefined) return hit
  }
  return undefined
}

function promptOf(block: ToolViewProps['block']): string {
  const fromArgs = findPrompt(block.args)
  if (fromArgs !== undefined) return fromArgs
  for (const raw of [block.argsRaw, (block as { call?: { argsRaw?: string } | null }).call?.argsRaw]) {
    if (typeof raw !== 'string') continue
    try { const hit = findPrompt(JSON.parse(raw)); if (hit !== undefined) return hit } catch { /* неполный JSON */ }
  }
  return ''
}

function Thumb({ image, loadImage }: { image: ImageRef; loadImage: ToolViewProps['loadImage'] }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { let alive = true; void loadImage(image as never).then((url) => { if (alive) setSrc(url) }, () => {}); return () => { alive = false } }, [image, loadImage])
  return src === null ? <div className="pz-thumb pz-thumb-empty" /> : <img className="pz-thumb" src={src} alt={image.name ?? ''} />
}

export function MediaToolView({ t, phase, toolName, block, loadImage, openFile }: ToolViewProps) {
  const video = toolName.endsWith('video')
  const prompt = promptOf(block)
  if (phase !== 'result') {
    return (
      <div className="pz-media">
        <div className="pz-media-head">
          <span className="pz-spinner" />
          <div className="pz-grow">
            <div className="pz-title">{video ? t('genVideo') : t('genImage')}</div>
            {prompt ? <div className="pz-muted pz-ellipsis">{prompt}</div> : null}
          </div>
        </div>
      </div>
    )
  }
  if (block.isError) {
    const text = block.content?.find(item => item.type === 'text')?.text ?? block.error?.reason ?? ''
    return <div className="pz-media"><div className="pz-title">{t('genFailed')}</div><div className="pz-error">{text}</div></div>
  }
  const meta = (block.meta ?? {}) as { files?: string[]; model?: string }
  const images = (block.content ?? []).filter(item => item.type === 'image' && item.attachment).map(item => item.attachment as ImageRef)
  return (
    <div className="pz-media">
      {images.length > 0 ? <div className="pz-thumbs">{images.map(image => <Thumb key={image.attachmentId} image={image} loadImage={loadImage} />)}</div> : null}
      <div className="pz-media-head">
        <span className="pz-muted pz-grow pz-ellipsis">{prompt}</span>
        {meta.model ? <span className="pz-dim" style={{ flex: 'none' }}>{meta.model}</span> : null}
      </div>
      <div className="pz-row" style={{ flexWrap: 'wrap' }}>
        {(meta.files ?? []).map(file => (
          <Button key={file} variant="outline" size="sm" onClick={() => { openFile(file) }}>
            {video ? t('openVideo') : t('openFile')} · {file.split(/[\\/]/u).pop()}
          </Button>
        ))}
      </div>
    </div>
  )
}
