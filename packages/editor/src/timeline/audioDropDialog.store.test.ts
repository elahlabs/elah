import { beforeEach, describe, expect, it } from 'vitest'
import { useAudioDropDialogStore } from './audioDropDialog.store'

describe('audioDropDialog store', () => {
  beforeEach(() => {
    useAudioDropDialogStore.setState({ open: false, assetName: '', resolve: null })
  })

  it('opens on request and resolves with the chosen placement', async () => {
    const pending = useAudioDropDialogStore.getState().request('clip.mp4')

    const opened = useAudioDropDialogStore.getState()
    expect(opened.open).toBe(true)
    expect(opened.assetName).toBe('clip.mp4')

    useAudioDropDialogStore.getState().respond('both')

    await expect(pending).resolves.toBe('both')
    const closed = useAudioDropDialogStore.getState()
    expect(closed.open).toBe(false)
    expect(closed.resolve).toBeNull()
  })

  it('supersedes a pending request, resolving the old one with null', async () => {
    const first = useAudioDropDialogStore.getState().request('a.mp4')
    const second = useAudioDropDialogStore.getState().request('b.mp4')

    await expect(first).resolves.toBeNull()
    expect(useAudioDropDialogStore.getState().assetName).toBe('b.mp4')

    useAudioDropDialogStore.getState().respond('audio-only')
    await expect(second).resolves.toBe('audio-only')
  })
})
