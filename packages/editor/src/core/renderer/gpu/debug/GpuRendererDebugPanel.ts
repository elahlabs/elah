/**
 * GpuRendererDebugPanel — development-only DOM overlay for production GpuRenderer.
 *
 * Polls a snapshot getter on an interval. No GL resources; isolated from renderer core.
 */

export interface DebugPanelSnapshot {
  fps: number
  currentFrame: number
  activeClipCount: number
  textureCount: number
  cacheHitRatio: number
  renderDurationMs: number
  decoderStates: Record<string, string>
  /** Total frames dropped due to decode failure (not seek/drain cancellation). */
  droppedFrames: number
  /** Current in-flight decode requests across all providers. */
  outstandingDecodes: number
  /** Number of unique-src providers currently alive in VideoLayer. */
  activeProviders: number
  /** Consecutive render() calls that skipped work (scene === lastScene). */
  noOpTicks: number
}

export class GpuRendererDebugPanel {
  private readonly _root: HTMLDivElement
  private readonly _content: HTMLPreElement
  private readonly _getSnapshot: () => DebugPanelSnapshot
  private readonly _intervalId: ReturnType<typeof setInterval>

  constructor(container: HTMLElement, getSnapshot: () => DebugPanelSnapshot) {
    this._getSnapshot = getSnapshot

    const computed = getComputedStyle(container)
    if (computed.position === 'static') {
      container.style.position = 'relative'
    }

    this._root = document.createElement('div')
    this._root.style.cssText = [
      'position:absolute',
      'top:8px',
      'right:8px',
      'pointer-events:none',
      'z-index:9999',
    ].join(';')

    this._content = document.createElement('pre')
    this._content.style.cssText = [
      'margin:0',
      'padding:8px 10px',
      'background:rgba(0,0,0,0.72)',
      'color:#0f0',
      'font:11px/1.45 monospace',
      'border-radius:4px',
      'white-space:pre',
    ].join(';')

    this._root.appendChild(this._content)
    container.appendChild(this._root)

    this._refresh()
    this._intervalId = setInterval(() => this._refresh(), 100)
  }

  dispose(): void {
    clearInterval(this._intervalId)
    this._root.remove()
  }

  private _refresh(): void {
    const s = this._getSnapshot()
    const decoderLines =
      Object.keys(s.decoderStates).length > 0
        ? Object.entries(s.decoderStates)
            .map(([src, state]) => `  ${src}: ${state}`)
            .join('\n')
        : '  (none)'

    this._content.textContent = [
      `FPS: ${s.fps.toFixed(1)}`,
      `Frame: ${s.currentFrame}`,
      `Clips: ${s.activeClipCount}`,
      `Textures: ${s.textureCount}`,
      `Cache hit: ${(s.cacheHitRatio * 100).toFixed(0)}%`,
      `Render: ${s.renderDurationMs.toFixed(2)}ms`,
      `No-op ticks: ${s.noOpTicks}`,
      `Dropped: ${s.droppedFrames}`,
      `Outstanding: ${s.outstandingDecodes}`,
      `Active providers: ${s.activeProviders}`,
      `Decoders:\n${decoderLines}`,
    ].join('\n')
  }
}
