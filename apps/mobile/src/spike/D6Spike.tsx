import { useEffect, useRef, useState } from 'react'
import { Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { Canvas, Image as SkiaImage, Skia, type SkImage } from 'react-native-skia'
import { GPUTextureUsage, createVideoFrameFromNativeBuffer, importDevice } from 'react-native-webgpu'
import { createFrameSpike } from 'elah-media-nitro'

/**
 * RN-P6 / D6 spike (docs/react-native/05-decisions.md, D6).
 *
 * The deciding requirement is invariant I4: `getCurrent(sourceFrame)` is a
 * synchronous call, on every render tick, that returns a frame handle or null
 * and keeps the pixels off the JS heap. D6 chose Nitro (Expo Modules was
 * measured against it and removed; numbers in 05-decisions.md). The Nitro
 * spike hands out a pool of GPU-shareable test frames:
 *
 *   getFrame(i) -> pointer (CVPixelBufferRef / AHardwareBuffer*)
 *     -> react-native-webgpu createVideoFrameFromNativeBuffer
 *     -> queue.copyExternalImageToTexture, a GPU copy into a texture on Skia's device
 *     -> Skia.Image.MakeImageFromGPUTexture (made once per texture)
 *
 * This screen measures each step and plays the pool at 30 fps. The
 * frame index is stamped on each frame as 9 bars (white = 1, MSB left).
 */

const POOL = { count: 8, width: 1280, height: 720 }
const CALLS = 10_000
const HANDOFFS = 300
const ROUNDS = 3
const TEXTURE_RING = 3
const PLAY_MS = 5_000
const FPS = 30

type SourceName = 'Nitro'

interface FrameSource {
  readonly name: SourceName
  noop(): number
  /** The raw native return value (a bigint, or undefined on a miss). */
  getFrameRaw(index: number): unknown
  /** What a NativeFrameProvider needs: the pointer as a BigInt, or null. */
  getFrame(index: number): bigint | null
  createPool(count: number, width: number, height: number): void
  destroyPool(): void
}

function makeSources(): FrameSource[] {
  const nitro = createFrameSpike()
  return [
    {
      name: 'Nitro',
      noop: () => nitro.noop(),
      getFrameRaw: (i) => nitro.getFrame(i),
      getFrame: (i) => nitro.getFrame(i) ?? null,
      createPool: (c, w, h) => nitro.createPool(c, w, h),
      destroyPool: () => nitro.destroyPool(),
    },
  ]
}

/** Copies native frames into a small ring of textures on Skia's own GPU device. */
class GpuHandOff {
  private readonly device: GPUDevice
  private readonly textures: GPUTexture[] = []
  private readonly images: SkImage[] = []

  constructor(private readonly width: number, private readonly height: number) {
    this.device = importDevice(Skia.getNativeDevice())
    for (let i = 0; i < TEXTURE_RING; i++) {
      const texture = this.device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      this.textures.push(texture)
      this.images.push(Skia.Image.MakeImageFromGPUTexture(texture))
    }
  }

  /** Wraps the pointer, copies it on the GPU into texture `slot`, and returns that slot's SkImage. */
  present(pointer: bigint, slot: number): SkImage {
    const frame = createVideoFrameFromNativeBuffer(pointer)
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: frame },
        { texture: this.textures[slot]! },
        [this.width, this.height],
      )
    } finally {
      frame.release() // react-native-webgpu took its own reference for the copy
    }
    return this.images[slot]!
  }

  /**
   * Resolves true when the GPU has finished the submitted copies, false after `timeoutMs`.
   * On a device imported from Skia the promise may never settle, if nothing processes
   * Dawn's callbacks; the benchmark reports that instead of hanging.
   */
  async gpuIdle(timeoutMs = 2_000): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    try {
      return await Promise.race([this.device.queue.onSubmittedWorkDone().then(() => true), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  dispose() {
    for (const image of this.images) image.dispose()
    for (const texture of this.textures) texture.destroy()
  }
}

declare const HermesInternal: { getInstrumentedStats?: () => Record<string, number> } | undefined

function allocatedBytes(): number | null {
  const stats = typeof HermesInternal === 'undefined' ? undefined : HermesInternal?.getInstrumentedStats?.()
  return stats?.js_allocatedBytes ?? null
}

interface Timing {
  us: number
  bytes: number | null
}

let sink: unknown

function time(n: number, fn: (i: number) => unknown): Timing {
  for (let i = 0; i < 200; i++) sink = fn(i) // warm up
  const before = allocatedBytes()
  const t0 = performance.now()
  for (let i = 0; i < n; i++) sink = fn(i)
  const t1 = performance.now()
  const after = allocatedBytes()
  return { us: ((t1 - t0) * 1000) / n, bytes: before === null || after === null ? null : (after - before) / n }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function medianTiming(runs: Timing[]): Timing {
  const bytes = runs.map((r) => r.bytes)
  return {
    us: median(runs.map((r) => r.us)),
    bytes: bytes.some((b) => b === null) ? null : median(bytes as number[]),
  }
}

const fmt = (t: Timing) => `${t.us.toFixed(2)} µs${t.bytes === null ? '' : ` · ${Math.round(t.bytes)} B`}`

export default function D6Spike({ onClose }: { onClose: () => void }) {
  const image = useSharedValue<SkImage | null>(null)
  const sources = useRef<FrameSource[] | null>(null)
  const handOff = useRef<GpuHandOff | null>(null)
  const playing = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<{ source: SourceName; index: number } | null>(null)
  // The refs hold the native objects; this state re-renders once they exist so the buttons appear.
  const [ready, setReady] = useState<FrameSource[]>([])

  useEffect(() => {
    try {
      const all = makeSources()
      for (const source of all) source.createPool(POOL.count, POOL.width, POOL.height)
      sources.current = all
      handOff.current = new GpuHandOff(POOL.width, POOL.height)
      setReady(all)
    } catch (e) {
      setError(describe(e))
    }
    return () => {
      if (playing.current !== null) cancelAnimationFrame(playing.current)
      image.value = null
      handOff.current?.dispose()
      for (const source of sources.current ?? []) source.destroyPool()
    }
  }, [image])

  const show = (source: FrameSource, index: number) => {
    try {
      const pointer = source.getFrame(index)
      if (pointer === null) throw new Error(`${source.name}: getFrame(${index}) returned null`)
      image.value = handOff.current!.present(pointer, index % TEXTURE_RING)
      setShown({ source: source.name, index })
    } catch (e) {
      setError(describe(e))
    }
  }

  const runBenchmarks = async () => {
    if (!sources.current || !handOff.current) return
    setBusy(true)
    setError(null)
    // Let the "Running…" state paint before the JS thread is busy.
    await new Promise((resolve) => setTimeout(resolve, 50))
    try {
      const gpu = handOff.current
      const lines = [
        `D6 spike · ${POOL.width}x${POOL.height} · median of ${ROUNDS} rounds`,
        `calls: ${CALLS} per round · hand-offs: ${HANDOFFS} per round`,
        `B = JS bytes allocated per call (Hermes)`,
        '',
      ]
      for (const source of sources.current) {
        const noop: Timing[] = []
        const raw: Timing[] = []
        const big: Timing[] = []
        const hand: Timing[] = []
        const withGpu: number[] = []
        for (let round = 0; round < ROUNDS; round++) {
          noop.push(time(CALLS, () => source.noop()))
          raw.push(time(CALLS, (i) => source.getFrameRaw(i % POOL.count)))
          big.push(time(CALLS, (i) => source.getFrame(i % POOL.count)))
          hand.push(time(HANDOFFS, (i) => gpu.present(source.getFrame(i % POOL.count)!, i % TEXTURE_RING)))
          const t0 = performance.now()
          for (let i = 0; i < HANDOFFS; i++) gpu.present(source.getFrame(i % POOL.count)!, i % TEXTURE_RING)
          if (await gpu.gpuIdle()) withGpu.push(((performance.now() - t0) * 1000) / HANDOFFS)
        }
        lines.push(
          `${source.name}`,
          `  noop()                ${fmt(medianTiming(noop))}`,
          `  getFrame() raw        ${fmt(medianTiming(raw))}`,
          `  getFrame() as BigInt  ${fmt(medianTiming(big))}`,
          `  + wrap + GPU copy     ${fmt(medianTiming(hand))}  (JS thread)`,
          withGpu.length > 0
            ? `  ... incl. GPU done    ${median(withGpu).toFixed(2)} µs per frame`
            : `  ... incl. GPU done    n/a (onSubmittedWorkDone never resolved within 2 s)`,
          '',
        )
      }
      setReport(lines.join('\n'))
    } catch (e) {
      setError(describe(e))
    } finally {
      setBusy(false)
    }
  }

  const play = (source: FrameSource) => {
    if (!handOff.current || playing.current !== null) return
    const gpu = handOff.current
    const start = performance.now()
    let last = -1
    let presented = 0
    let skipped = 0
    let worst = 0
    let total = 0
    const tick = () => {
      const elapsed = performance.now() - start
      if (elapsed >= PLAY_MS) {
        playing.current = null
        setReport(
          `${source.name} · played ${PLAY_MS / 1000}s at ${FPS} fps\n` +
            `  presented ${presented} of ${Math.floor((PLAY_MS / 1000) * FPS)} frames, skipped ${skipped}\n` +
            `  getFrame + hand-off: avg ${((total / Math.max(1, presented)) * 1000).toFixed(1)} µs, worst ${(worst * 1000).toFixed(1)} µs`,
        )
        return
      }
      const frame = Math.floor((elapsed * FPS) / 1000)
      if (frame !== last) {
        if (last >= 0) skipped += frame - last - 1
        last = frame
        const t0 = performance.now()
        const pointer = source.getFrame(frame % POOL.count)
        if (pointer !== null) image.value = gpu.present(pointer, frame % TEXTURE_RING)
        const dt = performance.now() - t0
        total += dt
        worst = Math.max(worst, dt)
        presented++
      }
      playing.current = requestAnimationFrame(tick)
    }
    setShown(null)
    playing.current = requestAnimationFrame(tick)
  }

  const all = ready
  return (
    <View style={styles.page}>
      <View style={styles.row}>
        <Text style={styles.title}>RN-P6 · D6 spike</Text>
        <Button label="Close" onPress={onClose} />
      </View>
      <Text style={styles.muted}>
        Frame pointer → react-native-webgpu → texture on Skia's device → SkImage. The bars on top spell the frame index
        in binary.
      </Text>
      <Canvas style={styles.canvas}>
        <SkiaImage image={image} x={0} y={0} width={CANVAS_W} height={CANVAS_H} fit="contain" />
      </Canvas>
      {shown ? <Text style={styles.muted}>{`${shown.source} · frame ${shown.index} (expect bars ${shown.index.toString(2).padStart(9, '0')})`}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.buttons}>
        {all.map((source) => (
          <Button key={`show-${source.name}`} label={`${source.name}: next frame`} onPress={() => show(source, ((shown?.index ?? -1) + 1) % POOL.count)} />
        ))}
        {all.map((source) => (
          <Button key={`play-${source.name}`} label={`${source.name}: play 5s`} onPress={() => play(source)} />
        ))}
        <Button label={busy ? 'Running…' : 'Run benchmarks'} disabled={busy || all.length === 0} onPress={runBenchmarks} />
        <Button label="Share results" disabled={!report} onPress={() => Share.share({ message: report })} />
      </View>
      {report ? <Text style={styles.code}>{report}</Text> : null}
    </View>
  )
}

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  )
}

const CANVAS_W = 320
const CANVAS_H = 180

const styles = StyleSheet.create({
  page: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#f2f3f5', fontSize: 20, fontWeight: '600' },
  muted: { color: '#8b919c', fontSize: 13 },
  error: { color: '#ff8a80', fontFamily: 'monospace', fontSize: 12 },
  canvas: { width: CANVAS_W, height: CANVAS_H, backgroundColor: '#000', alignSelf: 'center' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { backgroundColor: '#262b35', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, minHeight: 40, justifyContent: 'center' },
  buttonPressed: { backgroundColor: '#323946' },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: '#f2f3f5', fontSize: 14 },
  code: { color: '#b8e0a8', fontFamily: 'monospace', fontSize: 12, backgroundColor: '#161a21', padding: 8, borderRadius: 6 },
})
