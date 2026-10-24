import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportCapabilityError } from '../exportErrors'
import { clearWebmAlphaExportCache, ensureTransparencyGate, webmAlphaExportSupported } from '../capabilities'
import type { WebmAlphaSupport } from '../../media/capabilities'

const realProbe = vi.fn()
vi.mock('../../media/capabilities', () => ({ probeWebmAlpha: () => realProbe() }))

function support(over: Partial<WebmAlphaSupport>): WebmAlphaSupport {
  return {
    videoEncoder: true,
    rawAlphaKeep: true,
    mediabunnyAlphaKeep: true,
    roundTrip: 'alpha',
    canBeTransparent: true,
    ...over,
  }
}

describe('the WebM transparency gate — verified, not assumed (PV-P9a-1)', () => {
  afterEach(() => clearWebmAlphaExportCache())

  it('a config that claims support but decodes opaque (255) is rejected', async () => {
    const probe = vi.fn().mockResolvedValue(support({ roundTrip: 'opaque' }))
    const result = await webmAlphaExportSupported({ probe })
    expect(result.supported).toBe(false)
    expect(result.support.rawAlphaKeep).toBe(true)
    expect(result.support.mediabunnyAlphaKeep).toBe(true)
  })

  it('a missing API (no VideoEncoder/OffscreenCanvas) is rejected', async () => {
    const probe = vi.fn().mockResolvedValue(
      support({ videoEncoder: false, rawAlphaKeep: false, mediabunnyAlphaKeep: false, roundTrip: 'skipped', canBeTransparent: null }),
    )
    const result = await webmAlphaExportSupported({ probe })
    expect(result.supported).toBe(false)
  })

  it('a real round trip that decodes alpha is accepted', async () => {
    const probe = vi.fn().mockResolvedValue(support({ roundTrip: 'alpha' }))
    const result = await webmAlphaExportSupported({ probe })
    expect(result.supported).toBe(true)
  })

  it('a failed round trip is rejected', async () => {
    const probe = vi.fn().mockResolvedValue(support({ roundTrip: 'failed', detail: 'boom' }))
    const result = await webmAlphaExportSupported({ probe })
    expect(result.supported).toBe(false)
  })

  it('ensureTransparencyGate never probes an opaque export', async () => {
    const probe = vi.fn().mockResolvedValue(support({ roundTrip: 'alpha' }))
    await ensureTransparencyGate({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', mimeType: 'video/mp4' }, false, { probe })
    await ensureTransparencyGate({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', mimeType: 'video/webm' }, undefined, { probe })
    expect(probe).not.toHaveBeenCalled()
  })

  it('ensureTransparencyGate never probes MP4 (resolveExportFormat already rejects it)', async () => {
    const probe = vi.fn().mockResolvedValue(support({ roundTrip: 'alpha' }))
    await ensureTransparencyGate({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', mimeType: 'video/mp4' }, true, { probe })
    expect(probe).not.toHaveBeenCalled()
  })

  it('ensureTransparencyGate throws for a transparent WebM this runtime cannot decode back', async () => {
    const probe = vi.fn().mockResolvedValue(support({ roundTrip: 'opaque' }))
    await expect(
      ensureTransparencyGate({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', mimeType: 'video/webm' }, true, { probe }),
    ).rejects.toThrow(ExportCapabilityError)
  })

  it('ensureTransparencyGate resolves for a transparent WebM this runtime verifies', async () => {
    const probe = vi.fn().mockResolvedValue(support({ roundTrip: 'alpha' }))
    await expect(
      ensureTransparencyGate({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', mimeType: 'video/webm' }, true, { probe }),
    ).resolves.toBeUndefined()
  })

  it('caches the real-runtime probe per cache key, but never caches an injected test probe', async () => {
    const probe = vi.fn().mockResolvedValue(support({ roundTrip: 'alpha' }))
    await webmAlphaExportSupported({ probe }, 'vp9')
    await webmAlphaExportSupported({ probe }, 'vp9')
    expect(probe).toHaveBeenCalledTimes(2) // injected probes always run fresh
  })

  it('the DEFAULT (real) probe is cached per cache key — one call covers repeat exports', async () => {
    realProbe.mockReset().mockResolvedValue(support({ roundTrip: 'alpha' }))
    const a = await webmAlphaExportSupported(undefined, 'vp9')
    const b = await webmAlphaExportSupported(undefined, 'vp9')
    expect(realProbe).toHaveBeenCalledTimes(1)
    expect(a.supported).toBe(true)
    expect(b.supported).toBe(true)
  })

  it('a different cache key re-probes even on the default path', async () => {
    realProbe.mockReset().mockResolvedValue(support({ roundTrip: 'alpha' }))
    await webmAlphaExportSupported(undefined, 'vp9')
    await webmAlphaExportSupported(undefined, 'vp8')
    expect(realProbe).toHaveBeenCalledTimes(2)
  })
})
