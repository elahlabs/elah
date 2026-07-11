import { describe, it, expect, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Project } from '@elah/core'
import { createServeHandler, Semaphore, type ServeHandlerDeps } from './serve'
import { CliError } from './errors'

const FAKE_PROJECT = {} as Project
const FAKE_BYTES = Buffer.from('fake-mp4-bytes')

function makeDeps(overrides: Partial<ServeHandlerDeps> = {}): ServeHandlerDeps {
  return {
    buildSpec: vi.fn(async () => FAKE_PROJECT),
    renderProject: vi.fn(async () => FAKE_BYTES),
    browserConnected: () => true,
    semaphore: new Semaphore(1),
    maxBodyBytes: 5 * 1024 * 1024,
    log: vi.fn(),
    ...overrides,
  }
}

async function errorBody(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error
}

async function withServer<T>(deps: ServeHandlerDeps, run: (origin: string) => Promise<T>): Promise<T> {
  const server = createServer(createServeHandler(deps))
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const { port } = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((res) => server.close(() => res()))
  }
}

describe('createServeHandler', () => {
  it('GET /healthz reports the browser state', async () => {
    await withServer(makeDeps({ browserConnected: () => true }), async (origin) => {
      const res = await fetch(`${origin}/healthz`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'ok', browser: 'connected' })
    })
    await withServer(makeDeps({ browserConnected: () => false }), async (origin) => {
      const res = await fetch(`${origin}/healthz`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'ok', browser: 'disconnected' })
    })
  })

  it('POST /render returns the rendered MP4 bytes', async () => {
    await withServer(makeDeps(), async (origin) => {
      const res = await fetch(`${origin}/render`, { method: 'POST', body: JSON.stringify({ clips: [] }) })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('video/mp4')
      const body = Buffer.from(await res.arrayBuffer())
      expect(body.equals(FAKE_BYTES)).toBe(true)
    })
  })

  it('400s on malformed JSON', async () => {
    await withServer(makeDeps(), async (origin) => {
      const res = await fetch(`${origin}/render`, { method: 'POST', body: 'not json' })
      expect(res.status).toBe(400)
      expect(await errorBody(res)).toMatch(/not valid JSON/)
    })
  })

  it('422s with the CliError message when the spec fails to build', async () => {
    const deps = makeDeps({
      buildSpec: vi.fn(async () => {
        throw new CliError("Invalid spec: clips[0].track must be one of: video, audio, text, image")
      }),
    })
    await withServer(deps, async (origin) => {
      const res = await fetch(`${origin}/render`, { method: 'POST', body: '{}' })
      expect(res.status).toBe(422)
      expect(await errorBody(res)).toContain('Invalid spec:')
    })
  })

  it('500s when render fails', async () => {
    const deps = makeDeps({
      renderProject: vi.fn(async () => {
        throw new CliError('Browser tab crashed during export')
      }),
    })
    await withServer(deps, async (origin) => {
      const res = await fetch(`${origin}/render`, { method: 'POST', body: '{}' })
      expect(res.status).toBe(500)
      expect(await errorBody(res)).toBe('Browser tab crashed during export')
    })
  })

  it('503s with Retry-After when capacity is exhausted, and releases after failure', async () => {
    let releaseHeld: () => void = () => {}
    const held = new Promise<Buffer>((res) => {
      releaseHeld = () => res(FAKE_BYTES)
    })
    const deps = makeDeps({
      semaphore: new Semaphore(1),
      renderProject: vi.fn(() => held),
    })
    await withServer(deps, async (origin) => {
      const first = fetch(`${origin}/render`, { method: 'POST', body: '{}' })
      // give the first request a tick to acquire the semaphore
      await new Promise((r) => setTimeout(r, 20))

      const second = await fetch(`${origin}/render`, { method: 'POST', body: '{}' })
      expect(second.status).toBe(503)
      expect(second.headers.get('Retry-After')).toBe('5')
      expect(await errorBody(second)).toMatch(/capacity exhausted/)

      releaseHeld()
      const firstRes = await first
      expect(firstRes.status).toBe(200)

      // semaphore released — a third request succeeds
      const third = await fetch(`${origin}/render`, { method: 'POST', body: '{}' })
      expect(third.status).toBe(200)
    })
  })

  it('413s on an oversized body', async () => {
    const deps = makeDeps({ maxBodyBytes: 10 })
    await withServer(deps, async (origin) => {
      const res = await fetch(`${origin}/render`, { method: 'POST', body: 'x'.repeat(1000) })
      expect(res.status).toBe(413)
    })
  })

  it('405s on GET /render', async () => {
    await withServer(makeDeps(), async (origin) => {
      const res = await fetch(`${origin}/render`)
      expect(res.status).toBe(405)
    })
  })

  it('404s on an unknown route', async () => {
    await withServer(makeDeps(), async (origin) => {
      const res = await fetch(`${origin}/nope`)
      expect(res.status).toBe(404)
    })
  })
})

describe('Semaphore', () => {
  it('gates acquisition at max and tracks active count', () => {
    const sem = new Semaphore(2)
    expect(sem.tryAcquire()).toBe(true)
    expect(sem.tryAcquire()).toBe(true)
    expect(sem.active).toBe(2)
    expect(sem.tryAcquire()).toBe(false)
    sem.release()
    expect(sem.active).toBe(1)
    expect(sem.tryAcquire()).toBe(true)
  })
})
