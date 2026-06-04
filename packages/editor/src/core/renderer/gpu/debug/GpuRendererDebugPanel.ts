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

const PANEL_WIDTH = 220

const HEADER_STYLE = [
  'display:flex',
  'align-items:center',
  'justify-content:space-between',
  'gap:8px',
  'width:100%',
  'padding:6px 10px',
  'background:transparent',
  'border:none',
  'border-bottom:1px solid #1A1F2B',
  'color:#6B7280',
  'font:700 9px/1 system-ui,sans-serif',
  'letter-spacing:0.1em',
  'text-transform:uppercase',
  'cursor:pointer',
  'text-align:left',
].join(';')

export class GpuRendererDebugPanel {
  private readonly _root: HTMLDivElement
  private readonly _panel: HTMLDivElement
  private readonly _header: HTMLButtonElement
  private readonly _headerTitle: HTMLSpanElement
  private readonly _headerMeta: HTMLSpanElement
  private readonly _chevron: HTMLSpanElement
  private readonly _content: HTMLPreElement
  private readonly _getSnapshot: () => DebugPanelSnapshot
  private readonly _intervalId: ReturnType<typeof setInterval>
  private _collapsed = false
  private _lastFps = 0

  constructor(container: HTMLElement, getSnapshot: () => DebugPanelSnapshot) {
    this._getSnapshot = getSnapshot

    const computed = getComputedStyle(container)
    if (computed.position === 'static') {
      container.style.position = 'relative'
    }

    this._root = document.createElement('div')
    this._root.dataset.elahGpuDebug = 'true'
    this._root.style.cssText = [
      'position:absolute',
      'top:8px',
      'right:8px',
      'width:' + PANEL_WIDTH + 'px',
      'pointer-events:none',
      'z-index:9999',
    ].join(';')

    this._panel = document.createElement('div')
    this._panel.style.cssText = [
      'pointer-events:auto',
      'background:rgba(18,23,34,0.88)',
      'backdrop-filter:blur(8px)',
      'border:1px solid #232938',
      'border-radius:8px',
      'overflow:hidden',
      'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
    ].join(';')

    this._header = document.createElement('button')
    this._header.type = 'button'
    this._header.style.cssText = HEADER_STYLE
    this._headerTitle = document.createElement('span')
    this._headerTitle.textContent = 'GPU Monitor'
    this._headerMeta = document.createElement('span')
    this._headerMeta.style.cssText = [
      'font:500 9px/1 ui-monospace,monospace',
      'letter-spacing:0',
      'text-transform:none',
      'color:#22C55E',
    ].join(';')
    this._chevron = document.createElement('span')
    this._chevron.textContent = '▾'
    this._chevron.style.cssText = 'font-size:10px;opacity:0.7;flex-shrink:0'
    this._header.append(this._headerTitle, this._headerMeta, this._chevron)
    this._header.addEventListener('click', () => this._toggleCollapsed())

    this._content = document.createElement('pre')
    this._content.style.cssText = [
      'margin:0',
      'padding:8px 10px',
      'background:transparent',
      'color:#A7AFBF',
      'font:10px/1.5 ui-monospace,monospace',
      'white-space:pre',
      'max-height:min(38vh,220px)',
      'overflow:auto',
    ].join(';')

    this._panel.append(this._header, this._content)
    this._root.appendChild(this._panel)
    container.appendChild(this._root)

    this._refresh()
    this._intervalId = setInterval(() => this._refresh(), 100)
  }

  dispose(): void {
    clearInterval(this._intervalId)
    this._root.remove()
  }

  private _toggleCollapsed(): void {
    this._collapsed = !this._collapsed
    this._content.style.display = this._collapsed ? 'none' : 'block'
    this._header.style.borderBottom = this._collapsed ? 'none' : '1px solid #1A1F2B'
    this._chevron.textContent = this._collapsed ? '▸' : '▾'
    this._root.dataset.elahGpuDebugCollapsed = this._collapsed ? 'true' : 'false'
    this._updateHeaderMeta()
  }

  private _updateHeaderMeta(): void {
    if (this._collapsed) {
      this._headerMeta.textContent = `${this._lastFps.toFixed(1)} FPS`
      this._headerMeta.style.display = 'inline'
    } else {
      this._headerMeta.textContent = ''
      this._headerMeta.style.display = 'none'
    }
  }

  private _refresh(): void {
    const s = this._getSnapshot()
    this._lastFps = s.fps
    this._updateHeaderMeta()

    const decoderLines =
      Object.keys(s.decoderStates).length > 0
        ? Object.entries(s.decoderStates)
            .map(([src, state]) => `  ${src}: ${state}`)
            .join('\n')
        : '  (none)'

    this._content.textContent = [
      `${s.fps.toFixed(1)} FPS  ● LIVE`,
      `Frame  ${s.currentFrame}`,
      `Clips  ${s.activeClipCount}`,
      `Textures  ${s.textureCount}`,
      `Cache  ${(s.cacheHitRatio * 100).toFixed(0)}%`,
      `Render  ${s.renderDurationMs.toFixed(2)}ms`,
      `No-op  ${s.noOpTicks}`,
      `Dropped  ${s.droppedFrames}`,
      `Outstanding  ${s.outstandingDecodes}`,
      `Providers  ${s.activeProviders}`,
      `Decoders:\n${decoderLines}`,
      'WebGL2 hardware accelerated',
    ].join('\n')
  }
}
