import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatRub } from './api.ts'
import type { CatalogRow, PolzaState, PolzaStore } from './api.ts'
import { PolzaBadge } from './brand.tsx'
import { resetLabel } from './locale.ts'
import type { T } from './locale.ts'

const DASHBOARD = 'https://polza.ai/dashboard'

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Польза отдаёт маску ключа как label, если имя ключу не задали. */
export function accountTitle(t: T, label: string | null | undefined): string {
  return label && !label.startsWith('pza_') ? label : t('account')
}

export function useStore(store: PolzaStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

function price(row: CatalogRow): string {
  return row.promptRub === null || row.completionRub === null ? '' : `${formatRub(row.promptRub)} / ${formatRub(row.completionRub)}`
}

function ArrowIcon({ dir }: { dir: 'up' | 'down' }) {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{dir === 'up' ? <path d="M4 10l4-4 4 4" /> : <path d="M4 6l4 4 4-4" />}</svg>
}
function CloseIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
}

function SignedOut({ t, store, state }: { t: T; store: PolzaStore; state: PolzaState | null }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = state?.login.pending === true
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="pz-card">
      <div className="pz-row">
        <PolzaBadge size={40} />
        <div className="pz-grow">
          <div className="pz-title">{t('signedOutTitle')}</div>
          <div className="pz-muted">{t('signedOutText')}</div>
        </div>
      </div>
      {pending
        ? (
          <div className="pz-row">
            <span className="pz-muted pz-grow">{t('waiting')}</span>
            {state?.login.url ? <Button variant="ghost" onClick={() => { openExternal(state.login.url as string) }}>{t('openAgain')}</Button> : null}
            <Button variant="outline" onClick={() => { void run(() => store.cancelLogin()) }}>{t('cancel')}</Button>
          </div>
        )
        : (
          <div className="pz-row">
            <Button variant="primary" disabled={busy} onClick={() => { void run(() => store.login()) }}>{t('signIn')}</Button>
          </div>
        )}
      <div className="pz-row">
        <span className="pz-dim">{t('orKey')}</span>
        <Input className="pz-input" type="password" placeholder={t('keyPlaceholder')} value={key} onChange={(event) => { setKey(event.target.value) }} />
        <Button variant="outline" disabled={busy || key.trim().length === 0} onClick={() => { void run(async () => { await store.saveKey(key); setKey('') }) }}>{t('saveKey')}</Button>
      </div>
      {error ?? state?.login.error ? <div className="pz-error">{error ?? state?.login.error}</div> : null}
    </div>
  )
}

function AccountCard({ t, store, state }: { t: T; store: PolzaStore; state: PolzaState }) {
  const account = state.account
  const key = account?.key
  const limitUsed = key?.limit && key.remaining !== null ? Math.max(0, Math.min(1, 1 - key.remaining / key.limit)) : null
  return (
    <div className="pz-card">
      <div className="pz-row">
        <div className="pz-grow">
          <div className="pz-title pz-ellipsis">{accountTitle(t, key?.label)}</div>
          <div className="pz-muted">{t('key')} {state.keyHint}</div>
        </div>
        <Button variant="outline" onClick={() => { openExternal(DASHBOARD) }}>{t('topUp')}</Button>
        <Button variant="ghost" onClick={() => { void store.refresh(true) }}>{t('refresh')}</Button>
        <Button variant="ghost" onClick={() => { void store.logout() }}>{t('signOut')}</Button>
      </div>
      {account?.revoked ? <div className="pz-error">{t('revoked')}</div> : null}
      <div className="pz-stats">
        <div className="pz-stat accent">
          <span className="pz-muted">{t('available')}</span>
          <b>{formatRub(account?.balance?.available ?? account?.balance?.amount)}</b>
          <span className="pz-dim">{t('wallet', { amount: formatRub(account?.balance?.amount) })}</span>
        </div>
        <div className="pz-stat">
          <span className="pz-muted">{t('keyLimit')}</span>
          <b>{key?.limit ? formatRub(key.remaining) : '∞'}</b>
          <span className="pz-dim">{key?.limit ? t('limitOf', { limit: formatRub(key.limit), reset: resetLabel(t, key.reset) }) : t('noLimit')}</span>
          {limitUsed === null ? null : <div className="pz-meter"><i style={{ width: `${Math.round(limitUsed * 100)}%` }} /></div>}
        </div>
        <div className="pz-stat">
          <span className="pz-muted">{t('spent')}</span>
          <b>{formatRub(key?.usageMonthly ?? 0)}</b>
          <span className="pz-dim">{t('spentToday', { amount: formatRub(key?.usageDaily ?? 0) })}</span>
        </div>
      </div>
      {account?.errors.length ? <div className="pz-error">{account.errors.join(' · ')}</div> : null}
    </div>
  )
}

function ModelsEditor({ t, store, state }: { t: T; store: PolzaStore; state: PolzaState }) {
  const [catalog, setCatalog] = useState<CatalogRow[]>([])
  const [selection, setSelection] = useState<string[]>(state.models)
  const [query, setQuery] = useState('')
  const [vendor, setVendor] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => { store.catalog().then(setCatalog, (e: unknown) => { setStatus(e instanceof Error ? e.message : String(e)) }) }, [store])
  const saved = state.models.join('\n')
  useEffect(() => { setSelection(state.models) }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(catalog.map(row => [row.id, row] as const)), [catalog])
  const vendors = useMemo(() => [...new Set(catalog.map(row => row.vendor))].sort((a, b) => a.localeCompare(b)), [catalog])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter(row => (vendor === '' || row.vendor === vendor)
      && (q === '' || row.id.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)))
  }, [catalog, query, vendor])
  const dirty = selection.join('\n') !== saved
  const move = (index: number, delta: number) => {
    const next = [...selection]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item as string)
    setSelection(next)
  }
  const toggle = (id: string, on: boolean) => {
    setSelection(current => on ? (current.includes(id) ? current : [...current, id]) : current.filter(item => item !== id))
  }
  const save = async () => {
    try { await store.saveModels(selection); setStatus(t('saved')) } catch (e) { setStatus(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <div className="pz-card">
      <div className="pz-row">
        <div className="pz-grow">
          <div className="pz-title">{t('models')}</div>
          <div className="pz-muted">{t('modelsHint')}</div>
        </div>
        {status ? <span className="pz-dim">{status}</span> : null}
        <Button variant="primary" disabled={!dirty} onClick={() => { void save() }}>{dirty ? `${t('save')} (${selection.length})` : t('save')}</Button>
      </div>
      {selection.length === 0
        ? <div className="pz-muted">{t('empty')}</div>
        : (
          <div className="pz-list">
            {selection.map((id, index) => {
              const row = byId.get(id)
              return (
                <div className="pz-item" key={id}>
                  <span className="pz-num">{index + 1}</span>
                  <div className="pz-grow">
                    <div className="pz-row">
                      <span className="pz-title">{row?.name ?? id}</span>
                      {index === 0 ? <Tag tone="success">default</Tag> : null}
                    </div>
                    <div className="pz-dim">{id}{row ? ` · ${price(row)}` : catalog.length > 0 ? ` · ${t('missing')}` : ''}</div>
                  </div>
                  <button type="button" className="pz-icon-btn" aria-label={t('up')} disabled={index === 0} onClick={() => { move(index, -1) }}><ArrowIcon dir="up" /></button>
                  <button type="button" className="pz-icon-btn" aria-label={t('down')} disabled={index === selection.length - 1} onClick={() => { move(index, 1) }}><ArrowIcon dir="down" /></button>
                  <button type="button" className="pz-icon-btn" aria-label={t('remove')} onClick={() => { toggle(id, false) }}><CloseIcon /></button>
                </div>
              )
            })}
          </div>
        )}
      <div className="pz-row">
        <Input className="pz-input" placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
        <select className="pz-select" value={vendor} onChange={(event) => { setVendor(event.target.value) }}>
          <option value="">{t('allVendors')}</option>
          {vendors.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <span className="pz-dim">{t('count', { count: catalog.length })}</span>
      </div>
      <div className="pz-list pz-scroll">
        {filtered.slice(0, 300).map(row => (
          <label className="pz-item" key={row.id} style={{ cursor: 'pointer' }}>
            <input type="checkbox" className="pz-check" checked={selection.includes(row.id)} aria-label={row.name} onChange={(event) => { toggle(row.id, event.target.checked) }} />
            <div className="pz-grow">
              <div className="pz-row">
                <span>{row.vendor}: {row.name}</span>
                {row.reasoning ? <Tag tone="quiet">{t('reasoning')}</Tag> : null}
                {row.image ? <Tag tone="quiet">{t('vision')}</Tag> : null}
              </div>
              <div className="pz-dim">{row.id}{price(row) ? ` · ${price(row)}` : ''}{row.contextLength ? ` · ${Math.round(row.contextLength / 1000)}K` : ''}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

export function PolzaSection({ t, store }: { t: T; store: PolzaStore }) {
  const { state, loading, error } = useStore(store)
  return (
    <div className="pz-section">
      <div className="pz-hero">
        <PolzaBadge size={44} />
        <div>
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
      </div>
      {error ? <div className="pz-error">{error}</div> : null}
      {loading && state === null ? null : state?.signedIn ? <AccountCard t={t} store={store} state={state} /> : <SignedOut t={t} store={store} state={state} />}
      {state ? <ModelsEditor t={t} store={store} state={state} /> : null}
      <div className="pz-dim">{t('footer')}</div>
    </div>
  )
}
