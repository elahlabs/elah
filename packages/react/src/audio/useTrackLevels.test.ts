import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AudioPlaybackController } from '@elah/core'
import { useTrackLevels, type TrackLevel } from './useTrackLevels'

interface Rendered {
  container: HTMLElement
  root: Root
}

const mounted: Rendered[] = []

afterEach(() => {
  for (const { root, container } of mounted.splice(0).reverse()) {
    act(() => root.unmount())
    container.remove()
  }
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function render(element: ReactElement): Rendered {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  const rendered = { container, root }
  mounted.push(rendered)
  return rendered
}

async function waitForFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

function mockController(
  getTrackLevels: () => Map<string, TrackLevel>,
): AudioPlaybackController {
  return { getTrackLevels: vi.fn(getTrackLevels) } as unknown as AudioPlaybackController
}

function Harness({
  controller,
  onLevels,
}: {
  controller: AudioPlaybackController | null
  onLevels: (levels: Map<string, TrackLevel>) => void
}) {
  onLevels(useTrackLevels(controller))
  return null
}

describe('useTrackLevels', () => {
  it('returns an empty map when controller is null', () => {
    let levels: Map<string, TrackLevel> | undefined
    render(createElement(Harness, { controller: null, onLevels: (l) => (levels = l) }))

    expect(levels!.size).toBe(0)
  })

  it('reflects the controller.getTrackLevels() output after a poll tick', async () => {
    const controller = mockController(
      () => new Map([['t1', { left: 0.5, right: 0.6 }]]),
    )
    let levels: Map<string, TrackLevel> | undefined
    render(createElement(Harness, { controller, onLevels: (l) => (levels = l) }))

    await waitForFrame()

    expect(levels!.get('t1')).toEqual({ left: 0.5, right: 0.6 })
    expect(controller.getTrackLevels).toHaveBeenCalled()
  })

  it('stops polling (cancelAnimationFrame) on unmount', async () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const controller = mockController(() => new Map())
    const { root, container } = render(
      createElement(Harness, { controller, onLevels: () => {} }),
    )
    await waitForFrame()

    act(() => root.unmount())
    mounted.splice(mounted.findIndex((r) => r.container === container), 1)

    expect(cancelSpy).toHaveBeenCalled()
  })

  it('polls the new controller after the controller prop changes', async () => {
    const controllerA = mockController(() => new Map([['a', { left: 1, right: 1 }]]))
    const controllerB = mockController(() => new Map([['b', { left: 0, right: 0 }]]))
    let levels: Map<string, TrackLevel> | undefined
    const { root } = render(
      createElement(Harness, { controller: controllerA, onLevels: (l) => (levels = l) }),
    )
    await waitForFrame()
    expect(levels!.has('a')).toBe(true)

    const callsOnAAfterSwap = () => (controllerA.getTrackLevels as any).mock.calls.length

    act(() => {
      root.render(createElement(Harness, { controller: controllerB, onLevels: (l) => (levels = l) }))
    })
    const countRightAfterSwap = callsOnAAfterSwap()
    await waitForFrame()

    expect(levels!.has('b')).toBe(true)
    expect(controllerB.getTrackLevels).toHaveBeenCalled()
    // Polling on the old controller must have stopped once it was swapped out.
    expect(callsOnAAfterSwap()).toBe(countRightAfterSwap)
  })
})
