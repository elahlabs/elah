import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    // @elah/core spawns the MP4 export worker as a module worker
    // (`new Worker(new URL('./ExportWorker.js', import.meta.url), { type: 'module' })`).
    format: 'es',
  },
  optimizeDeps: {
    // Let Vite serve these from their real files so the `new URL(...)` worker
    // reference inside @elah/core resolves correctly instead of being rewritten
    // by the esbuild pre-bundle step. mediabunny is excluded for the same reason.
    exclude: ['@elah/editor', '@elah/core', '@elah/timeline', 'mediabunny'],
  },
})
