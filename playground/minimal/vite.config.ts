import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Both settings below are REQUIRED for @elah/editor. Copy them verbatim.
export default defineConfig({
  plugins: [react()],

  worker: {
    // @elah/core runs the MP4 export in a module worker. Vite's default worker
    // format is IIFE, which cannot use `import` — the export would crash at
    // runtime. This is the only worker setting you need.
    format: 'es',
  },

  optimizeDeps: {
    // Vite's esbuild pre-bundle step rewrites `new URL('./x.js', import.meta.url)`
    // and breaks the export worker reference inside @elah/core. Excluding the
    // SDK packages (and mediabunny, which they inject) makes Vite serve them
    // from their real files so the reference survives.
    exclude: ['@elah/editor', '@elah/core', '@elah/react', '@elah/timeline', 'mediabunny'],
  },
})
