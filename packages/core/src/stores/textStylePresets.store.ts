import { createStore } from 'zustand/vanilla'
import { generateId } from '../utils/id'

export interface TextStylePreset {
  id: string
  name: string
  fontFamily: string
  fontWeight: 'normal' | 'bold'
  fontSize: number
  textAlign: 'left' | 'center' | 'right'
  color: string
  opacity: number
}

// Shipped with the app so every project starts with a usable set of looks;
// not persisted and not deletable through the store's removePreset action.
export const BUILT_IN_TEXT_STYLE_PRESETS: TextStylePreset[] = [
  {
    id: 'builtin-subtitle',
    name: 'Subtitle',
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    fontSize: 32,
    textAlign: 'center',
    color: '#ffffff',
    opacity: 1,
  },
  {
    id: 'builtin-title',
    name: 'Title',
    fontFamily: 'Impact',
    fontWeight: 'bold',
    fontSize: 72,
    textAlign: 'center',
    color: '#ffffff',
    opacity: 1,
  },
  {
    id: 'builtin-caption',
    name: 'Caption',
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    fontSize: 26,
    textAlign: 'center',
    color: '#ffffff',
    opacity: 0.9,
  },
  {
    id: 'builtin-elegant',
    name: 'Elegant',
    fontFamily: 'Georgia',
    fontWeight: 'normal',
    fontSize: 48,
    textAlign: 'center',
    color: '#ffffff',
    opacity: 1,
  },
  {
    id: 'builtin-highlight',
    name: 'Highlight',
    fontFamily: 'Impact',
    fontWeight: 'bold',
    fontSize: 60,
    textAlign: 'center',
    color: '#ffde59',
    opacity: 1,
  },
]

export interface TextStylePresetsState {
  presets: TextStylePreset[]
}

export interface TextStylePresetsActions {
  addPreset: (preset: Omit<TextStylePreset, 'id'>) => void
  removePreset: (id: string) => void
}

/**
 * User-saved text looks (Ring 2). Vanilla; the React binding binds it into
 * the `useTextStylePresetsStore` hook.
 */
export const textStylePresetsStore = createStore<TextStylePresetsState & TextStylePresetsActions>()(
  (set) => ({
    presets: [],

    addPreset: (preset) =>
      set((s) => ({ presets: [...s.presets, { ...preset, id: generateId() }] })),

    removePreset: (id) =>
      set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
  }),
)
