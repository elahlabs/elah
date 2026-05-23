/**
 * DebugOverlay — lightweight DOM overlay for renderer validation.
 *
 * Renders FPS, zIndex labels, and bounding boxes as absolutely-positioned
 * HTML elements over the canvas. No GL resources; purely for manual inspection.
 */

import type { DebugRenderItem } from './types'
import { DEBUG_STAGE } from './types'

export class DebugOverlay {
  private readonly _root: HTMLDivElement
  private readonly _fpsEl: HTMLDivElement
  private readonly _stage: { width: number; height: number }
  private _visible = true

  constructor(container: HTMLElement, stage: { width: number; height: number } = DEBUG_STAGE) {
    this._stage = { width: stage.width, height: stage.height }
    const computed = getComputedStyle(container)
    if (computed.position === 'static') {
      container.style.position = 'relative'
    }

    this._root = document.createElement('div')
    this._root.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'overflow:hidden',
    ].join(';')

    this._fpsEl = document.createElement('div')
    this._fpsEl.style.cssText = [
      'position:absolute',
      'top:8px',
      'left:8px',
      'padding:4px 8px',
      'background:rgba(0,0,0,0.6)',
      'color:#0f0',
      'font:12px monospace',
      'border-radius:3px',
      'z-index:9999',
    ].join(';')
    this._fpsEl.textContent = 'FPS: --'

    this._root.appendChild(this._fpsEl)
    container.appendChild(this._root)
  }

  /** Refresh overlay elements to match the current items and FPS. */
  update(items: DebugRenderItem[], fps: number, stage?: { width: number; height: number }): void {
    const stageSize = stage ?? this._stage
    if (!this._visible) return

    this._fpsEl.textContent = `FPS: ${fps.toFixed(1)}`

    // Remove previous item overlays (keep FPS element).
    while (this._root.childNodes.length > 1) {
      this._root.removeChild(this._root.lastChild!)
    }

    const scaleX = this._root.clientWidth / stageSize.width
    const scaleY = this._root.clientHeight / stageSize.height

    for (const item of items) {
      const left = item.x * scaleX
      const top = item.y * scaleY
      const width = item.width * scaleX
      const height = item.height * scaleY

      const bounds = document.createElement('div')
      bounds.style.cssText = [
        'position:absolute',
        `left:${left}px`,
        `top:${top}px`,
        `width:${width}px`,
        `height:${height}px`,
        'border:1px dashed rgba(255,255,255,0.7)',
        'box-sizing:border-box',
      ].join(';')
      this._root.appendChild(bounds)

      const label = document.createElement('div')
      label.textContent = `z:${item.zIndex}`
      label.style.cssText = [
        'position:absolute',
        `left:${left + width / 2}px`,
        `top:${top + height / 2}px`,
        'transform:translate(-50%,-50%)',
        'padding:2px 6px',
        'background:rgba(0,0,0,0.75)',
        'color:#fff',
        'font:11px monospace',
        'border-radius:2px',
        'white-space:nowrap',
      ].join(';')
      this._root.appendChild(label)
    }
  }

  /** Show or hide the overlay without disposing it. */
  setVisible(visible: boolean): void {
    this._visible = visible
    this._root.style.display = visible ? 'block' : 'none'
  }

  /** Remove the overlay from the DOM. */
  dispose(): void {
    this._root.remove()
  }
}
