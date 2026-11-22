import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-plugin-manager'

const PACKAGE = '@polza-ai/dsh-plugin-polza'
const NPM = 'https://registry.npmjs.org/'

export type UpdateStatus = 'idle' | 'checking' | 'current' | 'unsupported' | 'available' | 'local' | 'updated' | 'restart-required' | 'error'
export type UpdateResult = { status: Exclude<UpdateStatus, 'available' | 'local'> } | { status: 'available' | 'local'; version: string }

export async function updatePolza(
  manager: Pick<Context['pluginManager'], 'listBundles' | 'listVersions' | 'updateBundle'>,
  install: boolean,
  enabled: () => boolean,
  signal: AbortSignal,
): Promise<UpdateResult> {
  if (signal.aborted || !enabled()) return { status: 'idle' }
  const installed = (await manager.listBundles()).find(bundle => bundle.name === PACKAGE)
  if (!installed?.enabled) return { status: 'unsupported' }
  if (signal.aborted || !enabled()) return { status: 'idle' }
  if (!installed.updatable) {
    if (install) return { status: 'unsupported' }
    const response = await fetch(new URL(`${encodeURIComponent(PACKAGE)}/latest`, NPM), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    })
    if (!response.ok) return { status: 'error' }
    const entry = await response.json() as { name?: unknown; version?: unknown } | null
    return entry?.name === PACKAGE && typeof entry.version === 'string' && /^\d+\.\d+\.\d+$/u.test(entry.version)
      ? { status: 'local', version: entry.version } : { status: 'error' }
  }
  const versions = await manager.listVersions(PACKAGE, { registry: NPM }, signal)
  if (signal.aborted || !enabled()) return { status: 'idle' }
  if (versions.status === 'refused') return { status: 'error' }
  const next = versions.versions.find(version =>
    version.bundle && !version.prerelease && version.incompatible === undefined && version.deprecated === undefined)
  if (next === undefined) return { status: 'current' }
  if (!install) return { status: 'available', version: next.version }
  // Delegate compatibility, package locking and rollback to the host.
  const { result } = await manager.updateBundle(PACKAGE, next.version, { registry: versions.registry })
  if (result.application === 'applied') return { status: 'updated' }
  if (result.application === 'restart-required') return { status: 'restart-required' }
  return { status: 'error' }
}
