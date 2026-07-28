import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TimelineEngine, type AudioPlaybackController } from '@elah/core'
import { useMasterVolume, type MasterVolumeApi } from './useMasterVolume'

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
  return { setMasterGain: vi.fn() } as unknown as AudioPlaybackController
}

// This hook takes engine/controller as direct params (not via useEditor()),
// so no EditorContext.Provider wrapper is needed for these tests.
function Harness({
  engine,
  controller,
  onApi,
}: {
  engine: TimelineEngine
  controller: AudioPlaybackController | null
  onApi: (api: MasterVolumeApi) => void
}) {
  onApi(useMasterVolume(controller, engine))
  return null
}

describe('useMasterVolume', () => {
  it('defaults to 1 when the project has no explicit masterVolume', () => {
    const engine = new TimelineEngine({ fps: 30 })
    let api: MasterVolumeApi | undefined
    render(createElement(Harness, { engine, controller: null, onApi: (a) => (api = a) }))

    expect(api!.masterVolume).toBe(1)
  })

  it('setMasterVolume ramps the controller and persists to the engine', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const controller = mockController()
    let api: MasterVolumeApi | undefined
    render(createElement(Harness, { engine, controller, onApi: (a) => (api = a) }))

    act(() => {
      api!.setMasterVolume(1.5)
    })

    expect(controller.setMasterGain).toHaveBeenCalledWith(1.5)
    expect(engine.getProject().masterVolume).toBe(1.5)
  })

  it('clamps values to [0, 2]', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const controller = mockController()
    let api: MasterVolumeApi | undefined
    render(createElement(Harness, { engine, controller, onApi: (a) => (api = a) }))

    act(() => {
      api!.setMasterVolume(5)
    })
    expect(controller.setMasterGain).toHaveBeenCalledWith(2)
    expect(engine.getProject().masterVolume).toBe(2)

    act(() => {
      api!.setMasterVolume(-1)
    })
    expect(controller.setMasterGain).toHaveBeenCalledWith(0)
    expect(engine.getProject().masterVolume).toBe(0)
  })

  it('persists to the engine even when controller is null', () => {
    const engine = new TimelineEngine({ fps: 30 })
    let api: MasterVolumeApi | undefined
    render(createElement(Harness, { engine, controller: null, onApi: (a) => (api = a) }))

    expect(() => {
      act(() => {
        api!.setMasterVolume(1.2)
      })
    }).not.toThrow()

    expect(engine.getProject().masterVolume).toBe(1.2)
  })
})
