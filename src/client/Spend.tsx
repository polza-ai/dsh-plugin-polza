// Расход сессии в ₽ и доля кэша — плашка в ряду под полем ввода (conversation.composer.dock).
import { useEffect, useState } from 'react'
import { formatRub } from './api.ts'
import type { PolzaStore, SpendView } from './api.ts'
import { PolzaMark } from './brand.tsx'
import type { T } from './locale.ts'

const POLL_MS = 3_000

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

function tokens(n: number): string {
  return n.toLocaleString('ru-RU')
}

export function SpendPill({ t, store, sessionId }: { t: T; store: PolzaStore; sessionId?: string }) {
  const [spend, setSpend] = useState<SpendView | null>(null)
  useEffect(() => {
    if (sessionId === undefined) { setSpend(null); return }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try { const next = await store.spend(sessionId); if (alive) setSpend(next) } catch { /* сеть — попробуем позже */ }
      if (alive) timer = setTimeout(() => { void tick() }, document.hidden ? POLL_MS * 5 : POLL_MS)
    }
    void tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [sessionId, store])
  if (spend === null || spend.calls === 0) return null
  const rate = spend.cacheHitRate
  const lowCache = rate !== null && spend.calls > 2 && rate < 0.3
  const models = Object.entries(spend.models ?? {}).sort((a, b) => b[1].rub - a[1].rub)
  const content = (
    <div className="pz-spend-card">
      <div className="pz-spend-grid">
        <span>{t('spendSession')}</span><b>≈ {formatRub(spend.rub)}</b>
        <span>{t('spendLast')}</span><b>{formatRub(spend.lastRub)}</b>
        <span>{t('spendCache')}</span><b>{percent(rate)}</b>
        <span>{t('spendCalls')}</span><b>{spend.calls}</b>
        <span>{t('spendInput')}</span><b>{tokens(spend.tokens.input)}</b>
        <span>{t('spendCacheRW')}</span><b>{tokens(spend.tokens.cacheRead)} / {tokens(spend.tokens.cacheWrite)}</b>
        <span>{t('spendOutput')}</span><b>{tokens(spend.tokens.output)}</b>
      </div>
      {models.length > 0
        ? <div className="pz-spend-models">{models.map(([id, m]) => <div key={id} className="pz-row"><span className="pz-grow pz-ellipsis">{id}</span><span>{m.calls}×</span><b>{formatRub(m.rub)}</b></div>)}</div>
        : null}
      {lowCache ? <div className="pz-warn">{t('spendLowCache')}</div> : null}
      <div className="pz-dim">{t('spendNote')}</div>
    </div>
  )
  return (
    <span className="pz-pop-anchor" tabIndex={0}>
      <span className={`pz-pill${lowCache ? ' warn' : ''}`}>
        <PolzaMark size={13} />
        ≈ {formatRub(spend.rub)}
        <span className="pz-pill-sep">·</span>
        {t('spendCacheShort')} {percent(rate)}
      </span>
      <span className="pz-pop" role="tooltip">{content}</span>
    </span>
  )
}
