/**
 * Whether the curve editor drawer (EDX-P6) is open. A tiny store because two
 * distant surfaces toggle it — the Animate tab's curve button and the
 * workspace layout (Motion opens it) — and the editor shell mounts it.
 */

import { create } from 'zustand'

interface CurveDrawerState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useCurveDrawer = create<CurveDrawerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
