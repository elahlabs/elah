import { beforeEach, describe, expect, it } from 'vitest'
import {
  EDITOR_PANEL_COLLAPSED_KEYS,
  editorPanelToggleLabel,
  readEditorPanelCollapsed,
  writeEditorPanelCollapsed,
  type EditorPanelId,
  type EditorPanelStore,
} from './panelCollapse'

const SIDES: EditorPanelId[] = ['left', 'right']

/** An in-memory `Storage` slice. */
function memoryStore(initial: Record<string, string> = {}): EditorPanelStore & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
    removeItem: (key) => {
      delete data[key]
    },
  }
}

/** A store that throws on everything — Safari's private mode, and a full quota. */
const hostileStore: EditorPanelStore = {
  getItem: () => {
    throw new Error('nope')
  },
  setItem: () => {
    throw new Error('nope')
  },
  removeItem: () => {
    throw new Error('nope')
  },
}

describe('readEditorPanelCollapsed', () => {
  it('defaults to expanded when nothing has been stored', () => {
    for (const side of SIDES) {
      expect(readEditorPanelCollapsed(side, memoryStore())).toBe(false)
    }
  })

  it('reads back a collapsed panel', () => {
    for (const side of SIDES) {
      const store = memoryStore({ [EDITOR_PANEL_COLLAPSED_KEYS[side]]: '1' })
      expect(readEditorPanelCollapsed(side, store)).toBe(true)
    }
  })

  it('keeps the panels independent', () => {
    const store = memoryStore({ [EDITOR_PANEL_COLLAPSED_KEYS.left]: '1' })
    expect(readEditorPanelCollapsed('left', store)).toBe(true)
    expect(readEditorPanelCollapsed('right', store)).toBe(false)
  })

  // Only the exact marker collapses: a corrupt or half-written value should
  // show the panel, not hide half the editor.
  it('expands the panel for any value that is not the marker', () => {
    for (const value of ['0', 'true', 'yes', '', '{}']) {
      const store = memoryStore({ [EDITOR_PANEL_COLLAPSED_KEYS.left]: value })
      expect(readEditorPanelCollapsed('left', store)).toBe(false)
    }
  })

  it('answers rather than throws with no storage at all', () => {
    expect(readEditorPanelCollapsed('left', null)).toBe(false)
    expect(readEditorPanelCollapsed('right', hostileStore)).toBe(false)
  })
})

describe('writeEditorPanelCollapsed', () => {
  let store: ReturnType<typeof memoryStore>
  beforeEach(() => {
    store = memoryStore()
  })

  it('round-trips the preference', () => {
    for (const side of SIDES) {
      writeEditorPanelCollapsed(side, true, store)
      expect(readEditorPanelCollapsed(side, store)).toBe(true)
    }
  })

  // "Never touched it" and "put it back" are the same stored state, so there is
  // only one default to reason about.
  it('clears the key rather than storing an expanded marker', () => {
    writeEditorPanelCollapsed('right', true, store)
    writeEditorPanelCollapsed('right', false, store)
    expect(store.data[EDITOR_PANEL_COLLAPSED_KEYS.right]).toBeUndefined()
    expect(readEditorPanelCollapsed('right', store)).toBe(false)
  })

  it('costs the preference and nothing else when storage is blocked', () => {
    expect(() => writeEditorPanelCollapsed('left', true, hostileStore)).not.toThrow()
    expect(() => writeEditorPanelCollapsed('left', true, null)).not.toThrow()
  })
})

describe('the toggle label', () => {
  // One source for the label and the tooltip, and it names the outcome, not
  // the current state.
  it('labels the toggle by what pressing it does', () => {
    expect(editorPanelToggleLabel('left', true)).toBe('Expand media panel')
    expect(editorPanelToggleLabel('left', false)).toBe('Collapse media panel')
    expect(editorPanelToggleLabel('right', true)).toBe('Expand properties')
    expect(editorPanelToggleLabel('right', false)).toBe('Collapse properties')
  })
})
