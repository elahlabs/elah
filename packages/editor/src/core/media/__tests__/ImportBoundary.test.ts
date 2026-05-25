import { readFileSync } from 'node:fs'
import { glob } from 'fast-glob'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const PKG_ROOT = resolve(__dirname, '../../../..') // packages/editor
const SRC = resolve(PKG_ROOT, 'src')

describe('architecture boundaries', () => {
  test('core/renderer/** may only import core/media/** via the public barrel or VideoFrameProvider type', async () => {
    const files = await glob('src/core/renderer/**/*.ts', { cwd: PKG_ROOT, absolute: true })
    const violations: string[] = []

    // Allowed shapes (matched against the import path string):
    //   '.../core/media/video'                              ← barrel
    //   '.../core/media/video/index'                        ← explicit barrel
    //   '.../core/media/video/VideoFrameProvider'           ← interface module only
    const ALLOWED = /core\/media\/video(\/index|\/VideoFrameProvider)?$/

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const imports = src.match(/from\s+['"][^'"]+['"]/g) ?? []
      for (const imp of imports) {
        const path = imp.replace(/^from\s+['"]|['"]$/g, '')
        if (path.includes('core/media/') && !ALLOWED.test(path)) {
          violations.push(`${file.replace(SRC, 'src')}: ${imp}`)
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })

  test('core/media/** must not import from core/renderer/** (except shared debug counters during Split-01)', async () => {
    const files = await glob('src/core/media/**/*.ts', { cwd: PKG_ROOT, absolute: true })
    const violations: string[] = []
    // Temporary allowance: moved decode files import GpuDebugCounters until a shared debug module exists.
    const ALLOWED = /core\/renderer\/gpu\/debug\/GpuDebugCounters$/

    for (const file of files) {
      if (file.includes(`${'/__tests__/'}`)) continue
      const src = readFileSync(file, 'utf8')
      const imports = src.match(/from\s+['"][^'"]+['"]/g) ?? []
      for (const imp of imports) {
        const path = imp.replace(/^from\s+['"]|['"]$/g, '')
        if (path.includes('core/renderer/') && !ALLOWED.test(path)) {
          violations.push(`${file.replace(SRC, 'src')}: ${imp}`)
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })

  test('core/assets/** must not import from core/renderer/** or core/media/**', async () => {
    const files = await glob('src/core/assets/**/*.ts', { cwd: PKG_ROOT, absolute: true })
    const violations: string[] = []

    for (const file of files) {
      if (file.includes(`${'/__tests__/'}`) || file.endsWith('.test.ts')) continue
      const src = readFileSync(file, 'utf8')
      const imports = src.match(/from\s+['"][^'"]+['"]/g) ?? []
      for (const imp of imports) {
        const path = imp.replace(/^from\s+['"]|['"]$/g, '')
        if (path.includes('core/renderer/') || path.includes('core/media/')) {
          violations.push(`${file.replace(SRC, 'src')}: ${imp}`)
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })
})
