// Баланс в футере сайдбара и карточка на странице Models.
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatRub } from './api.ts'
import type { PolzaStore } from './api.ts'
import { PolzaBadge, PolzaMark } from './brand.tsx'
import { resetLabel } from './locale.ts'
import type { T } from './locale.ts'
import { accountTitle, useStore } from './Section.tsx'

export function BalanceChip({ t, store, wide }: { t: T; store: PolzaStore; wide: boolean }) {
  const { state } = useStore(store)
  const [open, setOpen] = useState(false)
  if (state === null) return null
  const balance = state.account?.balance?.available ?? state.account?.balance?.amount ?? null
  const key = state.account?.key
  const label = state.signedIn ? formatRub(balance) : t('chipSignedOut')
  const low = state.alert !== null || (state.signedIn && balance !== null && balance < state.prefs.lowBalanceRub)
  return (
    <>
      <button type="button" className={`pz-chip${wide ? '' : ' narrow'}${low ? ' low' : ''}`} title={t('chipTitle')} onClick={() => { setOpen(true); void store.refresh(true) }}>
        <PolzaMark size={16} />
        {wide ? <span className="pz-grow">Polza</span> : null}
        {wide ? <b>{label}</b> : null}
      </button>
      <Modal open={open} onClose={() => { setOpen(false) }} title={t('chipTitle')} closeLabel={t('close')}
        footer={<Button variant="primary" onClick={() => { window.open('https://polza.ai/dashboard', '_blank', 'noopener,noreferrer') }}>{t('topUp')}</Button>}>
        <div className="pz-section" style={{ paddingBottom: 0 }}>
          {state.alert ? <div className="pz-error">{state.alert.message}</div> : low ? <div className="pz-warn">{t('lowBalance')}</div> : null}
          <div className="pz-row">
            <PolzaBadge size={36} />
            <div className="pz-grow">
              <div className="pz-title">{state.signedIn ? accountTitle(t, key?.label) : t('signedOutTitle')}</div>
              <div className="pz-muted">{state.signedIn ? `${t('key')} ${state.keyHint}` : t('signedOutText')}</div>
            </div>
          </div>
          {state.signedIn
            ? (
              <div className="pz-stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="pz-stat accent">
                  <span className="pz-muted">{t('available')}</span>
                  <b>{formatRub(balance)}</b>
                  <span className="pz-dim">{t('wallet', { amount: formatRub(state.account?.balance?.amount) })}</span>
                </div>
                <div className="pz-stat">
                  <span className="pz-muted">{t('keyLimit')}</span>
                  <b>{key?.limit ? formatRub(key.remaining) : '∞'}</b>
                  <span className="pz-dim">{key?.limit ? t('limitOf', { limit: formatRub(key.limit), reset: resetLabel(t, key.reset) }) : t('noLimit')}</span>
                </div>
              </div>
            )
            : <Button variant="primary" onClick={() => { void store.login() }}>{t('signIn')}</Button>}
          <div className="pz-dim">{t('openSettings')}</div>
        </div>
      </Modal>
    </>
  )
}

export function ModelsFooterCard({ t, store }: { t: T; store: PolzaStore }) {
  const { state } = useStore(store)
  if (state === null) return null
  return (
    <div className="pz-card" style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
      <PolzaBadge size={32} />
      <div className="pz-grow">
        <div className="pz-title">Polza</div>
        <div className="pz-muted">{state.signedIn ? t('modelsCardSignedIn', { count: state.models.length }) : t('modelsCardSignedOut')}</div>
      </div>
      {state.signedIn ? <b>{formatRub(state.account?.balance?.available ?? state.account?.balance?.amount)}</b> : <Button variant="primary" onClick={() => { void store.login() }}>{t('signIn')}</Button>}
    </div>
  )
}
