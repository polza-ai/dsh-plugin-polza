import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../src/atomic.ts'

describe('writeFileAtomic', () => {
  let dir = ''
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('параллельные сохранения не делят tmp и не оставляют мусор', async () => {
    dir = await mkdtemp(join(tmpdir(), 'pz-atomic-'))
    const file = join(dir, 'nested', 'spend.json')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(file, JSON.stringify({ i }))))
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveProperty('i')
    expect(await readdir(join(dir, 'nested'))).toEqual(['spend.json'])
  })
})
