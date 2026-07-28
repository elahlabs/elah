import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AudioPlaybackController } from '@elah/core'
import { useAudioMixer, type AudioMixerApi } from './useAudioMixer'

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

function mockController(): AudioPlaybackController {
  return {
    setMasterGain: vi.fn(),
    setTrackGain: vi.fn(),
  } as unknown as AudioPlaybackController
}

function Harness({
  controller,
  onApi,
}: {
  controller: AudioPlaybackController | null
  onApi: (api: AudioMixerApi) => void
}) {
  onApi(useAudioMixer(controller))
  return null
}

describe('useAudioMixer', () => {
  it('is a no-op and does not throw when controller is null', () => {
    let api: AudioMixerApi | undefined
    render(createElement(Harness, { controller: null, onApi: (a) => (api = a) }))

    expect(() => api!.setMasterGain(0.5)).not.toThrow()
    expect(() => api!.setTrackGain('t1', 0.5)).not.toThrow()
  })

  it('forwards calls to the controller when present', () => {
    const controller = mockController()
    let api: AudioMixerApi | undefined
    render(createElement(Harness, { controller, onApi: (a) => (api = a) }))

    api!.setMasterGain(0.7)
    api!.setTrackGain('t1', 0.3)

    expect(controller.setMasterGain).toHaveBeenCalledWith(0.7)
    expect(controller.setTrackGain).toHaveBeenCalledWith('t1', 0.3)
  })

  it('keeps stable callback identities across re-renders while the controller is unchanged, and rebinds when it changes', () => {
    const controllerA = mockController()
    const seen: AudioMixerApi[] = []
    const { root } = render(
      createElement(Harness, { controller: controllerA, onApi: (a) => seen.push(a) }),
    )

    act(() => {
      root.render(
        createElement(Harness, { controller: controllerA, onApi: (a) => seen.push(a) }),
      )
    })

    expect(seen[1].setMasterGain).toBe(seen[0].setMasterGain)
    expect(seen[1].setTrackGain).toBe(seen[0].setTrackGain)

    const controllerB = mockController()
    act(() => {
      root.render(
        createElement(Harness, { controller: controllerB, onApi: (a) => seen.push(a) }),
      )
    })

    expect(seen[2].setMasterGain).not.toBe(seen[1].setMasterGain)
    expect(seen[2].setTrackGain).not.toBe(seen[1].setTrackGain)
  })
})
