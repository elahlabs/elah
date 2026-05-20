import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react'

const DEFAULT_URL =
  'https://cdn.matify.io/generated/low_res_media/Shoulder_Bounce.mp4'
const SPARK_BARS = 30
const CANVAS_W = 320
const CANVAS_H = 180

type VideoWithWebkit = HTMLVideoElement & { webkitDecodedFrameCount?: number }

function btnStyle(disabled = false): CSSProperties {
  return {
    padding: '6px 14px',
    background: disabled ? '#333' : '#2a2a2a',
    color: disabled ? '#555' : '#ddd',
    border: '1px solid #3a3a3a',
    borderRadius: 6,
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'monospace',
  }
}

function getDecodedFrames(v: HTMLVideoElement): number {
  const w = v as VideoWithWebkit
  if (typeof w.webkitDecodedFrameCount === 'number') return w.webkitDecodedFrameCount
  return v.getVideoPlaybackQuality?.()?.totalVideoFrames ?? 0
}

function getDroppedFrames(v: HTMLVideoElement): number {
  return v.getVideoPlaybackQuality?.()?.droppedVideoFrames ?? 0
}

function p95(samples: number[]): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0
}

const mono: CSSProperties = { fontFamily: 'monospace', fontSize: 12, color: '#888' }

export default function MediaLimitsLab() {
  const [videoCount, setVideoCount] = useState(4)
  const [videoUrl, setVideoUrl] = useState(DEFAULT_URL)
  const [muted, setMuted] = useState(true)
  const [drawToCanvas, setDrawToCanvas] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [seekTime, setSeekTime] = useState(5)
  const [logLines, setLogLines] = useState<string[]>([])

  const videosRef = useRef<HTMLVideoElement[]>([])
  const objectUrlRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const drawToCanvasRef = useRef(false)
  const rafIdRef = useRef(0)
  const prevRafTsRef = useRef(0)
  const fpsEmaRef = useRef(0)
  const gapRingRef = useRef<{ t: number; dt: number }[]>([])
  const drawTimesRef = useRef<number[]>([])
  const prevDecodedRef = useRef<number[]>([])
  const sparkDataRef = useRef<number[]>(Array(SPARK_BARS).fill(0))
  const mountT0Ref = useRef(0)

  const fpsRef = useRef<HTMLSpanElement>(null)
  const rafGapRef = useRef<HTMLSpanElement>(null)
  const drawP95Ref = useRef<HTMLSpanElement>(null)
  const maxDriftRef = useRef<HTMLSpanElement>(null)
  const meanDriftRef = useRef<HTMLSpanElement>(null)
  const totalDroppedRef = useRef<HTMLSpanElement>(null)
  const decodedFpsRef = useRef<HTMLSpanElement>(null)
  const rowCellsRef = useRef<HTMLSpanElement[][]>([])
  const sparkRef = useRef<HTMLDivElement[]>([])
  const canvasCtxRef = useRef<(CanvasRenderingContext2D | null)[]>([])

  useEffect(() => {
    mountedRef.current = mounted
  }, [mounted])
  useEffect(() => {
    drawToCanvasRef.current = drawToCanvas
  }, [drawToCanvas])

  const appendLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23)
    setLogLines((prev) => [...prev.slice(-49), `[${ts}] ${msg}`])
  }, [])

  useEffect(() => {
    const onVis = () =>
      appendLog(`visibilitychange → ${document.visibilityState}`)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [appendLog])

  const cleanupVideos = useCallback(() => {
    videosRef.current.forEach((v) => {
      if (!v) return
      v.pause()
      v.removeAttribute('src')
      v.load()
    })
    videosRef.current = []
    canvasCtxRef.current = []
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    const t0 = mountT0Ref.current
    const cleanups: Array<() => void> = []
    const id = requestAnimationFrame(() => {
      videosRef.current.filter(Boolean).forEach((v, i) => {
        const onMeta = () =>
          appendLog(`loadedmetadata [i=${i}] +${(performance.now() - t0).toFixed(0)}ms`)
        const onCanPlay = () =>
          appendLog(`canplay [i=${i}] +${(performance.now() - t0).toFixed(0)}ms`)
        v.addEventListener('loadedmetadata', onMeta)
        v.addEventListener('canplay', onCanPlay)
        cleanups.push(() => {
          v.removeEventListener('loadedmetadata', onMeta)
          v.removeEventListener('canplay', onCanPlay)
        })
        prevDecodedRef.current[i] = getDecodedFrames(v)
      })
    })
    return () => {
      cancelAnimationFrame(id)
      cleanups.forEach((fn) => fn())
    }
  }, [mounted, videoCount, appendLog])

  useEffect(() => {
    if (!mounted) return
    const iv = window.setInterval(() => {
      const videos = videosRef.current.filter(Boolean)
      let sumFps = 0
      videos.forEach((v, i) => {
        const now = getDecodedFrames(v)
        const prev = prevDecodedRef.current[i] ?? now
        sumFps += (now - prev) * 2
        prevDecodedRef.current[i] = now
      })
      if (decodedFpsRef.current) decodedFpsRef.current.textContent = sumFps.toFixed(1)
      const data = sparkDataRef.current
      data.shift()
      data.push(sumFps)
      const max = Math.max(...data, 1)
      sparkRef.current.forEach((bar, j) => {
        if (bar) bar.style.height = `${Math.round((data[j]! / max) * 28)}px`
      })
    }, 500)
    return () => clearInterval(iv)
  }, [mounted])

  useEffect(() => {
    let running = true
    const tick = (ts: number) => {
      if (!running) return
      const prev = prevRafTsRef.current
      if (prev > 0) {
        const dt = ts - prev
        if (dt > 100) appendLog(`background throttle: ${dt.toFixed(0)} ms gap`)
        const ring = gapRingRef.current
        ring.push({ t: ts, dt })
        while (ring.length > 0 && ring[0]!.t < ts - 1000) ring.shift()
        const gapMax = ring.reduce((m, s) => Math.max(m, s.dt), 0)
        if (rafGapRef.current) rafGapRef.current.textContent = gapMax.toFixed(1)
        const instant = 1000 / dt
        fpsEmaRef.current = fpsEmaRef.current * 0.9 + instant * 0.1
        if (fpsRef.current) fpsRef.current.textContent = fpsEmaRef.current.toFixed(1)
      }
      prevRafTsRef.current = ts

      if (mountedRef.current) {
        const videos = videosRef.current.filter(Boolean)
        const n = videos.length
        if (n > 0) {
          const t0 = videos[0]!.currentTime
          let maxDrift = 0
          let sumDrift = 0
          let totalDropped = 0
          for (let i = 0; i < n; i++) {
            const v = videos[i]!
            const drift = i === 0 ? 0 : (v.currentTime - t0) * 1000
            const adrift = Math.abs(drift)
            if (adrift > maxDrift) maxDrift = adrift
            sumDrift += adrift
            totalDropped += getDroppedFrames(v)
            const cells = rowCellsRef.current[i]
            if (cells) {
              cells[0]!.textContent = String(v.readyState)
              cells[1]!.textContent = v.currentTime.toFixed(3)
              cells[2]!.textContent = drift.toFixed(1)
              cells[3]!.textContent = String(getDecodedFrames(v))
              cells[4]!.textContent = String(getDroppedFrames(v))
            }
          }
          if (maxDriftRef.current) maxDriftRef.current.textContent = maxDrift.toFixed(1)
          if (meanDriftRef.current)
            meanDriftRef.current.textContent = (sumDrift / n).toFixed(1)
          if (totalDroppedRef.current)
            totalDroppedRef.current.textContent = String(totalDropped)

          if (drawToCanvasRef.current) {
            videos.forEach((v, i) => {
              const ctx = canvasCtxRef.current[i]
              if (!ctx || v.readyState < 2) return
              const t0p = performance.now()
              ctx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H)
              const cost = performance.now() - t0p
              const arr = drawTimesRef.current
              arr.push(cost)
              if (arr.length > 120) arr.shift()
            })
            if (drawP95Ref.current)
              drawP95Ref.current.textContent = p95(drawTimesRef.current).toFixed(2)
          } else if (drawP95Ref.current) {
            drawP95Ref.current.textContent = '—'
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(tick)
    }
    rafIdRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafIdRef.current)
    }
  }, [appendLog])

  useEffect(() => () => cleanupVideos(), [cleanupVideos])

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setVideoUrl(url)
    e.target.value = ''
  }

  const handleMount = () => {
    cleanupVideos()
    mountT0Ref.current = performance.now()
    prevDecodedRef.current = []
    rowCellsRef.current = []
    sparkDataRef.current = Array(SPARK_BARS).fill(0)
    drawTimesRef.current = []
    gapRingRef.current = []
    fpsEmaRef.current = 0
    appendLog(`Mount N=${videoCount}`)
    setMounted(true)
  }

  const handleUnmount = () => {
    cleanupVideos()
    setMounted(false)
    appendLog('Unmount all')
  }

  const handlePlayAll = async () => {
    const results = await Promise.allSettled(
      videosRef.current.filter(Boolean).map((v) => v.play()),
    )
    results.forEach((r, i) => {
      if (r.status === 'rejected')
        appendLog(`play() rejected [i=${i}]: ${String(r.reason)}`)
    })
  }

  const handlePauseAll = () => {
    videosRef.current.forEach((v) => v?.pause())
  }

  const runSeek = (stagger: boolean) => {
    const videos = videosRef.current.filter(Boolean)
    if (videos.length === 0) return
    const t0 = performance.now()
    let pending = videos.length
    const label = stagger ? 'stagger seek' : 'seek all'
    const onSeeked = () => {
      pending -= 1
      if (pending === 0)
        appendLog(`${label} → all seeked in ${(performance.now() - t0).toFixed(0)}ms`)
    }
    videos.forEach((v, i) => {
      v.addEventListener('seeked', onSeeked, { once: true })
      v.currentTime = stagger ? seekTime + i * 0.1 : seekTime
    })
  }

  const src = mounted ? videoUrl : undefined
  const cols = ['readyState', 'currentTime', 'drift(ms)', 'decoded', 'dropped']

  return (
    <div
      style={{
        background: '#151515',
        borderBottom: '1px solid #2a2a2a',
        padding: '8px 12px',
        fontFamily: 'monospace',
        color: '#ddd',
        maxHeight: '45vh',
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#6cf' }}>MediaLimitsLab</span>
        <input
          type="text"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          style={{ flex: 1, minWidth: 200, background: '#1e1e1e', color: '#ddd', border: '1px solid #3a3a3a', borderRadius: 4, padding: '4px 8px', fontSize: 11 }}
          disabled={mounted}
        />
        <label style={mono}>
          N
          <input
            type="number"
            min={1}
            max={32}
            value={videoCount}
            onChange={(e) => setVideoCount(Math.min(32, Math.max(1, Number(e.target.value) || 1)))}
            style={{ width: 44, marginLeft: 4, background: '#1e1e1e', color: '#ddd', border: '1px solid #3a3a3a', borderRadius: 4 }}
            disabled={mounted}
          />
        </label>
        <label style={btnStyle()}>
          File
          <input type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} disabled={mounted} />
        </label>
        <button style={btnStyle(mounted)} disabled={mounted} onClick={handleMount}>Mount N</button>
        <button style={btnStyle(!mounted)} disabled={!mounted} onClick={handleUnmount}>Unmount all</button>
        <button style={btnStyle(!mounted)} disabled={!mounted} onClick={handlePlayAll}>Play all</button>
        <button style={btnStyle(!mounted)} disabled={!mounted} onClick={handlePauseAll}>Pause all</button>
        <label style={mono}>
          t
          <input
            type="number"
            step={0.1}
            value={seekTime}
            onChange={(e) => setSeekTime(Number(e.target.value))}
            style={{ width: 56, marginLeft: 4, background: '#1e1e1e', color: '#ddd', border: '1px solid #3a3a3a', borderRadius: 4 }}
          />
        </label>
        <button style={btnStyle(!mounted)} disabled={!mounted} onClick={() => runSeek(false)}>Seek all to t</button>
        <button style={btnStyle(!mounted)} disabled={!mounted} onClick={() => runSeek(true)}>Stagger seek</button>
        <label style={mono}>
          <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /> Mute
        </label>
        <label style={mono}>
          <input type="checkbox" checked={drawToCanvas} onChange={(e) => setDrawToCanvas(e.target.checked)} /> Draw to canvas
        </label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8, ...mono }}>
        <span>rAF fps: <span ref={fpsRef}>0</span></span>
        <span>rAF gap max: <span ref={rafGapRef}>0</span> ms</span>
        <span>drawImage p95: <span ref={drawP95Ref}>—</span> ms</span>
        <span>max drift: <span ref={maxDriftRef}>0</span> ms</span>
        <span>mean drift: <span ref={meanDriftRef}>0</span> ms</span>
        <span>dropped: <span ref={totalDroppedRef}>0</span></span>
        <span>dec fps Σ: <span ref={decodedFpsRef}>0</span></span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32, marginBottom: 8 }}>
        {Array.from({ length: SPARK_BARS }, (_, j) => (
          <div
            key={j}
            ref={(el) => {
              if (el) sparkRef.current[j] = el
            }}
            style={{ width: 4, height: 2, background: '#3a6a9a', borderRadius: 1 }}
          />
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 8 }}>
        <thead>
          <tr style={{ color: '#666', textAlign: 'left' }}>
            <th style={{ padding: '2px 6px' }}>#</th>
            {cols.map((c) => (
              <th key={c} style={{ padding: '2px 6px' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mounted &&
            Array.from({ length: videoCount }, (_, i) => (
              <tr key={i} style={{ background: i % 2 ? '#1a1a1a' : '#1e1e1e' }}>
                <td style={{ padding: '2px 6px', color: '#666' }}>{i}</td>
                {cols.map((_, ci) => (
                  <td key={ci} style={{ padding: '2px 6px' }}>
                    <span
                      ref={(el) => {
                        if (!el) return
                        if (!rowCellsRef.current[i]) rowCellsRef.current[i] = []
                        rowCellsRef.current[i]![ci] = el
                      }}
                    >
                      —
                    </span>
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>

      {mounted && drawToCanvas && (
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', marginBottom: 8 }}>
          {Array.from({ length: videoCount }, (_, i) => (
            <canvas
              key={i}
              width={CANVAS_W}
              height={CANVAS_H}
              ref={(el) => {
                if (el) canvasCtxRef.current[i] = el.getContext('2d')
              }}
              style={{ width: 120, height: 68, background: '#000', flexShrink: 0 }}
            />
          ))}
        </div>
      )}

      <div style={{ display: 'none' }} aria-hidden>
        {mounted &&
          Array.from({ length: videoCount }, (_, i) => (
            <video
              key={i}
              ref={(el) => {
                if (el) videosRef.current[i] = el
              }}
              src={src}
              preload="auto"
              muted={muted}
              playsInline
              style={{ width: 1, height: 1, opacity: 0, position: 'absolute', pointerEvents: 'none' }}
            />
          ))}
      </div>

      <pre
        style={{
          margin: 0,
          padding: 8,
          background: '#0d0d0d',
          borderRadius: 4,
          fontSize: 10,
          color: '#6a6',
          maxHeight: 100,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {logLines.length === 0 ? 'Event log…' : logLines.join('\n')}
      </pre>
    </div>
  )
}
