import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// DOM + WebGL stubs (node environment)
// ---------------------------------------------------------------------------

function makeCanvas(): HTMLCanvasElement {
  return {
    tagName: 'CANVAS',
    width: 300,
    height: 150,
    style: {},
    appendChild: vi.fn(),
    remove: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement
}

const mockCanvas = makeCanvas()

vi.mock('../WebGLContext', () => ({
  WebGLContext: vi.fn().mockImplementation(() => ({
    canvas: mockCanvas,
    gl: {},
    isLost: false,
    isWebGL2: true,
    resize: vi.fn(),
    clear: vi.fn(),
    setClearColor: vi.fn(),
    dispose: vi.fn(),
  })),
}))

import { DebugGpuRenderer } from '../debug/DebugGpuRenderer'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DebugGpuRenderer lifecycle', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = {
      tagName: 'DIV',
      clientWidth: 1280,
      clientHeight: 720,
      style: {},
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    } as unknown as HTMLElement
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('mount() appends the canvas to the container', () => {
    const renderer = new DebugGpuRenderer()
    renderer.mount(container)

    expect(container.appendChild).toHaveBeenCalledWith(mockCanvas)
    expect(renderer.isMounted).toBe(true)
    expect(renderer.canvas).toBe(mockCanvas)

    renderer.dispose()
  })

  it('mount() called twice throws', () => {
    const renderer = new DebugGpuRenderer()
    renderer.mount(container)

    expect(() => renderer.mount(container)).toThrow(
      'DebugGpuRenderer: mount() called more than once',
    )

    renderer.dispose()
  })

  it('render() before mount() is a silent no-op', () => {
    const renderer = new DebugGpuRenderer()

    expect(() =>
      renderer.render([
        {
          id: 'x',
          zIndex: 0,
          color: [1, 0, 0, 1],
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ]),
    ).not.toThrow()
  })

  it('resize() before mount() is a silent no-op', () => {
    const renderer = new DebugGpuRenderer()

    expect(() => renderer.resize(800, 600)).not.toThrow()
  })

  it('dispose() removes canvas and prevents further renders', () => {
    const renderer = new DebugGpuRenderer()
    renderer.mount(container)
    renderer.dispose()

    expect(mockCanvas.remove).toHaveBeenCalled()
    expect(renderer.isMounted).toBe(false)
    expect(renderer.canvas).toBeNull()

    expect(() =>
      renderer.render([
        {
          id: 'x',
          zIndex: 0,
          color: [1, 0, 0, 1],
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ]),
    ).not.toThrow()
  })
})
