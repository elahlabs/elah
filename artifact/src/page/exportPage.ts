/**
 * `onExportPage` for the HTML page (PLAN-HTML-FIRST decision H1): render every frame from the HTML itself,
 * encode an MP4 in the browser, hand it to the user. App.tsx's `pageHooks.onExportPage` delegates here.
 *
 * Also installs `window.__elahPageExportDebug`, a probe surface used to measure determinism, speed and
 * preview parity without driving the UI (never called by the app itself).
 */

import { saveFile } from '../download'
import { fontBaseUrl } from '../input'
import { encodePage, makeCanvas, type EncodeStats } from './encode'
import { inlineFonts } from './fontsInline'
import { PageExportUnsupported, createRasterizer } from './raster'
import type { PageExportContext, PagePlayerHandle } from './types'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'elah-video'

type LastExport = { size: number; type: string; route: string; source: 'page'; stats: EncodeStats }

export async function exportPage(ctx: PageExportContext): Promise<void> {
  const { title, player, setStatus, signal } = ctx
  if (!player) throw new Error('The page is not mounted yet.')
  player.pause()
  const resumeAt = player.time()
  setStatus({ text: 'Exporting MP4: starting', progress: 0 })
  try {
    const { blob, stats } = await encodePage(player, {
      signal,
      fontBaseUrl: fontBaseUrl(),
      onPhase: (text) => setStatus({ text, progress: 0 }),
      onProgress: (frame, totalFrames) => {
        if (frame % 3 === 0 || frame === totalFrames) {
          setStatus({ text: `Exporting MP4: frame ${frame} of ${totalFrames}`, progress: totalFrames ? frame / totalFrames : 0 })
        }
      },
    })
    const name = `${slug(title)}.mp4`
    const route = await saveFile(name, blob)
    const mb = (blob.size / 1048576).toFixed(2)
    setStatus({
      text: `Exported ${name} (${mb} MB, rendered from the HTML page, saved by ${route === 'capability' ? 'the artifact downloads capability' : 'a browser download'}).`,
    })
    ;(window as unknown as { __elahLastExport?: LastExport }).__elahLastExport = {
      size: blob.size,
      type: blob.type,
      route,
      source: 'page',
      stats,
    }
  } catch (e) {
    if (e instanceof PageExportUnsupported) {
      setStatus({ text: e.message })
      return
    }
    throw e
  } finally {
    player.seek(resumeAt)
  }
}

// ---------------------------------------------------------------------------
// Probe surface (determinism, speed, parity)
// ---------------------------------------------------------------------------

function fnv1a(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

async function prepare(player: PagePlayerHandle) {
  const fonts = await inlineFonts(player.stageEl, fontBaseUrl())
  const raster = createRasterizer(player, { fontCss: fonts.css })
  const { canvas, ctx } = makeCanvas(raster.width, raster.height)
  return { fonts, raster, canvas, ctx }
}

const debug = {
  /** Raster each `t` twice and compare the read-back bytes. */
  async determinism(times: number[]) {
    const player = (window as unknown as { __elahPage?: PagePlayerHandle }).__elahPage
    if (!player) throw new Error('no __elahPage')
    const { raster, ctx } = await prepare(player)
    const out: Array<{ t: number; identical: boolean; differingBytes: number; hash: string; ms1: number; ms2: number }> = []
    for (const t of times) {
      const a0 = performance.now()
      await raster.rasterFrame(t, ctx, `a${t}`)
      const ms1 = performance.now() - a0
      const a = ctx.getImageData(0, 0, raster.width, raster.height).data
      const hashA = fnv1a(a)
      const keep = new Uint8ClampedArray(a)
      const b0 = performance.now()
      await raster.rasterFrame(t, ctx, `b${t}`) // different URL: a real second render, not the image cache
      const ms2 = performance.now() - b0
      const b = ctx.getImageData(0, 0, raster.width, raster.height).data
      let diff = 0
      for (let i = 0; i < keep.length; i++) if (keep[i] !== b[i]) diff++
      out.push({ t, identical: diff === 0, differingBytes: diff, hash: hashA, ms1, ms2 })
    }
    return out
  },
  /** Average raster ms per frame over `n` frames spread across the video (no encode). */
  async speed(n = 60) {
    const player = (window as unknown as { __elahPage?: PagePlayerHandle }).__elahPage
    if (!player) throw new Error('no __elahPage')
    const { raster, ctx, fonts } = await prepare(player)
    const dur = player.page.durationSeconds
    const t0 = performance.now()
    for (let i = 0; i < n; i++) await raster.rasterFrame((i / n) * dur, ctx)
    const wall = performance.now() - t0
    const tm = raster.timings
    return {
      frames: n,
      wallMsPerFrame: wall / n,
      buildMsPerFrame: tm.buildMs / n,
      decodeMsPerFrame: tm.decodeMs / n,
      drawMsPerFrame: tm.drawMs / n,
      faces: fonts.faces,
      fontBytes: fonts.bytes,
      svgBytes: raster.svgFor(0).length,
    }
  },
  /** The canvas the rasteriser drew frame `t` on (read it back with getImageData). */
  async canvasAt(t: number): Promise<HTMLCanvasElement> {
    const player = (window as unknown as { __elahPage?: PagePlayerHandle }).__elahPage
    if (!player) throw new Error('no __elahPage')
    const { raster, canvas, ctx } = await prepare(player)
    await raster.rasterFrame(t, ctx)
    return canvas
  },
  /** PNG data URL of the rasterised frame at `t`. */
  async frame(t: number): Promise<string> {
    const player = (window as unknown as { __elahPage?: PagePlayerHandle }).__elahPage
    if (!player) throw new Error('no __elahPage')
    const { raster, canvas, ctx } = await prepare(player)
    await raster.rasterFrame(t, ctx)
    return canvas.toDataURL('image/png')
  },
  /** The SVG document string for `t` (inspect the baked markup). */
  async svg(t: number): Promise<string> {
    const player = (window as unknown as { __elahPage?: PagePlayerHandle }).__elahPage
    if (!player) throw new Error('no __elahPage')
    const { raster } = await prepare(player)
    return raster.svgFor(t)
  },
}

;(window as unknown as { __elahPageExportDebug?: typeof debug }).__elahPageExportDebug = debug
