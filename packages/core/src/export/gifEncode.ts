/**
 * In-repo animated GIF encoder (REN-5). No dependency: a median-cut palette
 * quantiser plus GIF-flavoured variable-width LZW, one local palette per
 * frame so a scene change does not inherit the previous frame's colours.
 *
 * Pure and synchronous (Uint8Array in, Uint8Array out), so it runs in the
 * export worker and in Node tests alike. Memory stays at the compressed size
 * of the frames added so far: each frame is quantised and compressed as it
 * arrives, nothing keeps the raw RGBA.
 *
 * Opaque frames only. GIF's 1-bit transparency is deliberately not offered
 * (`resolveExportFormat` rejects `transparent` with the gif container).
 */

/** GIF caps (REN-5). Explicit options override the defaults, never the hard limit. */
export const GIF_DEFAULT_MAX_FPS = 15
export const GIF_DEFAULT_MAX_SHORT_EDGE = 480
/** Refuse absurd GIF frame counts up front (a GIF this long is the wrong format). */
export const GIF_MAX_FRAMES = 3000

const BITS = 5
const BINS = 1 << (BITS * 3)

interface Box {
  /** Range into the non-empty-bin list. */
  start: number
  end: number
  count: number
}

/**
 * Median-cut quantiser over a 15-bit (5 bits per channel) histogram. Returns
 * a 256-entry RGB palette (unused entries zero) and one palette index per
 * pixel. Alpha is ignored.
 */
export function quantizeRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
  maxColors = 256,
): { palette: Uint8Array; indices: Uint8Array } {
  const counts = new Uint32Array(BINS)
  const sumR = new Float64Array(BINS)
  const sumG = new Float64Array(BINS)
  const sumB = new Float64Array(BINS)
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    counts[bin]++
    sumR[bin] += r
    sumG[bin] += g
    sumB[bin] += b
  }

  const bins: number[] = []
  for (let b = 0; b < BINS; b++) if (counts[b] > 0) bins.push(b)

  const channel = (bin: number, c: 0 | 1 | 2) => (c === 0 ? bin >> 10 : c === 1 ? (bin >> 5) & 31 : bin & 31)

  const boxes: Box[] = [{ start: 0, end: bins.length, count: pixelCount }]
  while (boxes.length < maxColors) {
    // Split the most populous box that still has more than one distinct colour.
    let pick = -1
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i]
      if (bx.end - bx.start < 2) continue
      if (pick < 0 || bx.count > boxes[pick].count) pick = i
    }
    if (pick < 0) break
    const bx = boxes[pick]
    const min = [31, 31, 31]
    const max = [0, 0, 0]
    for (let i = bx.start; i < bx.end; i++) {
      for (const c of [0, 1, 2] as const) {
        const v = channel(bins[i], c)
        if (v < min[c]) min[c] = v
        if (v > max[c]) max[c] = v
      }
    }
    const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    const axis = (ranges[0] >= ranges[1] && ranges[0] >= ranges[2] ? 0 : ranges[1] >= ranges[2] ? 1 : 2) as 0 | 1 | 2
    const slice = bins.slice(bx.start, bx.end).sort((a, b) => channel(a, axis) - channel(b, axis))
    for (let i = 0; i < slice.length; i++) bins[bx.start + i] = slice[i]
    // Weighted median, always leaving at least one bin on each side.
    let acc = 0
    let cut = bx.start + 1
    for (let i = bx.start; i < bx.end - 1; i++) {
      acc += counts[bins[i]]
      cut = i + 1
      if (acc * 2 >= bx.count) break
    }
    let leftCount = 0
    for (let i = bx.start; i < cut; i++) leftCount += counts[bins[i]]
    boxes.splice(pick, 1, { start: bx.start, end: cut, count: leftCount }, { start: cut, end: bx.end, count: bx.count - leftCount })
  }

  const palette = new Uint8Array(256 * 3)
  const lookup = new Uint8Array(BINS)
  boxes.forEach((bx, index) => {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = bx.start; i < bx.end; i++) {
      const bin = bins[i]
      r += sumR[bin]
      g += sumG[bin]
      b += sumB[bin]
      n += counts[bin]
      lookup[bin] = index
    }
    palette[index * 3] = n ? Math.round(r / n) : 0
    palette[index * 3 + 1] = n ? Math.round(g / n) : 0
    palette[index * 3 + 2] = n ? Math.round(b / n) : 0
  })

  const indices = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const bin = ((rgba[i * 4] >> 3) << 10) | ((rgba[i * 4 + 1] >> 3) << 5) | (rgba[i * 4 + 2] >> 3)
    indices[i] = lookup[bin]
  }
  return { palette, indices }
}

/** GIF LZW, minimum code size 8 (256-colour frames). Returns the raw code stream (not yet sub-blocked). */
export function lzwEncode(indices: Uint8Array): Uint8Array {
  const CLEAR = 256
  const EOI = 257
  const out: number[] = []
  let bitBuf = 0
  let bitCount = 0
  let codeSize = 9
  const emit = (code: number) => {
    bitBuf |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      out.push(bitBuf & 0xff)
      bitBuf >>>= 8
      bitCount -= 8
    }
  }

  // Dictionary: (prefix << 8 | byte) -> (generation << 12 | code). A clear
  // bumps the generation instead of refilling the table.
  const table = new Int32Array(4096 * 256)
  let gen = 1
  let next = 258
  const reset = () => {
    gen++
    if (gen >= 1 << 19) {
      table.fill(0)
      gen = 1
    }
    next = 258
    codeSize = 9
  }

  emit(CLEAR)
  if (indices.length > 0) {
    let prefix = indices[0]
    for (let i = 1; i < indices.length; i++) {
      const byte = indices[i]
      const key = (prefix << 8) | byte
      const entry = table[key]
      if (entry >>> 12 === gen) {
        prefix = entry & 0xfff
        continue
      }
      emit(prefix)
      if (next < 4096) {
        if (next === 1 << codeSize) codeSize++
        table[key] = (gen << 12) | next
        next++
      } else {
        emit(CLEAR)
        reset()
      }
      prefix = byte
    }
    emit(prefix)
    // The decoder adds one more entry after this last code; keep widths in step.
    if (next === 1 << codeSize && codeSize < 12) codeSize++
  }
  emit(EOI)
  if (bitCount > 0) out.push(bitBuf & 0xff)
  return Uint8Array.from(out)
}

export class GifEncoder {
  private readonly chunks: Uint8Array[] = []
  private frames = 0
  private finished = false

  constructor(
    readonly width: number,
    readonly height: number,
    /** 0 = loop forever. */
    loopCount = 0,
  ) {
    if (width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
      throw new RangeError(`GifEncoder: invalid size ${width}x${height}`)
    }
    const head = new Uint8Array(13 + 19)
    head.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a
    head[6] = width & 0xff
    head[7] = width >> 8
    head[8] = height & 0xff
    head[9] = height >> 8
    // bytes 10..12: no global colour table, background 0, aspect 0.
    // NETSCAPE2.0 looping extension.
    head.set(
      [0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, loopCount & 0xff, loopCount >> 8, 0x00],
      13,
    )
    this.chunks.push(head)
  }

  get frameCount(): number {
    return this.frames
  }

  /** Add one RGBA frame (width*height*4 bytes) shown for `delayCs` centiseconds (minimum 2, as browsers enforce). */
  addFrame(rgba: Uint8ClampedArray | Uint8Array, delayCs: number): void {
    if (this.finished) throw new Error('GifEncoder: already finished')
    const pixels = this.width * this.height
    if (rgba.length < pixels * 4) throw new RangeError('GifEncoder: frame is smaller than width*height*4')
    const { palette, indices } = quantizeRgba(rgba, pixels)
    const delay = Math.max(2, Math.min(0xffff, Math.round(delayCs)))
    const gce = Uint8Array.from([0x21, 0xf9, 0x04, 0x04, delay & 0xff, delay >> 8, 0x00, 0x00])
    const desc = Uint8Array.from([0x2c, 0, 0, 0, 0, this.width & 0xff, this.width >> 8, this.height & 0xff, this.height >> 8, 0x87])
    const lzw = lzwEncode(indices)
    const blocks = Math.ceil(lzw.length / 255)
    const data = new Uint8Array(1 + lzw.length + blocks + 1)
    data[0] = 8 // minimum code size
    let o = 1
    for (let i = 0; i < lzw.length; i += 255) {
      const n = Math.min(255, lzw.length - i)
      data[o++] = n
      data.set(lzw.subarray(i, i + n), o)
      o += n
    }
    data[o] = 0
    this.chunks.push(gce, desc, palette, data)
    this.frames++
  }

  finish(): Uint8Array {
    if (!this.finished) {
      this.chunks.push(Uint8Array.of(0x3b))
      this.finished = true
    }
    let size = 0
    for (const c of this.chunks) size += c.length
    const out = new Uint8Array(size)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }
}

/**
 * Which project frames a GIF keeps, and how long each is shown. The project
 * renders at `fps`; the GIF keeps every `step`-th frame so it never exceeds
 * `gifFps`. Delays come from cumulative centisecond rounding so the total
 * duration does not drift (GIF delays are whole centiseconds).
 */
export function planGifFrames(
  totalFrames: number,
  fps: number,
  gifFps: number | undefined,
): { step: number; delays: number[] } {
  const target = Math.min(fps, gifFps && gifFps > 0 ? gifFps : GIF_DEFAULT_MAX_FPS)
  const step = Math.max(1, Math.round(fps / target))
  const kept = Math.ceil(totalFrames / step)
  const delays: number[] = []
  for (let i = 0; i < kept; i++) {
    const startFrame = i * step
    const endFrame = Math.min(totalFrames, startFrame + step)
    delays.push(Math.round((endFrame * 100) / fps) - Math.round((startFrame * 100) / fps))
  }
  return { step, delays }
}

/** The short-edge target for GIF: an explicit outputHeight wins, else the stage capped at 480. */
export function gifOutputHeight(stageWidth: number, stageHeight: number, outputHeight: number | undefined): number {
  if (outputHeight !== undefined) return outputHeight
  return Math.min(GIF_DEFAULT_MAX_SHORT_EDGE, Math.min(stageWidth, stageHeight))
}
