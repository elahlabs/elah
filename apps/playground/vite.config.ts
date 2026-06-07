import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@elah/editor': path.resolve(__dirname, '../../packages/editor/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Keep mediabunny in a separate chunk
          if (id.includes('mediabunny')) {
            return 'mediabunny'
          }
          // Export code in separate chunk
          if (id.includes('export')) {
            return 'editor-export'
          }
        },
      },
    },
  },
})
