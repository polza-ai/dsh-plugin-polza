// Знак Пользы (тот же, что в bb-plugin-polza) и стили плагина.
import { MARK_PATHS as PATHS } from './mark-paths.ts'

export const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="black">${PATHS.map(d => `<path d="${d}"/>`).join('')}</svg>`

export function PolzaMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="currentColor" aria-hidden="true" className={className}>
      {PATHS.map(d => <path key={d} d={d} />)}
    </svg>
  )
}

/** Лаймовый знак на тёмной плашке — как иконка плагина. */
export function PolzaBadge({ size = 32 }: { size?: number }) {
  return (
    <span className="pz-badge" style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}>
      <PolzaMark size={Math.round(size * 0.6)} />
    </span>
  )
}

export const BRAND_LIME = '#B2F72A'
export const BRAND_DARK = '#0C0E12'

export const CSS = `
.pz-badge{display:inline-flex;align-items:center;justify-content:center;flex:none;background:${BRAND_DARK};color:${BRAND_LIME}}
.pz-section{display:flex;flex-direction:column;gap:20px;padding-bottom:24px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.pz-hero{display:flex;gap:14px;align-items:center}
.pz-hero h2{margin:0;font:var(--dsw-font-l-20)}
.pz-hero p{margin:2px 0 0;color:var(--dsw-alias-label-secondary)}
.pz-card{background:var(--dsw-alias-settings-card-fill);border:1px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-md);padding:16px;display:flex;flex-direction:column;gap:14px}
.pz-row{display:flex;align-items:center;gap:10px}
.pz-grow{flex:1;min-width:0}
.pz-title{font:var(--dsw-font-s-strong-14)}
.pz-muted{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13)}
.pz-dim{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.pz-error{color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xs-13)}
.pz-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.pz-stat{border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);padding:10px 12px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-layer-1)}
.pz-stat b{font:var(--dsw-font-l-20)}
.pz-stat.accent{border-color:color-mix(in srgb, ${BRAND_LIME} 70%, transparent);background:color-mix(in srgb, ${BRAND_LIME} 10%, var(--dsw-alias-bg-layer-1))}
.pz-meter{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden;margin-top:6px}
.pz-meter>i{display:block;height:100%;background:#6FA30C}
.pz-list{border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);overflow:hidden}
.pz-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l2)}
.pz-item:first-child{border-top:0}
.pz-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pz-num{width:20px;text-align:center;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13)}
.pz-scroll{max-height:420px;overflow:auto}
.pz-icon-btn{all:unset;cursor:pointer;width:26px;height:26px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.pz-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pz-icon-btn:disabled{opacity:.35;cursor:default;background:none}
.pz-select{height:36px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:inherit;padding:0 8px;font:inherit}
.pz-chip{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);box-sizing:border-box;width:100%}
.pz-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pz-chip b{color:var(--dsw-alias-label-primary);font-weight:500}
.pz-chip.narrow{width:auto;justify-content:center}
.pz-input{flex:1}
.pz-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pz-check{width:16px;height:16px;flex:none;margin:0;accent-color:#6FA30C;cursor:pointer}
[data-provider-id="polza"][data-pz-icon]{display:inline-flex;align-items:center;gap:6px}
`

/** Вставить стили так же, как это делают собранные бандлы harness (их снимут при выгрузке плагина). */
export function injectCss(id: string): () => void {
  const tagId = `${id}/polza.css`
  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`)
  if (existing !== null) return () => { existing.remove() }
  const tag = document.createElement('style')
  tag.dataset['plugin'] = id
  tag.dataset['pluginCss'] = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

/** Иконки провайдеров у моделей Polza в пикере: маска из моно-SVG, цвет — текущий цвет текста. */
export function pickerIconsCss(icons: Record<string, string>): string {
  return Object.entries(icons).map(([model, svg]) => {
    const uri = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    const sel = `[data-provider-id="polza"][data-model-id=${JSON.stringify(model)}]`
    return `${sel}{display:inline-flex;align-items:center;gap:6px}`
      + `${sel}::before{content:"";flex:none;width:14px;height:14px;background:currentColor;-webkit-mask:${uri} center/contain no-repeat;mask:${uri} center/contain no-repeat}`
  }).join('\n')
}
