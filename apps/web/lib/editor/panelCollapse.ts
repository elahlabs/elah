/**
 * Whether the editor's collapsible regions — the media panel on the left and
 * the Properties column on the right — are collapsed, kept across a reload.
 *
 * Follows the `myeditor-*` key convention, takes an injectable store so the
 * tests need no DOM, never throws, and falls back from a corrupt value to the
 * state that costs the user nothing (expanded). Kept in `lib/` because that is the only tree
 * this app's vitest run collects.
 */

export type EditorPanelId = 'left' | 'right'

/** Follows the `myeditor-*` convention set by `local-project.ts` and the theme. */
export const EDITOR_PANEL_COLLAPSED_KEYS: Record<EditorPanelId, string> = {
  left: 'myeditor-editor-left-panel-collapsed',
  right: 'myeditor-editor-right-panel-collapsed',
}

/** What each region is called in the toggle's label and tooltip. */
const EDITOR_PANEL_NAMES: Record<EditorPanelId, string> = {
  left: 'media panel',
  right: 'properties',
}

/** Narrowed to the three Storage methods used, so tests can pass a plain object. */
export type EditorPanelStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * The browser's localStorage, or null where there isn't one. The property read
 * is inside the try: Safari's private mode throws on access, not on use.
 */
export function editorPanelStoreOrNull(): EditorPanelStore | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * The stored preference, defaulting to expanded. Only the exact string `'1'`
 * collapses, so a corrupt or half-written value shows the panel rather than
 * hiding half the editor.
 */
export function readEditorPanelCollapsed(
  panel: EditorPanelId,
  store: EditorPanelStore | null = editorPanelStoreOrNull(),
): boolean {
  if (!store) return false
  try {
    return store.getItem(EDITOR_PANEL_COLLAPSED_KEYS[panel]) === '1'
  } catch {
    return false
  }
}

/** Records the preference. Collapsed is written; expanded removes the key. */
export function writeEditorPanelCollapsed(
  panel: EditorPanelId,
  collapsed: boolean,
  store: EditorPanelStore | null = editorPanelStoreOrNull(),
): void {
  if (!store) return
  try {
    // Removed rather than written as '0', so "never touched it" and "put it
    // back" are the same stored state — one default to reason about.
    if (collapsed) store.setItem(EDITOR_PANEL_COLLAPSED_KEYS[panel], '1')
    else store.removeItem(EDITOR_PANEL_COLLAPSED_KEYS[panel])
  } catch {
    // Nothing the caller can do, and nothing that breaks if it fails.
  }
}

/** The toggle's label and tooltip — one source, so the two never disagree. */
export function editorPanelToggleLabel(panel: EditorPanelId, collapsed: boolean): string {
  const name = EDITOR_PANEL_NAMES[panel]
  return collapsed ? `Expand ${name}` : `Collapse ${name}`
}
