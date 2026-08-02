import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    // @elah/core spawns the MP4 export worker as a module worker
    // (`new Worker(new URL('./ExportWorker.js', import.meta.url), { type: 'module' })`).
    // Without `format: 'es'` Vite emits an IIFE worker and the export crashes.
    format: 'es',
  },
  optimizeDeps: {
    // Let Vite serve these from their real files so the `new URL(...)` worker
    // reference inside @elah/core resolves correctly instead of being rewritten
    // by the esbuild pre-bundle step. mediabunny is excluded for the same reason.
    //
    // Both of these are required — see playground/minimal for the same config
    // on a bare app.
    exclude: ['@elah/editor', '@elah/core', '@elah/react', '@elah/timeline', 'mediabunny'],
  },
})
