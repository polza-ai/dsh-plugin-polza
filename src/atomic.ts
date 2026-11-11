// Атомарная замена JSON-файлов плагина. Имя временного файла случайное: при одном pid
// параллельные сохранения не должны делить tmp. На Windows rename поверх файла,
// который держит антивирус или индексатор, временно падает с EPERM/EBUSY/EACCES —
// повторяем недолго (как @deepseek-ai/dsh-atomic-write у самого harness).
import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RETRY_MS = 2_000

export async function writeFileAtomic(path: string, content: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tmp, content)
  const deadline = Date.now() + RETRY_MS
  for (let delay = 20; ; delay = Math.min(delay * 2, 250)) {
    try {
      await rename(tmp, path)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (platform !== 'win32' || !TRANSIENT.has(code) || Date.now() + delay > deadline) {
        await rm(tmp, { force: true }).catch(() => {})
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}
