import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobModuleUrl, isCrossOriginModule, siblingWorkerUrl, startCrossOriginModuleWorker } from './workerUrl'

const DIST = 'https://cdn.example.com/npm/@elah/core@1.0.0/dist/export/exportVideo.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isCrossOriginModule', () => {
  it('is false for a module on the page origin', () => {
    expect(isCrossOriginModule('https://app.example.com/_next/static/chunks/a.js', 'https://app.example.com')).toBe(false)
  })

  it('is true for a module on another origin (a CDN)', () => {
    expect(isCrossOriginModule(DIST, 'https://app.example.com')).toBe(true)
    // Same host, different port is another origin too.
    expect(isCrossOriginModule('http://127.0.0.1:4301/dist/index.js', 'http://127.0.0.1:4302')).toBe(true)
  })

  it('is false when there is no location (Node, a test, no page)', () => {
    expect(typeof (globalThis as { location?: unknown }).location).toBe('undefined')
    expect(isCrossOriginModule(DIST)).toBe(false)
    expect(isCrossOriginModule(DIST, undefined)).toBe(false)
  })

  it('reads location.origin by default', () => {
    vi.stubGlobal('location', { origin: 'https://app.example.com', href: 'https://app.example.com/editor' })
    expect(isCrossOriginModule(DIST)).toBe(true)
    expect(isCrossOriginModule('https://app.example.com/assets/index.js')).toBe(false)
  })

  it('is false for bundler file: URLs, blob:, data: and garbage', () => {
    const page = 'https://app.example.com'
    expect(isCrossOriginModule('file:///C:/work/packages/core/src/export/exportVideo.ts', page)).toBe(false)
    expect(isCrossOriginModule('blob:https://other.example.com/1234', page)).toBe(false)
    expect(isCrossOriginModule('data:text/javascript,1', page)).toBe(false)
    expect(isCrossOriginModule('not a url', page)).toBe(false)
  })

  it('treats an opaque page origin ("null", a sandboxed frame) as cross-origin to an http module', () => {
    expect(isCrossOriginModule(DIST, 'null')).toBe(true)
  })
})

describe('siblingWorkerUrl', () => {
  it('resolves the .js worker next to a built module', () => {
    expect(siblingWorkerUrl(DIST, 'ExportWorker')).toBe('https://cdn.example.com/npm/@elah/core@1.0.0/dist/export/ExportWorker.js')
    expect(siblingWorkerUrl('http://127.0.0.1:4301/dist/media/runCapabilityProbe.js', 'capabilityProbe.worker')).toBe(
      'http://127.0.0.1:4301/dist/media/capabilityProbe.worker.js',
    )
  })

  it('keeps .ts when the module is a source file', () => {
    expect(siblingWorkerUrl('http://localhost:5173/src/audio/analyzeInWorker.ts', 'analysisWorker')).toBe(
      'http://localhost:5173/src/audio/analysisWorker.ts',
    )
  })

  it('uses the /+esm build on jsDelivr (a module worker has no import map)', () => {
    expect(siblingWorkerUrl('https://cdn.jsdelivr.net/npm/@elah/core@1.0.0/dist/export/exportVideo.js', 'ExportWorker')).toBe(
      'https://cdn.jsdelivr.net/npm/@elah/core@1.0.0/dist/export/ExportWorker.js/+esm',
    )
    // A /+esm suffix on the module itself is ignored when resolving the sibling.
    expect(siblingWorkerUrl('https://cdn.jsdelivr.net/npm/@elah/core@1.0.0/dist/export/exportVideo.js/+esm', 'ExportWorker')).toBe(
      'https://cdn.jsdelivr.net/npm/@elah/core@1.0.0/dist/export/ExportWorker.js/+esm',
    )
  })
})

describe('blobModuleUrl', () => {
  it('wraps one import line in a text/javascript blob', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob)
      return 'blob:https://app.example.com/wrapper'
    })
    expect(blobModuleUrl('https://cdn.example.com/a "b".js')).toBe('blob:https://app.example.com/wrapper')
    expect(blobs[0].type).toBe('text/javascript')
    expect(await blobs[0].text()).toBe('import "https://cdn.example.com/a \\"b\\".js";\n')
  })
})

describe('startCrossOriginModuleWorker', () => {
  class FakeWorker extends EventTarget {
    static last: FakeWorker | undefined
    constructor(
      public url: string,
      public opts: WorkerOptions,
    ) {
      super()
      FakeWorker.last = this
    }
  }

  function setup() {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://app.example.com/w1')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal('Worker', FakeWorker)
    return revoke
  }

  it('starts a module worker on the blob URL and revokes it after the first message, once', () => {
    const revoke = setup()
    const w = startCrossOriginModuleWorker(DIST) as unknown as FakeWorker
    expect(w.url).toBe('blob:https://app.example.com/w1')
    expect(w.opts).toEqual({ type: 'module' })
    expect(revoke).not.toHaveBeenCalled()
    w.dispatchEvent(new Event('message'))
    w.dispatchEvent(new Event('message'))
    w.dispatchEvent(new Event('error'))
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:https://app.example.com/w1')
  })

  it('revokes on error', () => {
    const revoke = setup()
    const w = startCrossOriginModuleWorker(DIST) as unknown as FakeWorker
    w.dispatchEvent(new Event('error'))
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('revokes and rethrows when the Worker constructor throws', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://app.example.com/w2')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked by CSP')
        }
      },
    )
    expect(() => startCrossOriginModuleWorker(DIST)).toThrow('blocked by CSP')
    expect(revoke).toHaveBeenCalledWith('blob:https://app.example.com/w2')
  })
})

describe('the spawning sites keep the bundler literal', () => {
  it('each site has the literal new Worker(new URL(...)) beside the cross-origin branch', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    const sites: Array<[string, string, number]> = [
      ['../export/exportVideo.ts', 'ExportWorker', 2],
      ['../audio/analyzeInWorker.ts', 'analysisWorker', 1],
      ['../media/runCapabilityProbe.ts', 'capabilityProbe.worker', 1],
    ]
    for (const [file, name, count] of sites) {
      const src = read(file)
      const literal = `new Worker(new URL('./${name}.ts', import.meta.url), { type: 'module' })`
      expect(src.split(literal).length - 1, file).toBe(count)
      expect(src.split(`siblingWorkerUrl(import.meta.url, '${name}')`).length - 1, file).toBe(count)
    }
  })
})
